// 4호점 춘천 평면(R-42) — 사용자 표의 랙 수(칸은 1호점·세종과 같은 단×칸), 칸 코드 겹침 없음, 걸어갈 수 있음. WRITE_LAYOUT=1 이면 위치 파일을 docs/layout-export/chuncheon/ 에 쓴다.
import { describe, expect, it } from 'vitest';
import { buildChuncheonLayout, CHUNCHEON_RACKS } from '../src/domain/layoutChuncheon';
import { buildLocationCodeMap } from '../src/domain/locationCodes';
import { exportPositions } from '../src/domain/layoutExport';
import { NavGrid } from '../src/domain/navgrid';

const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as { writeFileSync(p: URL, s: string): void };
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe('춘천 MFC 평면(R-42)', () => {
  const L = buildChuncheonLayout();
  const codes = buildLocationCodeMap(L);
  const count = (pred: (r: (typeof L.racks)[number]) => boolean) => L.racks.filter(pred).length;
  const cells = (pred: (l: (typeof L.locations)[number]) => boolean) => L.locations.filter(pred).length;
  const zr = (id: string) => L.zones.find((z) => z.id === id)!.rect;

  it('랙·칸 수가 사용자 표와 같다(칸은 1호점 단×칸 — 9,737)', () => {
    expect(count((r) => !r.reserve && r.temp === 'CHILLED')).toBe(CHUNCHEON_RACKS.B);
    expect(count((r) => !r.reserve && r.temp === 'FROZEN')).toBe(CHUNCHEON_RACKS.A);
    for (const g of ['C', 'D', 'E', 'F', 'G', 'H'] as const) expect(count((r) => !r.reserve && r.temp === 'AMBIENT' && r.group[0] === g)).toBe(CHUNCHEON_RACKS[g]);
    expect(count((r) => !r.reserve)).toBe(235);
    expect(count((r) => !!r.reserve)).toBe(30);
    expect(cells((l) => !l.reserve && l.temp === 'CHILLED')).toBe(80 * 35);
    expect(cells((l) => !l.reserve && l.temp === 'FROZEN')).toBe(67 * 30);
    expect(cells((l) => !l.reserve)).toBe(9287);
    expect(cells((l) => !!l.reserve)).toBe(450);
    // 상온 구역 1 = C·D·F·G, 구역 2 = E·H
    const inZ = (r: (typeof L.racks)[number], id: string) => r.cx >= zr(id).x0 && r.cx <= zr(id).x1 && r.cz >= zr(id).z0 && r.cz <= zr(id).z1;
    // 단, G 맨 앞 줄(G01, 5랙)은 구역 2 앞 — 구역 1 맨 앞 줄과 같은 높이(사용자 2026-11-24 "G랙 맨 앞 한 줄 상온구역2 앞에 붙이면 G 가로로 이어지겠네")
    // 맨 앞(패킹 쪽) 줄은 고회전 F — 구역 2 앞 줄 F02(5랙)이 구역 1 맨 앞 F 줄과 같은 높이(사용자 2026-11-24 "고회전F열이 패킹대에 제일 가까이")
    const f01 = L.racks.filter((x) => x.group === 'F02');
    expect(f01.length).toBe(5);
    for (const r of f01) expect(inZ(r, 'C-H2')).toBe(true);
    const z1 = L.racks.filter((x) => !x.reserve && x.temp === 'AMBIENT' && inZ(x, 'C-H'));
    const z1front = Math.max(...z1.map((x) => x.cz));
    for (const r of f01) expect(r.cz).toBeCloseTo(z1front, 5);
    for (const r of z1.filter((x) => Math.abs(x.cz - z1front) < 1e-6)) expect(r.group[0]).toBe('F');
    for (const r of L.racks.filter((x) => !x.reserve && x.temp === 'AMBIENT' && x.group !== 'F02')) expect(inZ(r, 'CDFG'.includes(r.group[0]) ? 'C-H' : 'C-H2')).toBe(true);
    // 상온 구역 2 줄 사이 통로가 모두 같음(등 맞댄 쌍 사이 + 마지막 쌍 ~ 맨 앞 F02 줄)
    const z2rows = [...new Set(L.racks.filter((x) => !x.reserve && x.temp === 'AMBIENT' && inZ(x, 'C-H2')).map((x) => +x.cz.toFixed(3)))].sort((a, b) => a - b);
    const gaps = z2rows.slice(1).map((z, i) => +(z - z2rows[i] - 0.45).toFixed(3)).filter((g) => g > 0.01);
    expect(new Set(gaps).size).toBe(1);
    // 냉장·냉동 입고재고 팔레트 ~ 첫 피킹 줄 0.8 m 이상
    for (const t of ['CHILLED', 'FROZEN'] as const) {
      const pal = L.reserves.filter((r) => r.role === 'RECEIVING' && r.temp === t);
      const row = Math.min(...L.racks.filter((r) => !r.reserve && r.temp === t).map((r) => r.cx - 0.225));
      expect(row - Math.max(...pal.map((p) => p.rect.x1))).toBeGreaterThan(0.8);
    }
    // 상온 격리는 입고창고 동쪽 벽에 붙고, 보충재고 랙과 0.8 m 넘게 떨어짐
    const cq = zr('CQ');
    expect(cq.x1).toBeGreaterThan(zr('WH').x1 - 0.2);
    const whRacks = L.racks.filter((x) => x.reserve && x.temp === 'AMBIENT');
    expect(cq.x0 - Math.max(...whRacks.map((x) => x.cx + 0.625))).toBeGreaterThan(0.8);
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
    for (const b of bs) for (const o of L.obstacles) expect(hit(b, o.rect)).toBe(false);
    const nav = new NavGrid(L);
    const picks = [...new Map(L.locations.map((l) => [`${l.pick.x.toFixed(2)},${l.pick.z.toFixed(2)}`, l.pick])).values()];
    expect(picks.filter((p) => !nav.isFreeAt(p) || !nav.findPath(L.points.cartDepot, p))).toEqual([]);
    for (const st of L.stations) expect(nav.findPath(L.points.cartDepot, st.stand)).toBeTruthy();
    expect(nav.findPath(L.points.packQueue, L.points.shipDrop)).toBeTruthy();
    // 출하문 앞은 패킹 밖, 인계 랙은 돌출부 벽에 붙어 문을 막지 않음
    expect(zr('PK').x1).toBeLessThan(24.2);
    for (const o of L.obstacles.filter((x) => x.kind === 'SHIP_RACK')) expect(o.rect.x1 <= 24.2 + 1e-6 || o.rect.x0 >= 26.4 - 1e-6).toBe(true);
    // 격리 흰 랙은 격리 구역(실선) 안
    for (const [id, rs] of Object.entries(L.geo.quarantineRacks ?? {})) for (const r of rs) {
      const q = zr(id);
      expect(r.x0 >= q.x0 && r.x1 <= q.x1 && r.z0 >= q.z0 && r.z1 <= q.z1).toBe(true);
    }
    expect(nav.findPath(L.points.riderEntry, L.points.riderPickup)).toBeTruthy(); // 라이더는 앞마당에서 인계 창으로
    for (const r of L.reserves) expect(nav.findPath(L.points.truckDoor, r.stand)).toBeTruthy();
  }, 60_000);

  it('구역 넓이(평) · 건물 278평', () => {
    const py = (id: string) => ((zr(id).x1 - zr(id).x0) * (zr(id).z1 - zr(id).z0)) / 3.3058;
    expect(py('RCV')).toBeCloseTo(12.63, 0);
    expect(py('PK')).toBeCloseTo(12.63, 0);
    expect(Math.abs((L.width * L.buildingDepth) / 3.3058 + 2.1 - 278)).toBeLessThan(1);
    expect(L.stations.length).toBe(6); // 3 | 3(출하문 앞을 비움, 2026-11-24)
    expect(L.reserves.filter((r) => r.role === 'BULK').length).toBe(10);
    expect(L.reserves.filter((r) => r.role === 'RECEIVING' && r.temp === 'AMBIENT').length).toBe(6);
  });

  it('넓은 칸 — 1호점 규칙(코드가 있는 55칸) + 춘천 H3 의 4칸(제안), 닫힘 83 + 17', async () => {
    const { applyWideCells } = await import('../src/domain/wideCells');
    const M = buildChuncheonLayout();
    const spans = applyWideCells(M, buildLocationCodeMap(M));
    expect(spans.length).toBe(59);
    expect(M.locations.filter((l) => l.closed).length).toBe(100);
    expect(M.locations.find((l) => l.code === 'H03-03-101')!.dimMm).toEqual({ w: 1125, d: 450, h: 1260 });
  });

  it('위치 파일', () => {
    const { positions, reserveCells, bulkCells } = exportPositions(L, codes);
    const nonCart = positions.filter((p) => !p.locationCode.startsWith('CRT-'));
    expect(new Set(nonCart.map((p) => p.locationCode)).size).toBe(nonCart.length);
    expect(positions.filter((p) => p.kind === 'SHELF').length).toBe(9287);
    expect(reserveCells.length).toBe(450);
    expect(bulkCells.length).toBe(10);
    if (env.WRITE_LAYOUT === '1') {
      const out = new URL('../docs/layout-export/chuncheon/', import.meta.url);
      fs.writeFileSync(new URL('location-positions.json', out), '[\n' + positions.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
      fs.writeFileSync(new URL('reserve-rack-cells.json', out), JSON.stringify(reserveCells) + '\n');
      fs.writeFileSync(new URL('bulk-pallet-cells.json', out), JSON.stringify(bulkCells) + '\n');
    }
  });
});
