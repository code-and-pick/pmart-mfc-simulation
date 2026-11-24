import { describe, expect, it } from 'vitest';
import { INBOUND_ORDER } from '../src/config';
import { clampOrderQty, inboundCandidates, orderTotals, receiptTemp, recommendationLines, splitOrder, upsertLine } from '../src/domain/testInbound';
import type { SupplyRecommendation } from '../src/domain/contract';

describe('입고 발주 후보', () => {
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
});

describe('입고 발주표(사용자 지정·추천 채움·입고 전 수량)', () => {
  const L = (sku: string, qty: number, temp: 'AMBIENT' | 'CHILLED' | 'FROZEN' = 'AMBIENT', source: 'RECOMMEND' | 'MANUAL' = 'MANUAL') => ({ sku, name: sku, available: 3, qty, temp, source });

  it('수량은 1~화면 한도 정수', () => {
    expect(clampOrderQty(0)).toBe(1);
    expect(clampOrderQty(999, 500)).toBe(500);
    expect(clampOrderQty(999)).toBe(999);
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
    expect(upsertLine(ls, L('A', 600), false)[0].qty).toBe(607);
  });

  it('온도대마다, 발주 한 건 줄 한도(계약 200)씩 나눈다', () => {
    expect(INBOUND_ORDER.linesPerRequest).toBe(200);
    const ls = [...Array.from({ length: 45 }, (_, i) => L(`A${i}`, 1)), L('C1', 2, 'CHILLED'), L('F1', 3, 'FROZEN')];
    const parts = splitOrder(ls, 40);
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

describe('서버 발주 추천 → 발주표(MI-4, R-48)', () => {
  const R = (sku: string, o: Partial<SupplyRecommendation>): SupplyRecommendation => ({ sku, missingPolicyFields: [], historyDays: 7, expectedQty: 0, pendingRequestedQty: 0, ...o });
  it('추천 0 초과만 줄로, 0 은 세기만, null 은 0 으로 채우지 않고 사유별로', () => {
    const r = recommendationLines(
      [
        R('A', { recommendedQty: 12, storageType: 'CHILLED', availableQty: 3, forecastDailyQty: 5, reviewDays: 1, leadDays: 1, safetyDays: 1, targetQty: 15, shortfallQty: 12, productName: '우유' }),
        R('B', { recommendedQty: 0 }),
        R('C', { recommendedQty: null, reason: 'INSUFFICIENT_HISTORY' }),
        R('D', { reason: 'INSUFFICIENT_HISTORY' }),
        R('E', { recommendedQty: null, reason: 'POLICY_MISSING', missingPolicyFields: ['leadDays'] }),
        R('F', { recommendedQty: 4, storageType: null }),
      ],
      (s) => `이름${s}`,
      () => 'FROZEN',
    );
    expect(r.lines.map((l) => [l.sku, l.qty, l.temp, l.name, l.source])).toEqual([
      ['A', 12, 'CHILLED', '우유', 'RECOMMEND'],
      ['F', 4, 'FROZEN', '이름F', 'RECOMMEND'],
    ]);
    expect(r.zero).toBe(1);
    expect(r.skipped).toEqual({ INSUFFICIENT_HISTORY: 2, POLICY_MISSING: 1 });
    expect(r.lines[0].available).toBe(3);
    expect(r.lines[0].basis).toContain('목표 15');
  });
});
