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
  });

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
    expect(positions.some((p) => p.locationCode === 'PAK-A-06')).toBe(true);
    if (env.WRITE_LAYOUT === '1') {
      const out = new URL('../docs/layout-export/sejong/', import.meta.url);
      fs.writeFileSync(new URL('location-positions.json', out), '[\n' + positions.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
      fs.writeFileSync(new URL('reserve-rack-cells.json', out), JSON.stringify(reserveCells) + '\n');
    }
  });
});
