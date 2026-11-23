// MOCK 알뜰배달 묶음 — 한 라이더가 가게에서 묶음 1~3건을 한 번에 픽업한다
// (사용자 2026-11-23 "가게가 하나고 알뜰배달 2건이면 가게는 한 번에 가서 2개 동시에 픽업하고 1번째 고객 - 2번째 고객 전달" → "응 맞춰")
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, MOCK_BUNDLE } from '../src/config';
import { Rider } from '../src/sim/rider';
import { Simulation } from '../src/sim/simulation';

describe('MOCK 알뜰 묶음 라이더', () => {
  it('묶음 라이더는 최대 3건, 떠날 때 묶음 출고가 모두 인계돼 있다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, ordersPerHour: 90 });
    sim.speed = 60;
    const seen = new Map<string, Rider>();
    for (let i = 0; i < 1500; i++) {
      await sim.advance(0.1);
      for (const r of sim.riders) if (r instanceof Rider && r.legs.length > 1) seen.set(r.id, r);
      if ([...seen.values()].some((r) => r.done)) break;
    }
    const bundles = [...seen.values()];
    expect(bundles.length).toBeGreaterThan(0);
    for (const r of bundles) expect(r.legs.length).toBeLessThanOrEqual(MOCK_BUNDLE.maxSize);
    // 같은 라이더 ID 로 배송마다 배정됐다
    const mock = (sim as unknown as { mock: { allShipments(): { shipmentId: string; state: string; deliveryId?: string | null }[] } }).mock;
    const done = bundles.find((r) => r.done)!;
    expect(done).toBeTruthy();
    for (const l of done.legs) {
      const s = mock.allShipments().find((x) => x.shipmentId === l.shipmentId)!;
      expect(s.deliveryId).toBe(l.deliveryId);
      expect(['HANDED_OVER', 'CANCELLED']).toContain(s.state);
    }
  }, 120_000);
});
