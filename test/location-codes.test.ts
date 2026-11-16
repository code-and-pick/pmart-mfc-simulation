import { describe, expect, it } from 'vitest';
import { BACKEND_FACTS } from '../src/config';
import { SLOT_DESIGN, buildLayout } from '../src/domain/layout';
import { SIM_POINT, buildLocationCodeMap, packDropPoint } from '../src/domain/locationCodes';

// node 형 선언 없이 쓴다(barcode.test.ts 와 같은 방식) — 백엔드 저장소가 형제 폴더에 있을 때만 대조
const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as { existsSync(p: URL): boolean; readFileSync(p: URL, enc: 'utf-8'): string };
const BACKEND_LAYOUT = new URL('../../pmart-backend/docs/simulator/mfc/layout/layout.json', import.meta.url);

// 기대값 근거: pmart-backend docs/handoff/simulator/mfc/2026-11-09-simulator-notice-layout-bins.md,
// docs/simulator/mfc/layout/high-turnover.json, deploy/lan/seed/mfc_layout.py plan()
describe('위치 코드 대응 (SIM-6)', () => {
  const L = buildLayout();
  const m = buildLocationCodeMap(L);

  it('선반 칸 14,559개가 모두 서로 다른 백엔드 코드로 오가며 돌아온다', () => {
    expect(L.locations.length).toBe(14559);
    expect(m.shelfCount).toBe(14559);
    const seen = new Set<string>();
    for (const loc of L.locations) {
      const b = m.toBackend(loc.code)!;
      expect(b).toMatch(/^[ACF]-[A-H]\d+-\d{2}-\d-\d{2}$/);
      expect(m.toSim(b)).toBe(loc.code);
      seen.add(b);
    }
    expect(seen.size).toBe(14559);
  });

  // 백엔드 mfc_layout_v2.py plan(): layout.json 의 랙(그룹·랙 번호·온도) × DESIGN 표 = 등록한 선반 칸(2026-11-16 칸 설계 공지)
  it.runIf(fs.existsSync(BACKEND_LAYOUT))('백엔드 칸 설계(랙 × 단·칸)와 칸 코드 집합이 같다', () => {
    const lj = JSON.parse(fs.readFileSync(BACKEND_LAYOUT, 'utf-8')) as {
      racks: { group: string; rackNo: number; temp: 'FROZEN' | 'CHILLED' | 'AMBIENT'; levels?: number; slotsPerLevel?: number }[];
    };
    // 백엔드 06a4effa(11-17) 부터 layout.json 의 랙 단·칸 수도 문서 설계 — 적혀 있으면 같아야 한다
    const off = lj.racks.filter((r) => r.levels != null && (r.levels !== SLOT_DESIGN[r.group[0]][0] || r.slotsPerLevel !== SLOT_DESIGN[r.group[0]][1]));
    expect(off.map((r) => `${r.group}-${r.rackNo} ${r.levels}x${r.slotsPerLevel}`)).toEqual([]);
    const T = { FROZEN: 'F', CHILLED: 'C', AMBIENT: 'A' } as const;
    const want = new Set<string>();
    for (const r of lj.racks) {
      const [levels, slots] = SLOT_DESIGN[r.group[0]];
      const area = r.group[0] + String(Number(r.group.slice(1)));
      for (let lv = 1; lv <= levels; lv++)
        for (let sl = 1; sl <= slots; sl++) want.add(`${T[r.temp]}-${area}-${String(r.rackNo).padStart(2, '0')}-${lv}-${String(sl).padStart(2, '0')}`);
    }
    expect(want.size).toBe(14559);
    const mine = new Set(L.locations.map((l) => m.toBackend(l.code)!));
    expect([...want].filter((c) => !mine.has(c))).toEqual([]);
    expect([...mine].filter((c) => !want.has(c))).toEqual([]);
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
