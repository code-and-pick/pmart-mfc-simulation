import { describe, expect, it } from 'vitest';
import { HANDOVER_CODE } from '../src/config';
import { handoverCodeValid, shortHandoverCode } from '../src/domain/handoverCode';

describe('라벨 번호(fulfillment 0.23.0 — 4자리 고정, R-26)', () => {
  const rule = HANDOVER_CODE;
  it('늘 4자리(앞자리 0 포함), 쓰는 번호와 겹치지 않음', () => {
    expect(shortHandoverCode(new Set(), () => 0.001, rule)).toBe('0010');
    const taken = new Set(['0000', '0001']);
    for (let i = 0; i < 50; i++) {
      const c = shortHandoverCode(taken, Math.random, rule)!;
      expect(c).toMatch(/^[0-9]{4}$/);
      expect(taken.has(c)).toBe(false);
    }
  });
  it('자리 늘림 규칙(설정이 2~4일 때) — 함수는 남겨 둠', () => {
    const r = { minLen: 2, maxLen: 4, maxFill: 0.3 };
    const two = new Set(Array.from({ length: 30 }, (_, i) => String(i).padStart(2, '0')));
    expect(shortHandoverCode(two, Math.random, r)).toMatch(/^[0-9]{3}$/);
  });
  it('입력 형식: 4자리 또는 옛 6자리', () => {
    expect(handoverCodeValid('0712', rule)).toBe(true);
    expect(handoverCodeValid('024111', rule)).toBe(true);
    expect(handoverCodeValid('07', rule)).toBe(false);
    expect(handoverCodeValid('12345', rule)).toBe(false);
    expect(handoverCodeValid('12a4', rule)).toBe(false);
  });
});
