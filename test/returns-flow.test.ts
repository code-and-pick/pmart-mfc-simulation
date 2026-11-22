// 회수품 흐름(MOCK, 사용자 2026-11-22 "넣어"): 반납 → 반입(RTN-A-01 격리) → 검수(반입한 사람 말고)
// → 상온·미개봉 = 재판매 적치(선반), 냉장·냉동·개봉·파손 = 반입한 사람이 온도대 격리 구역으로 격리 이동
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config';
import { Simulation } from '../src/sim/simulation';
import { QUARANTINE_OF } from '../src/sim/returns';
import { InventoryLedger } from '../src/backend/mock/inventory';

describe('회수품 흐름 (MOCK)', () => {
  it('원장: 반입 H+q·Q+q(E 불변), 재판매 Q−q·E+q, 격리 이동은 총량 불변', () => {
    const inv = new InventoryLedger();
    inv.seed('S1', 5);
    inv.returnReceipt([{ sku: 'S1', qty: 2 }]);
    let b = inv.get('S1')!;
    expect([b.H, b.Q, b.E, b.returnArea]).toEqual([7, 2, 5, 2]);
    inv.releaseReturn('S1', 1);
    inv.quarantineMove('S1', 1);
    b = inv.get('S1')!;
    expect([b.H, b.Q, b.E, b.returnArea, b.quarantineArea, b.unstowed]).toEqual([7, 1, 6, 0, 1, 1]);
    inv.putaway('S1', 1, 'shelf');
    expect(inv.get('S1')!.shelf).toBe(6);
    expect(inv.violations).toEqual([]);
  });

  it('반납 6건을 끝까지: 정상은 선반, 폐기는 온도대 격리 구역, 검수자 ≠ 반입자', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, ordersPerHour: 0, startHour: 10 });
    const mock = sim.mock!;
    const inv = mock.inventory;
    const api: { path: string; status: number | string }[] = [];
    mock.onApi((r) => api.push({ path: r.path, status: r.status }));
    const insp: string[] = [];
    mock.onEvent((e) => {
      if (e.type === 'ReturnInspected') insp.push(e.summary.split(' ')[0]);
    });
    for (let i = 0; i < 6; i++) expect(sim.callReturn()).toMatch(/^RTD-/);
    const items = [...sim.returnItems];
    expect(items.length).toBeGreaterThanOrEqual(6);
    sim.speed = 300;
    for (let i = 0; i < 400 && sim.returnItems.some((it) => it.stage !== 'QUARANTINED' && it.stage !== 'DONE'); i++) await sim.advance(0.1);
    for (const it of items) {
      expect(['QUARANTINED', 'DONE']).toContain(it.stage);
      if (it.temp !== 'AMBIENT') expect(it.stage).toBe('QUARANTINED'); // 냉장·냉동은 재판매 불가
      expect(it.receivedBy).toBeTruthy();
      if (it.stage === 'QUARANTINED') {
        const q = QUARANTINE_OF[it.temp];
        expect(it.quarantineCode).toBe(q.code);
        const z = sim.layout.zones.find((x) => x.id === q.zoneId)!;
        expect(it.pos.x).toBeGreaterThan(z.rect.x0);
        expect(it.pos.x).toBeLessThan(z.rect.x1);
        expect(it.pos.z).toBeGreaterThan(z.rect.z0);
        expect(it.pos.z).toBeLessThan(z.rect.z1);
      }
    }
    // 재고: 격리 구역 수량 = 폐기분, 반품 위치는 비었다
    const disposed = items.filter((it) => it.stage === 'QUARANTINED');
    for (const it of disposed) expect(inv.get(it.sku)!.quarantineArea).toBeGreaterThanOrEqual(it.qty);
    for (const it of items) expect(inv.get(it.sku)!.returnArea).toBe(0);
    expect(insp.length).toBe(new Set(items.map((it) => it.receiptId)).size);
    expect(inv.violations).toEqual([]);
    expect(sim.metrics.apiErrors).toBe(0);
    // 계약 경로를 탔다(4xx 없음)
    for (const p of ['/return-receipts', '/return-inspections']) expect(api.some((a) => a.path === p && a.status === 202)).toBe(true);
    expect(api.filter((a) => typeof a.status === 'number' && a.status >= 400)).toEqual([]);
    if (disposed.length) expect(api.some((a) => a.path.endsWith('/quarantine-moves') && a.status === 200)).toBe(true);
    expect(sim.inboundBoard().returns.quarantined).toBe(disposed.length);
  }, 120_000);

  it('반입한 사람은 검수할 수 없다(422 SELF_APPROVAL), 냉장 재판매는 422 RESALE_NOT_ALLOWED', async () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS, ordersPerHour: 0, inboundWorkers: 0 });
    const mock = sim.mock!;
    const amb = sim.catalog.find((s) => s.temp === 'AMBIENT')!.sku;
    const chl = sim.catalog.find((s) => s.temp === 'CHILLED')!.sku;
    mock.returnDelivered('RTD-T1', 'CLAIM_RETURN', [{ sku: amb, qty: 1 }, { sku: chl, qty: 1 }]);
    const r = await mock.recordReturnReceipt({ mfcId: 'MFC-SEED-01', toLocationCode: 'RTN-A-01', arrivalId: 'RTD-T1', receivedBy: 'IB1' }, 'k1');
    const body = (by: string, verdict: 'RESALE' | 'DISPOSE') => ({
      mfcId: 'MFC-SEED-01',
      returnReceiptId: r.resultId!,
      inspectedBy: by,
      lines: [
        { sku: amb, qty: 1, verdict: 'RESALE' as const, temperatureZone: 'AMBIENT' as const, opened: false },
        { sku: chl, qty: 1, verdict, temperatureZone: 'CHILLED' as const, opened: false },
      ],
    });
    await expect(mock.createReturnInspection(body('IB1', 'DISPOSE'), 'k2')).rejects.toMatchObject({ problem: { code: 'SELF_APPROVAL' } });
    await expect(mock.createReturnInspection(body('IB2', 'RESALE'), 'k3')).rejects.toMatchObject({ problem: { code: 'RESALE_NOT_ALLOWED' } });
    const ok = await mock.createReturnInspection(body('IB2', 'DISPOSE'), 'k4');
    const qrt = ok.createdTaskIds.find((t) => mock.returnTask(t)!.taskType === 'QUARANTINE_MOVE')!;
    expect(mock.returnTask(qrt)!.assigneeId).toBe('IB1');
    await expect(mock.quarantineMove(qrt, { toLocationCode: 'QRT-C-01', qty: 1 }, 'k5', 'IB2')).rejects.toMatchObject({ problem: { code: 'NOT_ASSIGNEE' } });
    await expect(mock.quarantineMove(qrt, { toLocationCode: 'QRT-A-01', qty: 1 }, 'k6', 'IB1')).rejects.toMatchObject({ problem: { code: 'TEMPERATURE_ZONE_MISMATCH' } });
    await mock.quarantineMove(qrt, { toLocationCode: 'QRT-C-01', qty: 1 }, 'k7', 'IB1');
    expect(mock.inventory.get(chl)!.quarantineArea).toBe(1);
    expect(mock.inventory.violations).toEqual([]);
  });
});
