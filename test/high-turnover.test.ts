// 상온 고회전 구역 F — 인기(주문율) 상위 20개 상온 상품이 F 칸을 갖고, 나머지 상품은 F 에 두지 않는다(사용자 2026-11-23, MOCK).
import { describe, expect, it } from 'vitest';
import { BACKEND_FACTS, DEFAULT_PARAMS, MOCK_HIGH_TURNOVER_TOP } from '../src/config';
import { buildCatalog, slotCapacity } from '../src/domain/catalog';
import { buildLayout } from '../src/domain/layout';

describe('고회전 구역 F 배치(MOCK)', () => {
  const layout = buildLayout();
  const cat = buildCatalog(layout, DEFAULT_PARAMS.mockSkuCount, BACKEND_FACTS.slotFillRate, DEFAULT_PARAMS.seed, MOCK_HIGH_TURNOVER_TOP);
  const inF = (s: (typeof cat)[number]) => s.temp === 'AMBIENT' && s.location.code[0] === 'F';

  it('상온 인기 상위 20개는 F(F 칸에 안 들어가는 큰 상품만 빼고), F 에는 그 20개 안의 상품뿐', () => {
    const top = [...cat.filter((s) => s.temp === 'AMBIENT')].sort((a, b) => b.weight - a.weight).slice(0, MOCK_HIGH_TURNOVER_TOP);
    const fCells = layout.locationsByTemp.AMBIENT.filter((l) => l.code[0] === 'F');
    const mmOf = (u: { w: number; d: number; h: number }) => ({ w: Math.round(u.w * 1000), d: Math.round(u.d * 1000), h: Math.round(u.h * 1000) });
    const fits = (s: (typeof cat)[number]) => fCells.some((l) => slotCapacity(l.dimMm, mmOf(s.unit), BACKEND_FACTS.slotFillRate) >= 2);
    for (const s of top) expect(inF(s) || !fits(s)).toBe(true);
    expect(top.filter(inF).length).toBeGreaterThanOrEqual(15);
    const topSet = new Set(top.map((s) => s.sku));
    expect(cat.filter(inF).every((s) => topSet.has(s.sku))).toBe(true);
  });

  it('한 칸에 한 상품', () => {
    expect(new Set(cat.map((s) => s.location.code)).size).toBe(cat.length);
  });

  it('MOCK 상품 바코드는 상품마다 다르고 EAN-13(검사 숫자 맞음)', async () => {
    const { ean13CheckDigit } = await import('../src/domain/barcode');
    const codes = cat.map((s) => s.barcode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) {
      expect(c).toMatch(/^880\d{10}$/);
      expect(Number(c[12])).toBe(ean13CheckDigit(c.slice(0, 12)));
    }
  });
});
