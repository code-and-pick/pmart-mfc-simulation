// 피킹 카트 안내 — 주문마다 다른 빈 카트, 다른 PC 화면도 같은 답(결정적)
import { describe, expect, it } from 'vitest';
import { suggestCarts } from '../src/domain/cartSuggest';

const CARTS = ['CRT-A-01', 'CRT-A-02', 'CRT-A-03'];
describe('suggestCarts', () => {
  it('쓰는 카트를 빼고 만든 순으로 하나씩 — 입력 순서가 달라도 같은 답', () => {
    const a = suggestCarts(CARTS, ['CRT-A-01'], [
      { shipmentId: 'S2', createdAt: '2026-11-18T01:43:32Z' },
      { shipmentId: 'S1', createdAt: '2026-11-18T01:43:03Z' },
    ]);
    expect([...a]).toEqual([['S1', 'CRT-A-02'], ['S2', 'CRT-A-03']]);
    const b = suggestCarts(CARTS, new Set(['CRT-A-01']), [
      { shipmentId: 'S1', createdAt: '2026-11-18T01:43:03Z' },
      { shipmentId: 'S2', createdAt: '2026-11-18T01:43:32Z' },
    ]);
    expect([...b]).toEqual([...a]);
  });

  it('빈 카트가 모자라면 앞에서부터 다시', () => {
    const m = suggestCarts(CARTS, ['CRT-A-01', 'CRT-A-02'], [
      { shipmentId: 'S1', createdAt: 'a' },
      { shipmentId: 'S2', createdAt: 'b' },
    ]);
    expect([...m.values()]).toEqual(['CRT-A-03', 'CRT-A-03']);
  });
});
