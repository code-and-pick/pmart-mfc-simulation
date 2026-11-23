// MOCK 입고 하차가 롤테이너 단위(사용자 2026-11-24 "승강기에서 입고재고 받아올 때 하나씩 받아오니? … 롤테이너가 적어도 3-4개는 들어갈텐데?")
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, INBOUND_UNLOAD } from '../src/config';
import { Simulation } from '../src/sim/simulation';

describe('입고 하차 — 롤테이너 단위', () => {
  it('승강기 왕복은 품목 수가 아니라 롤테이너 수만큼, 승강기 한 번에 여러 대', async () => {
    const s = new Simulation({ ...DEFAULT_PARAMS, ordersPerHour: 0, firstInboundAfterSec: 1e9 });
    s.speed = 60;
    const id = s.callTruck();
    expect(id).toBeTruthy();
    const truck = s.trucks.find((t) => t.trfId === id)!;
    const n = truck.lines.length;
    const rolls = new Set<string>();
    const lifts = new Set<string>();
    for (let i = 0; i < 20000 && truck.unloaded < n; i++) {
      await s.advance(0.1);
      for (const w of s.inboundWorkers) {
        const m = /롤테이너 (\d+)\/(\d+)/.exec(w.activity);
        if (m && w.activity.includes(id!)) rolls.add(m[1]);
        if (w.activity.startsWith('승강기 — ')) lifts.add(w.pda?.step ?? '');
      }
    }
    expect(truck.unloaded).toBe(n);
    // 온도대 3개 × ceil(줄/롤테이너당 줄) 이하 — 품목마다 왕복이면 n 번
    expect(rolls.size).toBeLessThanOrEqual(Math.ceil(n / INBOUND_UNLOAD.linesPerRoll) + 2);
    if (n > 3) expect(rolls.size).toBeLessThan(n);
    expect(lifts.size).toBe(Math.max(0, Math.ceil(rolls.size / INBOUND_UNLOAD.rollsPerLift) - 1));
  }, 120_000);
});
