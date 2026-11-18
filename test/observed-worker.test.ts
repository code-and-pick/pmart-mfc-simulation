// 실서버의 실제 PDA 작업자 — 서버가 확정한 마지막 집품 칸에 세운다(SIM-2a, 그리기만).
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import type { TaskDetail } from '../src/domain/contract';
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
  it('스캔 안내: 카트 → (카트 찍음) → 첫 칸 → 집품 확정되면 다음 칸, 작업이 끝나면 2분 뒤 빠진다', async () => {
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

    // 열린 작업이 없어지면 바로 빼지 않고(2분) 쉬는 상태로, 말풍선 없음
    real.tasks.get(d2.taskId)!.closed = { atMs: 0, state: 'COMPLETED' };
    sync();
    expect(sim.observedWorkers).toHaveLength(1);
    expect(w.state).toBe('IDLE');
    expect(w.cue).toBeNull();
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
    expect(Math.hypot(w.pos.x - st.x, w.pos.z - st.z)).toBeLessThan(0.5);

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
});
