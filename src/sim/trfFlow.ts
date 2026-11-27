// 입고 추적 탭 맨 위 "TRF 흐름" — DC 시뮬레이터 TRF 흐름 카드와 같은 모양(사용자 2026-11-27 "입고 할 때 실시간으로 내가 작업하는 거 오른쪽 탭으로 이런 식으로 뜨게").
// 송장 하나: 머리(T/W 번호·상품) → 단계(점·오른쪽 값) → 차량 → MFC 작업(검사·적치) → 기록(최신순, 시각·누가).
// MFC 계정으로 읽는 것만 — 공급 요청(있으면)·운행·입고 예정·입고 작업·재고 확정 기록(stock-ledger). React 없음.
import type { InboundPromise, InboundTask, StockLedgerEntry, SupplyRequest, SupplyTransfer, TmsTrip } from '../domain/contract';

type Stop = TmsTrip['stops'][number];
export type TfState = 'done' | 'now' | 'wait' | 'warn';
export interface TfStep {
  key: string;
  title: string;
  state: TfState;
  /** 오른쪽 값 — 수량(4/4)·시각·번호 */
  value?: string;
}
export interface TfEvent {
  at: string;
  title: string;
  who?: string;
}
export interface TfTask {
  taskId: string;
  kind: '품질검사' | '적치' | '격리 이동';
  product: string;
  done: number;
  planned: number;
  state: 'READY' | 'COMPLETED';
  from: string;
  /** 적치한 칸(기록에서) */
  to: string[];
  who?: string;
}
export interface TrfFlowView {
  trfId: string;
  /** 서버 상태 배지 */
  badge: string;
  products: { name: string; qty: number }[];
  steps: TfStep[];
  vehicle: { title: string; sub: string } | null;
  tasks: TfTask[];
  events: TfEvent[];
}

const hm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const hms = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function trfFlowView(p: {
  trfId: string;
  promise: InboundPromise | null;
  link: { trip: TmsTrip; stop: Stop } | null;
  tasks: InboundTask[];
  ledger: StockLedgerEntry[];
  supply: { req: SupplyRequest; t: SupplyTransfer } | null;
  name: (sku: string) => string;
  who: (operatorId: string | null | undefined) => string | undefined;
  mfcName: string;
}): TrfFlowView {
  const { promise, link, tasks, ledger, supply } = p;
  const trip = link?.trip ?? null;
  const stop = link?.stop ?? null;
  const lines = promise?.lines ?? [];
  const products = lines.length
    ? lines.map((l) => ({ name: l.productName ?? p.name(l.sku), qty: l.expectedQty }))
    : (supply?.t.lines ?? []).map((l) => ({ name: p.name(l.sku), qty: l.qty }));
  const total = sum(products.map((x) => x.qty));
  const sent = !!supply?.t.sentAt || !!promise;
  const departed = !!promise?.departedAt || trip?.state === 'DEPARTED' || trip?.state === 'COMPLETED';
  const arrived = !!stop?.arrivedAt || !!promise?.arrivedAt;
  const handed = !!stop?.handover || stop?.state === 'HANDED_OVER' || stop?.state === 'DEPARTED';
  const applied = (promise?.receipts ?? []).filter((r) => r.inventoryApplyStatus === 'APPLIED');
  const received = applied.length > 0 || promise?.state === 'TIN_POSTED';
  const recvQty = sum(lines.map((l) => l.receivedQty ?? 0));
  const ins = tasks.filter((t) => t.taskType === 'INSPECT');
  const puts = tasks.filter((t) => t.taskType === 'PUTAWAY');
  const q = (xs: InboundTask[]) => `${sum(xs.map((x) => x.doneQty))}/${sum(xs.map((x) => x.plannedQty))}`;
  const allDone = (xs: InboundTask[]) => xs.length > 0 && xs.every((x) => x.state === 'COMPLETED');
  const end = received && allDone(ins) && allDone(puts);
  const raw: TfStep[] = [];
  if (supply) {
    raw.push({ key: 'order', title: '발주·승인', state: supply.req.state === 'APPROVED' ? 'done' : 'now', value: hm(supply.req.decidedAt) });
    raw.push({ key: 'send', title: 'DC 로 보냄', state: supply.t.sentAt ? 'done' : supply.t.error ? 'warn' : 'now', value: hm(supply.t.sentAt) });
  }
  raw.push({ key: 'dc', title: 'DC 출고 작업', state: departed ? 'done' : sent ? 'now' : 'wait', value: trip ? ({ SCHEDULED: '배차', CHECKED_IN: '입차', LOADED: '상차 끝', DEPARTED: '출발', COMPLETED: '끝', CANCELLED: '취소' } as const)[trip.state] : '' });
  raw.push({ key: 'depart', title: 'DC 출발', state: departed ? 'done' : 'wait', value: hm(promise?.departedAt ?? trip?.departedAt) });
  raw.push({ key: 'arrive', title: 'MFC 도착', state: arrived ? 'done' : departed ? 'now' : 'wait', value: hm(stop?.arrivedAt ?? promise?.arrivedAt) });
  raw.push({
    key: 'handover',
    title: '하차 인계',
    state: stop?.handover?.result === 'MISMATCHED' ? 'warn' : handed ? 'done' : arrived ? 'now' : 'wait',
    value: stop?.handover ? `${stop.handover.receivedBoxes ?? '?'}/${stop.handover.shippedBoxes ?? '?'}` : hm(stop?.handedOverAt),
  });
  raw.push({ key: 'receive', title: '수령', state: received ? 'done' : (promise?.receipts ?? []).some((r) => r.inventoryApplyStatus === 'REJECTED') ? 'warn' : arrived ? 'now' : 'wait', value: received ? `${recvQty}/${total}` : '' });
  raw.push({ key: 'inspect', title: '품질검사', state: allDone(ins) ? 'done' : received ? 'now' : 'wait', value: ins.length ? q(ins) : '' });
  raw.push({ key: 'putaway', title: '적치', state: allDone(puts) && allDone(ins) ? 'done' : puts.length ? 'now' : 'wait', value: puts.length ? q(puts) : '' });
  raw.push({ key: 'end', title: '끝 — 판매 가능', state: end ? 'done' : 'wait' });
  // 지금은 하나만
  let seen = false;
  const steps = raw.map((s) => {
    if (s.state === 'now' || s.state === 'warn') {
      if (seen && s.state === 'now') return { ...s, state: 'wait' as const };
      seen = true;
    }
    return s;
  });

  const badge = end ? '끝' : promise?.state ?? (supply?.t.sentAt ? 'DC 작업 중' : '보내는 중');
  const vehicle = trip
    ? {
        title: `차량 ${trip.vehicleId ?? trip.plateNo ?? '?'} · ${p.mfcName} ${stop ? ({ PLANNED: '오는 중', ARRIVED: '도착', HANDED_OVER: '인계 끝', DEPARTED: '정차 출발' } as const)[stop.state] : ''}`,
        sub: `운행 ${trip.tripId}${trip.driverName ? ` · ${trip.driverName}` : ''}${stop?.plannedArrivalAt ? ` · 도착 예정 ${hm(stop.plannedArrivalAt)}` : ''}${stop?.arrivedAt ? ` · 도착 ${hm(stop.arrivedAt)}` : ''}`,
      }
    : null;

  // 작업 — 적치한 칸·누가는 재고 기록(sourceRef = 작업 ID)에서
  const byRef = new Map<string, StockLedgerEntry[]>();
  for (const e of ledger) if (e.sourceRef) byRef.set(e.sourceRef, [...(byRef.get(e.sourceRef) ?? []), e]);
  const kindOf = (t: InboundTask) => (t.taskType === 'INSPECT' ? '품질검사' : t.taskType === 'PUTAWAY' ? '적치' : '격리 이동') as TfTask['kind'];
  const taskRows: TfTask[] = tasks.map((t) => {
    const es = byRef.get(t.taskId) ?? [];
    const to = [...new Set(es.flatMap((e) => e.entries.filter((x) => x.delta > 0 && x.symbol === 'H' && x.locationCode !== t.locationCode).map((x) => x.locationCode)))];
    return { taskId: t.taskId, kind: kindOf(t), product: t.productName ?? p.name(t.sku), done: t.doneQty, planned: t.plannedQty, state: t.state, from: t.locationCode, to, who: p.who(es[0]?.actorOperatorId ?? t.assigneeId) };
  });

  // 기록 — 최신순
  const ev: TfEvent[] = [];
  const add = (at: string | null | undefined, title: string, who?: string) => at && ev.push({ at, title, who });
  if (supply) {
    add(supply.req.submittedAt, `발주 ${supply.req.supplyRequestId.slice(-6)}`);
    add(supply.req.decidedAt, '승인', p.who(supply.req.decidedBy));
    add(supply.t.sentAt, 'DC 로 보냄(이관 요청)');
  }
  add(trip?.departedAt ?? promise?.departedAt, `DC 출발${trip ? ` · 운행 ${trip.tripId}` : ''}`);
  add(stop?.arrivedAt, `MFC 도착 · 정차 ${stop?.seq ?? ''}`);
  add(promise?.arrivedAt, '입고 예정 도착 등록');
  if (stop?.handover) add(stop.handedOverAt, `하차 인계 · 박스 ${stop.handover.result === 'MATCHED' ? '맞음' : '차이 있음'} ${stop.handover.receivedBoxes ?? '?'}/${stop.handover.shippedBoxes ?? '?'}`, (stop.handover as { receiverName?: string }).receiverName);
  add(stop?.departedAt, '정차 출발');
  for (const r of promise?.receipts ?? []) add(r.postedAt ?? r.receivedAt, `수령 ${r.inventoryApplyStatus === 'APPLIED' ? '확정(재고 반영)' : r.inventoryApplyStatus === 'REJECTED' ? `거절 ${r.rejectReason ?? ''}` : (r.inventoryApplyStatus ?? '')}`);
  for (const t of tasks)
    for (const e of byRef.get(t.taskId) ?? []) {
      const moved = e.entries.filter((x) => x.symbol === 'H' && x.delta > 0 && x.locationCode !== t.locationCode).map((x) => x.locationCode);
      const n = sum(e.entries.filter((x) => x.symbol === 'H' && x.delta > 0).map((x) => x.delta)) || sum(e.entries.filter((x) => x.symbol === 'E' && x.delta > 0).map((x) => x.delta));
      add(e.occurredAt, `${kindOf(t)} ${t.productName ?? p.name(t.sku)}${n ? ` ${n}개` : ''}${moved.length ? ` → ${moved.join(', ')}` : ''}`, p.who(e.actorOperatorId));
    }
  ev.sort((a, b) => b.at.localeCompare(a.at));
  return { trfId: p.trfId, badge, products, steps, vehicle, tasks: taskRows, events: ev.map((e) => ({ ...e, at: hms(e.at) })) };
}
