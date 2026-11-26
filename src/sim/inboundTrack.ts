// 입고 추적 — DC(CDC) 이관 입고와 센터 발주 입고를 한 건씩: 예정 → 도착 → 수령 → 검사 → 적치 → 끝(사용자 2026-11-26
// "DC에서 입고 받은 거 적치하고, 입고받아서 추가되는 재고 추적 되는 거 만들어").
// 서버 값만 모아 보여 준다 — 수량 규칙을 계산하지 않는다. 실서버는 입고 예정·입고 작업(receiptId)·센터 재고(그 입고의 LOT 단위 행)에서,
// MOCK 은 입고 차량·하차 칸·적치 기록에서 같은 모양을 만든다.
//  - 수령(TIN) = 보유 H+q(검사 전), 검사 정상 → 적치(PUTAWAY)에서 판매 가능 E+q (mfc-inventory 0.33~ "E 는 검수·적치 뒤에만 는다")

import type { CenterStock, InboundPromise, InboundTask } from '../domain/contract';

export type TrackStage = 'EXPECTED' | 'ARRIVED' | 'RECEIVED' | 'STOWING' | 'DONE' | 'CANCELLED';

export const STAGE_KO: Record<TrackStage, string> = {
  EXPECTED: '오는 중',
  ARRIVED: '도착 · 하차',
  RECEIVED: '수령 · 검사',
  STOWING: '적치 중',
  DONE: '끝',
  CANCELLED: '취소 · 종결',
};

/** 단계 막대 짧은 글(좁은 패널에서 줄바꿈 안 되게) */
export const STEP_KO: Record<TrackStage, string> = { EXPECTED: '오는 중', ARRIVED: '도착', RECEIVED: '수령', STOWING: '적치', DONE: '끝', CANCELLED: '종결' };

/** 목록 순서 — 하차·수령·적치 중 → 오는 중 → 끝 */
export const STAGE_ORDER: Record<TrackStage, number> = { ARRIVED: 0, RECEIVED: 1, STOWING: 2, EXPECTED: 3, DONE: 4, CANCELLED: 5 };

export interface TrackLine {
  sku: string;
  name?: string | null;
  /** 예정(출발·승인) 수량 */
  expected: number;
  /** 수령(재고 반영) */
  received: number;
  /** 검사 끝(정상·격리 판정) — 검사 단계가 없는 흐름(MOCK)은 수령과 같다 */
  inspected: number;
  /** 격리 */
  quarantined: number;
  /** 적치 끝(선반·보충재고 칸) */
  stowed: number;
  /** 아직 입고칸(수령 뒤 적치 전) */
  atDock: number;
  /** 놓인 칸과 양 */
  placed: { loc: string; qty: number }[];
}

export interface InboundTrack {
  /** 화면 키 */
  key: string;
  kind: 'DC' | 'ORDER';
  /** DC = trfId, 발주 = receiptId */
  id: string;
  /** 출발 센터(DC 이름) */
  from?: string | null;
  stage: TrackStage;
  /** 서버 상태 원문(작게) */
  serverState: string;
  lines: TrackLine[];
  /** 수령 받은 ID(작업 조회 키) */
  receiptIds: string[];
  /** 수령을 못 하는 까닭(예: 출발 정보 없음) */
  blockedWhy?: string | null;
  /** 정렬·표시 시각(ms) */
  atMs?: number | null;
}

export function sumLines(lines: TrackLine[]) {
  return lines.reduce(
    (a, l) => ({ expected: a.expected + l.expected, received: a.received + l.received, inspected: a.inspected + l.inspected, quarantined: a.quarantined + l.quarantined, stowed: a.stowed + l.stowed, atDock: a.atDock + l.atDock }),
    { expected: 0, received: 0, inspected: 0, quarantined: 0, stowed: 0, atDock: 0 },
  );
}

/** 단계 — 서버 상태 + 작업 진행으로 */
export function stageOf(serverStage: 'EXPECTED' | 'ARRIVED' | 'RECEIVED' | 'CANCELLED', lines: TrackLine[], tasksOpen: boolean): TrackStage {
  if (serverStage !== 'RECEIVED') return serverStage;
  const s = sumLines(lines);
  if (s.received > 0 && !tasksOpen && s.atDock === 0) return 'DONE';
  if (s.stowed > 0) return 'STOWING';
  return 'RECEIVED';
}

/**
 * 실서버 한 SKU 줄 — 그 입고의 작업(검사·적치 doneQty)과 그 작업 LOT 의 센터 재고 단위 행(지금 어디에 얼마나)에서.
 * 적치 칸 = 그 LOT 의 STORED 행, 입고칸 = 아직 UNSTOWED 행, 격리 = QUARANTINED 행.
 */
export function realLine(sku: string, name: string | null | undefined, expected: number, received: number, tasks: InboundTask[], stock: CenterStock | undefined): TrackLine {
  const mine = tasks.filter((t) => t.sku === sku);
  const lots = new Set(mine.map((t) => t.lotId).filter(Boolean));
  const inspected = mine.filter((t) => t.taskType === 'INSPECT').reduce((a, t) => a + t.doneQty, 0);
  const stowedTask = mine.filter((t) => t.taskType === 'PUTAWAY').reduce((a, t) => a + t.doneQty, 0);
  const units = (stock?.units ?? []).filter((u) => lots.has(u.lotId));
  const placedMap = new Map<string, number>();
  let atDock = 0;
  let quarantined = 0;
  for (const u of units) {
    if (u.qualityState === 'QUARANTINED' || u.qualityState === 'DISPOSAL_PENDING') quarantined += u.qty;
    else if (u.workState === 'STORED') placedMap.set(u.locationCode, (placedMap.get(u.locationCode) ?? 0) + u.qty);
    else if (u.workState === 'UNSTOWED') atDock += u.qty;
  }
  const placed = [...placedMap].map(([loc, qty]) => ({ loc, qty })).sort((a, b) => b.qty - a.qty || a.loc.localeCompare(b.loc));
  return { sku, name: name && name !== sku ? name : (stock?.productName ?? name), expected, received, inspected, quarantined, stowed: stowedTask, atDock, placed };
}

/** MOCK 한 건(입고 차량) — 하차 칸 상태와 적치 기록에서 */
export interface MockTruckTrack {
  trfId: string;
  lines: { sku: string; qty: number }[];
  /** 차량 상태 */
  truck: 'APPROACHING' | 'DOCKED' | 'UNLOADING' | 'DONE' | 'LEAVING' | 'GONE';
  /** 수령 등록 끝 */
  received: boolean;
  /** SKU → 아직 하차 칸에 남은 양(수령 뒤) */
  onDock: Map<string, number>;
  /** SKU → 놓인 칸 */
  placed: Map<string, { loc: string; qty: number }[]>;
  atMs: number;
}

export function mockTrack(t: MockTruckTrack, nameOf: (sku: string) => string | undefined): InboundTrack {
  const lines: TrackLine[] = t.lines.map((l) => {
    const placed = t.placed.get(l.sku) ?? [];
    const stowed = placed.reduce((a, p) => a + p.qty, 0);
    const received = t.received ? l.qty : 0;
    return { sku: l.sku, name: nameOf(l.sku), expected: l.qty, received, inspected: received, quarantined: 0, stowed, atDock: t.received ? (t.onDock.get(l.sku) ?? 0) : 0, placed };
  });
  const server = t.received ? 'RECEIVED' : t.truck === 'APPROACHING' ? 'EXPECTED' : 'ARRIVED';
  const open = lines.some((l) => l.atDock > 0);
  return {
    key: `mock:${t.trfId}`,
    kind: 'DC',
    id: t.trfId,
    from: '가상 DC',
    stage: stageOf(server, lines, open),
    serverState: t.received ? 'TIN_POSTED' : t.truck === 'APPROACHING' ? 'EXPECTED' : 'RECEIVING',
    lines,
    receiptIds: [],
    atMs: t.atMs,
  };
}

/** 출발 줄이 아직 없는 예정(매니페스트만 온 것)은 LPN 목록을 SKU 별로 합쳐 예정 수량으로 본다 */
export function packageLines(p: InboundPromise, nameOf: (sku: string) => string): { sku: string; name: string; expected: number; received: number }[] {
  const m = new Map<string, number>();
  for (const k of p.packages ?? []) m.set(k.sku, (m.get(k.sku) ?? 0) + k.qty);
  return [...m].map(([sku, expected]) => ({ sku, name: nameOf(sku), expected, received: 0 }));
}
