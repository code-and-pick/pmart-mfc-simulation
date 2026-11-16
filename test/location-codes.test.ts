import { describe, expect, it } from 'vitest';
import { BACKEND_FACTS } from '../src/config';
import { buildLayout } from '../src/domain/layout';
import { SIM_POINT, buildLocationCodeMap, packDropPoint } from '../src/domain/locationCodes';

// 기대값 근거: pmart-backend docs/handoff/simulator/2026-11-09-simulator-notice-layout-bins.md,
// docs/simulator/mfc/layout/high-turnover.json, deploy/lan/seed/mfc_layout.py plan()
describe('위치 코드 대응 (SIM-6)', () => {
  const L = buildLayout();
  const m = buildLocationCodeMap(L);

  it('선반 칸 6,762개가 모두 서로 다른 백엔드 코드로 오가며 돌아온다', () => {
    expect(L.locations.length).toBe(6762);
    expect(m.shelfCount).toBe(6762);
    const seen = new Set<string>();
    for (const loc of L.locations) {
      const b = m.toBackend(loc.code)!;
      expect(b).toMatch(/^[ACF]-[A-H]\d+-\d{2}-\d-\d{2}$/);
      expect(m.toSim(b)).toBe(loc.code);
      seen.add(b);
    }
    expect(seen.size).toBe(6762);
  });

  it('공지의 예와 고회전 5칸이 맞는다', () => {
    expect(m.toBackend('A01-01-101')).toBe('F-A1-01-1-01');
    expect(BACKEND_FACTS.highTurnoverBins.map((c) => m.toBackend(c))).toEqual([
      'A-H1-01-1-01',
      'A-H1-01-1-02',
      'A-H1-01-1-03',
      'A-H1-01-1-04',
      'A-H1-01-2-01',
    ]);
  });

  it('선반 밖 자리: 팔레트·패킹대·대기 지점·격리·입고·회수·출하대기·카트', () => {
    expect(m.toBackend('AR-1')).toBe('F-R1-01-1-01');
    expect(m.toBackend('BR-4')).toBe('C-R1-04-1-01');
    expect(m.toBackend('WR-24')).toBe('A-R1-24-1-01');
    expect(m.toBackend('PS-1')).toBe('PAK-A-01');
    expect(m.toBackend('PS-8')).toBe('PAK-A-08');
    expect(m.toBackend(SIM_POINT.packQueue)).toBe('PAK-C-01');
    expect(m.toBackend(SIM_POINT.packQueueFrozen)).toBe('PAK-F-01');
    expect(m.toSim('PAK-F-01')).toBe(SIM_POINT.packQueueFrozen);
    expect([packDropPoint('FROZEN'), packDropPoint('CHILLED'), packDropPoint('AMBIENT')].map((c) => m.toBackend(c))).toEqual(['PAK-F-01', 'PAK-C-01', 'PAK-C-01']);
    expect([m.toBackend('AQ'), m.toBackend('BQ'), m.toBackend('CQ')]).toEqual(['QRT-F-01', 'QRT-C-01', 'QRT-A-01']);
    expect(m.toBackend(SIM_POINT.receivingDock)).toBe('RCV-A-01');
    expect(m.toBackend(SIM_POINT.returnIntake)).toBe('RTN-A-01');
    expect(m.toBackend('SR2-11')).toBe('DSP-A-02');
    expect(m.toSim('CRT-F-01')).toBe(SIM_POINT.cartDepot);
    expect(m.toSim('MIGRATION')).toBeNull();
  });
});
