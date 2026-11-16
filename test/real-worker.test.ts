// 실서버 가상 작업자(RealWorker)의 호출 순서 — 가짜 백엔드로 화면 없이 돌린다.
import { describe, expect, it } from 'vitest';
import type { HttpBackend } from '../src/backend/http/HttpBackend';
import type { TokenSource } from '../src/backend/http/tokens';
import { DEFAULT_PARAMS } from '../src/config';
import { ApiProblem, type CapacityAssignment, type TaskDetail, type TaskState } from '../src/domain/contract';
import { buildLayout } from '../src/domain/layout';
import { buildLocationCodeMap } from '../src/domain/locationCodes';
import { NavGrid } from '../src/domain/navgrid';
import { RealWorker, packDropFor, tempOfCode, type RealSiteContext } from '../src/sim/realWorker';
import { StationPool } from '../src/sim/site';

const ME = 'OP-pp01';

function task(id: string, type: 'PICK' | 'PACK', state: TaskState, extra: Partial<TaskDetail> = {}): TaskDetail {
  return {
    taskId: id,
    taskType: type,
    state,
    version: 1,
    mfcId: 'MFC-SEED-01',
    fulfillmentId: 'FUL-1',
    shipmentId: 'ORD-1-S1',
    assignment: { workerId: ME, assignmentVersion: 1 },
    lineCount: 2,
    plannedQty: 3,
    completedQty: 0,
    remainingQty: 3,
    promisedReadyAt: null,
    createdAt: '2026-11-16T06:00:00Z',
    blockReason: null,
    lines: [
      {
        taskLineId: 'TL1',
        orderLineId: 'L1',
        sku: 'B-1',
        barcode: null,
        locationId: null,
        lotId: null,
        expiresOn: null,
        plannedQty: 2,
        completedQty: 0,
        cancelledQty: 0,
        remainingQty: 2,
        pendingQty: 0,
        picks: [{ lotId: 'LOT-B', expiresOn: null, remainingQty: 2, visitSeq: 2, locations: [{ locationCode: 'A-C1-04-2-02', qty: 8, allocatedQty: 2 }] }],
      },
      {
        taskLineId: 'TL2',
        orderLineId: 'L2',
        sku: 'F-1',
        barcode: null,
        locationId: null,
        lotId: null,
        expiresOn: null,
        plannedQty: 1,
        completedQty: 0,
        cancelledQty: 0,
        remainingQty: 1,
        pendingQty: 0,
        picks: [{ lotId: 'LOT-F', expiresOn: null, remainingQty: 1, visitSeq: 1, locations: [{ locationCode: 'F-A1-01-1-01', qty: 3, allocatedQty: 1 }] }],
      },
    ],
    ...extra,
  } as TaskDetail;
}

class FakeBe {
  calls: string[] = [];
  bodies: unknown[] = [];
  queue: (CapacityAssignment | 'NONE')[] = [];
  tasks = new Map<string, TaskDetail>();
  dispatchFails = false;
  /** 앞으로 몇 번 401 을 돌려줄지(다음 작업 받기) */
  unauthorized = 0;
  async pullNextTask(_m: string, w: string, area: string) {
    this.calls.push(`pull ${w} ${area}`);
    if (this.unauthorized > 0) {
      this.unauthorized--;
      throw new ApiProblem({ status: 401, code: 'UNAUTHENTICATED' });
    }
    const n = this.queue.shift() ?? 'NONE';
    if (n === 'NONE') throw new ApiProblem({ status: 409, code: 'NO_TASK_AVAILABLE' });
    return n;
  }
  async getTask(id: string) {
    return this.tasks.get(id)!;
  }
  async startTask(id: string, body: { workerId: string; assignmentVersion: number }) {
    this.calls.push(`start ${id} ${body.workerId} v${body.assignmentVersion}`);
    const t = this.tasks.get(id)!;
    this.tasks.set(id, { ...t, state: 'IN_PROGRESS' });
    return { status: 'ACCEPTED' };
  }
  async recordExecution(id: string, body: { fromLocation: string; toLocation: string; lines: { sku: string; lotId: string; pickedQty: number }[] }, key: string) {
    this.calls.push(`pick ${id} ${body.lines[0].sku}×${body.lines[0].pickedQty} ${body.fromLocation}→${body.toLocation} lot=${body.lines[0].lotId}`);
    this.bodies.push(key);
    return { status: 'ACCEPTED' };
  }
  async requestDispatch(s: string, minutes: number) {
    this.calls.push(`dispatch ${s} ${minutes}m`);
    if (this.dispatchFails) throw new ApiProblem({ status: 409, code: 'INVALID_STATE' });
    return {};
  }
  async sealPackage(s: string, body: { contents: { sku: string }[]; temperatureZone?: string; packingLocation?: string }) {
    this.calls.push(`seal ${s} ${body.contents.map((c) => c.sku).join('+')} ${body.temperatureZone ?? '-'} @${body.packingLocation ?? '-'}`);
    return {};
  }
  async getCenterStock() {
    this.calls.push('stock');
    return { mfcId: 'MFC-SEED-01', sku: '', lots: [], units: [] };
  }
}

function setup() {
  const layout = buildLayout();
  const codes = buildLocationCodeMap(layout);
  const locBy = new Map(layout.locations.map((l) => [l.code, l]));
  const ctx: RealSiteContext = {
    runId: 'run1',
    mfcId: 'MFC-SEED-01',
    layout,
    nav: new NavGrid(layout),
    stations: new StationPool(layout.stations, 4),
    params: { ...DEFAULT_PARAMS },
    now: () => 0,
    log: () => {},
    location: (c) => locBy.get(codes.toSim(c) ?? '') ?? null,
    point: () => null,
  };
  const be = new FakeBe();
  const tokens = { get: async () => 'tok', operatorId: ME, lastError: null, invalidated: 0, invalidate() { this.invalidated++; } };
  const w = new RealWorker('mfcw-pp-01', layout.points.idle[0], ctx, be as unknown as HttpBackend, tokens as unknown as TokenSource);
  return { w, be, tokens };
}

async function runFor(w: RealWorker, sec: number) {
  for (let t = 0; t < sec; t += 0.25) {
    w.tick(0.25);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
}

describe('RealWorker — 실서버 가상 작업자', () => {
  it('코드 첫 글자 = 온도대, 냉동만 PAK-F-01', () => {
    expect(tempOfCode('F-A1-01-1-01')).toBe('FROZEN');
    expect(tempOfCode('C-B1-09-4-01')).toBe('CHILLED');
    expect(tempOfCode('A-C1-04-2-02')).toBe('AMBIENT');
    expect(tempOfCode('PAK-A-01')).toBeNull();
    expect(packDropFor('FROZEN')).toBe('PAK-F-01');
    expect(packDropFor('AMBIENT')).toBe('PAK-C-01');
  });

  it('다음 작업 받기(PICK_PACK) → 시작 → visitSeq 순 집품 → PACK 시작 + 배차 요청 → 온도대별 밀봉', async () => {
    const { w, be } = setup();
    be.tasks.set('P1', task('P1', 'PICK', 'ASSIGNED'));
    be.tasks.set('K1', task('K1', 'PACK', 'ASSIGNED', { packingLocations: ['PAK-C-01', 'PAK-F-01'] }));
    be.queue = [
      { assignmentId: 'AS1', mfcId: 'MFC-SEED-01', taskId: 'P1', taskType: 'PICK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' },
      { assignmentId: 'AS2', mfcId: 'MFC-SEED-01', taskId: 'K1', taskType: 'PACK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' },
    ];
    void w.run();
    await runFor(w, 900);
    const c = be.calls;
    expect(c[0]).toBe(`pull ${ME} PICK_PACK`);
    expect(c[1]).toBe(`start P1 ${ME} v1`);
    // visitSeq 1(냉동) 먼저, 그다음 상온 — 각자 온도대 포장 위치로
    expect(c[2]).toBe('pick P1 F-1×1 F-A1-01-1-01→PAK-F-01 lot=LOT-F');
    expect(c[3]).toBe('pick P1 B-1×2 A-C1-04-2-02→PAK-C-01 lot=LOT-B');
    expect(c[4]).toBe(`pull ${ME} PICK_PACK`);
    expect(c[5]).toBe(`start K1 ${ME} v1`);
    expect(c[6]).toMatch(/^dispatch ORD-1-S1 \d+m$/); // 포장 시작 때 배차 요청
    expect(c.slice(7, 9).sort()).toEqual(['seal ORD-1-S1 B-1 AMBIENT @PAK-C-01', 'seal ORD-1-S1 F-1 FROZEN @PAK-F-01']);
    expect(c).not.toContain('stock'); // 내가 내려놓은 곳을 알면 재고를 묻지 않는다
    expect(w.ordersDone).toBe(1);
    expect(new Set(be.bodies).size).toBe(2); // 집품마다 다른 Idempotency-Key
    w.stop();
  });

  it('배차 요청이 거절돼도 포장은 이어서 하고 사유를 남긴다. 남이 집은 출고는 packingLocations 하나면 그곳으로 밀봉', async () => {
    const { w, be } = setup();
    be.dispatchFails = true;
    be.tasks.set('K2', task('K2', 'PACK', 'ASSIGNED', { packingLocations: ['PAK-A-01'] }));
    be.queue = [{ assignmentId: 'AS3', mfcId: 'MFC-SEED-01', taskId: 'K2', taskType: 'PACK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' }];
    void w.run();
    await runFor(w, 400);
    expect(be.calls).toContain('seal ORD-1-S1 B-1+F-1 - @PAK-A-01');
    expect(be.calls).not.toContain('stock');
    expect(w.ordersDone).toBe(1);
    w.stop();
  });

  it('작업이 없으면 기다렸다 다시 묻는다(NO_TASK_AVAILABLE 는 오류가 아님)', async () => {
    const { w, be } = setup();
    void w.run();
    await runFor(w, 12);
    expect(be.calls.filter((x) => x.startsWith('pull')).length).toBeGreaterThanOrEqual(2);
    expect(w.lastProblem).toBeNull();
    expect(w.state).toBe('IDLE');
    w.stop();
  });

  it('R-14: 401 이면 토큰을 새로 받아 한 번 다시 보낸다 — 그다음 성공하면 계속', async () => {
    const { w, be, tokens } = setup();
    be.unauthorized = 1;
    void w.run();
    await runFor(w, 12);
    expect(tokens.invalidated).toBe(1);
    expect(w.halted).toBe(false);
    expect(be.calls.filter((x) => x.startsWith('pull')).length).toBeGreaterThanOrEqual(3); // 401 → 다시(NO_TASK) → 대기 뒤 또
    w.stop();
  });

  it('R-14: 토큰을 새로 받은 뒤에도 401 이면 그 계정은 멈추고 더 부르지 않는다', async () => {
    const { w, be, tokens } = setup();
    be.unauthorized = 5;
    void w.run();
    await runFor(w, 120);
    expect(tokens.invalidated).toBe(1);
    expect(be.calls.filter((x) => x.startsWith('pull')).length).toBe(2);
    expect(w.halted).toBe(true);
    expect(w.left).toBe(false); // 화면에 남겨 사유를 보인다
    expect(w.lastProblem).toMatch(/R-14/);
  });
});
