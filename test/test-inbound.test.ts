import { describe, expect, it } from 'vitest';
import { TEST_INBOUND } from '../src/config';
import { inboundCandidates, inboundLines } from '../src/domain/testInbound';

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
