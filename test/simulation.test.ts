import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { Simulation } from '../src/sim/simulation';

describe('Simulation (mock, 화면 없이)', () => {
  it('배치: 모든 피킹 지점·보충재고·하차 칸이 걸어서 닿는다', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS });
    const depot = sim.layout.points.cartDepot;
    const unreachable = sim.layout.locations
      .filter((_l, i) => i % 7 === 0) // 표본 (전수는 느리다)
      .filter((l) => sim.nav.findPath(depot, l.pick) === null)
      .map((l) => l.code);
    expect(unreachable).toEqual([]);
    for (const st of sim.layout.stations) expect(sim.nav.findPath(depot, st.stand)).not.toBeNull();
    for (const r of sim.layout.reserves) expect(sim.nav.findPath(sim.layout.points.truckDoor, r.stand), r.id).not.toBeNull();
    for (const d of sim.layout.dockSlots) expect(sim.nav.findPath(sim.layout.points.truckDoor, d.pos), d.id).not.toBeNull();
    expect(sim.nav.findPath(sim.layout.points.shipDrop, sim.layout.points.riderPickup)).not.toBeNull();
    expect(sim.nav.findPath(sim.layout.points.riderEntry, sim.layout.points.riderPickup)).not.toBeNull();
    // 로케이션의 85% 를 SKU 로 채운다
    expect(sim.catalog.length).toBe(
      (['AMBIENT', 'CHILLED', 'FROZEN'] as const).reduce((a, t) => a + Math.floor(sim.layout.locationsByTemp[t].length * 0.85), 0),
    );
  }, 60_000); // 혼자 4~5초 — 다른 시험과 함께 돌면 기본 5초를 넘는다

  it('3시간 운영: 출고 흐름과 입고·적치·보충이 함께 돌고 재고 불변식이 지켜진다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, ordersPerHour: 40 });
    const inv = sim.mock!.inventory;
    const h0 = inv.all().reduce((a, b) => a + b.H, 0);
    sim.speed = 600;
    for (let i = 0; i < 180; i++) await sim.advance(0.1); // 180 × 60초 = 3시간
    const s = sim.metrics.summary();
    const ib = sim.metrics.inbound;
    expect(sim.metrics.ordersCreated).toBeGreaterThan(80);
    expect(s.ready).toBeGreaterThan(60);
    expect(s.handedOver).toBeGreaterThan(50);
    expect(ib.trucksReceived).toBeGreaterThanOrEqual(1);
    expect(ib.putawayShelfUnits + ib.putawayReserveUnits).toBeGreaterThan(0);
    expect(ib.replenishMoves).toBeGreaterThan(0);
    expect(inv.violations).toEqual([]);
    expect(sim.metrics.apiErrors).toBe(0);
    // 결품 보고 → BLOCKED → 결품 사가 해결 경로가 실제로 돌았고, 사가 대기로 남은 작업이 오래 걸려 있지 않다
    expect(sim.metrics.shortageUnits).toBeGreaterThan(0);
    expect(sim.mock!.blockedForShortage().length).toBeLessThanOrEqual(1);
    // 선반은 칸 한도를 넘지 않는다
    for (const k of sim.catalog) expect(inv.get(k.sku)!.shelf).toBeLessThanOrEqual(k.shelfCap);
    // H 변화 = 수령 − 인계 수량
    const handed = sim.mock!.allShipments()
      .flatMap((x) => x.packages)
      .filter((p) => p.state === 'HANDED_OVER')
      .reduce((a, p) => a + p.contents.reduce((b, c) => b + c.qty, 0), 0);
    const h1 = inv.all().reduce((a, b) => a + b.H, 0);
    expect(h1).toBe(h0 + ib.receivedUnits - handed);
  }, 180_000);
});
