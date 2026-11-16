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
  it('시작 = 카트 자리, 집품 등록되면 그 칸 앞으로, 작업이 끝나면 2분 뒤 빠진다', async () => {
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

    // 첫 칸 집품 등록 → 그 칸 앞으로 걸어간다
    const d2 = pick([0, 1]);
    real.tasks.set(d2.taskId, { summary: d2, detail: d2, firstSeenMs: 0, closed: null });
    sync();
    await walk(sim, 120);
    const loc = sim.backendLocation('A-C1-05-1-04')!;
    expect(Math.hypot(w.pos.x - loc.pick.x, w.pos.z - loc.pick.z)).toBeLessThan(0.3);
    expect(w.pda?.location).toBe('A-C1-05-1-04');
    expect(w.pda?.nextLocation).toBe('A-C1-04-6-02');

    // 열린 작업이 없어지면 바로 빼지 않고(2분) 쉬는 상태로
    real.tasks.get(d2.taskId)!.closed = { atMs: 0, state: 'COMPLETED' };
    sync();
    expect(sim.observedWorkers).toHaveLength(1);
    expect(w.state).toBe('IDLE');
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
