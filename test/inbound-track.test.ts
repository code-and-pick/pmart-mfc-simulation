// 입고 추적(사용자 2026-11-26 "DC에서 입고 받은 거 적치하고, 입고받아서 추가되는 재고 추적")
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, REAL_DC } from '../src/config';
import type { CenterStock, InboundPromise, InboundTask } from '../src/domain/contract';
import { dcArrivalsOf, inboundJobs, inboundScanItems, inboundSourceOf, packageLines, realLine, stageOf, sumLines, tripInfo } from '../src/sim/inboundTrack';
import type { TmsTrip } from '../src/domain/contract';
import { Simulation } from '../src/sim/simulation';

const task = (p: Partial<InboundTask>): InboundTask => ({ taskId: 'T', taskType: 'INSPECT', mfcId: 'M', receiptId: 'R1', sku: 'E-00000001', lotId: 'L1', locationCode: 'RCV-A-02', plannedQty: 6, doneQty: 0, state: 'READY', version: 1, ...p });

describe('실서버 줄 — 작업과 그 LOT 재고 행에서', () => {
  it('검사·적치 수량은 작업 doneQty, 놓인 칸·입고칸·격리는 그 입고 LOT 의 재고 행', () => {
    const tasks = [task({ taskId: 'I', doneQty: 6, state: 'COMPLETED' }), task({ taskId: 'P', taskType: 'PUTAWAY', lotId: 'L2', plannedQty: 5, doneQty: 4 })];
    const stock: CenterStock = {
      mfcId: 'M',
      sku: 'E-00000001',
      lots: [],
      units: [
        { locationCode: 'A-C1-01-1-01', lotId: 'L2', qualityState: 'NORMAL', workState: 'STORED', qty: 3 },
        { locationCode: 'R-01', lotId: 'L2', qualityState: 'NORMAL', workState: 'STORED', qty: 1 },
        { locationCode: 'RCV-A-02', lotId: 'L2', qualityState: 'NORMAL', workState: 'UNSTOWED', qty: 1 },
        { locationCode: 'Q-A-01', lotId: 'L1', qualityState: 'QUARANTINED', workState: 'STORED', qty: 1 },
        // 다른 입고 LOT — 세지 않음
        { locationCode: 'A-C1-01-1-01', lotId: 'OLD', qualityState: 'NORMAL', workState: 'STORED', qty: 40 },
      ],
    };
    const l = realLine('E-00000001', '콜라', 6, 6, tasks, stock);
    expect(l.inspected).toBe(6);
    expect(l.stowed).toBe(4);
    expect(l.atDock).toBe(1);
    expect(l.quarantined).toBe(1);
    expect(l.placed).toEqual([
      { loc: 'A-C1-01-1-01', qty: 3 },
      { loc: 'R-01', qty: 1 },
    ]);
  });

  it('단계 — 수령 뒤 열린 작업이 없고 입고칸이 비면 끝, 적치가 시작되면 적치 중', () => {
    const base = { sku: 'X', expected: 6, received: 6, inspected: 6, quarantined: 0, placed: [] };
    expect(stageOf('RECEIVED', [{ ...base, stowed: 0, atDock: 6 }], true)).toBe('RECEIVED');
    expect(stageOf('RECEIVED', [{ ...base, stowed: 2, atDock: 4 }], true)).toBe('STOWING');
    expect(stageOf('RECEIVED', [{ ...base, stowed: 6, atDock: 0 }], false)).toBe('DONE');
    expect(stageOf('EXPECTED', [{ ...base, received: 0, stowed: 0, atDock: 0 }], false)).toBe('EXPECTED');
  });

  it('출발 줄이 아직 없는 DC 예정(매니페스트만)은 LPN 을 SKU 별로 합쳐 예정 수량', () => {
    const p = {
      trfId: 'TRF-SIM-1',
      mfcId: 'M',
      version: 1,
      state: 'EXPECTED',
      lines: [],
      packages: [
        { lpn: 'B1', sku: 'B-00000006', qty: 2 },
        { lpn: 'B2', sku: 'B-00000006', qty: 1 },
        { lpn: 'B2', sku: 'B-00000007', qty: 2 },
      ],
    } as InboundPromise;
    expect(packageLines(p, (s) => s)).toEqual([
      { sku: 'B-00000006', name: 'B-00000006', expected: 3, received: 0 },
      { sku: 'B-00000007', name: 'B-00000007', expected: 2, received: 0 },
    ]);
  });
});

describe('MOCK 입고 차량 추적', () => {
  it('차량을 부르면 오는 중 → 수령 → 적치, 다 놓으면 끝 · 놓인 칸 합 = 받은 양', async () => {
    const s = new Simulation({ ...DEFAULT_PARAMS, ordersPerHour: 0, firstInboundAfterSec: 1e9 });
    s.speed = 60;
    const id = s.callTruck()!;
    await s.refreshInboundTracks();
    const first = s.inboundTracks.items.find((t) => t.id === id)!;
    expect(first.stage).toBe('EXPECTED');
    expect(sumLines(first.lines).received).toBe(0);
    const seen = new Set<string>();
    for (let i = 0; i < 60000; i++) {
      await s.advance(0.1);
      if (i % 50 === 0) {
        await s.refreshInboundTracks();
        const t = s.inboundTracks.items.find((x) => x.id === id)!;
        seen.add(t.stage);
        if (t.stage === 'DONE') break;
      }
    }
    await s.refreshInboundTracks();
    const t = s.inboundTracks.items.find((x) => x.id === id)!;
    expect(t.stage).toBe('DONE');
    expect(seen.has('RECEIVED') || seen.has('STOWING')).toBe(true);
    const sum = sumLines(t.lines);
    expect(sum.received).toBe(sum.expected);
    expect(sum.stowed).toBe(sum.received);
    expect(sum.atDock).toBe(0);
    for (const l of t.lines) expect(l.placed.reduce((a, p) => a + p.qty, 0)).toBe(l.received);
  }, 180_000);
});

describe('DC 간선 운행(TMS) 한 줄', () => {
  it('이 센터 정차의 상태·도착 예정·박스 수(그 정차 상차 LPN)', () => {
    const trip: TmsTrip = {
      tripId: 'TO-20261126-001',
      cdcId: 'CDC01',
      tempClass: 'AMBIENT',
      state: 'DEPARTED',
      driverName: '기사 04A',
      departedAt: '2026-11-26T08:20:06Z',
      stops: [
        { seq: 1, mfcId: 'MFC-BJG-01', state: 'PLANNED', trfIds: ['TRF-1'], plannedArrivalAt: '2026-11-26T20:00:00Z', estimatedArrivalAt: '2026-11-26T10:20:06Z' },
        { seq: 2, mfcId: 'MFC-BNG-01', state: 'PLANNED', trfIds: ['TRF-2'] },
      ],
      transfers: [
        { trfId: 'TRF-1', stopSeq: 1, loaded: true, lpns: ['L1', 'L2'] },
        { trfId: 'TRF-2', stopSeq: 2, loaded: true, lpns: ['L3'] },
      ],
      version: 3,
    };
    const t = tripInfo(trip, trip.stops[0]);
    expect(t.stop).toBe('PLANNED');
    expect(t.boxes).toBe(2);
    expect(t.etaMs).toBe(Date.parse('2026-11-26T10:20:06Z'));
    expect(t.driver).toBe('기사 04A');
  });
});

describe('DC 차량 도착(하차 고르기)', () => {
  it('이 센터 정차가 ARRIVED·HANDED_OVER·DEPARTED(수령 전 남기기는 pollDcTrips 가 거름) 인 것, 도착 → 인계 → 떠남 순, 박스 = 그 정차 상차 LPN', () => {
    const mk = (id: string, state: 'PLANNED' | 'ARRIVED' | 'HANDED_OVER' | 'DEPARTED', at: string | null): TmsTrip => ({
      tripId: id,
      cdcId: 'CDC01',
      tempClass: 'AMBIENT',
      state: 'DEPARTED',
      stops: [
        { seq: 1, mfcId: 'MFC-BJG-01', state, trfIds: [`TRF-${id}`], arrivedAt: at },
        { seq: 2, mfcId: 'MFC-BNG-01', state: 'ARRIVED', trfIds: ['X'] },
      ],
      transfers: [
        { trfId: `TRF-${id}`, stopSeq: 1, loaded: true, lpns: [`${id}-B1`, `${id}-B2`] },
        { trfId: 'X', stopSeq: 2, loaded: true, lpns: ['NO'] },
      ],
      version: 1,
    });
    const list = dcArrivalsOf(
      [mk('T1', 'HANDED_OVER', '2026-11-26T10:00:00Z'), mk('T2', 'ARRIVED', '2026-11-26T11:00:00Z'), mk('T3', 'PLANNED', null), mk('T4', 'DEPARTED', null)],
      'MFC-BJG-01',
      (k) => (k === 'T2:1' ? 'PDA' : null),
    );
    expect(list.map((a) => [a.tripId, a.stop, a.mode])).toEqual([
      ['T2', 'ARRIVED', 'PDA'],
      ['T1', 'HANDED_OVER', null],
      ['T4', 'DEPARTED', null],
    ]);
    expect(list[0].boxes).toEqual([
      { lpn: 'T2-B1', trfId: 'TRF-T2' },
      { lpn: 'T2-B2', trfId: 'TRF-T2' },
    ]);
  });
});

describe('입고 신청 → DC TRF 번호 후보(REAL_DC.supplyTrfIds)', () => {
  it('서버 linkedTrfId 먼저, 그다음 0.23.0 규칙 TRF-{id}, 다리 첫 규칙 TRF-SR-{id}', () => {
    expect(REAL_DC.supplyTrfIds('SR-abc', 'TRF-SR-abc')).toEqual(['TRF-SR-abc', 'TRF-SR-SR-abc']);
    expect(REAL_DC.supplyTrfIds('SR-abc')).toEqual(['TRF-SR-abc', 'TRF-SR-SR-abc']);
    expect(REAL_DC.supplyTrfIds('SR-abc', 'TRF-X')).toEqual(['TRF-X', 'TRF-SR-abc', 'TRF-SR-SR-abc']);
  });
  it('64자로 자른다', () => {
    const id = `SR-${'a'.repeat(80)}`;
    for (const t of REAL_DC.supplyTrfIds(id)) expect(t.length).toBe(64);
  });
});

describe('DC 로 보낸 발주 한 줄의 단계(0.23.0 R-27 transfers)', () => {
  const sim = new Simulation({ ...DEFAULT_PARAMS });
  const t = { trfId: 'TRF-SR-x', temperatureZone: 'AMBIENT' as const, cdcId: 'CDC01', dueAt: '2026-11-28T01:00:00Z', lines: [{ sku: 'B-1', qty: 1 }] };
  it('보내는 중 · 다시 시도 중(실패로 단정 안 함) · DC 가 받음(운행 전)', () => {
    expect(sim.dcTransferStage({ ...t, sentAt: null })).toBe('DC 로 보내는 중');
    expect(sim.dcTransferStage({ ...t, sentAt: null, error: 'UNKNOWN_RESULT: x' })).toBe('DC 로 보내는 중 — 서버가 다시 시도 중(지난 시도: 결과 모름)');
    expect(sim.dcTransferStage({ ...t, sentAt: '2026-11-27T00:03:31Z' })).toBe('DC 가 받음 — 피킹·배차 기다림');
  });
});

describe('바코드 탭 입고 작업 — 놓을 칸(inboundScanItems)', () => {
  const base = { mfcId: 'M', receiptId: 'R', lotId: 'L', locationCode: 'RCV-A-02', state: 'READY' as const, version: 1 };
  it('서버 추천이 먼저, 없으면 같은 상품이 놓인 칸(입고·격리 칸 빼고, 보충재고 칸 먼저·많은 순), 받아 둔 작업이 위, 끝난 양은 뺌', () => {
    const items = inboundScanItems(
      [
        { ...base, taskId: 'P1', taskType: 'PUTAWAY', sku: 'S1', plannedQty: 2, doneQty: 0, suggestedPlacements: [{ locationCode: 'A-H1-01-1-01', qty: 2 }] },
        { ...base, taskId: 'P2', taskType: 'PUTAWAY', sku: 'S2', plannedQty: 2, doneQty: 1, assigneeId: 'OP-x', suggestedPlacements: [] },
        { ...base, taskId: 'I1', taskType: 'INSPECT', sku: 'S3', plannedQty: 5, doneQty: 5 },
      ],
      [
        { sku: 'S2', locationCode: 'RCV-A-02', qty: 1 },
        { sku: 'S2', locationCode: 'A-R2-01-1-01', qty: 2 },
        { sku: 'S2', locationCode: 'A-H2-07-1-01', qty: 12 },
      ],
    );
    expect(items.map((x) => [x.task.taskId, x.remain, x.dest.map((d) => `${d.code}:${d.why}`)])).toEqual([
      ['P2', 1, ['A-R2-01-1-01:SAME_SKU']],
      ['P1', 2, ['A-H1-01-1-01:SUGGESTED']],
    ]);
  });
});

describe('입고 작업의 입고 건(탭) — inboundSourceOf', () => {
  it('DC 수령은 TRF 번호, 모르면 확인 중, 그 밖은 수령 종류', () => {
    const trf = (rid: string) => (rid === 'RCV-TRF-a' ? 'TRF-SIM-MWXELMKQ' : undefined);
    expect(inboundSourceOf('RCV-TRF-a', trf)).toEqual({ key: 'TRF-SIM-MWXELMKQ', label: 'TRF-SIM-MWXELMKQ', trfId: 'TRF-SIM-MWXELMKQ' });
    expect(inboundSourceOf('RCV-TRF-bbbbbbbb', trf).label).toBe('DC 입고(TRF 확인 중) bbbbbb');
    expect(inboundSourceOf('RCV-INIT-01953d40', trf).label).toBe('초기 입고 953d40');
  });
});

describe('서버 추천이 빈 적치 — 피킹 칸 대신 보충재고 칸', () => {
  const t = { taskId: 'P', taskType: 'PUTAWAY' as const, mfcId: 'M', receiptId: 'R', lotId: 'L', locationCode: 'RCV-A-02', state: 'READY' as const, version: 1, sku: 'B-7', plannedQty: 2, doneQty: 0, storageType: 'AMBIENT' as const, suggestedPlacements: [] };
  it('그 상품 보충재고 칸이 없으면 같은 온도대 빈 보충재고 칸(바닥 팔레트 R2 먼저), 다른 상품이 있는 칸·다른 온도대는 뺌, 피킹 칸(꽉 찼던 A-H1)은 안 냄', () => {
    const [it] = inboundScanItems([t], [{ sku: 'B-7', locationCode: 'A-H1-03-5-01', qty: 12 }, { sku: 'X', locationCode: 'A-R2-01-1-01', qty: 3 }], undefined, ['A-R1-01-1-01', 'A-R2-01-1-01', 'A-R2-02-1-01', 'C-R1-01-1-01']);
    expect(it.dest.map((d) => `${d.code}:${d.why}`)).toEqual(['A-R2-02-1-01:EMPTY_RESERVE', 'A-R1-01-1-01:EMPTY_RESERVE']);
  });
  it('보충재고 칸이 하나도 없을 때만 피킹 칸(꽉 찼을 수 있음)', () => {
    const [it] = inboundScanItems([t], [{ sku: 'B-7', locationCode: 'A-H1-03-5-01', qty: 12 }], undefined, []);
    expect(it.dest.map((d) => `${d.code}:${d.why}`)).toEqual(['A-H1-03-5-01:PICK_FACE']);
  });
});

describe('바코드 탭 입고 건(inboundJobs) — 송장마다 한 카드·단계', () => {
  const arr = (stop: 'ARRIVED' | 'HANDED_OVER', trfState: string) => ({
    key: 'TO-1:1', tripId: 'TO-1', seq: 1, cdcId: 'CDC01', tempClass: 'AMBIENT' as const, stop, trfIds: ['TRF-A'], boxes: [{ lpn: 'L1', trfId: 'TRF-A' }], arrivedAtMs: 1, mode: null,
    trfs: [{ trfId: 'TRF-A', label: 'TRF:TRF-A:2', state: trfState, canReceipt: true, products: [] }],
  });
  const task = (id: string, trf: string, assignee?: string) => ({
    task: { taskId: id, taskType: 'PUTAWAY' as const, mfcId: 'M', receiptId: 'R', sku: 'S', lotId: 'L', locationCode: 'RCV-A-02', plannedQty: 1, doneQty: 0, state: 'READY' as const, version: 1, assigneeId: assignee },
    remain: 1, dest: [], source: { key: trf, label: trf, trfId: trf },
  });
  it('도착 = 하차, 인계 뒤 수령 전 = 수령, 수령 뒤 작업 있으면 검사·적치, PDA 가 받은 건이 첫 탭', () => {
    expect(inboundJobs([arr('ARRIVED', 'EXPECTED')], [], [])[0].stage).toBe('UNLOAD');
    expect(inboundJobs([arr('HANDED_OVER', 'RECEIVING')], [], [])[0].stage).toBe('RECEIVE');
    expect(inboundJobs([arr('HANDED_OVER', 'TIN_POSTED')], [task('T1', 'TRF-A')], [])[0].stage).toBe('TASKS');
    const jobs = inboundJobs([arr('ARRIVED', 'EXPECTED')], [task('T2', 'TRF-B', 'OP-1')], []);
    expect(jobs.map((j) => [j.key, j.stage, j.pdaBusy])).toEqual([
      ['TRF-B', 'TASKS', true],
      ['TRF-A', 'UNLOAD', false],
    ]);
  });
});
