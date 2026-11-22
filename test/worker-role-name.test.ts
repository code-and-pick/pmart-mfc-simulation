import { describe, expect, it } from 'vitest';
import { workerRoleName } from '../src/domain/workerName';

// 사용자 2026-11-22 "피킹점원이 패킹으로 가면 피킹1 이렇게 뜨는 거 패킹1로 바뀌게 해"
describe('workerRoleName', () => {
  it('피킹 점원은 패킹대 대기·포장·출하대기 랙으로 가는 동안 패킹N', () => {
    for (const s of ['WAIT_STATION', 'PACKING', 'TO_SHIP']) {
      expect(workerRoleName('W01', s)).toBe('패킹1');
      expect(workerRoleName('mfcw-pp-03', s)).toBe('패킹3');
    }
    for (const s of ['IDLE', 'TO_CART', 'PICKING', 'RETURNING', 'ERROR', null, undefined]) expect(workerRoleName('W01', s)).toBe('피킹1');
  });
  it('다른 역할은 그대로', () => {
    expect(workerRoleName('IB2', 'PACKING')).toBe('입고2');
    expect(workerRoleName('OP-12345678-aaaa-bbbb-cccc-1234567890ab', 'PACKING')).toMatch(/^OP·/);
  });
});
