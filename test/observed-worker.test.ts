// 실서버의 실제 PDA 작업자 — 서버가 확정한 마지막 집품 칸에 세운다(SIM-2a, 그리기만).
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS, REAL_LINK } from '../src/config';
import type { TaskDetail } from '../src/domain/contract';
import { ViewController } from '../src/render/controller';
import { Simulation } from '../src/sim/simulation';

function pick(rem: [number, number]): TaskDetail {
  const line = (sku: string, loc: string, seq: number, r: number) => ({
    taskLineId: sku, orderLineId: sku, sku, productName: `상품 ${sku}`, barcode: null, locationId: loc, lotId: null, expiresOn: null,
    plannedQty: 1, completedQty: 1 - r, cancelledQty: 0, remainingQty: r, pendingQty: 0,
    picks: [{ lotId: `LOT-${sku}`, expiresOn: null, remainingQty: r, visitSeq: seq, locations: [{ locationCode: loc, qty: 5, allocatedQty: 1 }] }],
  });
  return {
    taskId: 'ORD-1-S1-PICK', taskType: 'PICK', state: 'IN_PROGRESS', version: 3 - rem[0] - rem[1], mfcId: 'MFC-SEED-01', fulfillmentId: 'FUL-1', shipmentId: 'ORD-1-S1',
    assignment: { workerId: 'OP-990d2c09', assignmentVersion: 1 }, lineCount: 2, plannedQty: 2, completedQty: 0, remainingQty: rem[0] + rem[1],
    promisedReadyAt: null, createdAt: '2026-11-16T07:14:03Z', blockReason: null,
    lines: [line('E-1', 'A-C1-05-1-04', 1, rem[0]), line('E-2', 'A-C1-04-6-02', 2, rem[1])],
  } as unknown as TaskDetail;
}

async function walk(sim: Simulation, sec: number) {
  for (let t = 0; t < sec; t += 0.25) {
    for (const w of sim.observedWorkers) w.tick(0.25);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
}

describe('실제 PDA 작업자 표시(실서버 관찰)', () => {
  it('스캔 안내: 카트 → (카트 찍음) → 첫 칸 → 집품 확정되면 다음 칸, 작업이 끝나면 피킹 대기 자리로 돌아가 기다린다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const sync = () => {
      real.polls++;
      (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    };
    const d = pick([1, 1]);
    real.tasks.set(d.taskId, { summary: d, detail: d, firstSeenMs: 0, closed: null });
    sync();
    expect(sim.observedWorkers).toHaveLength(1);
    const w = sim.observedWorkers[0];
    expect(sim.siteWorkers()).toContain(w);
    expect(w.state).toBe('PICKING');
    expect(w.pda?.progress).toBe('0 / 2');
    expect(w.pda?.nextLocation).toBe('A-C1-05-1-04');
    expect(w.currentTarget?.code).toBe('C01-05-104'); // 다음 지시 칸(바닥 고리)
    const cart = sim.backendPoint('CRT-A-01')!;
    expect(Math.hypot(w.pos.x - cart.x, w.pos.z - cart.z)).toBeLessThan(0.5);
    // ① 카트 — 상온 칸이 첫 칸이라 상온 카트
    expect(w.cue).toMatchObject({ kind: 'CART', cart: 'CRT-A-01' });
    await walk(sim, 2);
    expect(w.moving).toBe(false); // 도착 → 말풍선이 뜬다
    expect(w.hasCart).toBe(false); // 카트 QR 을 찍기 전엔 빈손

    // 화면에서 "카트 찍음" → 첫 칸으로 걸어가 ② 위치 ③ 상품
    sim.passCart('OP-990d2c09');
    expect(w.cue?.kind).toBe('PICK');
    expect(w.hasCart).toBe(true); // 카트 QR 찍음 → 카트를 든다
    await walk(sim, 120);
    const loc1 = sim.backendLocation('A-C1-05-1-04')!;
    expect(Math.hypot(w.pos.x - loc1.pick.x, w.pos.z - loc1.pick.z)).toBeLessThan(0.3);
    expect(w.moving).toBe(false);
    expect(w.cue).toMatchObject({ kind: 'PICK', index: 1, total: 2, stop: { location: 'A-C1-05-1-04', qty: 1 } });

    // 첫 칸 집품 확정(서버) → 다음 칸으로
    const d2 = pick([0, 1]);
    real.tasks.set(d2.taskId, { summary: d2, detail: d2, firstSeenMs: 0, closed: null });
    sync();
    await walk(sim, 120);
    const loc2 = sim.backendLocation('A-C1-04-6-02')!;
    expect(Math.hypot(w.pos.x - loc2.pick.x, w.pos.z - loc2.pick.z)).toBeLessThan(0.3);
    expect(w.cue).toMatchObject({ kind: 'PICK', index: 2, stop: { location: 'A-C1-04-6-02' } });
    expect(w.pda?.location).toBe('A-C1-05-1-04');
    expect(w.pda?.nextLocation).toBe('A-C1-04-6-02');

    // 열린 작업이 없어지면: 피킹이 막 끝난 사이(PACK 이 보이기 전)는 observedGraceSec 동안 그대로, 그 뒤 쉬는 상태·말풍선 없음 — 피킹 대기 자리로 걸어간다
    real.tasks.get(d2.taskId)!.closed = { atMs: 0, state: 'COMPLETED' };
    sync();
    expect(w.state).toBe('PICKING'); // 아직 기다림
    w.lastSeenMs -= REAL_LINK.observedGraceSec * 1000 + 1;
    sync();
    expect(sim.observedWorkers).toHaveLength(1);
    expect(w.state).toBe('IDLE');
    expect(w.cue).toBeNull();
    await walk(sim, 120);
    const home = sim.layout.points.idle[0];
    expect(Math.hypot(w.pos.x - home.x, w.pos.z - home.z)).toBeLessThan(0.3);
  });

  it('카트 안내: 카트가 아직 없는 두 주문은 서로 다른 빈 카트, 다른 주문이 쓰는 카트(서버)는 빼고', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const a = pick([1, 1]);
    const b = { ...pick([1, 1]), taskId: 'ORD-2-S1-PICK', shipmentId: 'ORD-2-S1', createdAt: '2026-11-16T07:15:00Z', assignment: { workerId: 'OP-other', assignmentVersion: 1 } } as unknown as TaskDetail;
    // 다른 주문 ORD-9 가 CRT-A-01 을 쓰는 중(서버 PACK packingLocations)
    const busy = { ...pick([0, 0]), taskId: 'ORD-9-S1-PACK', taskType: 'PACK', state: 'READY', shipmentId: 'ORD-9-S1', packingLocations: ['CRT-A-01'], assignment: { workerId: null, assignmentVersion: 0 } } as unknown as TaskDetail;
    for (const d of [a, b, busy]) real.tasks.set(d.taskId, { summary: d, detail: d, firstSeenMs: 0, closed: null });
    real.polls++;
    (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    const cue = (id: string) => (sim.observedWorkers.find((w) => w.workerId === id)!.cue as { cart: string }).cart;
    expect(cue('OP-990d2c09')).toBe('CRT-A-02');
    expect(cue('OP-other')).toBe('CRT-A-03');
  });

  it('속도 배수: 서버 speedFactor 위에 곱한다(1~최대), 가상 작업자 배율에도', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const ctx = (sim as unknown as { realCtx: { speedFactor: (id: string) => number } }).realCtx;
    expect(ctx.speedFactor('OP-x')).toBe(1);
    sim.setSpeedBoost(4);
    expect(ctx.speedFactor('OP-x')).toBe(4);
    sim.setSpeedBoost(99);
    expect(sim.speedBoost).toBe(10);
    sim.setSpeedBoost(0);
    expect(sim.speedBoost).toBe(1);
  });

  it('PDA 따라가기: 아바타가 아직 걷는 중인데 서버에 집품이 오면 방금 집은 칸으로 순간이동 → 다음 칸으로 걷는다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const sync = () => {
      real.polls++;
      (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    };
    const d = pick([1, 1]);
    real.tasks.set(d.taskId, { summary: d, detail: d, firstSeenMs: 0, closed: null });
    sync();
    const w = sim.observedWorkers[0];
    sim.passCart('OP-990d2c09');
    await walk(sim, 1); // 첫 칸으로 걷는 중
    const loc1 = sim.backendLocation('A-C1-05-1-04')!;
    expect(Math.hypot(w.pos.x - loc1.pick.x, w.pos.z - loc1.pick.z)).toBeGreaterThan(0.3);
    const d2 = pick([0, 1]);
    real.tasks.set(d2.taskId, { summary: d2, detail: d2, firstSeenMs: 0, closed: null });
    sync();
    expect(Math.hypot(w.pos.x - loc1.pick.x, w.pos.z - loc1.pick.z)).toBeLessThan(0.3); // PDA 는 이미 첫 칸을 지남
    expect(w.moving).toBe(true); // 다음 칸으로
    await walk(sim, 120);
    const loc2 = sim.backendLocation('A-C1-04-6-02')!;
    expect(Math.hypot(w.pos.x - loc2.pick.x, w.pos.z - loc2.pick.z)).toBeLessThan(0.3);
  });

  it('이미 집품이 있는 작업은 카트를 건너뛰고 지금 칸, 막힘(BLOCKED)은 말풍선 없이 마지막 칸', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const d = pick([0, 1]);
    real.tasks.set(d.taskId, { summary: d, detail: d, firstSeenMs: 0, closed: null });
    real.polls++;
    (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    const w = sim.observedWorkers[0];
    expect(w.cue).toMatchObject({ kind: 'PICK', stop: { location: 'A-C1-04-6-02' } });

    const b = { ...pick([0, 1]), state: 'BLOCKED' } as TaskDetail;
    real.tasks.set(b.taskId, { summary: b, detail: b, firstSeenMs: 0, closed: null });
    real.polls++;
    (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    expect(w.cue).toBeNull();
    await walk(sim, 120);
    const last = sim.backendLocation('A-C1-05-1-04')!;
    expect(Math.hypot(w.pos.x - last.pick.x, w.pos.z - last.pick.z)).toBeLessThan(0.3);
  });

  it('포장 안내: 패킹대 → 카트 → (서버) 배차 요청 → 담기(밀봉한 만큼 줄어듦) → 출고 READY 면 출하대기 랙', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const sync = () => {
      real.polls++;
      (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    };
    const p = pick([0, 0]);
    const pack = {
      ...p, taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'IN_PROGRESS', packingLocations: ['PAK-A-02'],
      lines: p.lines.map((l) => ({ ...l, plannedQty: 2, completedQty: 0, remainingQty: 2, picks: [] })),
    } as unknown as TaskDetail;
    const pk = { ...p, state: 'COMPLETED' } as TaskDetail;
    real.tasks.set(pk.taskId, { summary: pk, detail: pk, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
    real.tasks.set(pack.taskId, { summary: pack, detail: pack, firstSeenMs: 0, closed: null });
    const ship = (o: object) => real.shipmentInfo.set('ORD-1-S1', { data: { shipmentId: 'ORD-1-S1', state: 'PREPARING', packages: [], dispatchRequest: null, ...o } as never, readMs: 0, sig: '' });
    ship({});
    sync();
    const w = sim.observedWorkers[0];
    const cue = () => w.cue as { kind: string; step: string; station: string; cart: string; bag: { left: number }[] };
    expect(cue()).toMatchObject({ kind: 'PACK', step: 'STATION', station: 'PAK-A-02', cart: 'CRT-A-01' });
    expect(w.hasCart).toBe(true); // 피킹한 카트를 끌고 옴
    await walk(sim, 120);
    const st = sim.backendPoint('PAK-A-02')!;
    // 패킹대(탁자 깊이 0.8 m) 바로 앞 — 패킹 구역 벽을 뺀 뒤(2026-11-21) 길찾기 격자 끝점이 0.53 m 로 조금 달라짐
    expect(Math.hypot(w.pos.x - st.x, w.pos.z - st.z)).toBeLessThan(0.6);

    // 배차 요청이 이미 있어도(피킹 전 요청 — fulfillment 0.14.0) PDA 는 ① 패킹대 → ② 카트부터 묻는다
    ship({ dispatchRequest: { estimatedReadyAt: '2026-11-17T02:00:00Z' } });
    sync();
    expect(cue().step).toBe('STATION');
    ship({});
    sync();
    sim.passScan('OP-990d2c09');
    expect(cue().step).toBe('CART');
    sim.passScan('OP-990d2c09');
    expect(cue().step).toBe('DISPATCH');
    expect(w.hasCart).toBe(false);

    ship({ dispatchRequest: { estimatedReadyAt: '2026-11-17T02:00:00Z' } });
    sync();
    expect(cue().step).toBe('BAG');
    expect(cue().bag.map((b) => b.left)).toEqual([2, 2]);
    ship({ dispatchRequest: {}, packages: [{ state: 'SEALED', contents: [{ orderLineId: 'E-1', sku: 'E-1', qty: 2 }, { orderLineId: 'E-2', sku: 'E-2', qty: 1 }] }] });
    sync();
    expect(cue().bag.map((b) => b.left)).toEqual([1]);

    ship({ state: 'READY', dispatchRequest: {}, packages: [] });
    sync();
    expect(cue().step).toBe('RACK');
    await walk(sim, 120);
    const rack = sim.backendPoint('DSP-A-01')!;
    expect(Math.hypot(w.pos.x - rack.x, w.pos.z - rack.z)).toBeLessThan(0.5);
  });

  it('마지막 밀봉에서 PACK 이 끝나도(서버) ⑤ 랙 단계로 둔다 — "랙 찍음" 또는 그 작업자가 다음 작업을 받아야 랙에 올림', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const sync = () => {
      real.polls++;
      (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    };
    const p = pick([0, 0]);
    const pack = { ...p, taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'COMPLETED', packingLocations: ['CRT-A-07'] } as unknown as TaskDetail;
    real.tasks.set(pack.taskId, { summary: pack, detail: pack, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
    real.shipmentInfo.set('ORD-1-S1', { data: { shipmentId: 'ORD-1-S1', state: 'READY', dispatchRequest: {}, packages: [{ state: 'SEALED', contents: [] }] } as never, readMs: 0, sig: '' });
    sync();
    const w = sim.observedWorkers[0];
    expect(w.cue).toMatchObject({ kind: 'PACK', step: 'RACK' });
    expect(sim.onRack('ORD-1-S1')).toBe(false); // 아직 패킹대
    expect(sim.rackFor('ORD-1-S1')).toBe('DSP-A-01'); // 모르면 랙 1
    sim.passScan(w.workerId, 'DSP-A-02'); // 랙 2 찍음
    expect(sim.onRack('ORD-1-S1')).toBe(true);
    expect(sim.rackFor('ORD-1-S1')).toBe('DSP-A-02');
    expect(w.cue).toBeNull();
    expect(w.state).toBe('IDLE');

    // 다른 PC 화면(찍음 안 누름): 그 작업자가 다음 작업을 받으면 랙에 올린 것으로
    const sim2 = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const r2 = sim2.real!;
    r2.tasks.set(pack.taskId, { summary: pack, detail: pack, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
    r2.shipmentInfo.set('ORD-1-S1', real.shipmentInfo.get('ORD-1-S1')!);
    expect(sim2.onRack('ORD-1-S1')).toBe(false);
    const next = { ...pick([1, 1]), taskId: 'ORD-2-S1-PICK', shipmentId: 'ORD-2-S1', state: 'ASSIGNED' } as unknown as TaskDetail;
    r2.tasks.set(next.taskId, { summary: next, detail: next, firstSeenMs: 0, closed: null });
    expect(sim2.onRack('ORD-1-S1')).toBe(true);
  });

  it('⑤ 랙: 아바타가 랙에 서고 rackAutoSec 지나면 랙에 둔 것으로(PDA 는 다음 건, 서버는 모름) → 피킹 대기 자리로', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.parse('2026-11-19T04:00:00Z'));
      const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
      const real = sim.real!;
      const sync = () => {
        real.polls++;
        (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
      };
      const p = pick([0, 0]);
      const pack = { ...p, taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'COMPLETED', packingLocations: ['CRT-A-07'] } as unknown as TaskDetail;
      real.tasks.set(pack.taskId, { summary: pack, detail: pack, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
      real.shipmentInfo.set('ORD-1-S1', { data: { shipmentId: 'ORD-1-S1', state: 'READY', dispatchRequest: {}, packages: [{ state: 'SEALED', contents: [] }] } as never, readMs: 0, sig: '' });
      sync();
      const w = sim.observedWorkers[0];
      expect(w.cue).toMatchObject({ kind: 'PACK', step: 'RACK' });
      await walk(sim, 120); // 랙까지 걷기
      sync(); // 도착 시각 기록
      expect(w.cue).toMatchObject({ step: 'RACK' });
      vi.setSystemTime(Date.now() + (REAL_LINK.rackAutoSec - 1) * 1000);
      sync();
      expect(w.cue).toMatchObject({ step: 'RACK' }); // 아직
      vi.setSystemTime(Date.now() + 2000);
      sync(); // 넘김 표시
      sync(); // 다음 조회: 열린 작업 없음 → 대기 자리로
      expect(w.cue).toBeNull();
      expect(w.state).toBe('IDLE');
      expect(sim.onRack('ORD-1-S1')).toBe(true);
      expect(sim.rackFor('ORD-1-S1')).toBe('DSP-A-01'); // 버튼 안 눌렀으면 랙 1(추정)
      // 실제 주문 탭에서 그 주문을 누르면 작업자가 아니라 그 랙으로
      const view = new ViewController(sim);
      view.select({ kind: 'worker', id: w.id });
      view.setScanShipment('ORD-1-S1');
      const rack = sim.backendPoint('DSP-A-01')!;
      const req = view.takeCameraRequest()!;
      expect(Math.hypot(req.target.x - rack.x, req.target.z - rack.z)).toBeLessThan(0.01);
      expect(view.follow).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('피킹 끝 · 패킹 배정 전(서버 pickedBy 만): 사라지지 않고 카트 끌고 포장대 앞에서 "다음 작업 받기" 안내 → 배정되면 ① 패킹대', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const sync = () => {
      real.polls++;
      (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    };
    const p = pick([0, 0]);
    real.tasks.set(p.taskId, { summary: { ...p, state: 'COMPLETED' }, detail: { ...p, state: 'COMPLETED' }, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
    const pack = { ...p, taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'READY', assignment: { workerId: null, assignmentVersion: 0 }, pickedBy: 'OP-990d2c09', packingLocations: ['CRT-A-07'] } as unknown as TaskDetail;
    real.tasks.set(pack.taskId, { summary: pack, detail: pack, firstSeenMs: 0, closed: null });
    sync();
    expect(sim.observedWorkers).toHaveLength(1);
    const w = sim.observedWorkers[0];
    expect(w.workerId).toBe('OP-990d2c09');
    expect(w.cue).toMatchObject({ kind: 'NEXT', shipmentId: 'ORD-1-S1', cart: 'CRT-A-07' });
    expect(w.hasCart).toBe(true);
    expect(sim.heldCarts().has('CRT-A-07')).toBe(true);
    expect(w.state).toBe('WAIT_STATION');

    // PDA 다음 작업 받기 → 서버가 이 PACK 을 배정
    const assigned = { ...pack, state: 'ASSIGNED', assignment: { workerId: 'OP-990d2c09', assignmentVersion: 1 } } as unknown as TaskDetail;
    real.tasks.set(pack.taskId, { summary: assigned, detail: assigned, firstSeenMs: 0, closed: null });
    sync();
    expect(w.cue).toMatchObject({ kind: 'PACK', step: 'STATION' });
  });

  it('끌고 온 장바구니의 집품분(서버 PICKED)은 작업자 카트 위에 — 카트를 내려놓으면 카트 보관 자리로', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const sync = () => {
      real.polls++;
      (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    };
    const p = pick([0, 0]);
    const pack = {
      ...p, taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'IN_PROGRESS', packingLocations: ['CRT-A-07'],
      lines: p.lines.map((l) => ({ ...l, plannedQty: 2, completedQty: 0, remainingQty: 2, picks: [] })),
    } as unknown as TaskDetail;
    real.tasks.set(pack.taskId, { summary: pack, detail: pack, firstSeenMs: 0, closed: null });
    real.shipmentInfo.set('ORD-1-S1', { data: { shipmentId: 'ORD-1-S1', state: 'PREPARING', packages: [], dispatchRequest: null } as never, readMs: 0, sig: '' });
    real.stock.set('E-1', { data: { mfcId: 'MFC-SEED-01', sku: 'E-1', lots: [], units: [{ locationCode: 'CRT-A-07', workState: 'PICKED', qualityState: 'NORMAL', qty: 2 }] } as never, readMs: 0 });
    real.stock.set('E-2', { data: { mfcId: 'MFC-SEED-01', sku: 'E-2', lots: [], units: [{ locationCode: 'CRT-A-09', workState: 'PICKED', qualityState: 'NORMAL', qty: 5 }] } as never, readMs: 0 });
    sync();
    const w = sim.observedWorkers[0];
    expect(w.hasCart).toBe(true);
    expect(w.carrying).toHaveLength(2); // 이 출고의 카트 CRT-A-07 몫만
    expect([...sim.heldCarts()]).toEqual(['CRT-A-07']);
    sim.passScan(w.workerId);
    sim.passScan(w.workerId); // 카트 찍음 → 내려놓음
    expect(w.hasCart).toBe(false);
    expect(w.carrying).toEqual([]);
    expect(sim.heldCarts().size).toBe(0);
  });

  it('복귀(RETURN): 출발 위치(장바구니)에서 상품 싣기 → (실었어요) → 추천 선반 칸, 실적이 서버에 오면 다음 조각', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const sync = () => {
      real.polls++;
      (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    };
    const ret = (rem: [number, number]): TaskDetail => {
      const line = (sku: string, shelf: string, q: number, r: number) => ({
        taskLineId: sku, orderLineId: sku, sku, productName: `상품 ${sku}`, barcode: '2990000004963', locationId: 'CRT-C-01', lotId: `LOT-${sku}`, expiresOn: null,
        plannedQty: q, completedQty: q - r, cancelledQty: 0, remainingQty: r, pendingQty: 0,
        picks: [{ lotId: `LOT-${sku}`, expiresOn: null, remainingQty: r, locations: [{ locationCode: 'CRT-C-01', qty: r, allocatedQty: 0 }], suggestedToLocations: [shelf] }],
      });
      return {
        taskId: 'ORD-9-S1-RETURN', taskType: 'RETURN', state: 'IN_PROGRESS', version: 2, mfcId: 'MFC-SEED-01', fulfillmentId: 'FUL-9', shipmentId: 'ORD-9-S1',
        assignment: { workerId: 'OP-ret', assignmentVersion: 1 }, lineCount: 2, plannedQty: 3, completedQty: 0, remainingQty: rem[0] + rem[1],
        promisedReadyAt: null, createdAt: '2026-11-17T06:30:00Z', blockReason: null,
        lines: [line('B-1', 'A-F3-01-3-01', 1, rem[0]), line('E-2', 'A-C1-04-6-02', 2, rem[1])],
      } as unknown as TaskDetail;
    };
    const d = ret([1, 2]);
    real.tasks.set(d.taskId, { summary: d, detail: d, firstSeenMs: 0, closed: null });
    sync();
    const w = sim.observedWorkers[0];
    expect(w.cue).toMatchObject({ kind: 'RETURN', step: 'FROM', index: 1, total: 3, piece: { from: 'CRT-C-01', left: 1, suggested: ['A-F3-01-3-01'] } });
    expect(w.hasCart).toBe(false);
    const cartPt = sim.backendPoint('CRT-C-01')!;
    expect(Math.hypot(w.pos.x - cartPt.x, w.pos.z - cartPt.z)).toBeLessThan(0.5);
    // "실었어요" → 추천 선반 칸으로
    sim.passScan('OP-ret');
    expect(w.cue).toMatchObject({ kind: 'RETURN', step: 'TO' });
    expect(w.hasCart).toBe(true);
    await walk(sim, 180);
    const shelf = sim.backendLocation('A-F3-01-3-01')!;
    expect(Math.hypot(w.pos.x - shelf.pick.x, w.pos.z - shelf.pick.z)).toBeLessThan(0.3);
    // 복귀 실적 반영(서버) → 다음 조각은 다시 출발 위치부터
    const d2 = ret([0, 2]);
    real.tasks.set(d2.taskId, { summary: d2, detail: d2, firstSeenMs: 0, closed: null });
    sync();
    expect(w.cue).toMatchObject({ kind: 'RETURN', step: 'FROM', index: 2, piece: { line: { sku: 'E-2' }, left: 2, suggested: ['A-C1-04-6-02'] } });
  });

  it('가상 작업자가 맡은 작업은 실제 작업자로 따로 세우지 않는다', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    (sim as unknown as { virtualWorkerIds(): Set<string> }).virtualWorkerIds = () => new Set(['OP-990d2c09']);
    const d = pick([1, 1]);
    sim.real!.tasks.set(d.taskId, { summary: d, detail: d, firstSeenMs: 0, closed: null });
    sim.real!.polls++;
    (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    expect(sim.observedWorkers).toHaveLength(0);
  });

  it('PDA 가 쓰는 계정: 최근 서버 작업의 담당·피킹한 사람이면 사용 중, 첫 조회 전은 모름, 오래된 끝난 작업은 아님', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    expect(sim.pdaInUse('OP-990d2c09')).toBeNull(); // 첫 조회 전
    real.polls++;
    expect(sim.pdaInUse('OP-990d2c09')).toBe(false);
    const d = { ...pick([1, 1]), lastActivityAt: new Date().toISOString() } as unknown as TaskDetail;
    real.tasks.set(d.taskId, { summary: d, detail: d, firstSeenMs: 0, closed: null });
    expect(sim.pdaInUse('OP-990d2c09')).toBe(true); // 열린 작업 담당
    expect(sim.pdaInUse('OP-other')).toBe(false);
    const old = { ...d, lastActivityAt: new Date(Date.now() - (REAL_LINK.pdaSkipSec + 60) * 1000).toISOString() } as unknown as TaskDetail;
    real.tasks.set(d.taskId, { summary: old, detail: old, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
    expect(sim.pdaInUse('OP-990d2c09')).toBe(false); // 오래전에 끝난 것
    const pack = { ...d, taskId: 'P', taskType: 'PACK', state: 'READY', assignment: { workerId: null, assignmentVersion: 0 }, pickedBy: 'OP-990d2c09' } as unknown as TaskDetail;
    real.tasks.set('P', { summary: pack, detail: pack, firstSeenMs: 0, closed: null });
    expect(sim.pdaInUse('OP-990d2c09')).toBe(true); // 피킹한 사람
  });

  it('끊긴 가상 작업자 작업: 시작 기기 SIM-mfcw-pp-NN 인 열린 작업 → 이어 하기 목록, PDA 사용 중으로 보지 않음', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    real.polls++;
    const d = { ...pick([1, 1]), orderNumber: '12345678', lastActivityAt: new Date().toISOString(), activeStart: { requestId: 'r', workerId: 'OP-990d2c09', deviceId: 'SIM-mfcw-pp-03', startedAt: '' } } as unknown as TaskDetail;
    real.tasks.set(d.taskId, { summary: d, detail: d, firstSeenMs: 0, closed: null });
    expect(sim.interruptedVirtual()).toEqual([{ account: 'mfcw-pp-03', taskId: d.taskId, taskType: 'PICK', orderNumber: '12345678' }]);
    expect(sim.pdaInUse('OP-990d2c09')).toBe(false);
    expect(sim.ownWork('OP-990d2c09')).toBe(true);
    // PDA 가 시작한 작업은 이어 하기 대상이 아니고 PDA 사용 중
    const pda = { ...d, activeStart: { ...d.activeStart!, deviceId: 'PDA-abc' } } as unknown as TaskDetail;
    real.tasks.set(d.taskId, { summary: pda, detail: pda, firstSeenMs: 0, closed: null });
    expect(sim.interruptedVirtual()).toEqual([]);
    expect(sim.pdaInUse('OP-990d2c09')).toBe(true);
  });

  it('가상 작업자 켜는 순서: 끊긴 작업이 남은 계정(시작 기기 SIM-mfcw-pp-03)부터, 나머지는 번호 순', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    real.polls++;
    const d = { ...pick([1, 1]), activeStart: { requestId: 'r', workerId: 'OP-990d2c09', deviceId: 'SIM-mfcw-pp-03', startedAt: '' } } as unknown as TaskDetail;
    real.tasks.set(d.taskId, { summary: d, detail: d, firstSeenMs: 0, closed: null });
    const started: string[] = [];
    (sim as unknown as { spawnVirtual(a: string, i: number, r: boolean): unknown }).spawnVirtual = (a: string) => {
      started.push(a);
      const w = { account: a, leaving: false, left: false, resumeOnly: false, skipped: false, workerId: null };
      sim.virtualWorkers.push(w as never);
      return w;
    };
    sim.setVirtualWorkers(1);
    expect(started).toEqual(['mfcw-pp-03']);
    sim.setVirtualWorkers(3);
    expect(started).toEqual(['mfcw-pp-03', 'mfcw-pp-01', 'mfcw-pp-02']);
  });

  it('서버가 랙을 알면(포장 stagingLocation, F-12) ⑤ 랙 단계 없이 그 랙 — 추정·자동 넘김 안 씀', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const p = pick([0, 0]);
    const pack = { ...p, taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'COMPLETED', packingLocations: ['CRT-A-07'] } as unknown as TaskDetail;
    real.tasks.set(pack.taskId, { summary: pack, detail: pack, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
    real.shipmentInfo.set('ORD-1-S1', { data: { shipmentId: 'ORD-1-S1', state: 'READY', dispatchRequest: {}, packages: [{ state: 'SEALED', contents: [], stagingLocation: 'DSP-A-02' }] } as never, readMs: 0, sig: '' });
    real.polls++;
    (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    expect(sim.observedWorkers).toHaveLength(0); // 랙 단계로 세우지 않음
    expect(sim.onRack('ORD-1-S1')).toBe(true);
    expect(sim.rackFor('ORD-1-S1')).toBe('DSP-A-02');
    expect(sim.serverRack('ORD-1-S1')).toBe('DSP-A-02');
  });

  it('피킹 끝 → PACK 에 pickedBy 가 아직 없어도 같은 출고 PICK 담당으로 이어 붙이고, 배차 요청이 먼저 와도 카트를 든 채 포장대로', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    const sync = () => {
      real.polls++;
      (sim as unknown as { syncObservedWorkers(): void }).syncObservedWorkers();
    };
    const p = pick([0, 0]);
    real.tasks.set(p.taskId, { summary: { ...p, state: 'COMPLETED' }, detail: { ...p, state: 'COMPLETED' }, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
    const pack = { ...p, taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'READY', assignment: { workerId: null, assignmentVersion: 0 }, pickedBy: null, packingLocations: ['CRT-A-07'] } as unknown as TaskDetail;
    real.tasks.set(pack.taskId, { summary: pack, detail: pack, firstSeenMs: 0, closed: null });
    sync();
    const w = sim.observedWorkers[0];
    expect(w?.cue).toMatchObject({ kind: 'NEXT' });
    expect(w.hasCart).toBe(true);
    // PDA 가 패킹 시작 + 배차 요청까지 바로 — 아바타는 아직 포장대로 걷는 중
    const started = { ...pack, state: 'IN_PROGRESS', assignment: { workerId: 'OP-990d2c09', assignmentVersion: 1 } } as unknown as TaskDetail;
    real.tasks.set(pack.taskId, { summary: started, detail: started, firstSeenMs: 0, closed: null });
    real.shipmentInfo.set('ORD-1-S1', { data: { shipmentId: 'ORD-1-S1', state: 'PREPARING', packages: [], dispatchRequest: { state: 'REQUESTED' } } as never, readMs: 0, sig: '' });
    sync();
    expect(w.cue).toMatchObject({ kind: 'PACK', step: 'STATION' }); // 배차 요청만으로는 안 넘어감(PDA 화면과 같음) — 카트 든 채 포장대로
    expect(w.hasCart).toBe(true);
  });
});
