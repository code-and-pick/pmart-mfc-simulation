// 1호점 부산진구 다시 설계(R-45) — 사용자 표의 랙 수, 랙당 칸·칸 코드는 지금 1호점 그대로(새 칸 없음), 넓은 칸 59·닫힘 100 그대로, 걸어갈 수 있음.
// WRITE_LAYOUT=1 이면 위치 파일을 docs/layout-export/busanjin/ 에 쓴다.
import { describe, expect, it } from 'vitest';
import { buildBusanjinLayout, BUSANJIN_RACKS } from '../src/domain/layoutBusanjin';
import { buildLayout } from '../src/domain/layout';
import { buildLocationCodeMap } from '../src/domain/locationCodes';
import { exportPositions } from '../src/domain/layoutExport';
import { applyWideCells } from '../src/domain/wideCells';
import { NavGrid } from '../src/domain/navgrid';

const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as { writeFileSync(p: URL, s: string): void };
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe('부산진구 MFC 다시 설계(R-45)', () => {
  const L = buildBusanjinLayout();
  const codes = buildLocationCodeMap(L);
  const count = (pred: (r: (typeof L.racks)[number]) => boolean) => L.racks.filter(pred).length;
  const cells = (pred: (l: (typeof L.locations)[number]) => boolean) => L.locations.filter(pred).length;
  const zr = (id: string) => L.zones.find((z) => z.id === id)!.rect;

  it('랙 수 = 사용자 표, 칸 = 1호점 랙당 칸 그대로(피킹 8,756 · 보충 435)', () => {
    expect(count((r) => !r.reserve && r.temp === 'CHILLED')).toBe(BUSANJIN_RACKS.B);
    expect(count((r) => !r.reserve && r.temp === 'FROZEN')).toBe(BUSANJIN_RACKS.A);
    for (const g of ['C', 'D', 'E', 'F', 'G', 'H'] as const) expect(count((r) => !r.reserve && r.temp === 'AMBIENT' && r.group[0] === g)).toBe(BUSANJIN_RACKS[g]);
    expect(count((r) => !r.reserve)).toBe(222);
    expect(count((r) => !!r.reserve)).toBe(29);
    expect(cells((l) => !l.reserve)).toBe(8756);
    expect(cells((l) => !!l.reserve)).toBe(435);
  });

  it('칸 코드는 모두 지금 1호점에 있는 코드(새 코드 없음), 순서도 1호점 순서', () => {
    const O = buildLayout();
    const oc = buildLocationCodeMap(O);
    const oldSet = new Set(O.locations.map((l) => oc.toBackend(l.code)));
    const now = L.locations.map((l) => codes.toBackend(l.code));
    expect(now.every((c) => c && oldSet.has(c))).toBe(true);
    expect(new Set(now).size).toBe(now.length);
    const oldIdx = new Map(O.locations.map((l, i) => [l.code, i]));
    const idx = L.locations.map((l) => oldIdx.get(l.code)!);
    expect(idx.every((v, i) => i === 0 || v > idx[i - 1])).toBe(true);
  });

  it('넓은 칸 59·닫힘 100 이 그대로 남는다', () => {
    const M = buildBusanjinLayout();
    const spans = applyWideCells(M, buildLocationCodeMap(M));
    expect(spans.length).toBe(59);
    expect(M.locations.filter((l) => l.closed).length).toBe(100);
  });

  it('배치(그림대로) — 상온 동쪽 띠 C·D·E·F, 남쪽 띠 G·H, 물리 줄마다 한 코드 줄, 격리 랙은 구역 안, 인계 창 앞 비움, 대형재고 10', () => {
    const amb = L.racks.filter((r) => !r.reserve && r.temp === 'AMBIENT');
    const ch2 = zr('C-H2');
    for (const r of amb) expect('GH'.includes(r.group[0]) || ['F02', 'F03', 'E02', 'E03'].includes(r.group) || (['D02', 'D03'].includes(r.group) && r.rackNo <= 2) || (['C01', 'C02'].includes(r.group) && r.rackNo >= 6)).toBe(r.cz > ch2.z0);
    // 같은 z·같은 묶음(1.25 m 간격으로 이어진 랙)은 같은 코드 줄, 랙 번호가 1씩 늘어남
    const rows = new Map<string, (typeof L.racks)[number][]>();
    for (const r of L.racks.filter((x) => !x.reserve)) rows.set(`${r.temp}:${r.cz.toFixed(3)}`, [...(rows.get(`${r.temp}:${r.cz.toFixed(3)}`) ?? []), r]);
    for (const rs of rows.values()) {
      rs.sort((a, b) => a.cx - b.cx);
      for (let i = 1; i < rs.length; i++) if (Math.abs(rs[i].cx - rs[i - 1].cx - 1.25) < 1e-6 && rs[i].group === rs[i - 1].group) expect(rs[i].rackNo).toBe(rs[i - 1].rackNo + 1);
      for (let i = 1; i < rs.length; i++) if (Math.abs(rs[i].cx - rs[i - 1].cx - 1.25) < 1e-6 && rs[i].temp !== 'AMBIENT') expect(rs[i].group).toBe(rs[i - 1].group);
    }
    for (const [id, rs] of Object.entries(L.geo.quarantineRacks ?? {})) for (const r of rs) {
      const q = zr(id);
      expect(r.x0 >= q.x0 - 1e-6 && r.x1 <= q.x1 + 1e-6 && r.z0 >= q.z0 - 1e-6 && r.z1 <= q.z1 + 1e-6).toBe(true);
    }
    // 인계 창(서쪽 벽 z 6.95~7.95) 안쪽 1 m 에 장애물 없음
    for (const o of L.obstacles) expect(o.rect.x0 < (L.geo.floorX0 ?? 0) + 1.0 && o.rect.z1 > 6.95 && o.rect.z0 < 7.95).toBe(false);
    expect(L.reserves.filter((r) => r.role === 'BULK').length).toBe(10);
    expect(L.stations.length).toBe(8);
  });

  it('랙끼리·벽·장애물과 겹치지 않고, 모든 칸·자리에 걸어갈 수 있다', () => {
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
    expect(nav.findPath(L.points.riderEntry, L.points.riderPickup)).toBeTruthy();
    for (const r of L.reserves) expect(nav.findPath(L.points.truckDoor, r.stand)).toBeTruthy();
    for (const r of L.reserveRackSpots) expect(nav.findPath(L.points.truckDoor, r.stand)).toBeTruthy();
  }, 60_000);

  it('구역 넓이(평)', () => {
    const py = (id: string) => {
      const r = id === 'ANNEX_' ? L.geo.liftAnnex : zr(id);
      return ((r.x1 - r.x0) * (r.z1 - r.z0)) / 3.3058;
    };
    // 건물 = MFC 265평 + 승강기 별동 10.1평 = 275.1평(사용자 그림 표, 2026-11-24 "처음 준 게 265평이었잖아")
    const W = L.width - (L.geo.floorX0 ?? 0);
    expect((W * L.buildingDepth) / 3.3058).toBeCloseTo(275.1, 0);
    expect((W * L.buildingDepth) / 3.3058 - py('ANNEX_')).toBeCloseTo(265, 0);
    expect(py('RCV')).toBeCloseTo(12, 0);
    expect(py('PK')).toBeGreaterThanOrEqual(12); // 사용자 "패킹 구역 확보" — 15평
    expect(py('WH')).toBeCloseTo(25.9, 0); // 사용자 "입고창고만 평수 유지"(2026-11-24) — 동쪽으로 밀고 남쪽으로 늘려도 26평
    expect(L.reserves.filter((r) => r.role === 'RECEIVING' && r.temp === 'AMBIENT').every((r) => r.rect.x0 >= zr('WH').x0 && r.rect.z1 <= zr('WH').z1)).toBe(true);
    expect(py('A')).toBeCloseTo(47.3, 0); // 58 → 남북 0.9 m(남쪽 띠 2쌍) → 동서 2.0 m(패킹·장바구니 거치대 넓힘)(사용자 2026-11-24)
    expect(py('B')).toBeCloseTo(47.3, 0);
    expect(py('PK')).toBeCloseTo(26.4, 0);
    expect(py('CQ')).toBeCloseTo(1, 0);
    expect(py('SHIP')).toBeCloseTo(2, 0);
  });

  it('위치 파일', () => {
    const { positions, reserveCells, bulkCells } = exportPositions(L, codes);
    const nonCart = positions.filter((p) => !p.locationCode.startsWith('CRT-'));
    expect(new Set(nonCart.map((p) => p.locationCode)).size).toBe(nonCart.length);
    expect(positions.filter((p) => p.kind === 'SHELF').length).toBe(8756);
    expect(reserveCells.length).toBe(435);
    expect(bulkCells.length).toBe(10);
    if (env.WRITE_LAYOUT === '1') {
      const out = new URL('../docs/layout-export/busanjin/', import.meta.url);
      fs.writeFileSync(new URL('location-positions.json', out), '[\n' + positions.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
      fs.writeFileSync(new URL('reserve-rack-cells.json', out), JSON.stringify(reserveCells) + '\n');
      fs.writeFileSync(new URL('bulk-pallet-cells.json', out), JSON.stringify(bulkCells) + '\n');
    }
  });
});
