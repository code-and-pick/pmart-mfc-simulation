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

    // 화면에서 "카트 찍음" → 첫 칸으로 걸어가 ② 위치 ③ 상품
    sim.passCart('OP-990d2c09');
    expect(w.cue?.kind).toBe('PICK');
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
