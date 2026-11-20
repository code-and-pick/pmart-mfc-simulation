// 실서버 가상 작업자(RealWorker)의 호출 순서 — 가짜 백엔드로 화면 없이 돌린다.
import { describe, expect, it } from 'vitest';
import type { HttpBackend } from '../src/backend/http/HttpBackend';
import type { TokenSource } from '../src/backend/http/tokens';
import { BACKEND_FACTS, DEFAULT_PARAMS } from '../src/config';
import { ApiProblem, type CapacityAssignment, type InboundTask, type InboundTaskExecution, type MoveOrder, type TaskDetail, type TaskState } from '../src/domain/contract';
import { buildLayout } from '../src/domain/layout';
import { buildLocationCodeMap } from '../src/domain/locationCodes';
import { NavGrid } from '../src/domain/navgrid';
import { RealWorker, packDropFor, tempOfCode, type RealSiteContext } from '../src/sim/realWorker';
import { CartPool } from '../src/sim/cartPool';
import { StationPool } from '../src/sim/site';

const ME = 'OP-pp01';

function task(id: string, type: TaskDetail['taskType'], state: TaskState, extra: Partial<TaskDetail> = {}): TaskDetail {
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
  /** PICK_PACK 밖 업무의 받을 작업 — DENY = 422 WORK_AREA_NOT_ALLOWED */
  areaQueue: Record<string, (CapacityAssignment | 'NONE' | 'DENY')[]> = {};
  async pullNextTask(_m: string, w: string, area: string) {
    this.calls.push(`pull ${w} ${area}`);
    if (this.unauthorized > 0) {
      this.unauthorized--;
      throw new ApiProblem({ status: 401, code: 'UNAUTHENTICATED' });
    }
    const n = (area === 'PICK_PACK' ? this.queue.shift() : this.areaQueue[area]?.shift()) ?? 'NONE';
    if (n === 'NONE') throw new ApiProblem({ status: 409, code: 'NO_TASK_AVAILABLE' });
    if (n === 'DENY') throw new ApiProblem({ status: 422, code: 'WORK_AREA_NOT_ALLOWED' });
    return n;
  }
  // ── 입고 작업·이동 지시(mfc-inbound)·적치 후보(mfc-location) ──
  inbound = new Map<string, InboundTask>();
  /** 실행 응답 차례(앞에서부터) — 비면 APPLIED */
  applyStatuses: (InboundTaskExecution['applyStatus'] | 503)[] = [];
  candidates: { locationCode: string }[] = [];
  moves = new Map<string, MoveOrder>();
  keys: string[] = [];
  lotLabels = new Map<string, { lotId: string; lotNo: string; sku: string; tracking: 'TRACKED'; onHand: number; expiryDate?: string | null; manufactureDate?: string | null; sourceLotRef?: string | null }>();
  async getLotLabel(_mfcId: string, lotId: string) {
    this.calls.push(`label ${lotId}`);
    const l = this.lotLabels.get(lotId);
    if (!l) throw new ApiProblem({ status: 404, code: 'LOT_NOT_FOUND' });
    return l;
  }
  rejectPick: { code: string; reason: string } | null = null;
  async getExecution(taskId: string, executionId: string) {
    this.calls.push(`execution ${taskId} ${executionId}`);
    return { executionId, taskId, state: 'REJECTED', rejectCode: this.rejectPick?.code ?? null, rejectReason: this.rejectPick?.reason ?? null };
  }
  async getInboundTask(id: string) {
    return this.inbound.get(id)!;
  }
  private execInbound(id: string, qty: number, key: string): InboundTaskExecution {
    this.keys.push(key);
    const s = this.applyStatuses.shift() ?? 'APPLIED';
    if (s === 503) throw new ApiProblem({ status: 503, code: 'UNKNOWN_RESULT' });
    const t = this.inbound.get(id)!;
    if (s === 'APPLIED') this.inbound.set(id, { ...t, doneQty: t.doneQty + qty, state: t.doneQty + qty >= t.plannedQty ? 'COMPLETED' : 'READY' });
    return { executionId: `EX-${id}`, taskId: id, applyStatus: s, createdTaskIds: s === 'APPLIED' && t.taskType === 'INSPECT' ? ['PUT-1'] : [] };
  }
  async inspectInboundTask(id: string, results: { qty: number; resultQuality: string; expiryDate?: string; sourceLotRef?: string }[], key: string) {
    this.calls.push(`inspect ${id} ${results.map((r) => `${r.resultQuality}×${r.qty}${r.expiryDate ? ` exp=${r.expiryDate}` : ''}${r.sourceLotRef ? ` ref=${r.sourceLotRef}` : ''}`).join(',')}`);
    return this.execInbound(id, results.reduce((s, r) => s + r.qty, 0), key);
  }
  async putawayInboundTask(id: string, body: { toLocationCode: string; qty: number }, key: string) {
    this.calls.push(`putaway ${id} ${body.qty}→${body.toLocationCode}`);
    return this.execInbound(id, body.qty, key);
  }
  async listPutawayCandidates(mfcId: string, sku: string, qty?: number) {
    this.calls.push(`candidates ${mfcId} ${sku} ${qty}`);
    return this.candidates;
  }
  async getMoveOrder(id: string) {
    return this.moves.get(id)!;
  }
  async pickUpMoveOrder(id: string, body: { cartLocation: string; qty: number }, key: string) {
    this.calls.push(`pickup ${id} ${body.cartLocation} ${body.qty}`);
    this.keys.push(key);
    const m = this.moves.get(id)!;
    const n = { ...m, cartLocation: body.cartLocation, pickedQty: m.pickedQty + body.qty, onCartQty: m.onCartQty + body.qty, pickedBy: ME };
    this.moves.set(id, n);
    return n;
  }
  async dropMoveOrder(id: string, body: { toLocation: string; qty: number }, key: string) {
    this.calls.push(`drop ${id} ${body.toLocation} ${body.qty}`);
    this.keys.push(key);
    const m = this.moves.get(id)!;
    const n = { ...m, droppedQty: m.droppedQty + body.qty, onCartQty: m.onCartQty - body.qty, state: 'COMPLETED' as const };
    this.moves.set(id, n);
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
  /** 이 출고가 이미 쓰는 장바구니(이어 하기) — 다른 toLocation 이면 409 CART_MISMATCH */
  cartInUse: string | null = null;
  async recordExecution(
    id: string,
    body: { executionType: string; workerId: string; assignmentVersion?: number; fromLocation: string; toLocation: string; lines: { orderLineId: string; sku: string; lotId: string; pickedQty: number }[] },
    key: string,
  ) {
    if (body.executionType === 'RETURN') {
      // 복귀 실적 — 바로 반영된 것으로(줄·조각·위치 양을 줄인다)
      this.calls.push(`return ${id} ${body.lines[0].sku}×${body.lines[0].pickedQty} ${body.fromLocation}→${body.toLocation} lot=${body.lines[0].lotId}`);
      this.bodies.push(body);
      const t = this.tasks.get(id)!;
      const q = body.lines[0].pickedQty;
      this.tasks.set(id, {
        ...t,
        lines: t.lines.map((l) =>
          l.orderLineId !== body.lines[0].orderLineId
            ? l
            : {
                ...l,
                remainingQty: l.remainingQty - q,
                completedQty: l.completedQty + q,
                picks: l.picks?.map((p) => ({ ...p, remainingQty: p.remainingQty - q, locations: p.locations.map((c) => (c.locationCode === body.fromLocation ? { ...c, qty: c.qty - q } : c)) })),
              },
        ),
      });
      return { status: 'ACCEPTED' };
    }
    this.calls.push(`pick ${id} ${body.lines[0].sku}×${body.lines[0].pickedQty} ${body.fromLocation}→${body.toLocation} lot=${body.lines[0].lotId}`);
    if (this.cartInUse && body.toLocation !== this.cartInUse)
      throw new ApiProblem({ status: 409, code: 'CART_MISMATCH', detail: `이 출고는 장바구니 ${this.cartInUse} 를 씁니다.` });
    this.bodies.push(key);
    if (this.rejectPick) return { status: 'REJECTED', resultId: `EX-${id}`, nextAction: 'QUERY_RESULT' };
    return { status: 'ACCEPTED' };
  }
  async requestDispatch(s: string, minutes: number) {
    this.calls.push(`dispatch ${s} ${minutes}m`);
    if (this.dispatchFails) throw new ApiProblem({ status: 409, code: 'INVALID_STATE' });
    return {};
  }
  /** 밀봉 직전에 주문이 취소되는 경우(배차 불가 자동 취소 등) — 그 작업을 CANCELLED 로 바꾸고 409 */
  cancelOnSeal: string | null = null;
  async sealPackage(s: string, body: { contents: { sku: string }[]; temperatureZone?: string; packingLocation?: string }) {
    if (this.cancelOnSeal) {
      const t = this.tasks.get(this.cancelOnSeal)!;
      this.tasks.set(this.cancelOnSeal, { ...t, state: 'CANCELLED' });
      throw new ApiProblem({ status: 409, code: 'INVALID_STATE', detail: '포장 작업은 CANCELLED 상태입니다(시작한 포장 작업만 밀봉).' });
    }
    this.calls.push(`seal ${s} ${body.contents.map((c) => c.sku).join('+')} ${body.temperatureZone ?? '-'} @${body.packingLocation ?? '-'}`);
    return { packageId: `PKG-${body.temperatureZone ?? 'X'}` };
  }
  async stagePackage(id: string, rack: string) {
    this.calls.push(`stage ${id} ${rack}`);
    return { packageId: id, stagingLocation: rack };
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
  const logs: string[] = [];
  const ctx: RealSiteContext = {
    runId: 'run1',
    mfcId: 'MFC-SEED-01',
    layout,
    nav: new NavGrid(layout),
    stations: new StationPool(layout.stations, 4),
    params: { ...DEFAULT_PARAMS },
    now: () => 0,
    log: (m: string) => logs.push(m),
    location: (c) => locBy.get(codes.toSim(c) ?? '') ?? null,
    point: () => null,
    wire: (c) => codes.toBackend(c),
    carts: new CartPool(BACKEND_FACTS.cartLocations.map((x) => x.code)),
  };
  const be = new FakeBe();
  const tokens = { get: async () => 'tok', operatorId: ME, lastError: null, invalidated: 0, invalidate() { this.invalidated++; } };
  const w = new RealWorker('mfcw-pp-01', layout.points.idle[0], ctx, be as unknown as HttpBackend, tokens as unknown as TokenSource);
  return { w, be, tokens, ctx, logs };
}

function assign(taskId: string, taskType: string): CapacityAssignment {
  return { assignmentId: `AS-${taskId}`, mfcId: 'MFC-SEED-01', taskId, taskType, workerId: ME, assignmentVersion: 1, state: 'ACTIVE' };
}

function inboundTask(id: string, type: 'INSPECT' | 'PUTAWAY', qty: number): InboundTask {
  return { taskId: id, taskType: type, mfcId: 'MFC-SEED-01', receiptId: 'RC-1', sku: 'B-1', lotId: 'LOT-R', locationCode: 'RCV-A-01', plannedQty: qty, doneQty: 0, state: 'READY', version: 1, assigneeId: ME };
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

  it('다음 작업 받기(PICK_PACK) → 시작 → visitSeq 순 장바구니로 집품 → PACK 시작 + 배차 요청 → 패킹대에서 온도대별 밀봉', async () => {
    const { w, be } = setup();
    be.tasks.set('P1', task('P1', 'PICK', 'ASSIGNED'));
    be.tasks.set('K1', task('K1', 'PACK', 'ASSIGNED', { packingLocations: ['CRT-A-01'] }));
    be.queue = [
      { assignmentId: 'AS1', mfcId: 'MFC-SEED-01', taskId: 'P1', taskType: 'PICK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' },
      { assignmentId: 'AS2', mfcId: 'MFC-SEED-01', taskId: 'K1', taskType: 'PACK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' },
    ];
    void w.run();
    await runFor(w, 900);
    const c = be.calls;
    expect(c[0]).toBe(`pull ${ME} PICK_PACK`);
    expect(c[1]).toBe(`start P1 ${ME} v1`);
    // visitSeq 1(냉동) 먼저, 그다음 상온 — 한 출고 = 한 장바구니(fulfillment 0.8.0), 온도 구분 없이 첫 빈 카트
    expect(c[2]).toBe('pick P1 F-1×1 F-A1-01-1-01→CRT-A-01 lot=LOT-F');
    expect(c[3]).toBe('pick P1 B-1×2 A-C1-04-2-02→CRT-A-01 lot=LOT-B');
    expect(c[4]).toBe(`pull ${ME} PICK_PACK`);
    expect(c[5]).toBe(`start K1 ${ME} v1`);
    expect(c[6]).toMatch(/^dispatch ORD-1-S1 \d+m$/); // 포장 시작 때 배차 요청
    // 장바구니로 집품했으면 packingLocation = 이 패킹대(필수 — 장바구니 → 패킹대)
    expect(c.slice(7, 9).sort()).toEqual(['seal ORD-1-S1 B-1 AMBIENT @PAK-A-01', 'seal ORD-1-S1 F-1 FROZEN @PAK-A-01']);
    // ⑤ 랙: 밀봉한 포장마다 출하대기 랙에 올림(fulfillment 0.20.0 stagePackage, F-12)
    expect(c.filter((x) => x.startsWith('stage')).sort()).toEqual(['stage PKG-AMBIENT DSP-A-01', 'stage PKG-FROZEN DSP-A-01']);
    expect(c).not.toContain('stock'); // 내가 내려놓은 곳을 알면 재고를 묻지 않는다
    expect(w.ordersDone).toBe(1);
    expect(new Set(be.bodies).size).toBe(2); // 집품마다 다른 Idempotency-Key
    w.stop();
  });

  it('속도 배수는 하는 중에 바꿔도 바로 — 걷기·손일을 매 틱 지금 배율로(배수 1 → 중간에 10)', async () => {
    const run = async (switchAt: number | null) => {
      const { w, be, ctx } = setup();
      let f = 1;
      ctx.speedFactor = () => f;
      be.tasks.set('P1', task('P1', 'PICK', 'ASSIGNED'));
      be.tasks.set('K1', task('K1', 'PACK', 'ASSIGNED', { packingLocations: ['CRT-A-01'] }));
      be.queue = [
        { assignmentId: 'AS1', mfcId: 'MFC-SEED-01', taskId: 'P1', taskType: 'PICK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' },
        { assignmentId: 'AS2', mfcId: 'MFC-SEED-01', taskId: 'K1', taskType: 'PACK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' },
      ];
      void w.run();
      let t = 0;
      let switched = false;
      for (; t < 900 && w.ordersDone < 1; t += 0.25) {
        // 포장(손일 수 분)을 시작한 뒤에 배수를 올린다
        if (switchAt !== null && !switched && w.activity.startsWith('패킹 PS-')) {
          f = 10;
          switched = true;
        }
        w.tick(0.25);
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      w.stop();
      return t;
    };
    const slow = await run(null);
    const fast = await run(0);
    expect(slow).toBeGreaterThan(300);
    expect(fast).toBeLessThan(slow - 120); // 포장 중에 올린 배수가 그 포장에 바로 먹는다
  });

  it('이어 하기(resumeOnly): 들고 있던 작업은 하고, 서버에 남은 자기 일이 없으면 새 작업을 받지 않고 퇴근', async () => {
    const { w, be, ctx } = setup();
    let mine = true;
    ctx.ownWork = () => mine;
    w.resumeOnly = true;
    be.tasks.set('P1', task('P1', 'PICK', 'ASSIGNED'));
    be.queue = [{ assignmentId: 'AS1', mfcId: 'MFC-SEED-01', taskId: 'P1', taskType: 'PICK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' }];
    void w.run();
    for (let t = 0; t < 600 && !be.calls.some((c) => c.startsWith('pick P1 B-1')); t += 0.25) {
      w.tick(0.25);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    }
    mine = false; // 서버에 남은 일 없음
    await runFor(w, 120);
    expect(be.calls.filter((c) => c.startsWith('pull')).length).toBe(1);
    expect(w.left).toBe(true);
    w.stop();
  });

  it('이 출고가 이미 다른 장바구니를 쓰면(409 CART_MISMATCH) 그 장바구니로 다시 보낸다', async () => {
    const { w, be } = setup();
    be.cartInUse = 'CRT-A-17';
    be.tasks.set('P1', task('P1', 'PICK', 'ASSIGNED'));
    be.queue = [{ assignmentId: 'AS1', mfcId: 'MFC-SEED-01', taskId: 'P1', taskType: 'PICK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' }];
    void w.run();
    await runFor(w, 400);
    const picks = be.calls.filter((x) => x.startsWith('pick'));
    expect(picks).toEqual([
      'pick P1 F-1×1 F-A1-01-1-01→CRT-A-01 lot=LOT-F',
      'pick P1 F-1×1 F-A1-01-1-01→CRT-A-17 lot=LOT-F',
      'pick P1 B-1×2 A-C1-04-2-02→CRT-A-17 lot=LOT-B',
    ]);
    w.stop();
  });

  it('남이 장바구니로 집은 출고는 packingLocations 가 장바구니 — 밀봉은 이 패킹대로', async () => {
    const { w, be } = setup();
    be.tasks.set('K3', task('K3', 'PACK', 'ASSIGNED', { packingLocations: ['CRT-A-22'] }));
    be.queue = [{ assignmentId: 'AS4', mfcId: 'MFC-SEED-01', taskId: 'K3', taskType: 'PACK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' }];
    void w.run();
    await runFor(w, 400);
    expect(be.calls).toContain('seal ORD-1-S1 B-1+F-1 - @PAK-A-01');
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

  it('포장 중 주문이 취소돼 밀봉이 409 이고 작업이 CANCELLED 면 오류가 아니라 멈추고 다음 작업을 묻는다', async () => {
    const { w, be, logs } = setup();
    be.cancelOnSeal = 'K3';
    be.tasks.set('K3', task('K3', 'PACK', 'ASSIGNED', { packingLocations: ['PAK-A-01'] }));
    be.queue = [{ assignmentId: 'AS4', mfcId: 'MFC-SEED-01', taskId: 'K3', taskType: 'PACK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' }];
    void w.run();
    await runFor(w, 400);
    expect(w.state).not.toBe('ERROR');
    expect(w.lastProblem).toBeNull();
    expect(logs.some((l) => l.includes('주문 취소로 멈추고'))).toBe(true);
    expect(be.calls.filter((x) => x.startsWith('pull')).length).toBeGreaterThanOrEqual(2);
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

describe('RealWorker — 재고 이동·품질검사 업무', () => {
  function returnTask(): TaskDetail {
    return task('R1', 'RETURN', 'ASSIGNED', {
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
          picks: [{ lotId: 'LOT-B', expiresOn: null, remainingQty: 2, locations: [{ locationCode: 'CRT-A-05', qty: 2 }], suggestedToLocations: ['A-C1-04-2-02', 'A-C1-04-2-03'] }],
        },
      ],
    });
  }

  it('피패킹이 없으면 재고 이동을 묻고, 받은 취소품 복귀(RETURN)는 시작 → 장바구니 → 첫 추천 선반으로 RETURN 실적', async () => {
    const { w, be } = setup();
    be.tasks.set('R1', returnTask());
    be.areaQueue.STOCK_MOVE = [assign('R1', 'RETURN')];
    void w.run();
    await runFor(w, 300);
    const c = be.calls;
    expect(c.slice(0, 4)).toEqual([`pull ${ME} PICK_PACK`, `pull ${ME} STOCK_MOVE`, `start R1 ${ME} v1`, 'return R1 B-1×2 CRT-A-05→A-C1-04-2-02 lot=LOT-B']);
    expect(be.bodies[0]).toEqual({
      executionType: 'RETURN',
      workerId: ME,
      assignmentVersion: 1,
      fromLocation: 'CRT-A-05',
      toLocation: 'A-C1-04-2-02',
      lines: [{ orderLineId: 'L1', sku: 'B-1', lotId: 'LOT-B', pickedQty: 2 }],
    });
    expect(c.filter((x) => x.startsWith('return'))).toHaveLength(1);
    expect(w.lastProblem).toBeNull();
    w.stop();
  });

  it('추천 선반이 없는 복귀 조각은 지어내지 않고 건너뛰며 사유를 남긴다', async () => {
    const { w, be } = setup();
    const t = returnTask();
    t.lines[0].picks![0].suggestedToLocations = [];
    be.tasks.set('R1', t);
    be.areaQueue.STOCK_MOVE = [assign('R1', 'RETURN')];
    void w.run();
    await runFor(w, 20);
    expect(be.calls.filter((x) => x.startsWith('return'))).toHaveLength(0);
    expect(w.lastProblem).toMatch(/추천 선반/);
    w.stop();
  });

  it('품질검사(INSPECTION)는 LOT 정보의 기한·표기로 PDA 와 같은 기준 판정(정상) — CAPTURED 면 같은 키로 다시', async () => {
    const { w, be } = setup();
    be.inbound.set('IN1', { ...inboundTask('IN1', 'INSPECT', 10), minRemainingDays: 3 });
    be.lotLabels.set('LOT-R', { lotId: 'LOT-R', lotNo: 'L1', sku: 'B-1', tracking: 'TRACKED', onHand: 0, expiryDate: '2099-01-01', sourceLotRef: 'MFG-7' });
    be.applyStatuses = ['CAPTURED'];
    be.areaQueue.INSPECTION = [assign('IN1', 'INSPECT')];
    void w.run();
    await runFor(w, 200);
    const c = be.calls;
    expect(c.slice(0, 3)).toEqual([`pull ${ME} PICK_PACK`, `pull ${ME} STOCK_MOVE`, `pull ${ME} INSPECTION`]);
    expect(c.filter((x) => x.startsWith('inspect'))).toEqual(['inspect IN1 NORMAL×10 exp=2099-01-01 ref=MFG-7', 'inspect IN1 NORMAL×10 exp=2099-01-01 ref=MFG-7']);
    expect(new Set(be.keys).size).toBe(1); // 같은 Idempotency-Key
    expect(be.inbound.get('IN1')!.state).toBe('COMPLETED');
    w.stop();
  });

  it('품질검사: 판정 기준·소비기한·LOT 이 없으면 시뮬레이터가 지어 넣고 보낸다(사용자 2026-11-20 "그냥 알아서 값 넣어"), 잔여일이 모자라면 격리', async () => {
    const { w, be, logs } = setup();
    be.inbound.set('IN1', inboundTask('IN1', 'INSPECT', 4)); // minRemainingDays 없음
    // LOT 정보 없음(404) — 소비기한·제조사 LOT 도 없음
    be.areaQueue.INSPECTION = [assign('IN1', 'INSPECT')];
    void w.run();
    await runFor(w, 120);
    const sent = be.calls.filter((x) => x.startsWith('inspect'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^inspect IN1 NORMAL×4 exp=\d{4}-\d{2}-\d{2} ref=SIM-\d{8}-B-1$/);
    expect(logs.some((m) => /INSPECT IN1 B-1 — 라벨 값 없음, 시뮬레이터가 넣음: 판정 기준 7일, 소비기한/.test(m))).toBe(true);
    w.stop();

    const b = setup();
    b.be.inbound.set('IN2', { ...inboundTask('IN2', 'INSPECT', 4), minRemainingDays: 30 });
    b.be.lotLabels.set('LOT-R', { lotId: 'LOT-R', lotNo: 'L1', sku: 'B-1', tracking: 'TRACKED', onHand: 0, expiryDate: '2000-01-02' });
    b.be.areaQueue.INSPECTION = [assign('IN2', 'INSPECT')];
    void b.w.run();
    await runFor(b.w, 120);
    expect(b.be.calls.filter((x) => x.startsWith('inspect'))).toEqual([expect.stringMatching(/^inspect IN2 QUARANTINED×4 exp=2000-01-02 ref=SIM-\d{8}-B-1$/)]);
    b.w.stop();
  });

  it('집품 실적이 REJECTED 면 실행을 한 번 읽어 거절 사유(rejectCode·rejectReason, fulfillment 0.16.0)를 남기고 넘어가지 않는다', async () => {
    const { w, be, logs } = setup();
    be.rejectPick = { code: 'LOT_MISMATCH', reason: '예약에 없는 LOT' };
    be.tasks.set('P1', task('P1', 'PICK', 'ASSIGNED'));
    be.queue = [{ assignmentId: 'AS1', mfcId: 'MFC-SEED-01', taskId: 'P1', taskType: 'PICK', workerId: ME, assignmentVersion: 1, state: 'ACTIVE' }];
    void w.run();
    await runFor(w, 200);
    expect(be.calls).toContain('execution P1 EX-P1');
    expect(be.calls.filter((x) => x.startsWith('pick'))[0]).toBe('pick P1 F-1×1 F-A1-01-1-01→CRT-A-01 lot=LOT-F');
    expect(be.calls).not.toContain('pick P1 B-1×2 A-C1-04-2-02→CRT-A-01 lot=LOT-B');
    expect(logs.some((m) => m.includes('PICK P1 중단 — 집품 거절 LOT_MISMATCH — 예약에 없는 LOT'))).toBe(true);
    w.stop();
  });

  it('적치(PUTAWAY)는 적치 후보 첫 칸으로 남은 양 전부 — 503 UNKNOWN_RESULT 면 같은 키로 다시', async () => {
    const { w, be } = setup();
    const t = inboundTask('PUT-1', 'PUTAWAY', 6);
    be.inbound.set('PUT-1', { ...t, doneQty: 2 });
    be.candidates = [{ locationCode: 'A-C1-04-2-02' }, { locationCode: 'A-C1-04-2-03' }];
    be.applyStatuses = [503];
    be.areaQueue.STOCK_MOVE = [assign('PUT-1', 'PUTAWAY')];
    void w.run();
    await runFor(w, 200);
    const c = be.calls;
    expect(c).toContain('candidates MFC-SEED-01 B-1 4');
    expect(c.filter((x) => x.startsWith('putaway'))).toEqual(['putaway PUT-1 4→A-C1-04-2-02', 'putaway PUT-1 4→A-C1-04-2-02']);
    expect(new Set(be.keys).size).toBe(1);
    expect(be.inbound.get('PUT-1')!.state).toBe('COMPLETED');
    w.stop();
  });

  it('적치 후보가 없으면 적치하지 않고 사유를 남긴다', async () => {
    const { w, be } = setup();
    be.inbound.set('PUT-1', inboundTask('PUT-1', 'PUTAWAY', 3));
    be.areaQueue.STOCK_MOVE = [assign('PUT-1', 'PUTAWAY')];
    void w.run();
    await runFor(w, 20);
    expect(be.calls.filter((x) => x.startsWith('putaway'))).toHaveLength(0);
    expect(w.lastProblem).toMatch(/적치 후보 없음/);
    w.stop();
  });

  it('보충(REPLENISH)은 빈 카트 → 출발 칸에서 싣기(pickups) → 도착 칸에 내려놓기(drops), 끝나면 카트를 돌려준다', async () => {
    const { w, be, ctx } = setup();
    be.moves.set('MV1', {
      moveId: 'MV1',
      kind: 'REPLENISH',
      mfcId: 'MFC-SEED-01',
      sku: 'B-1',
      lotId: 'LOT-B',
      fromLocation: 'A-C1-04-2-03',
      toLocation: 'A-C1-04-2-02',
      cartLocation: null,
      qty: 4,
      pickedQty: 0,
      droppedQty: 0,
      onCartQty: 0,
      state: 'ACTIVE',
      assigneeId: ME,
      pickedBy: null,
    });
    be.areaQueue.STOCK_MOVE = [assign('MV1', 'REPLENISH')];
    void w.run();
    await runFor(w, 200);
    expect(be.calls.filter((x) => x.startsWith('pickup') || x.startsWith('drop'))).toEqual(['pickup MV1 CRT-A-01 4', 'drop MV1 A-C1-04-2-02 4']);
    expect(be.moves.get('MV1')!.state).toBe('COMPLETED');
    expect(ctx.carts.inUse).toBe(0);
    w.stop();
  });

  it('이동(MOVE)이 이미 실려 있으면(이어 하기) 그 카트로 내려놓기만', async () => {
    const { w, be } = setup();
    be.moves.set('MV2', {
      moveId: 'MV2',
      kind: 'MOVE',
      mfcId: 'MFC-SEED-01',
      sku: 'B-1',
      lotId: 'LOT-B',
      fromLocation: 'A-C1-04-2-03',
      toLocation: 'A-C1-04-2-02',
      cartLocation: 'CRT-A-09',
      qty: 3,
      pickedQty: 3,
      droppedQty: 0,
      onCartQty: 3,
      state: 'ACTIVE',
      assigneeId: ME,
      pickedBy: ME,
    });
    be.areaQueue.STOCK_MOVE = [assign('MV2', 'MOVE')];
    void w.run();
    await runFor(w, 200);
    expect(be.calls.filter((x) => x.startsWith('pickup') || x.startsWith('drop'))).toEqual(['drop MV2 A-C1-04-2-02 3']);
    w.stop();
  });

  it('WORK_AREA_NOT_ALLOWED 받은 업무는 그 작업자에게 다시 묻지 않는다', async () => {
    const { w, be } = setup();
    be.areaQueue.STOCK_MOVE = ['DENY'];
    void w.run();
    await runFor(w, 20);
    const pulls = be.calls.filter((x) => x.startsWith('pull'));
    expect(pulls.filter((x) => x.endsWith('STOCK_MOVE'))).toHaveLength(1);
    expect(pulls.filter((x) => x.endsWith('PICK_PACK')).length).toBeGreaterThanOrEqual(2);
    expect(pulls.filter((x) => x.endsWith('INSPECTION')).length).toBeGreaterThanOrEqual(2);
    expect(w.lastProblem).toBeNull();
    w.stop();
  });
});
