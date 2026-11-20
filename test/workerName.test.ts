import { describe, expect, it } from 'vitest';
import { workerShortName } from '../src/domain/workerName';

describe('workerShortName', () => {
  it('가상 작업자 계정은 역할 + 번호', () => {
    expect(workerShortName('mfcw-pp-01')).toBe('피킹1');
    expect(workerShortName('mfcw-qc-10')).toBe('검사10');
    expect(workerShortName('mfcw-rcv-03')).toBe('적치3');
  });
  it('긴 값은 끝만', () => {
    expect(workerShortName('OP-72be6776-21ca-4210-b65d-5ee07318d053')).toBe('OP·d053');
    expect(workerShortName('W1')).toBe('W1');
  });
});

describe('입고 번호', () => {
  it('검사·적치 계정을 켠 순서대로 입고N, 도는 동안은 그대로', async () => {
    const { assignInboundNumbers } = await import('../src/domain/workerName');
    assignInboundNumbers(['mfcw-qc-01', 'mfcw-qc-02', 'mfcw-rcv-01']);
    expect(workerShortName('mfcw-rcv-01')).toBe('입고3');
    assignInboundNumbers(['mfcw-qc-01', 'mfcw-rcv-01', 'mfcw-qc-03']);
    expect(workerShortName('mfcw-rcv-01')).toBe('입고3');
    expect(workerShortName('mfcw-qc-03')).toBe('입고2');
    assignInboundNumbers([]);
    expect(workerShortName('mfcw-qc-01')).toBe('검사1');
  });
});
