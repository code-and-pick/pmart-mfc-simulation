// 재고 변동 기록 — 재고 실시간 스트림(stock-changed)을 SKU 한 줄씩으로 풀어 둔다(사용자 2026-11-25 "주문에 따른 실시간 차감, 회수했을 때 정상재고면 증가를 볼 수 있는 탭").
// 수량 규칙(IV-07/08/09)은 서버 값 그대로 보여 줄 뿐 계산하지 않는다. 보유(H) 증감 = 그 커밋의 위치 단위 증감 합.
// 같은 이벤트가 다시 올 수 있어(이어 받기) SKU 마다 version 이 지금보다 큰 것만 받는다(계약).

import type { StockStreamEvent } from '../domain/contract';
import type { StreamState } from '../backend/http/stockStream';

/** 화면 묶음 — 주문(예약)·인계·취소 해제·회수(반입·검수 정상)·취소 복귀·입고·그 밖 */
export type FeedKind = 'ORDER' | 'HANDOVER' | 'CANCEL' | 'RETURN_IN' | 'RETURN_OK' | 'CANCEL_RETURN' | 'INBOUND' | 'MOVE' | 'OTHER';

const LABEL: Record<string, [FeedKind, string]> = {
  RESERVE: ['ORDER', '주문 예약'],
  RESECURE: ['ORDER', '주문 재확보'],
  HANDOVER: ['HANDOVER', '라이더 인계'],
  RELEASE: ['CANCEL', '주문 취소 — 예약 풀림'],
  EXPIRE: ['CANCEL', '예약 만료 — 풀림'],
  CANCEL_RETURN: ['CANCEL_RETURN', '취소품 선반 복귀'],
  QUALITY_RELEASE: ['RETURN_OK', '검수 정상 — 판매 가능'],
  QUALITY_QUARANTINE: ['OTHER', '격리'],
  QUALITY_DISPOSE: ['OTHER', '폐기'],
  QUALITY_HOLD: ['OTHER', '품질 보류'],
  QUALITY_SALE_HOLD: ['OTHER', '판매 보류'],
  QUALITY_SALE_RELEASE: ['OTHER', '판매 보류 풀림'],
  SHORTAGE: ['OTHER', '결품'],
  STOCK_EXCEPTION: ['OTHER', '재고 예외'],
  CORRECTION: ['OTHER', '재고 정정'],
  COUNT_ADJ: ['OTHER', '실사 조정'],
  TASK_EXECUTION: ['MOVE', '작업(적치·피킹·포장)'],
};

export interface FeedRow {
  key: string;
  atMs: number;
  cause: string;
  kind: FeedKind;
  label: string;
  sku: string;
  /** 판매 가능(A = E − R) 증감 */
  availableDelta: number;
  /** 보유(H) 증감 = 위치 단위 증감 합 */
  onHandDelta: number;
  /** 바뀐 뒤 센터 값 */
  after: { H: number; Q: number; E: number; R: number; A: number };
}

/** 센터·SKU 지금 값(전체 재고) — 처음은 스냅샷, 그 뒤는 스트림 */
export interface SkuNow {
  sku: string;
  name?: string;
  H: number;
  Q: number;
  E: number;
  R: number;
  A: number;
  /** 스트림으로 마지막에 바뀐 시각·증감·원인 */
  changedAtMs?: number;
  lastAvailableDelta?: number;
  lastOnHandDelta?: number;
  lastLabel?: string;
  lastKind?: FeedKind;
  /** 스트림이 마지막으로 바꾼 시각(스냅샷이 더 옛 값으로 덮지 않게) */
  streamMs?: number;
}

export interface FeedTotal {
  n: number;
  units: number;
}

/** 회수품 반입 자리(RTN-) — TIN 이 거기면 입고가 아니라 회수 반입 */
const isReturnSpot = (code: string) => code.startsWith('RTN-');

export function classify(cause: string, units: { locationCode: string }[]): [FeedKind, string] {
  if (cause === 'TIN') return units.some((u) => isReturnSpot(u.locationCode)) ? ['RETURN_IN', '회수 반입 — 격리(검수 전)'] : ['INBOUND', '입고 수령'];
  if (cause.startsWith('MOVE_')) return ['MOVE', '위치 이동'];
  return LABEL[cause] ?? ['OTHER', cause];
}

export class StockFeed {
  /** 오래된 것부터 — 화면은 거꾸로 */
  readonly rows: FeedRow[] = [];
  readonly totals = new Map<FeedKind, FeedTotal>();
  private readonly ver = new Map<string, number>();
  version = 0;
  state: StreamState | 'off' = 'off';
  stateWhy: string | undefined;
  /** 처음 연결된 시각(이때부터 셈) */
  sinceMs: number | null = null;
  /** 놓친 변동이 있을 수 있었던 마지막 시각(resync·이어 받기 실패) */
  gapAtMs: number | null = null;
  /** 전체 재고(SKU → 지금 값) */
  readonly skus = new Map<string, SkuNow>();
  /** 스냅샷 읽기 — null 안 읽음, 'busy', 끝난 시각(ms) */
  snapshot: { state: 'busy' | 'done' | 'error'; atMs: number; why?: string } | null = null;
  /** 셈 시작 때 센터 합계(첫 스냅샷이 끝난 때) — 탭 큰 숫자 "15,004개 중 −153" 의 앞 숫자(사용자 2026-11-25) */
  base: { A: number; H: number } | null = null;
  /** ready(이어 받기 아님)·resync 뒤 스냅샷을 다시 읽으라는 표시 — 시뮬레이션이 본다 */
  needSnapshot = false;

  /**
   * 스냅샷 한 SKU — LOT 합(H·Q·E·R·A). 읽기 시작(startedMs) 뒤에 스트림이 바꾼 SKU 는 덮지 않는다(스트림 값이 더 새 것).
   */
  setSnapshot(sku: string, lots: { onHand: number; quarantined: number; sellable: number; reserved: number; available: number }[], startedMs: number, name?: string | null) {
    const cur = this.skus.get(sku);
    if (name && cur) cur.name ??= name;
    if (cur?.streamMs !== undefined && cur.streamMs >= startedMs) return;
    const v = lots.reduce((a, l) => ({ H: a.H + l.onHand, Q: a.Q + l.quarantined, E: a.E + l.sellable, R: a.R + l.reserved, A: a.A + l.available }), { H: 0, Q: 0, E: 0, R: 0, A: 0 });
    this.skus.set(sku, { ...cur, sku, name: cur?.name ?? name ?? undefined, ...v });
  }

  snapshotState(state: 'busy' | 'done' | 'error', why?: string) {
    this.snapshot = { state, atMs: this.nowMs(), why };
    // 셈 시작 합계 = 첫 스냅샷 값에서 그 사이 스트림으로 이미 센 양을 되돌린 것(판매 가능·보유)
    if (state === 'done' && !this.base) {
      let A = 0;
      let H = 0;
      for (const x of this.skus.values()) {
        A += x.A;
        H += x.H;
      }
      for (const r of this.rows) {
        A -= r.availableDelta;
        H -= r.onHandDelta;
      }
      this.base = { A, H };
    }
    this.version++;
  }

  constructor(
    private readonly keep = 500,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  setState(s: StreamState, why?: string) {
    this.state = s;
    this.stateWhy = why;
    if (s === 'open') this.sinceMs ??= this.nowMs();
    this.version++;
  }

  apply(e: StockStreamEvent) {
    if (e.type === 'resync' || (e.type === 'ready' && e.resumed === false)) {
      // 처음 붙을 때(ready)는 스냅샷만, 그 뒤 놓쳤을 수 있으면 표시도
      if (e.type === 'resync' || this.rows.length > 0 || this.skus.size > 0) this.gapAtMs = this.nowMs();
      this.needSnapshot = true;
      this.version++;
      return;
    }
    if (e.type !== 'stock-changed' || !e.items?.length) return;
    const cause = e.cause ?? '?';
    const atMs = (e.occurredAt && Date.parse(e.occurredAt)) || this.nowMs();
    const units = e.units ?? [];
    const [kind, label] = classify(cause, units);
    let added = false;
    for (const it of e.items) {
      if (it.version <= (this.ver.get(it.sku) ?? -Infinity)) continue;
      this.ver.set(it.sku, it.version);
      const onHandDelta = units.filter((u) => u.sku === it.sku).reduce((a, u) => a + u.delta, 0);
      this.rows.push({
        key: `${e.eventId ?? e.commitId ?? atMs}:${it.sku}`,
        atMs,
        cause,
        kind,
        label,
        sku: it.sku,
        availableDelta: it.availableDelta,
        onHandDelta,
        after: { H: it.onHandQty, Q: it.quarantinedQty, E: it.sellableQty, R: it.reservedQty, A: it.availableQty },
      });
      const prev = this.skus.get(it.sku);
      this.skus.set(it.sku, {
        sku: it.sku,
        name: prev?.name,
        H: it.onHandQty,
        Q: it.quarantinedQty,
        E: it.sellableQty,
        R: it.reservedQty,
        A: it.availableQty,
        changedAtMs: atMs,
        lastAvailableDelta: it.availableDelta,
        lastOnHandDelta: onHandDelta,
        lastLabel: label,
        lastKind: kind,
        streamMs: this.nowMs(),
      });
      const t = this.totals.get(kind) ?? { n: 0, units: 0 };
      t.n++;
      // 인계는 보유가 빠지는 양, 나머지는 판매 가능 증감
      t.units += kind === 'HANDOVER' ? onHandDelta : it.availableDelta;
      this.totals.set(kind, t);
      added = true;
    }
    if (!added) return;
    if (this.rows.length > this.keep) this.rows.splice(0, this.rows.length - this.keep);
    this.version++;
  }
}
