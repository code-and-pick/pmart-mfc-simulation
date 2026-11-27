// 입고 신청 흐름(사용자 2026-11-27 "입고 신청한 거 자세히 볼 수 있는 흐름")
import { describe, expect, it } from 'vitest';
import type { InboundPromise, InboundTask, SupplyRequest, SupplyTransfer, TmsTrip } from '../src/domain/contract';
import { MINI_STEPS, supplyFlowSteps, supplyMiniStage } from '../src/sim/supplyFlow';

const t: SupplyTransfer = { trfId: 'TRF-SR-1', temperatureZone: 'CHILLED', cdcId: 'CDC01', dueAt: '2026-11-28T00:58:18Z', sentAt: null, error: null, lines: [{ sku: 'B-458', qty: 4 }] };
const req = (p: Partial<SupplyRequest> = {}): SupplyRequest => ({ supplyRequestId: 'SR-1', version: 2, state: 'APPROVED', mfcId: 'M', lines: [{ sku: 'B-458', qty: 4 }], submittedAt: '2026-11-27T00:58:17Z', decidedAt: '2026-11-27T01:01:46Z', transfers: [t], ...p }) as SupplyRequest;
const name = (s: string) => (s === 'B-458' ? '유정란' : s);
const states = (xs: { key: string; state: string }[]) => Object.fromEntries(xs.map((x) => [x.key, x.state]));

describe('supplyFlowSteps', () => {
  it('승인 뒤 서버가 다시 보내는 중이면 "DC 로 보냄"이 warn, 뒤는 wait', () => {
    const s = states(supplyFlowSteps(req(), { ...t, error: 'UNKNOWN_RESULT: x' }, null, null, [], name));
    expect(s).toMatchObject({ order: 'done', approve: 'done', send: 'warn', dc: 'wait', arrive: 'wait', end: 'wait' });
  });
  it('보낸 뒤 운행이 없으면 DC 출고 작업이 지금 단계, 운행이 도착·인계면 수령이 지금', () => {
    const sent = { ...t, sentAt: '2026-11-27T01:03:02Z' };
    expect(states(supplyFlowSteps(req(), sent, null, null, [], name)).dc).toBe('now');
    const trip = { tripId: 'TO-1', cdcId: 'CDC01', tempClass: 'CHILLED', state: 'DEPARTED', version: 1, stops: [], transfers: [{ trfId: 'TRF-SR-1', stopSeq: 1, loaded: true, lpns: ['L1'] }] } as unknown as TmsTrip;
    const stop = { seq: 1, mfcId: 'M', state: 'HANDED_OVER', trfIds: ['TRF-SR-1'], arrivedAt: '2026-11-27T03:00:00Z', handover: { handoverId: 'H', result: 'MATCHED', shippedBoxes: 1, receivedBoxes: 1 } } as TmsTrip['stops'][number];
    const promise = { trfId: 'TRF-SR-1', state: 'RECEIVING', departedAt: '2026-11-27T02:00:00Z', lines: [{ sku: 'B-458', expectedQty: 4, receivedQty: 0 }], receipts: [] } as unknown as InboundPromise;
    const s = supplyFlowSteps(req(), sent, { trip, stop }, promise, [], name);
    expect(states(s)).toMatchObject({ dc: 'done', depart: 'done', arrive: 'done', handover: 'done', receive: 'now', inspect: 'wait', putaway: 'wait' });
    expect(s.find((x) => x.key === 'handover')!.lines[0]).toBe('박스 맞음 · 보냄 1 · 받음 1');
  });
  it('검사·적치 다 끝나면 끝, 재고 +적치 수', () => {
    const sent = { ...t, sentAt: '2026-11-27T01:03:02Z' };
    const promise = { trfId: 'TRF-SR-1', state: 'TIN_POSTED', departedAt: 'x', arrivedAt: 'y', lines: [{ sku: 'B-458', expectedQty: 4, receivedQty: 4 }], receipts: [{ receiptId: 'RCV-TRF-1', inventoryApplyStatus: 'APPLIED', postedAt: 'z' }] } as unknown as InboundPromise;
    const task = (taskType: 'INSPECT' | 'PUTAWAY'): InboundTask => ({ taskId: taskType, taskType, mfcId: 'M', receiptId: 'RCV-TRF-1', sku: 'B-458', lotId: 'L', locationCode: 'RCV-C-01', plannedQty: 4, doneQty: 4, state: 'COMPLETED', version: 2 });
    const s = supplyFlowSteps(req(), sent, null, promise, [task('INSPECT'), task('PUTAWAY')], name);
    expect(states(s)).toMatchObject({ receive: 'done', inspect: 'done', putaway: 'done', end: 'done' });
    expect(s.find((x) => x.key === 'end')!.lines).toEqual(['재고 +4']);
  });
});

describe('목록 한 줄 6칸(supplyMiniStage)', () => {
  it('보내는 중 → DC 작업(배차 전) → 오는 중 → 도착 → 수령 → 검사·적치', () => {
    const sent = { ...t, sentAt: 'x' };
    const trip = (state: string, stop: string) => ({ trip: { tripId: 'TO-1', state, stops: [] } as unknown as TmsTrip, stop: { seq: 1, mfcId: 'M', state: stop, trfIds: ['TRF-SR-1'] } as TmsTrip['stops'][number] });
    const at = (x: { at: number }) => MINI_STEPS[x.at];
    expect(at(supplyMiniStage({ ...t, error: 'UNKNOWN_RESULT' }, null, null))).toBe('보냄');
    expect(supplyMiniStage(sent, null, null).text).toBe('DC 작업 중(피킹·검품) — 배차 전');
    expect(at(supplyMiniStage(sent, trip('LOADED', 'PLANNED'), null))).toBe('DC 작업');
    expect(at(supplyMiniStage(sent, trip('DEPARTED', 'PLANNED'), null))).toBe('출발');
    expect(at(supplyMiniStage(sent, trip('DEPARTED', 'ARRIVED'), null))).toBe('도착');
    expect(at(supplyMiniStage(sent, trip('DEPARTED', 'HANDED_OVER'), null))).toBe('수령');
    expect(at(supplyMiniStage(sent, null, { state: 'TIN_POSTED' } as InboundPromise))).toBe('검사·적치');
  });
});
