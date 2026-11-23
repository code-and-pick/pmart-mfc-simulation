// 3호점 세종 평면(R-41) — 사용자 표의 랙·칸 수, 칸 코드 겹침 없음, 걸어갈 수 있음. WRITE_LAYOUT=1 이면 위치 파일을 docs/layout-export/sejong/ 에 쓴다.
import { describe, expect, it } from 'vitest';
import { buildSejongLayout, SEJONG_RACKS } from '../src/domain/layoutSejong';
import { buildLocationCodeMap } from '../src/domain/locationCodes';
import { exportPositions } from '../src/domain/layoutExport';
import { NavGrid } from '../src/domain/navgrid';

const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as { writeFileSync(p: URL, s: string): void };
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe('세종 MFC 평면(R-41)', () => {
  const L = buildSejongLayout();
  const codes = buildLocationCodeMap(L);
  const count = (pred: (r: (typeof L.racks)[number]) => boolean) => L.racks.filter(pred).length;
  const cells = (pred: (l: (typeof L.locations)[number]) => boolean) => L.locations.filter(pred).length;

  it('랙·칸 수가 사용자 표와 같다', () => {
    expect(count((r) => !r.reserve && r.temp === 'CHILLED')).toBe(SEJONG_RACKS.B);
    expect(count((r) => !r.reserve && r.temp === 'FROZEN')).toBe(SEJONG_RACKS.A);
    for (const g of ['C', 'D', 'E', 'F', 'G', 'H'] as const) expect(count((r) => !r.reserve && r.temp === 'AMBIENT' && r.group[0] === g)).toBe(SEJONG_RACKS[g]);
    expect(count((r) => !r.reserve)).toBe(428);
    expect(count((r) => !!r.reserve)).toBe(70);
    expect(cells((l) => !l.reserve && l.temp === 'CHILLED')).toBe(5110);
    expect(cells((l) => !l.reserve && l.temp === 'FROZEN')).toBe(3660);
    expect(cells((l) => !l.reserve)).toBe(16935);
    expect(cells((l) => !!l.reserve)).toBe(1050);
  });

  it('칸 코드가 겹치지 않고 서버 코드로 모두 바뀐다', () => {
    const backend = L.locations.map((l) => codes.toBackend(l.code));
    expect(backend.every(Boolean)).toBe(true);
    expect(new Set(backend).size).toBe(L.locations.length);
  });

  it('랙끼리·벽과 겹치지 않고, 모든 칸 앞 자리에 장바구니 거치대에서 걸어갈 수 있다', () => {
    const box = (r: (typeof L.racks)[number]) => {
      const hx = r.along === 'x' ? 0.625 : 0.225;
      const hz = r.along === 'x' ? 0.225 : 0.625;
      return { x0: r.cx - hx, z0: r.cz - hz, x1: r.cx + hx, z1: r.cz + hz };
    };
    const hit = (a: { x0: number; z0: number; x1: number; z1: number }, b: typeof a) => a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
    const bs = L.racks.map(box);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(hit(bs[i], bs[j])).toBe(false);
    for (const b of bs) for (const w of L.walls) expect(hit(b, w.rect)).toBe(false);
    const nav = new NavGrid(L);
    const picks = [...new Map(L.locations.map((l) => [`${l.pick.x.toFixed(2)},${l.pick.z.toFixed(2)}`, l.pick])).values()];
    const bad = picks.filter((p) => !nav.isFreeAt(p) || !nav.findPath(L.points.cartDepot, p));
    expect(bad).toEqual([]);
    for (const st of L.stations) expect(nav.findPath(L.points.cartDepot, st.stand)).toBeTruthy();
    expect(nav.findPath(L.points.packQueue, L.points.shipDrop)).toBeTruthy();
    expect(nav.findPath(L.points.truckDoor, L.reserves.find((r) => r.id === 'WR-01')!.stand)).toBeTruthy();
  }, 60_000); // 칸 앞 자리 수천 곳 길 찾기 — 전체 시험과 같이 돌면 5초를 넘는다

  it('구역 넓이(평)가 표와 가깝다', () => {
    const py = (id: string) => {
      const r = L.zones.find((z) => z.id === id)!.rect;
      return ((r.x1 - r.x0) * (r.z1 - r.z0)) / 3.3058;
    };
    expect(py('RCV')).toBeCloseTo(24.27, 0);
    expect(py('WH')).toBeCloseTo(51.31, 0);
    expect(py('PK')).toBeCloseTo(20.26, 0);
    expect(py('OFF')).toBeCloseTo(8.15, 0);
    expect(py('C-H') + py('C-H2')).toBeCloseTo(80.46, -1);
    expect(Math.abs(py('B') - 112.9)).toBeLessThan(1.5); // 냉장 110.9 + 격리 2
    const mfc = (L.width * L.buildingDepth) / 3.3058 + 3;
    expect(Math.abs(mfc - 539)).toBeLessThan(1);
  });

  it('위치 파일 — 지원 칸까지 코드 겹침 없음', () => {
    const { positions, reserveCells } = exportPositions(L, codes);
    const nonCart = positions.filter((p) => !p.locationCode.startsWith('CRT-'));
    expect(new Set(nonCart.map((p) => p.locationCode)).size).toBe(nonCart.length);
    expect(positions.filter((p) => p.kind === 'SHELF').length).toBe(16935);
    expect(reserveCells.length).toBe(1050);
    expect(positions.some((p) => p.locationCode === 'PAK-A-08')).toBe(true); // 패킹대 8(4 | 4, 2026-11-24)
    if (env.WRITE_LAYOUT === '1') {
      const out = new URL('../docs/layout-export/sejong/', import.meta.url);
      fs.writeFileSync(new URL('location-positions.json', out), '[\n' + positions.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
      fs.writeFileSync(new URL('reserve-rack-cells.json', out), JSON.stringify(reserveCells) + '\n');
    }
  });
});

describe('세종 넓은 칸(R-41 PC3 계획과 같음)', () => {
  it('1호점 넓은 칸 규칙이 세종 칸에도 — 합친 칸 58·닫힌 칸 86', async () => {
    const { applyWideCells } = await import('../src/domain/wideCells');
    const L = buildSejongLayout();
    const spans = applyWideCells(L, buildLocationCodeMap(L));
    // + 세종 B-00000006 넓은 칸 A-H4-05-1-01(PC3 #392): 합친 칸 59, 닫힌 칸 86 + 14
    expect(spans.length).toBe(59);
    expect(L.locations.filter((l) => l.closed).length).toBe(100);
    const big = L.locations.find((l) => l.code === 'H04-05-101')!;
    expect(big.dimMm).toEqual({ w: 1125, d: 450, h: 1260 });
    expect(big.span).toEqual({ slots: 5, levels: 3 });
  });
});

describe('세종 배치 고침(2026-11-24)', () => {
  it('상온 격리는 상온 구역 1 안, 랙과 겹치지 않음 · 패킹대 8(4 | 4) · 카트 거치대는 패킹 옆 세로', () => {
    const L = buildSejongLayout();
    const zr = (id: string) => L.zones.find((z) => z.id === id)!.rect;
    const cq = zr('CQ');
    const ch = zr('C-H');
    expect(cq.x0 >= ch.x0 && cq.x1 <= ch.x1 && cq.z0 >= ch.z0 && cq.z1 <= ch.z1).toBe(true);
    for (const r of L.racks) {
      const hx = r.along === 'x' ? 0.625 : 0.225;
      const hz = r.along === 'x' ? 0.225 : 0.625;
      expect(r.cx + hx <= cq.x0 || r.cx - hx >= cq.x1 || r.cz + hz <= cq.z0 || r.cz - hz >= cq.z1).toBe(true);
    }
    expect(L.stations.length).toBe(8);
    expect(new Set(L.stations.map((s) => s.table.z.toFixed(2))).size).toBe(2);
    const pk = zr('PK');
    expect(pk.z0).toBeGreaterThan(ch.z1); // 패킹이 상온 구역 1 남쪽
    expect(L.geo.cartDepotVertical).toBe(true);
  });
});
