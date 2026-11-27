// 입고 신청(공급 요청) 한 건의 흐름 — 발주부터 적치까지 단계마다 상태·시각·내용(사용자 2026-11-27 "입고 신청한 거 자세히 볼 수 있는 흐름").
// MFC 계정으로 읽을 수 있는 것만: 공급 요청(mfc-inbound) · 운행(TMS inbound-trips) · 입고 예정·수령(mfc-inbound) · 검사·적치 작업(mfc-inbound).
// DC 안쪽(할당·Wave·피킹·검품)은 MFC 계정이 못 읽는다(cdc-outbound /cdcs/CDC01/transfers 403) — 운행이 생기면(배차) 그 뒤부터 보인다.
// React 없음(시험이 화면 없이 돈다).
import type { InboundPromise, InboundTask, SupplyRequest, SupplyTransfer, TmsTrip } from '../domain/contract';
import { srShort } from './inboundTrack';

export type FlowState = 'done' | 'now' | 'wait' | 'warn';
export interface FlowStep {
  key: string;
  title: string;
  state: FlowState;
  /** 그 단계가 끝난(또는 시작한) 시각 ISO */
  at?: string | null;
  /** 한 줄씩 — 번호는 줄 하나에 하나 */
  lines: string[];
}

type Stop = TmsTrip['stops'][number];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function supplyFlowSteps(
  req: SupplyRequest,
  t: SupplyTransfer,
  link: { trip: TmsTrip; stop: Stop } | null,
  promise: InboundPromise | null,
  tasks: InboundTask[],
  name: (sku: string) => string,
): FlowStep[] {
  const steps: FlowStep[] = [];
  const reqQty = sum(t.lines.map((l) => l.qty));
  steps.push({ key: 'order', title: '발주', state: 'done', at: req.submittedAt, lines: [srShort(req.supplyRequestId), ...t.lines.map((l) => `${name(l.sku)} × ${l.qty}`)] });
  const cut = (req.approvedLines ?? []).filter((l) => l.approvedQty !== l.requestedQty);
  steps.push({
    key: 'approve',
    title: '승인',
    state: req.state === 'APPROVED' ? 'done' : req.state === 'REJECTED' ? 'warn' : 'now',
    at: req.decidedAt,
    lines: req.state === 'APPROVED' ? (cut.length ? cut.map((l) => `${name(l.sku)} ${l.requestedQty} → ${l.approvedQty}${req.decisionNote ? ` (${req.decisionNote})` : ''}`) : ['요청 수량 그대로']) : req.state === 'REJECTED' ? [`거절 — ${req.rejectReason ?? ''}`] : ['센터 관리자 승인 기다림'],
  });
  const sent = !!t.sentAt;
  steps.push({
    key: 'send',
    title: 'DC 로 보냄',
    state: sent ? 'done' : t.error ? 'warn' : req.state === 'APPROVED' ? 'now' : 'wait',
    at: t.sentAt,
    lines: [`송장 ${t.trfId}`, `칠곡 DC · ${{ AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' }[t.temperatureZone]} · 기한 ${t.dueAt.slice(0, 16).replace('T', ' ')}Z`, ...(t.error && !sent ? ['서버가 다시 보내는 중 — 지난 시도 결과 모름'] : [])],
  });
  const trip = link?.trip ?? null;
  const stop = link?.stop ?? null;
  const departed = !!promise?.departedAt || trip?.state === 'DEPARTED' || trip?.state === 'COMPLETED';
  steps.push({
    key: 'dc',
    title: 'DC 출고 작업',
    state: departed ? 'done' : sent ? 'now' : 'wait',
    at: null,
    lines: trip
      ? [`운행 ${trip.tripId}${trip.vehicleId ? ` · 차량 ${trip.vehicleId}` : ''}${trip.driverName ? ` · ${trip.driverName}` : ''}`, `운행 ${({ SCHEDULED: '배차됨', CHECKED_IN: '입차', LOADED: '상차 끝', DEPARTED: '출발', COMPLETED: '끝', CANCELLED: '취소' } as const)[trip.state]}`]
      : sent
        ? ['할당 → Wave → 피킹 → 분류 → 검품 → 상차(DC 화면에서 — MFC 계정은 못 읽음)', '배차되면 운행 번호가 여기 뜸']
        : [],
  });
  const boxes = trip ? (trip.transfers ?? []).filter((x) => x.trfId === t.trfId).flatMap((x) => x.lpns) : [];
  steps.push({
    key: 'depart',
    title: 'DC 출발',
    state: departed ? 'done' : 'wait',
    at: promise?.departedAt ?? trip?.departedAt ?? null,
    lines: departed ? [`박스 ${boxes.length || (promise?.packages ? new Set(promise.packages.map((p) => p.lpn)).size : 0)}개`, ...(stop?.plannedArrivalAt || stop?.estimatedArrivalAt ? [`도착 예정 ${(stop.estimatedArrivalAt ?? stop.plannedArrivalAt)!.slice(11, 16)}Z`] : [])] : [],
  });
  const arrived = !!stop?.arrivedAt || !!promise?.arrivedAt;
  steps.push({ key: 'arrive', title: 'MFC 도착', state: arrived ? 'done' : departed ? 'now' : 'wait', at: stop?.arrivedAt ?? promise?.arrivedAt ?? null, lines: arrived && stop ? [`정차 ${stop.seq}`] : [] });
  const ho = stop?.handover ?? null;
  const handed = !!ho || stop?.state === 'HANDED_OVER' || stop?.state === 'DEPARTED';
  steps.push({
    key: 'handover',
    title: '하차 인계',
    state: ho?.result === 'MISMATCHED' ? 'warn' : handed ? 'done' : arrived ? 'now' : 'wait',
    at: stop?.handedOverAt ?? null,
    lines: ho ? [`박스 ${ho.result === 'MATCHED' ? '맞음' : '차이 있음'} · 보냄 ${ho.shippedBoxes ?? '?'} · 받음 ${ho.receivedBoxes ?? '?'}`, ...(ho.missingLpns?.length ? [`빠진 박스 ${ho.missingLpns.join(', ')}`] : [])] : [],
  });
  const rc = promise?.receipts ?? [];
  const applied = rc.filter((r) => r.inventoryApplyStatus === 'APPLIED');
  const recvQty = sum((promise?.lines ?? []).map((l) => l.receivedQty ?? 0));
  const received = applied.length > 0 || promise?.state === 'TIN_POSTED';
  steps.push({
    key: 'receive',
    title: '수령',
    state: received ? 'done' : rc.some((r) => r.inventoryApplyStatus === 'REJECTED') ? 'warn' : arrived ? 'now' : 'wait',
    at: applied[0]?.postedAt ?? applied[0]?.receivedAt ?? null,
    lines: [
      ...(received ? [`받음 ${recvQty} / ${reqQty}`] : []),
      ...rc.map((r) => `수령 ${r.receiptId} · ${r.inventoryApplyStatus === 'APPLIED' ? '재고 반영' : r.inventoryApplyStatus === 'REJECTED' ? `거절 ${r.rejectReason ?? ''}` : (r.inventoryApplyStatus ?? '처리 중')}`),
    ],
  });
  const ins = tasks.filter((x) => x.taskType === 'INSPECT');
  const puts = tasks.filter((x) => x.taskType === 'PUTAWAY');
  const qDone = (xs: InboundTask[]) => `${sum(xs.map((x) => x.doneQty))} / ${sum(xs.map((x) => x.plannedQty))}`;
  const allDone = (xs: InboundTask[]) => xs.length > 0 && xs.every((x) => x.state === 'COMPLETED');
  steps.push({
    key: 'inspect',
    title: '품질검사',
    state: allDone(ins) ? 'done' : ins.length ? 'now' : received ? 'now' : 'wait',
    lines: ins.map((x) => `${x.productName ?? name(x.sku)} ${x.doneQty}/${x.plannedQty}${x.state === 'COMPLETED' ? ' 끝' : ''}`),
  });
  steps.push({
    key: 'putaway',
    title: '적치',
    state: allDone(puts) && allDone(ins) ? 'done' : puts.length ? 'now' : 'wait',
    lines: puts.length ? [`${qDone(puts)}개`, ...puts.map((x) => `${x.productName ?? name(x.sku)} ${x.doneQty}/${x.plannedQty}${x.state === 'COMPLETED' ? ' 끝' : ` · ${x.locationCode} 에 남음`}`)] : [],
  });
  const end = allDone(ins) && allDone(puts);
  steps.push({ key: 'end', title: '끝 — 판매 가능', state: end ? 'done' : 'wait', lines: end ? [`재고 +${sum(puts.map((x) => x.doneQty))}`] : [] });
  // 지금 단계는 하나만 — 앞 단계가 안 끝났는데 'now' 로 표시된 뒤 단계는 'wait' 로
  let seenNow = false;
  for (const s of steps) {
    if (s.state === 'now' || s.state === 'warn') {
      if (seenNow && s.state === 'now') s.state = 'wait';
      seenNow = true;
    }
  }
  return steps;
}

/** 목록 한 줄용 짧은 단계(6칸) — 보냄 · DC 작업 · 출발 · 도착 · 수령 · 검사·적치 */
export const MINI_STEPS = ['보냄', 'DC 작업', '출발', '도착', '수령', '검사·적치'] as const;
export function supplyMiniStage(t: SupplyTransfer, link: { trip: TmsTrip; stop: Stop } | null, promise: InboundPromise | null): { at: number; text: string; tone: 'warn' | 'run' | 'ok' } {
  if (!t.sentAt) return t.error ? { at: 0, text: '서버가 DC 로 다시 보내는 중(지난 시도 결과 모름)', tone: 'warn' } : { at: 0, text: 'DC 로 보내는 중', tone: 'run' };
  if (promise?.state === 'TIN_POSTED') return { at: 5, text: '수령 끝 — 검사·적치는 자세히', tone: 'ok' };
  if (promise?.state === 'CLOSED') return { at: 5, text: '종결됨', tone: 'ok' };
  const stop = link?.stop;
  const trip = link?.trip;
  if (stop?.state === 'HANDED_OVER' || stop?.state === 'DEPARTED' || promise?.state === 'RECEIVING') return { at: 4, text: '인계 끝 — 수령하세요', tone: 'run' };
  if (stop?.state === 'ARRIVED') return { at: 3, text: '도착 — 하차하세요', tone: 'run' };
  if (trip && (trip.state === 'DEPARTED' || trip.state === 'COMPLETED')) {
    const eta = stop?.estimatedArrivalAt ?? stop?.plannedArrivalAt;
    return { at: 2, text: `오는 중${eta ? ` · 도착 예정 ${new Date(eta).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}`, tone: 'run' };
  }
  if (trip) return { at: 1, text: `DC ${({ SCHEDULED: '배차됨', CHECKED_IN: '입차', LOADED: '상차 끝', CANCELLED: '운행 취소' } as Record<string, string>)[trip.state] ?? trip.state} · 운행 ${trip.tripId}`, tone: 'run' };
  return { at: 1, text: 'DC 작업 중(피킹·검품) — 배차 전', tone: 'run' };
}
