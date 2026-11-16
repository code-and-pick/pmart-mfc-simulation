// 실서버 모드 앞마당 라이더(M-02) — 서버 배송 상태로만 세우고 떠나보낸다(그리기만, API 호출 없음).
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import type { Shipment, StaffDeliverySummary, TaskDetail } from '../src/domain/contract';
import { RealRider } from '../src/sim/realRider';
import { Simulation } from '../src/sim/simulation';

const packTask = {
  taskId: 'ORD-1-S1-PACK',
  taskType: 'PACK',
  state: 'COMPLETED',
  version: 3,
  mfcId: 'MFC-SEED-01',
  fulfillmentId: 'FUL-1',
  shipmentId: 'ORD-1-S1',
  assignment: { workerId: 'OP-x', assignmentVersion: 1 },
  lineCount: 1,
  plannedQty: 1,
  completedQty: 1,
  remainingQty: 0,
  promisedReadyAt: null,
  createdAt: '2026-11-16T06:00:00Z',
  lines: [],
  blockReason: null,
} as unknown as TaskDetail;

function ship(state: Shipment['state'], handed: boolean): Shipment {
  return {
    shipmentId: 'ORD-1-S1',
    fulfillmentId: 'FUL-1',
    orderId: 'ORD-1',
    deliveryId: null,
    version: handed ? 5 : 4,
    state,
    holdReason: null,
    packages: [{ packageId: 'PKG-1', state: handed ? 'HANDED_OVER' : 'SEALED' } as Shipment['packages'][number]],
    bagCount: 1,
    weightG: 0,
    readyAt: null,
    dispatchRequest: { shipmentId: 'ORD-1-S1', trigger: 'MANUAL', estimatedReadyAt: '', requestedAt: '' },
  };
}

function dl(state: StaffDeliverySummary['state']): StaffDeliverySummary {
  return { deliveryId: 'DLV-1', version: 1, type: 'FORWARD', orderId: 'ORD-1', mfcId: 'MFC-SEED-01', riderId: 'RD-sim-1', state, assignedAt: null, pickedUpAt: null, completedAt: null, createdAt: '' };
}

async function walk(sim: Simulation, sec: number) {
  for (let t = 0; t < sec; t += 0.25) {
    for (const r of sim.riders) r.tick(0.25);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
}

describe('앞마당 라이더(실서버 관찰, M-02)', () => {
  it('ARRIVED_AT_STORE 에 세우고, 인계(HANDED_OVER)·PICKED_UP 이면 포장을 들고 떠난다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    real.tasks.set(packTask.taskId, { summary: packTask, detail: packTask, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
    real.shipmentInfo.set('ORD-1-S1', { data: ship('READY', false), readMs: 0, sig: '' });
    const sync = () => (sim as unknown as { syncRealRiders(): void }).syncRealRiders();

    // 오는 중(ASSIGNED)은 rider 시뮬레이터 화면 몫 — MFC 에는 세우지 않는다
    real.deliveries.set('ORD-1', dl('ASSIGNED'));
    real.deliveryVersion++;
    sync();
    expect(sim.riders).toHaveLength(0);

    real.deliveries.set('ORD-1', dl('ARRIVED_AT_STORE'));
    real.deliveryVersion++;
    sync();
    expect(sim.riders).toHaveLength(1);
    const r = sim.riders[0] as RealRider;
    expect(r.id).toBe('RD-sim-1');
    await walk(sim, 60);
    expect(r.activity).toContain('인계 대기');
    expect(r.carrying).toBe(0);

    real.shipmentInfo.set('ORD-1-S1', { data: ship('HANDED_OVER', true), readMs: 0, sig: '' });
    real.deliveries.set('ORD-1', dl('PICKED_UP'));
    real.deliveryVersion++;
    sync();
    await walk(sim, 5);
    expect(r.carrying).toBe(1);
    await walk(sim, 90);
    expect(r.done).toBe(true);
  });

  it('도착을 못 보고 이미 픽업된 배송은 지어내 그리지 않는다', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    real.tasks.set(packTask.taskId, { summary: packTask, detail: packTask, firstSeenMs: 0, closed: { atMs: 0, state: 'COMPLETED' } });
    real.shipmentInfo.set('ORD-1-S1', { data: ship('HANDED_OVER', true), readMs: 0, sig: '' });
    real.deliveries.set('ORD-1', dl('PICKED_UP'));
    real.deliveryVersion++;
    (sim as unknown as { syncRealRiders(): void }).syncRealRiders();
    expect(sim.riders).toHaveLength(0);
  });
});
