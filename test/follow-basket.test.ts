import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { Simulation } from '../src/sim/simulation';

// 따라가기 왼쪽 패널(사용자 2026-11-22 "점원을 따라가면 실시간으로 픽업할 때 고른 제품이 뭔지") — 점원 PDA 의 장바구니 목록
describe('따라가기 장바구니(basket)', () => {
  it('피킹 중 점원은 고를 상품 목록을 갖고, 집음 표시는 서버 실적과 맞는다', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, ordersPerHour: 60 });
    sim.speed = 60;
    let seen = false;
    for (let i = 0; i < 400 && !seen; i++) {
      await sim.advance(0.1);
      for (const w of sim.siteWorkers()) {
        const b = w.pda?.basket;
        if (!b || w.pda!.taskType !== 'PICK') continue;
        expect(b.length).toBeGreaterThan(0);
        expect(b.filter((x) => x.state === 'NOW').length).toBeLessThanOrEqual(1);
        for (const x of b) {
          expect(x.name).toBeTruthy();
          if (x.state === 'TODO' || x.state === 'NOW') expect(x.picked).toBe(0);
          if (x.state === 'DONE') expect(x.picked).toBe(x.planned);
        }
        if (b.some((x) => x.state === 'DONE')) seen = true;
      }
    }
    expect(seen).toBe(true);
  }, 60_000);
});
