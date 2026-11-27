// 입고 추적 — DC(CDC) 이관 입고와 센터 발주 입고를 한 건씩: 예정 → 도착 → 수령 → 검사 → 적치 → 끝(사용자 2026-11-26
// "DC에서 입고 받은 거 적치하고, 입고받아서 추가되는 재고 추적 되는 거 만들어").
// 서버 값만 모아 보여 준다 — 수량 규칙을 계산하지 않는다. 실서버는 입고 예정·입고 작업(receiptId)·센터 재고(그 입고의 LOT 단위 행)에서,
// MOCK 은 입고 차량·하차 칸·적치 기록에서 같은 모양을 만든다.
//  - 수령(TIN) = 보유 H+q(검사 전), 검사 정상 → 적치(PUTAWAY)에서 판매 가능 E+q (mfc-inventory 0.33~ "E 는 검수·적치 뒤에만 는다")

import type { CenterStock, InboundPromise, InboundTask, TmsTrip } from '../domain/contract';

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
  /** 받기 버튼을 보일까(실서버 DC — 도착·인계 또는 수령할 수 있음) */
  canReceive?: boolean;
  /** DC 간선 운행(TMS) — 차량·기사·도착 예정·이 센터 정차 상태 */
  trip?: TripInfo | null;
  /** 정렬·표시 시각(ms) */
  atMs?: number | null;
}

export interface TripInfo {
  tripId: string;
  /** 운행: 상차 전·운행 중·끝 */
  trip: TmsTrip['state'];
  /** 이 센터 정차: 오는 중(PLANNED)·도착·인계·떠남 */
  stop: TmsTrip['stops'][number]['state'];
  driver?: string | null;
  plate?: string | null;
  departedAtMs?: number | null;
  etaMs?: number | null;
  delayed?: boolean;
  boxes: number;
  handover?: 'MATCHED' | 'MISMATCHED' | null;
}

export function tripInfo(trip: TmsTrip, stop: TmsTrip['stops'][number]): TripInfo {
  return {
    tripId: trip.tripId,
    trip: trip.state,
    stop: stop.state,
    driver: trip.driverName,
    plate: trip.plateNo,
    departedAtMs: Date.parse(trip.departedAt ?? '') || null,
    etaMs: Date.parse(stop.arrivedAt ?? stop.estimatedArrivalAt ?? stop.plannedArrivalAt ?? '') || null,
    delayed: stop.delayed ?? trip.delayed,
    boxes: (trip.transfers ?? []).filter((x) => x.stopSeq === stop.seq).reduce((a, x) => a + x.lpns.length, 0),
    handover: stop.handover?.result ?? null,
  };
}

/** 이 센터에 와 있는 DC 차량 하나(정차 ARRIVED·HANDED_OVER — 정차 출발 전) */
export interface DcArrival {
  /** tripId:seq */
  key: string;
  tripId: string;
  seq: number;
  cdcId: string;
  tempClass: TmsTrip['tempClass'];
  driver?: string | null;
  /** DEPARTED = DC 가 정차 출발을 보냈지만 아직 수령 전(pollDcTrips 가 수령 끝난 것·오래된 것은 뺀다) */
  stop: 'ARRIVED' | 'HANDED_OVER' | 'DEPARTED';
  trfIds: string[];
  /** 그 정차 박스(상차 스캔 LPN) — PDA 하차 때 찍을 바코드 */
  boxes: { lpn: string; trfId: string }[];
  arrivedAtMs: number | null;
  handover?: 'MATCHED' | 'MISMATCHED' | null;
  /** 고른 하차 방법(아직이면 null) */
  mode: 'VIRTUAL' | 'PDA' | null;
  /** 그 정차 TRF 의 입고 예정(읽은 것만) — PDA 수령 때 찍을 송장 라벨·상품 바코드 */
  trfs?: DcArrivalTrf[];
}

export interface DcArrivalTrf {
  trfId: string;
  /** 송장 라벨 값 `TRF:{trfId}:{version}`(mfc-inbound 0.8.0 BR-53 R10 — PDA 는 trfId 만 비교) */
  label: string;
  state: string;
  /** 수령이 서버에서 거절됐으면 까닭(예 INVENTORY_REJECTED:LOCATION_NOT_REGISTERED) */
  rejected?: string | null;
  /** 수령 가능(출발 기록·품목 있음) — 아니면 R-49 */
  canReceipt: boolean;
  products: { sku: string; name: string; expected: number; barcodes: string[] }[];
}

/** 송장 라벨 값 — 버전은 TRF 버전(없으면 입고 예정 버전) */
export function trfLabelOf(p: Pick<InboundPromise, 'trfId' | 'trfVersion' | 'version'>): string {
  return `TRF:${p.trfId}:${p.trfVersion ?? p.version ?? 1}`;
}

export function dcArrivalsOf(trips: TmsTrip[], mfcId: string, modeOf: (key: string) => 'VIRTUAL' | 'PDA' | null, _name?: (sku: string) => string): DcArrival[] {
  const out: DcArrival[] = [];
  for (const trip of trips) {
    for (const stop of trip.stops) {
      if (stop.mfcId !== mfcId || (stop.state !== 'ARRIVED' && stop.state !== 'HANDED_OVER' && stop.state !== 'DEPARTED')) continue;
      const key = `${trip.tripId}:${stop.seq}`;
      out.push({
        key,
        tripId: trip.tripId,
        seq: stop.seq,
        cdcId: trip.cdcId,
        tempClass: trip.tempClass,
        driver: trip.driverName,
        stop: stop.state as DcArrival['stop'],
        trfIds: stop.trfIds,
        boxes: (trip.transfers ?? []).filter((x) => x.stopSeq === stop.seq).flatMap((x) => x.lpns.map((lpn) => ({ lpn, trfId: x.trfId }))),
        arrivedAtMs: Date.parse(stop.arrivedAt ?? '') || null,
        handover: stop.handover?.result ?? null,
        mode: modeOf(key),
      });
    }
  }
  const rank = { ARRIVED: 0, HANDED_OVER: 1, DEPARTED: 2 } as const;
  return out.sort((a, b) => rank[a.stop] - rank[b.stop] || (a.arrivedAtMs ?? 0) - (b.arrivedAtMs ?? 0));
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
    from: '칠곡 DC',
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

/** 바코드 탭 — 열린 입고 작업 하나와 찍을 것(PDA 순서: 출발 칸 → 상품 → 놓을 칸) */
export interface InboundScanItem {
  task: InboundTask;
  remain: number;
  /** 놓을 칸 — 적치·격리 이동만. why: 서버 추천 / 서버 추천 없음 → 같은 상품이 있는 칸 */
  dest: { code: string; qty: number | null; why: 'SUGGESTED' | 'SAME_SKU' | 'EMPTY_RESERVE' | 'PICK_FACE' | 'QUARANTINE' }[];
  /** 어느 입고 건인가 — 탭 묶음 키·이름(DC 입고면 TRF 번호) */
  source: InboundSource;
}

/** 입고 알림 카드 하나 */
export interface InboundAlert {
  id: number;
  /** 같은 일을 두 번 알리지 않는 키 */
  key: string;
  at: number;
  tone: 'info' | 'act' | 'ok' | 'warn';
  title: string;
  /** 번호는 줄 하나에 하나 */
  lines: string[];
  /** 닫을 때까지 남김(도착 등 할 일) */
  sticky?: boolean;
  /** 누르면 열 오른쪽 탭 */
  view?: 'scan' | 'inbound';
}

/** 바코드 탭 — 방금 끝난 입고 작업(목록에서 빠진 뒤 서버가 COMPLETED) */
export interface InboundScanDone {
  task: InboundTask;
  source: InboundSource;
  atMs: number;
}

export interface InboundSource {
  key: string;
  label: string;
  trfId?: string | null;
}

/** 수령 ID → 입고 건(DC 입고 = TRF, 그 밖은 수령 종류). trfOf 는 수령 ID → trfId(입고 예정 receipts 에서) */
export function inboundSourceOf(receiptId: string, trfOf: (rid: string) => string | undefined): InboundSource {
  const trf = trfOf(receiptId);
  if (trf) return { key: trf, label: trf, trfId: trf };
  if (receiptId.startsWith('RCV-TRF-')) return { key: receiptId, label: `DC 입고(TRF 확인 중) ${receiptId.slice(-6)}` };
  if (receiptId.startsWith('RCV-SR-')) return { key: receiptId, label: `센터 발주 ${receiptId.slice(-6)}` };
  if (receiptId.startsWith('RCV-INIT-')) return { key: receiptId, label: `초기 입고 ${receiptId.slice(-6)}` };
  // 회수품 반입(RRC-…, mfc-inbound return-receipts) — 반품·오배송·배송 실패로 돌아온 상품(사용자 2026-11-27 "쉐림프? 이거 무슨 작업인데")
  if (/^(RET|RTN|RR|RRC)-/.test(receiptId)) return { key: receiptId, label: `회수품 반입 ${receiptId.slice(-6)}` };
  return { key: receiptId, label: `입고 ${receiptId.slice(-6)}` };
}

const NOT_SHELF = /^(RCV|QRT|CRT|PK|PACK|DSP|STG)-/;
const QRT_BY_TEMP = { AMBIENT: 'QRT-A-01', CHILLED: 'QRT-C-01', FROZEN: 'QRT-F-01' } as const;

/**
 * 열린 입고 작업의 놓을 칸 — 서버 추천(suggestedPlacements → suggestedToLocations)이 먼저.
 * 비면(LAN 큰 상품 추천 버그, MFC 백엔드 2026-11-27) 서버 추천 순서(mfc-inventory 0.47 ③)를 흉내 내되 피킹 칸은 뺀다 — 피킹 칸은 상품마다 들어갈 수가 정해져
 * 꽉 차면 거절(LOCATION_CAPACITY_EXCEEDED, 사용자 PDA 2026-11-27 A-H2-07-1-01·A-H1-03-5-01 "할 때마다 이러면 곤란한데"). 그 온도대 보충재고 칸 중
 * ① 그 상품이 있는 칸 ② 빈 칸(큰 상품 바닥 팔레트 X-R2 먼저) 3곳. 보충재고 칸이 없을 때만 그 상품이 있는 피킹 칸(꽉 찼을 수 있음). 참고값 — 서버가 목적지를 검사한다
 */
export function inboundScanItems(
  tasks: InboundTask[],
  units: { sku: string; locationCode: string; qty: number }[],
  trfOf: (rid: string) => string | undefined = () => undefined,
  reserveCodes: readonly string[] = [],
): InboundScanItem[] {
  const used = new Set(units.filter((u) => u.qty > 0).map((u) => u.locationCode));
  return tasks
    .map((task) => ({ task, remain: task.plannedQty - task.doneQty - (task.exceptedQty ?? 0) }))
    .filter((x) => x.task.state === 'READY' && x.remain > 0)
    .map(({ task, remain }) => {
      let dest: InboundScanItem['dest'] = [];
      if (task.taskType === 'QUARANTINE_MOVE') {
        const s = (task.suggestedToLocations ?? []).filter((c) => c.startsWith('QRT-'));
        dest = (s.length ? s : [QRT_BY_TEMP[task.storageType ?? 'AMBIENT']]).map((code) => ({ code, qty: null, why: 'QUARANTINE' as const }));
      } else if (task.taskType === 'PUTAWAY') {
        if (task.suggestedPlacements?.length) dest = task.suggestedPlacements.map((p) => ({ code: p.locationCode, qty: p.qty, why: 'SUGGESTED' as const }));
        else if (task.suggestedToLocations?.length) dest = task.suggestedToLocations.map((code) => ({ code, qty: null, why: 'SUGGESTED' as const }));
        else {
          const letter = { AMBIENT: 'A', CHILLED: 'C', FROZEN: 'F' }[task.storageType ?? 'AMBIENT'];
          const isReserve = (c: string) => c.startsWith(`${letter}-R`) && /^[ACF]-R\d/.test(c);
          const mine = new Map<string, number>();
          for (const u of units) if (u.sku === task.sku && u.qty > 0 && !NOT_SHELF.test(u.locationCode) && u.locationCode !== task.locationCode) mine.set(u.locationCode, (mine.get(u.locationCode) ?? 0) + u.qty);
          const sameReserve = [...mine.entries()].filter(([c]) => isReserve(c)).sort((a, b) => b[1] - a[1]).map(([c]) => c);
          const empty = reserveCodes.filter((c) => isReserve(c) && !used.has(c)).sort((a, b) => Number(!/-R2-/.test(a)) - Number(!/-R2-/.test(b)) || a.localeCompare(b));
          const picks = [...mine.entries()].filter(([c]) => !isReserve(c)).sort((a, b) => b[1] - a[1]).map(([c]) => c);
          const res = [...sameReserve.map((code) => ({ code, qty: null, why: 'SAME_SKU' as const })), ...empty.map((code) => ({ code, qty: null, why: 'EMPTY_RESERVE' as const }))].slice(0, 3);
          dest = res.length ? res : picks.slice(0, 3).map((code) => ({ code, qty: null, why: 'PICK_FACE' as const }));
        }
      }
      return { task, remain, dest, source: inboundSourceOf(task.receiptId, trfOf) };
    })
    .sort((a, b) => Number(!!b.task.assigneeId) - Number(!!a.task.assigneeId) || (a.task.createdAt ?? '').localeCompare(b.task.createdAt ?? ''));
}

/**
 * 바코드 탭 "입고" — 입고 건(DC 송장 TRF 하나, 또는 그 밖의 수령 하나)마다 한 카드.
 * 와 있는 DC 차량(정차)·그 송장의 입고 예정·열린 검사·적치 작업·방금 끝난 작업을 한데 모아 지금 단계를 정한다
 * (사용자 2026-11-27 "번호도 섞여있고 순서도 섞여있고 뭐가 뭔지도 모르겠잖아")
 */
export type InboundJobStage = 'UNLOAD' | 'RECEIVE' | 'TASKS' | 'DONE';
export interface InboundJob {
  key: string;
  /** DC 입고면 송장 번호 */
  trfId: string | null;
  /** DC 입고가 아니면 "초기 입고 …" 같은 이름 */
  label: string;
  arrival: DcArrival | null;
  trf: DcArrivalTrf | null;
  open: InboundScanItem[];
  done: InboundScanDone[];
  stage: InboundJobStage;
  /** PDA 가 받아 둔 검사·적치가 있음 */
  pdaBusy: boolean;
}

const JOB_ORDER: Record<InboundJobStage, number> = { UNLOAD: 0, RECEIVE: 1, TASKS: 2, DONE: 3 };

export function inboundJobs(arrivals: DcArrival[], items: InboundScanItem[], done: InboundScanDone[]): InboundJob[] {
  const jobs = new Map<string, InboundJob>();
  const get = (key: string, trfId: string | null, label: string) => {
    let j = jobs.get(key);
    if (!j) jobs.set(key, (j = { key, trfId, label, arrival: null, trf: null, open: [], done: [], stage: 'DONE', pdaBusy: false }));
    return j;
  };
  for (const a of arrivals)
    for (const id of a.trfIds) {
      const j = get(id, id, id);
      j.arrival = a;
      j.trf = a.trfs?.find((t) => t.trfId === id) ?? null;
    }
  for (const it of items) get(it.source.key, it.source.trfId ?? null, it.source.label).open.push(it);
  for (const d of done) get(d.source.key, d.source.trfId ?? null, d.source.label).done.push(d);
  for (const j of jobs.values()) {
    j.pdaBusy = j.open.some((x) => !!x.task.assigneeId);
    const received = !j.trf || j.trf.state === 'TIN_POSTED' || j.trf.state === 'CLOSED';
    j.stage = j.arrival?.stop === 'ARRIVED' ? 'UNLOAD' : j.arrival && !received ? 'RECEIVE' : j.open.length ? 'TASKS' : 'DONE';
  }
  return [...jobs.values()].sort((a, b) => Number(b.pdaBusy) - Number(a.pdaBusy) || JOB_ORDER[a.stage] - JOB_ORDER[b.stage] || a.key.localeCompare(b.key));
}

/** 송장 짧은 이름 — 화면 번호(T+6)가 있으면 그것, 없으면 "TRF …끝6자리"(요청 R-52 전) */
export function trfShort(trfId: string, trfNumber?: string | null): string {
  return trfNumber || `TRF …${trfId.slice(-6)}`;
}

/** 발주(공급 요청) 짧은 이름 — 서버에 화면 번호가 없어(요청 R-53) 끝 6자리 "발주 017efb". 화면 번호가 생기면 그것 */
export function srShort(supplyRequestId: string, number?: string | null): string {
  return number || `발주 ${supplyRequestId.slice(-6)}`;
}
