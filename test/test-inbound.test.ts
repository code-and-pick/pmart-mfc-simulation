import { describe, expect, it } from 'vitest';
import { TEST_INBOUND } from '../src/config';
import { clampOrderQty, inboundCandidates, inboundLines, orderTotals, receiptTemp, splitOrder, upsertLine } from '../src/domain/testInbound';

describe('시험 입고 줄 고르기(MI-3·R-23)', () => {
  it('취급·판매 중지 아님만, 품절 먼저, 중복 없이, readMax 까지', () => {
    const hits = [
      { representativeSku: 'A', saleState: 'ON_SALE', carried: true },
      { representativeSku: 'B', saleState: 'TEMPORARILY_SOLD_OUT', carried: true },
      { representativeSku: 'C', saleState: 'SALE_STOPPED', carried: true },
      { representativeSku: 'D', saleState: 'ON_SALE', carried: false },
      { representativeSku: 'A', saleState: 'ON_SALE', carried: true },
      { representativeSku: 'E', saleState: 'ON_SALE', carried: true, name: '이' },
      {},
    ];
    const c = inboundCandidates(hits, 10, () => 0.5);
    expect(c[0].sku).toBe('B');
    expect(c.map((x) => x.sku).sort()).toEqual(['A', 'B', 'E']);
    expect(inboundCandidates(hits, 2, () => 0.5)).toHaveLength(2);
  });

  it('판매 가능이 적은 순, 목표까지 모자란 만큼(최소·최대 안), 못 읽은 것은 뒤', () => {
    const opt = { lines: 3, targetQty: 20, minQty: 5, maxQty: 15 };
    const lines = inboundLines(
      [
        { sku: 'X', name: 'x', available: null },
        { sku: 'Y', name: 'y', available: 18 },
        { sku: 'Z', name: 'z', available: 0 },
        { sku: 'W', name: 'w', available: 9 },
      ],
      opt,
    );
    expect(lines.map((l) => [l.sku, l.qty])).toEqual([
      ['Z', 15],
      ['W', 11],
      ['Y', 5],
    ]);
  });

  it('설정 값이 계약 범위 안(줄 1~40, SKU 당 1~500)', () => {
    expect(TEST_INBOUND.lines).toBeGreaterThanOrEqual(1);
    expect(TEST_INBOUND.lines).toBeLessThanOrEqual(40);
    expect(TEST_INBOUND.minQty).toBeGreaterThanOrEqual(1);
    expect(TEST_INBOUND.maxQty).toBeLessThanOrEqual(500);
  });
});

describe('입고 발주표(사용자 지정·추천 채움·입고 전 수량)', () => {
  const L = (sku: string, qty: number, temp: 'AMBIENT' | 'CHILLED' | 'FROZEN' = 'AMBIENT', source: 'RECOMMEND' | 'MANUAL' = 'MANUAL') => ({ sku, name: sku, available: 3, qty, temp, source });

  it('수량은 1~500 정수', () => {
    expect(clampOrderQty(0)).toBe(1);
    expect(clampOrderQty(999)).toBe(500);
    expect(clampOrderQty(12.6)).toBe(13);
    expect(clampOrderQty(Number.NaN)).toBe(1);
  });

  it('같은 SKU 는 한 줄 — 직접 넣으면 더하고, 추천으로 다시 채우면 바꾼다', () => {
    let ls = upsertLine([], L('A', 10), false);
    ls = upsertLine(ls, L('A', 5), false);
    expect(ls).toHaveLength(1);
    expect(ls[0].qty).toBe(15);
    ls = upsertLine(ls, L('A', 7, 'AMBIENT', 'RECOMMEND'), true);
    expect(ls[0]).toMatchObject({ qty: 7, source: 'RECOMMEND' });
    expect(upsertLine(ls, L('A', 490), false)[0].qty).toBe(497);
    expect(upsertLine(ls, L('A', 600), false)[0].qty).toBe(500);
  });

  it('온도대마다, 40줄씩 입고 예정으로 나눈다', () => {
    const ls = [...Array.from({ length: 45 }, (_, i) => L(`A${i}`, 1)), L('C1', 2, 'CHILLED'), L('F1', 3, 'FROZEN')];
    const parts = splitOrder(ls);
    expect(parts.map((p) => [p.temp, p.lines.length])).toEqual([
      ['AMBIENT', 40],
      ['AMBIENT', 5],
      ['CHILLED', 1],
      ['FROZEN', 1],
    ]);
  });

  it('입고 전 합계 — 온도대별 품목·개수', () => {
    const t = orderTotals([L('A', 10), L('B', 5), L('C', 2, 'CHILLED')]);
    expect(t).toMatchObject({ items: 3, units: 17, byTemp: { AMBIENT: { items: 2, units: 15 }, CHILLED: { items: 1, units: 2 }, FROZEN: { items: 0, units: 0 } } });
  });

  it('입고 예정 수령 칸 온도대 = 줄에 가장 많은 온도대, 없으면 상온', () => {
    const t = (s: string) => (s.startsWith('F') ? 'FROZEN' : s.startsWith('C') ? 'CHILLED' : 'AMBIENT') as 'AMBIENT' | 'CHILLED' | 'FROZEN';
    expect(receiptTemp(['F1', 'F2', 'A1'], t)).toBe('FROZEN');
    expect(receiptTemp([], t)).toBe('AMBIENT');
  });
});
