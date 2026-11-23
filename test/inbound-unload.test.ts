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

describe('입고 상자가 넘칠 때', () => {
  it('입고재고 팔레트·하차 칸이 다 차도 그 자리 위로 쌓고 다른 구역(패킹)으로 안 감', () => {
    for (const mfcId of ['MFC-SEED-01', 'MFC-SEJ-01', 'MFC-CHC-01', 'MFC-BNG-01']) {
      const s = new Simulation({ ...DEFAULT_PARAMS, mfcId, ordersPerHour: 0, firstInboundAfterSec: 1e9 });
      const place = (s as unknown as { placeOnDock(it: unknown): void }).placeOnDock.bind(s);
      const ok = new Set(s.layout.dockSlots.map((d) => `${d.pos.x.toFixed(2)},${d.pos.z.toFixed(2)}`));
      for (let i = 0; i < 300; i++) {
        const temp = (['AMBIENT', 'CHILLED', 'FROZEN'] as const)[i % 3];
        const it = { id: `T-${i}`, trfId: 'T', sku: 'X', qty: 1, temp, slot: null, floorPos: { x: 0, z: 0 }, state: 'ON_DOCK' as const } as { slot: { pos: { x: number; z: number } } | null; floorPos: { x: number; z: number }; stand?: unknown; temp: string };
        place(it);
        const p = it.slot?.pos ?? it.floorPos;
        const onPallet = s.layout.reserves.some((r) => r.role === 'RECEIVING' && r.temp === temp && p.x >= r.rect.x0 && p.x <= r.rect.x1 && p.z >= r.rect.z0 && p.z <= r.rect.z1);
        expect(onPallet || ok.has(`${p.x.toFixed(2)},${p.z.toFixed(2)}`)).toBe(true);
      }
    }
  });
});
