// 입고 작업자 롤테이너 길 — 롤테이너(몸 앞 0.47~1.09 m, 폭 0.46 m)가 걷는 내내 벽·랙·팔레트에 닿지 않고, 멈춘 자리에서도 박히지 않는다
// (사용자 2026-11-24 "입고자 통로 동선 무시하고 장애물 통과하고 길을 개척하던데. 그리고 입고랙에 적재할 때 롤테이너를 한참이나 벽에 박고 있더라")
import { describe, expect, it } from 'vitest';
import { buildLayout, type Layout } from '../src/domain/layout';
import { buildSejongLayout } from '../src/domain/layoutSejong';
import { buildChuncheonLayout } from '../src/domain/layoutChuncheon';
import { buildBusanNamguLayout } from '../src/domain/layoutBusanNamgu';
import { buildBusanjinLayout } from '../src/domain/layoutBusanjin';
import { applyMokpo } from '../src/domain/layoutMokpo';
import { NavGrid, type P } from '../src/domain/navgrid';

const SITES: [string, () => Layout][] = [
  ['부산진구', buildBusanjinLayout],
  ['목포', () => applyMokpo(buildLayout())],
  ['세종', buildSejongLayout],
  ['춘천', buildChuncheonLayout],
  ['부산남구', buildBusanNamguLayout],
];

const DEEP = 0.05;
/**
 * 한 번 오가는 길에서 롤테이너가 스쳐도 되는 거리(m). 문·모퉁이를 돌 때 잠깐 스치는 것은 남는다(격자 0.25 m 칸으로는 좁은 통로 정가운데에 못 선다).
 * 11-24 고치기 전 부산진구 상온 입고재고까지 20 m 넘게 뚫고 갔다 → 고친 뒤 지점별 최대 0.3~1.3 m
 */
const MAX_GRAZE = 1.5;
type R = { x0: number; z0: number; x1: number; z1: number };
/** 실제 벽·장애물(팔레트·탁자)·랙 모양(격자 여유 없이) */
function solids(L: Layout): R[] {
  return [
    ...L.walls.map((w) => w.rect),
    ...L.obstacles.map((o) => o.rect),
    ...L.racks.map((rk) => {
      const hx = rk.along === 'x' ? 0.625 : 0.225, hz = rk.along === 'x' ? 0.225 : 0.625;
      return { x0: rk.cx - hx, z0: rk.cz - hz, x1: rk.cx + hx, z1: rk.cz + hz };
    }),
  ];
}
/** 롤테이너 바닥(몸 앞 0.5~1.05 m, 폭 ±0.2 m)이 벽·랙·팔레트 안으로 5 cm 넘게 들어가는가(스치는 것은 봐준다) */
function cartHits(S: R[], p: P, h: number): boolean {
  const fx = Math.sin(h), fz = Math.cos(h);
  for (let d = 0.5; d <= 1.05; d += 0.1)
    for (const w of [-0.2, 0, 0.2]) {
      const x = p.x + fx * d + fz * w, z = p.z + fz * d - fx * w;
      if (S.some((r) => x > r.x0 + DEEP && x < r.x1 - DEEP && z > r.z0 + DEEP && z < r.z1 - DEEP)) return true;
    }
  return false;
}

/** 길을 0.1 m 씩 걸으며 롤테이너가 닿은 거리(m) — 출발·도착 1 m 는 팔레트 앞에서 돌아서는 곳이라 뺀다 */
function hitMeters(S: R[], from: P, path: P[]): number {
  let hit = 0, prev = from, walked = 0;
  const total = path.reduce((a, q, i) => a + Math.hypot(q.x - (i ? path[i - 1] : from).x, q.z - (i ? path[i - 1] : from).z), 0);
  for (const q of path) {
    const len = Math.hypot(q.x - prev.x, q.z - prev.z);
    const h = Math.atan2(q.x - prev.x, q.z - prev.z);
    for (let s = 0; s < len; s += 0.1) {
      const p = { x: prev.x + Math.sin(h) * s, z: prev.z + Math.cos(h) * s };
      if (walked + s > 1 && walked + s < total - 1 && cartHits(S, p, h)) hit += 0.1;
    }
    walked += len;
    prev = q;
  }
  return hit;
}

describe('입고 롤테이너 길', () => {
  for (const [name, build] of SITES) {
    it(`${name}: 승강기 ↔ 입고재고 팔레트 앞, 롤테이너가 장애물을 뚫지 않고 멈춘 자리에서 박히지 않는다`, () => {
      const L = build();
      const nav = new NavGrid(L);
      const S = solids(L);
      const door = L.points.truckDoor;
      const bad: string[] = [];
      for (const rs of L.reserves.filter((r) => r.role === 'RECEIVING')) {
        for (const [a, b] of [[door, rs.stand], [rs.stand, door]] as const) {
          const path = nav.findPath(a, b, { cart: true });
          if (!path) { bad.push(`${rs.id} 길 없음`); continue; }
          const m = hitMeters(S, a, path);
          if (m > MAX_GRAZE) bad.push(`${rs.id} ${a === door ? '가는 길' : '오는 길'} 롤테이너 ${m.toFixed(1)} m 닿음`);
          const end = path[path.length - 1];
          const last = path.length > 1 ? path[path.length - 2] : a;
          const h = nav.cartHeading(end, Math.atan2(end.x - last.x, end.z - last.z));
          if (cartHits(S, end, h)) bad.push(`${rs.id} 멈춘 자리에서 박힘`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
