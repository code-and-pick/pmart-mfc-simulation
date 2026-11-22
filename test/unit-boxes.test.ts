import { describe, expect, it } from 'vitest';
import { RACK_DEPTH, buildLayout } from '../src/domain/layout';
import { UNIT_CELL_CAP, unitBoxes } from '../src/render/unitBoxes';

// 실서버 선반: 서버 SKU 치수로 상자 크기(사용자 2026-11-22 "쌀 같이 무거운 건 상품 박스 크기도 커?" → 서버 치수)
describe('unitBoxes', () => {
  const L = buildLayout();
  const loc = L.locations.find((l) => !l.reserve && l.along === 'x')!;
  const locZ = L.locations.find((l) => !l.reserve && l.along === 'z')!;
  const inside = (b: ReturnType<typeof unitBoxes>[number], l: typeof loc) => {
    const along = l.along === 'z' ? [b.z, b.sz, l.shelf.z] : [b.x, b.sx, l.shelf.x];
    expect(Math.abs(along[0] - along[2]) + along[1] / 2).toBeLessThanOrEqual(l.slotW / 2 + 1e-6); // 칸 가로 안
    const cross = l.along === 'z' ? [b.x, b.sx, l.shelf.x] : [b.z, b.sz, l.shelf.z];
    const center = cross[2] - (l.face * RACK_DEPTH) / 4;
    expect(Math.abs(cross[0] - center) + cross[1] / 2).toBeLessThanOrEqual(RACK_DEPTH / 2 + 1e-6); // 랙 깊이 안
    expect(b.sy).toBeLessThanOrEqual(l.levelH);
  };

  it('작은 상품은 작게 여러 개, 큰 상품(쌀 10kg 포대)은 크게 적게', () => {
    const small = unitBoxes(loc, { w: 0.06, d: 0.06, h: 0.11 }, 100);
    const rice = unitBoxes(loc, { w: 0.4, d: 0.6, h: 0.1 }, 100);
    expect(small.length).toBe(Math.min(UNIT_CELL_CAP, small.length));
    expect(small.length).toBeGreaterThan(rice.length);
    const vol = (b: (typeof small)[number]) => b.sx * b.sy * b.sz;
    expect(vol(rice[0])).toBeGreaterThan(vol(small[0]) * 5);
    for (const b of [...small, ...rice]) inside(b, loc);
  });

  it('수량만큼만(칸·상한 안에서), 0 이면 없음', () => {
    expect(unitBoxes(loc, { w: 0.1, d: 0.1, h: 0.1 }, 3)).toHaveLength(3);
    expect(unitBoxes(loc, { w: 0.1, d: 0.1, h: 0.1 }, 0)).toHaveLength(0);
    expect(unitBoxes(loc, { w: 0.01, d: 0.01, h: 0.01 }, 10_000).length).toBe(UNIT_CELL_CAP);
  });

  it('세로로 놓인 랙(along z)도 칸 안에', () => {
    for (const b of unitBoxes(locZ, { w: 0.25, d: 0.18, h: 0.3 }, 20)) inside(b, locZ);
  });
});
