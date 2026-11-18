// 넓은 칸(백엔드 layout-v3-wide 2026-11-18) — 합친 칸 59·닫힌 칸 100 이 시뮬레이터 칸에 맞게 들어가는지
import { describe, expect, it } from 'vitest';
import { buildLayout } from '../src/domain/layout';
import { buildLocationCodeMap } from '../src/domain/locationCodes';
import { applyWideCells, dividerInside, shelfInside } from '../src/domain/wideCells';
import { WIDE_CLOSED, WIDE_MERGED } from '../src/domain/wideCellsData';

describe('applyWideCells', () => {
  const L = buildLayout();
  const codes = buildLocationCodeMap(L);
  const spans = applyWideCells(L, codes);
  const loc = (b: string) => L.locations.find((l) => l.code === codes.toSim(b))!;

  it('합친 칸 59개 모두 시뮬레이터 칸을 찾고, 닫힌 칸 100개는 합친 칸 범위 안', () => {
    expect(spans).toHaveLength(WIDE_MERGED.length);
    expect(L.locations.filter((l) => l.closed)).toHaveLength(WIDE_CLOSED.length);
    const covered = (l: (typeof L.locations)[number]) =>
      spans.some((s) => s.rackId === l.rackId && l.level >= s.level && l.level < s.level + s.levels && l.slot >= s.slot && l.slot < s.slot + s.slots && !(l.level === s.level && l.slot === s.slot));
    expect(L.locations.filter((l) => l.closed).every(covered)).toBe(true);
    // 칸 수 합: 합친 칸이 먹은 칸 = 닫힌 칸
    expect(spans.reduce((a, s) => a + s.slots * s.levels - 1, 0)).toBe(WIDE_CLOSED.length);
  });

  it('치수는 백엔드 값, 그림 폭·높이는 합친 칸 수만큼 — 냉장 2칸·상온 H 세로 3단', () => {
    const c = loc('C-B1-01-4-01');
    expect(c.dimMm.w).toBe(322);
    expect(c.span).toEqual({ slots: 2, levels: 1 });
    const h = loc('A-H2-07-1-01');
    expect(h.dimMm).toEqual({ w: 1125, d: 450, h: 1260 });
    expect(h.span).toEqual({ slots: 5, levels: 3 });
    expect(shelfInside(spans, h.rackId, 2, 5)).toBe(true);
    expect(shelfInside(spans, h.rackId, 4, 5)).toBe(false);
    expect(dividerInside(spans, c.rackId, 4, 1)).toBe(true);
    expect(dividerInside(spans, c.rackId, 4, 2)).toBe(false);
  });

  it('두 번 불러도 한 번만 적용', () => {
    const w = loc('C-B1-01-4-01').slotW;
    applyWideCells(L, codes);
    expect(loc('C-B1-01-4-01').slotW).toBe(w);
  });
});

import { NavGrid } from '../src/domain/navgrid';
describe('NavGrid', () => {
  it('격자 밖 목적지는 길 찾기를 하지 않고 null(멈추지 않음)', () => {
    const nav = new NavGrid(buildLayout());
    expect(nav.findPath({ x: 30, z: 39 }, { x: 30, z: 60 })).toBeNull();
  });
});
