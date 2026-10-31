import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { Simulation } from '../src/sim/simulation';

describe('Simulation (mock, 화면 없이)', () => {
  it('배치: 모든 SKU 피킹 지점이 장바구니 거치대에서 걸어서 닿는다', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, skuCount: 300 });
    const depot = sim.layout.points.cartDepot;
    const unreachable = sim.catalog.filter((s) => sim.nav.findPath(depot, s.location.pick) === null);
    expect(unreachable.map((s) => s.location.code)).toEqual([]);
    for (const st of sim.layout.stations) expect(sim.nav.findPath(depot, st.stand)).not.toBeNull();
    expect(sim.nav.findPath(sim.layout.points.shipDrop, sim.layout.points.riderPickup)).not.toBeNull();
    expect(sim.nav.findPath(sim.layout.points.riderEntry, sim.layout.points.riderPickup)).not.toBeNull();
  });

  it('2시간 운영: 주문이 피킹→패킹→출하대기→인계까지 흐르고 재고 불변식이 지켜진다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, skuCount: 400, ordersPerHour: 30 });
    sim.speed = 1;
    // 실제 0.1초 × 1배속 = 0.1초씩. 2시간 = 72000 스텝은 길어서 배속을 키운다
    sim.speed = 600;
    for (let i = 0; i < 120; i++) await sim.advance(0.1); // 120 × 60초 = 2시간
    const s = sim.metrics.summary();
    expect(sim.metrics.ordersCreated).toBeGreaterThan(30);
    expect(s.ready).toBeGreaterThan(20);
    expect(s.handedOver).toBeGreaterThan(10);
    expect(sim.mock!.inventory.violations).toEqual([]);
    expect(sim.metrics.apiErrors).toBe(0);
    // 인계된 만큼만 H 가 줄었다
    const totalH = sim.mock!.inventory.all().reduce((a, b) => a + b.H, 0);
    expect(totalH).toBeLessThan(400 * DEFAULT_PARAMS.initialStockPerSku);
  }, 120_000);
});
