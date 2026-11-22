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
    real.deliveries.set('ORD-1-S1', dl('ASSIGNED'));
    real.deliveryVersion++;
    sync();
    expect(sim.riders).toHaveLength(0);

    real.deliveries.set('ORD-1-S1', dl('ARRIVED_AT_STORE'));
    real.deliveryVersion++;
    sync();
    expect(sim.riders).toHaveLength(1);
    const r = sim.riders[0] as RealRider;
    expect(r.id).toBe('RD-sim-1');
    await walk(sim, 60);
    expect(r.activity).toContain('인계 대기');
    expect(r.carrying).toBe(0);

    real.shipmentInfo.set('ORD-1-S1', { data: ship('HANDED_OVER', true), readMs: 0, sig: '' });
    real.deliveries.set('ORD-1-S1', dl('PICKED_UP'));
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
    real.deliveries.set('ORD-1-S1', dl('PICKED_UP'));
    real.deliveryVersion++;
    (sim as unknown as { syncRealRiders(): void }).syncRealRiders();
    expect(sim.riders).toHaveLength(0);
  });
});

import { NavGrid } from '../src/domain/navgrid';
import { buildLayout } from '../src/domain/layout';
import { getOff, vehicleOf, offLot } from '../src/sim/realRider';
describe('라이더 수단(배차 배정 vehicleType)', () => {
  it('내리면 수단이 선 방향의 운전석 문 쪽(모델 +x)으로 비켜 선다', async () => {
    const L = buildLayout();
    const P = L.points;
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const r = new RealRider('RD-2', 'DLV-2', P.riderParking[3], P.riderEntry, P.riderPickup, new NavGrid(L), 'CAR');
      // 앞마당 안 한 자리(주차 칸) — 평면을 옮겨도(2026-11-22 463평 맞춤) 앞마당 안이게
      const at = { x: P.riderParking[3].x, z: P.riderParking[3].z - 1.8 };
      r.pos = { ...at };
      r.heading = heading;
      const done = getOff(r);
      for (let i = 0; i < 40; i++) {
        r.tick(0.25);
        for (let k = 0; k < 5; k++) await Promise.resolve();
      }
      await done;
      expect(r.parkedHeading).toBe(heading);
      expect(r.pos.x).toBeCloseTo(at.x + 0.9 * Math.cos(heading), 1);
      expect(r.pos.z).toBeCloseTo(at.z - 0.9 * Math.sin(heading), 1);
    }
  });

  it('배차 상세가 늦게 와 처음엔 기본 수단이어도, 서버 수단이 오면 그것으로(도보면 안 탐), 모르는 값은 무시', () => {
    const L = buildLayout();
    const P = L.points;
    const r = new RealRider('RD-3', 'DLV-3', P.riderParking[1], P.riderEntry, P.riderPickup, new NavGrid(L), null);
    expect(r.vehicle).toBe('MOTORCYCLE');
    r.updateVehicle(null);
    expect(r.vehicle).toBe('MOTORCYCLE');
    r.updateVehicle('WALK');
    expect(r.vehicle).toBe('WALK');
    expect(r.riding).toBe(false);
  });

  it('수단 이름 → 그릴 수단, 모르면 오토바이', () => {
    expect(['MOTORCYCLE', 'BICYCLE', 'E_BIKE', 'KICKBOARD', 'CAR', 'WALK'].map(vehicleOf)).toEqual(['MOTORCYCLE', 'BICYCLE', 'E_BIKE', 'KICKBOARD', 'CAR', 'WALK']);
    expect(vehicleOf(null)).toBe('MOTORCYCLE');
    expect(vehicleOf('TRUCK')).toBe('MOTORCYCLE');
  });

  it('앞길 끝에서 타고 와 주차 자리에서 내리고, 걸어서 랙 → 다시 타고 앞길 끝으로', async () => {
    const L = buildLayout();
    const P = L.points;
    const r = new RealRider('RD-1', 'DLV-1', P.riderParking[0], P.riderEntry, P.riderPickup, new NavGrid(L), 'CAR');
    expect(r.vehicle).toBe('CAR');
    const seen = new Set<string>();
    const step = async (sec: number) => {
      for (let t = 0; t < sec; t += 0.25) {
        r.tick(0.25);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        if (r.door) seen.add(r.carrying ? 'door-out' : 'door-in');
        if (r.trunk) seen.add('trunk');
      }
    };
    void r.run();
    await step(0.5);
    expect(r.riding).toBe(true); // 타고 들어옴
    await step(60);
    expect(r.riding).toBe(false); // 내려서 걸어 랙 앞
    expect(Math.hypot(r.pos.x - P.riderPickup.x, r.pos.z - P.riderPickup.z)).toBeLessThan(0.5);
    expect(seen.has('door-in')).toBe(true); // 내릴 때 문 열림
    expect(r.door).toBe(false);
    const parked = { ...r.parkedAt! };
    r.depart(1);
    await step(8);
    expect(r.stowed).toBe(true); // 트렁크에 넣음
    await step(60);
    expect(seen.has('trunk')).toBe(true);
    expect(seen.has('door-out')).toBe(true); // 탈 때 문 열림
    expect(parked).toBeTruthy();
    expect(r.done).toBe(true);
    const end = offLot(P.riderEntry);
    expect(Math.hypot(r.pos.x - end.x, r.pos.z - end.z)).toBeLessThan(0.5);
  });
});
