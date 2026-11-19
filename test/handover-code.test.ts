import { describe, expect, it } from 'vitest';
import { HANDOVER_CODE } from '../src/config';
import { handoverCodeValid, shortHandoverCode } from '../src/domain/handoverCode';

describe('라벨 번호 고르기(2~4자리)', () => {
  const rule = HANDOVER_CODE;
  it('비어 있으면 2자리, 겹치지 않음', () => {
    const c = shortHandoverCode(new Set(), Math.random, rule)!;
    expect(c).toMatch(/^[0-9]{2}$/);
    const taken = new Set(['00', '01']);
    for (let i = 0; i < 50; i++) expect(taken.has(shortHandoverCode(taken, Math.random, rule)!)).toBe(false);
  });
  it('2자리가 maxFill 만큼 차면 3자리, 3자리도 차면 4자리', () => {
    const two = new Set(Array.from({ length: 30 }, (_, i) => String(i).padStart(2, '0')));
    expect(shortHandoverCode(two, Math.random, rule)).toMatch(/^[0-9]{3}$/);
    const three = new Set([...two, ...Array.from({ length: 300 }, (_, i) => String(i).padStart(3, '0'))]);
    expect(shortHandoverCode(three, Math.random, rule)).toMatch(/^[0-9]{4}$/);
  });
  it('형식: 2~4자리 숫자만', () => {
    expect(handoverCodeValid('07', rule)).toBe(true);
    expect(handoverCodeValid('1234', rule)).toBe(true);
    expect(handoverCodeValid('1', rule)).toBe(false);
    expect(handoverCodeValid('12345', rule)).toBe(false);
    expect(handoverCodeValid('12a', rule)).toBe(false);
  });
});
