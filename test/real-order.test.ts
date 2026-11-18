import { describe, expect, it } from 'vitest';
import { orderCandidates, randomMode, seoulDate, selectableSlots, slotOrder, slotRetryable, type ProductHit, type SlotView } from '../src/domain/realOrder';

const fixed = (v: number) => () => v;

describe('실제 주문 넣기 — 고르는 규칙(R-21)', () => {
  it('상품 후보: 판매 중·취급·단가 범위만, 장바구니에 이미 있는 SKU·겹친 SKU 는 뺀다', () => {
    const hits: ProductHit[] = [
      { representativeSku: 'E-00000001', basePrice: 3000, saleState: 'ON_SALE', carried: true },
      { representativeSku: 'E-00000002', basePrice: 3000, saleState: 'TEMPORARILY_SOLD_OUT', carried: true },
      { representativeSku: 'E-00000003', basePrice: 3000, saleState: 'ON_SALE', carried: false },
      { representativeSku: 'E-00000004', basePrice: 500, saleState: 'ON_SALE', carried: true },
      { representativeSku: 'E-00000005', basePrice: 20000, saleState: 'ON_SALE', carried: true },
      { representativeSku: 'E-00000006', basePrice: 4000, saleState: 'ON_SALE', carried: true },
      { representativeSku: 'E-00000001', basePrice: 3000, saleState: 'ON_SALE', carried: true },
      { basePrice: 3000, saleState: 'ON_SALE', carried: true },
    ];
    const c = orderCandidates(hits, new Set(['E-00000006']), { min: 1000, max: 12000 }, fixed(0));
    expect(c.map((x) => x.sku)).toEqual(['E-00000001']);
  });

  it('예약 시간대: AVAILABLE·남은 정원 ≥1·마감 여유만, 이른 순', () => {
    const now = Date.parse('2026-11-19T01:00:00Z'); // 서울 10:00
    const slot = (start: string, cutoff: string, extra: Partial<SlotView> = {}): SlotView => ({
      window: { date: '2026-11-19', start, end: start.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, '0')) },
      availability: 'AVAILABLE',
      remaining: 3,
      cutoffAt: cutoff,
      ...extra,
    });
    const slots = [
      slot('14:00', '2026-11-19T04:00:00Z'),
      slot('11:00', '2026-11-19T01:03:00Z'), // 마감 3분 남음 — 뺌
      slot('12:00', '2026-11-19T02:00:00Z'),
      slot('13:00', '2026-11-19T03:00:00Z', { remaining: 0 }),
      slot('15:00', '2026-11-19T05:00:00Z', { availability: 'FULL' }),
      slot('16:00', '2026-11-19T06:00:00Z', { remaining: null }),
    ];
    expect(selectableSlots(slots, now, 5).map((s) => s.window!.start)).toEqual(['12:00', '14:00']);
  });

  it('시간대 순서: 직접 예약은 가장 빠른 것부터, 랜덤은 빠른 pool 개 중 하나를 앞에', () => {
    const s = ['10', '11', '12', '13'].map((h) => ({ window: { date: 'd', start: `${h}:00`, end: '' } }));
    expect(slotOrder(s, false, 3, fixed(0.99))[0].window!.start).toBe('10:00');
    const r = slotOrder(s, true, 3, fixed(0.99));
    expect(r[0].window!.start).toBe('12:00');
    expect(r).toHaveLength(4);
  });

  it('랜덤 방식은 지금 되는 것 중에서만, 없으면 null', () => {
    expect(randomMode(['SCHEDULED'], fixed(0.5))).toBe('SCHEDULED');
    expect(randomMode([], fixed(0.5))).toBeNull();
  });

  it('다시 해 볼 결제 진입 실패와 서울 날짜', () => {
    expect(slotRetryable('SLOT_NOT_SELECTABLE')).toBe(true);
    expect(slotRetryable('CAPACITY_EXCEEDED')).toBe(true);
    expect(slotRetryable('INSUFFICIENT_STOCK')).toBe(false);
    const ms = Date.parse('2026-11-19T16:30:00Z'); // 서울 11-20 01:30
    expect(seoulDate(ms)).toBe('2026-11-20');
    expect(seoulDate(ms, 1)).toBe('2026-11-21');
  });
});
