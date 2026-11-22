import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, MFC_SITES, REAL_LINK, activeSite, setActiveSite } from '../src/config';
import { passwordFileFor } from '../src/backend/http/accounts';
import { workerShortName, isInboundAccount } from '../src/domain/workerName';
import { Simulation } from '../src/sim/simulation';

// 2호점 목포 MFC(사용자 2026-11-22 "여기랑 평수, 구조, sku 수, 랙 갯수 등 완전 똑같이 … MFC 전환가능하도록 버튼")
describe('MFC 지점', () => {
  afterEach(() => setActiveSite(undefined));

  it('목포는 평면·랙·칸·MOCK 상품 수가 1호점과 같고 센터 ID·이름만 다르다', () => {
    const a = new Simulation({ ...DEFAULT_PARAMS, mfcId: setActiveSite('MFC-SEED-01').id });
    const b = new Simulation({ ...DEFAULT_PARAMS, mfcId: setActiveSite('MFC-MOKPO-01').id });
    expect(b.params.mfcId).toBe('MFC-MOKPO-01');
    expect(b.layout.racks.length).toBe(a.layout.racks.length);
    expect(b.layout.locations.length).toBe(a.layout.locations.length);
    expect(b.layout.zones.map((z) => [z.id, z.rect])).toEqual(a.layout.zones.map((z) => [z.id, z.rect]));
    expect(b.catalog.length).toBe(a.catalog.length);
    expect(b.centerLabel).toContain('목포');
  });

  it('목포 가상 작업자 계정은 mfcw-mk-…, 토큰 허용 목록에 있고 이름은 같은 규칙', () => {
    setActiveSite('MFC-MOKPO-01');
    expect(activeSite().id).toBe('MFC-MOKPO-01');
    expect(REAL_LINK.virtualAccounts[0]).toBe('mfcw-mk-pp-01');
    expect(REAL_LINK.inboundAccounts).toContain('mfcw-mk-rcv-10');
    expect(passwordFileFor('mfcw-mk-pp-01')).not.toBeNull();
    expect(passwordFileFor(REAL_LINK.supervisorAccount)).not.toBeNull();
    expect(workerShortName('mfcw-mk-pp-03')).toBe('피킹3');
    expect(isInboundAccount('mfcw-mk-qc-02')).toBe(true);
    setActiveSite('없는-지점');
    expect(activeSite().id).toBe(MFC_SITES[0].id);
    expect(REAL_LINK.virtualAccounts[0]).toBe('mfcw-pp-01');
  });
});
