import { describe, expect, it } from 'vitest';
import { fitIdempotencyKey, IDEMPOTENCY_KEY_MAX } from '../src/backend/http/idemKey';

describe('Idempotency-Key 길이(계약 maxLength 128)', () => {
  const long = 'abcdef:mfcw-pp-01:pick:ORD-1cbead3f-ae24-39f0-ad98-237d12ede104-S1-PICK:OL-0123456789abcdef0123456789abcdef0123:LOT-0123456789abcdef0123456789abcdef01:CRT-A-01';
  it('128자 이하는 그대로', () => {
    expect(fitIdempotencyKey('run:acct:start:T1')).toBe('run:acct:start:T1');
  });
  it('넘으면 128자 이하로, 같은 입력은 같은 키, 끝만 다른 입력은 다른 키', () => {
    expect(long.length).toBeGreaterThan(IDEMPOTENCY_KEY_MAX);
    const k = fitIdempotencyKey(long);
    expect(k.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX);
    expect(fitIdempotencyKey(long)).toBe(k);
    expect(fitIdempotencyKey(long.replace('CRT-A-01', 'CRT-A-02'))).not.toBe(k);
    expect(k.startsWith('abcdef:mfcw-pp-01:pick:')).toBe(true);
  });
});
