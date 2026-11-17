// 가상 작업자 품질검사 판정 = PDA quality_controllers.dart forcedReason·inspectRowIssues(클라이언트 3f2048f) 와 같은 기준
import { describe, expect, it } from 'vitest';
import { inspectVerdict, seoulToday } from '../src/domain/inspectVerdict';

const T = '2026-11-18';
describe('inspectVerdict — PDA 와 같은 품질검사 판정', () => {
  it('기준 미설정·기한 모름·제조일 필요한데 없음·제조일이 기한 뒤면 판정하지 않는다', () => {
    expect(inspectVerdict({ minRemainingDays: null }, { expiryDate: '2027-01-01' }, 1, T).ok).toBe(false);
    expect(inspectVerdict({ minRemainingDays: 3 }, { expiryDate: null }, 1, T).ok).toBe(false);
    expect(inspectVerdict({ minRemainingDays: 3 }, null, 1, T).ok).toBe(false);
    expect(inspectVerdict({ minRemainingDays: 3, maxDaysSinceManufacture: 10 }, { expiryDate: '2027-01-01' }, 1, T).ok).toBe(false);
    expect(inspectVerdict({ minRemainingDays: 3 }, { expiryDate: '2027-01-01', manufactureDate: '2026-11-19' }, 1, T).ok).toBe(false);
  });

  it('잔여일 = 최소 잔여일이면 정상, 하루 모자라면 격리(기한), 제조 후 경과일 초과면 격리(제조)', () => {
    expect(inspectVerdict({ minRemainingDays: 3 }, { expiryDate: '2026-11-21', sourceLotRef: 'M1' }, 2, T)).toEqual({
      ok: true, reason: 'NORMAL', result: { qty: 2, resultQuality: 'NORMAL', expiryDate: '2026-11-21', sourceLotRef: 'M1' },
    });
    expect(inspectVerdict({ minRemainingDays: 3 }, { expiryDate: '2026-11-20' }, 2, T)).toMatchObject({ ok: true, reason: 'EXPIRY', result: { resultQuality: 'QUARANTINED' } });
    expect(inspectVerdict({ minRemainingDays: 3, maxDaysSinceManufacture: 10 }, { expiryDate: '2027-01-01', manufactureDate: '2026-11-07' }, 1, T)).toMatchObject({
      reason: 'MANUFACTURE', result: { resultQuality: 'QUARANTINED', manufactureDate: '2026-11-07' },
    });
    expect(inspectVerdict({ minRemainingDays: 3, maxDaysSinceManufacture: 10 }, { expiryDate: '2027-01-01', manufactureDate: '2026-11-08' }, 1, T).ok && 'NORMAL').toBe('NORMAL');
  });

  it('서울 날짜 — UTC 15시 이후는 다음 날', () => {
    expect(seoulToday(Date.UTC(2026, 10, 17, 14, 59))).toBe('2026-11-17');
    expect(seoulToday(Date.UTC(2026, 10, 17, 15, 0))).toBe('2026-11-18');
  });
});
