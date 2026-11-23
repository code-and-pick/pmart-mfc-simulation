// 5호점 부산남구 평면(R-44) — 사용자 표의 랙·칸 수(13,471), 칸 코드 겹침 없음, 걸어갈 수 있음. WRITE_LAYOUT=1 이면 위치 파일을 docs/layout-export/busan-namgu/ 에 쓴다.
import { describe, expect, it } from 'vitest';
import { buildBusanNamguLayout, BUSAN_NAMGU_RACKS } from '../src/domain/layoutBusanNamgu';
import { buildLocationCodeMap } from '../src/domain/locationCodes';
import { exportPositions } from '../src/domain/layoutExport';
import { NavGrid } from '../src/domain/navgrid';

const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as { writeFileSync(p: URL, s: string): void };
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe('부산남구 MFC 평면(R-44)', () => {
  const L = buildBusanNamguLayout();
  const codes = buildLocationCodeMap(L);
  const count = (pred: (r: (typeof L.racks)[number]) => boolean) => L.racks.filter(pred).length;
  const cells = (pred: (l: (typeof L.locations)[number]) => boolean) => L.locations.filter(pred).length;
  const zr = (id: string) => L.zones.find((z) => z.id === id)!.rect;

  it('랙·칸 수가 사용자 표와 같다(피킹 321·12,706 / 보충 51·765)', () => {
    expect(count((r) => !r.reserve && r.temp === 'CHILLED')).toBe(BUSAN_NAMGU_RACKS.B);
    expect(count((r) => !r.reserve && r.temp === 'FROZEN')).toBe(BUSAN_NAMGU_RACKS.A);
    for (const g of ['C', 'D', 'E', 'F', 'G', 'H'] as const) expect(count((r) => !r.reserve && r.temp === 'AMBIENT' && r.group[0] === g)).toBe(BUSAN_NAMGU_RACKS[g]);
    expect(count((r) => !r.reserve)).toBe(321);
    expect(count((r) => !!r.reserve)).toBe(51);
    expect(cells((l) => !l.reserve)).toBe(12706);
    expect(cells((l) => !!l.reserve)).toBe(765);
  });

  it('칸 코드가 겹치지 않고 서버 코드로 모두 바뀐다', () => {
    const backend = L.locations.map((l) => codes.toBackend(l.code));
    expect(backend.every(Boolean)).toBe(true);
    expect(new Set(backend).size).toBe(L.locations.length);
  });

  it('배치 — 고회전 F 가 패킹 쪽(남쪽) 맨 앞, 격리 랙은 실선 안, 출하문 앞 비움, 입고·검수 남쪽 문 없음', () => {
    const amb = L.racks.filter((r) => !r.reserve && r.temp === 'AMBIENT');
    const front = Math.max(...amb.map((r) => r.cz));
    for (const r of amb.filter((x) => Math.abs(x.cz - front) < 1e-6)) expect(r.group[0]).toBe('F');
    for (const [id, rs] of Object.entries(L.geo.quarantineRacks ?? {})) for (const r of rs) {
      const q = zr(id);
      expect(r.x0 >= q.x0 && r.x1 <= q.x1 && r.z0 >= q.z0 && r.z1 <= q.z1).toBe(true);
    }
    for (const o of L.obstacles.filter((x) => x.kind === 'SHIP_RACK')) expect(o.rect.x1 <= 37.6 + 1e-6 || o.rect.x0 >= 39.8 - 1e-6).toBe(true);
    const rcv = zr('RCV');
    const southWall = L.walls.filter((w) => Math.abs((w.rect.z0 + w.rect.z1) / 2 - (rcv.z1 + 0.1)) < 0.01 && w.rect.x0 < rcv.x1 && w.rect.x1 > rcv.x0);
    expect(southWall.reduce((a, w) => a + Math.min(w.rect.x1, rcv.x1) - Math.max(w.rect.x0, rcv.x0), 0)).toBeCloseTo(rcv.x1 - rcv.x0, 3);
    // 입고창고 남쪽(패킹 쪽) 벽에 문 없음, 상온 격리 흰 랙은 가로로 남쪽 벽에
    const wh = zr('WH');
    const whSouth = L.walls.filter((w) => Math.abs((w.rect.z0 + w.rect.z1) / 2 - wh.z1) < 0.01 && w.rect.x0 < wh.x1 && w.rect.x1 > wh.x0);
    expect(whSouth.reduce((a, w) => a + Math.min(w.rect.x1, wh.x1) - Math.max(w.rect.x0, wh.x0), 0)).toBeCloseTo(wh.x1 - wh.x0, 3);
    for (const r of L.geo.quarantineRacks!.CQ) {
      expect(r.x1 - r.x0).toBeGreaterThan(r.z1 - r.z0);
      expect(wh.z1 - r.z1).toBeLessThan(0.2);
    }
    // 입고창고: 입고재고 팔레트 ~ 보충재고 랙 첫 줄 1.8 m 이상, 마지막 줄 ~ 상온 격리 1 m 이상
    const whRacks = L.racks.filter((x) => x.reserve && x.temp === 'AMBIENT');
    const wr = L.reserves.filter((x) => x.role === 'RECEIVING' && x.temp === 'AMBIENT');
    expect(Math.min(...whRacks.map((x) => x.cz - 0.225)) - Math.max(...wr.map((x) => x.rect.z1))).toBeGreaterThan(1.8);
    // 보충재고 랙 줄마다 5랙(3쌍 30) + 남는 1랙 한 줄(사용자 2026-11-24 "5 5 5 남은거")
    const perRow = [...whRacks.reduce((m, x) => m.set(x.cz.toFixed(3), (m.get(x.cz.toFixed(3)) ?? 0) + 1), new Map<string, number>()).values()];
    expect(perRow.sort((a, b) => b - a)).toEqual([5, 5, 5, 5, 5, 5, 1]);
    // 3쌍 마지막 줄 ~ 상온 격리 1 m 이상(남는 1랙은 서쪽 끝이라 격리와 x 가 겹치지 않음)
    const main = whRacks.filter((x) => perRow.length && whRacks.filter((y) => y.cz.toFixed(3) === x.cz.toFixed(3)).length === 5);
    expect(zr('CQ').z0 - Math.max(...main.map((x) => x.cz + 0.225))).toBeGreaterThan(1.0);
    const lone = whRacks.find((x) => whRacks.filter((y) => y.cz.toFixed(3) === x.cz.toFixed(3)).length === 1)!;
    expect(lone.cx + 0.625).toBeLessThan(zr('CQ').x0);
    // 입고·검수 ~ 냉동 방 동쪽 벽 통로 2 m 이상(사용자 2026-11-24 "입고검수랑 냉동 사이가 좁잖아")
    expect(rcv.x0 - zr('A').x1).toBeGreaterThan(2);
    // 저온 입고재고 팔레트 ~ 첫 피킹 줄 0.8 m 이상
    for (const t of ['CHILLED', 'FROZEN'] as const) {
      const pal = L.reserves.filter((r) => r.role === 'RECEIVING' && r.temp === t);
      const row = Math.min(...L.racks.filter((r) => !r.reserve && r.temp === t).map((r) => r.cx - 0.225));
      expect(row - Math.max(...pal.map((p) => p.rect.x1))).toBeGreaterThan(0.8);
    }
  });

  it('랙끼리·벽·장애물과 겹치지 않고, 모든 칸·팔레트에 걸어갈 수 있다', () => {
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
  }, 60_000);

  it('구역 넓이(평) · 건물 404평', () => {
    const py = (id: string) => ((zr(id).x1 - zr(id).x0) * (zr(id).z1 - zr(id).z0)) / 3.3058;
    expect(py('RCV')).toBeCloseTo(17.46, 0);
    expect(py('PK')).toBeCloseTo(15.19, 0);
    expect(py('OFF')).toBeCloseTo(6.11, 0);
    expect(py('C-H')).toBeCloseTo(60.25, -1);
    expect(Math.abs((L.width * L.buildingDepth) / 3.3058 + 3 - 404)).toBeLessThan(1);
    expect(L.stations.length).toBe(8);
    expect(L.reserves.filter((r) => r.role === 'BULK').length).toBe(10);
    expect(L.reserves.filter((r) => r.role === 'RECEIVING' && r.temp === 'AMBIENT').length).toBe(5);
  });

  it('넓은 칸 — 1호점 규칙 + 1호점 H 넓은 칸 랙 6대를 부산남구 H2-01~04·H3-01·02 로(제안): 합침 59·닫힘 100(1호점과 같은 수)', async () => {
    const { applyWideCells } = await import('../src/domain/wideCells');
    const M = buildBusanNamguLayout();
    const spans = applyWideCells(M, buildLocationCodeMap(M));
    expect(spans.length).toBe(59);
    expect(M.locations.filter((l) => l.closed).length).toBe(100);
    expect(M.locations.find((l) => l.code === 'H03-02-101')!.dimMm).toEqual({ w: 1125, d: 450, h: 1260 });
  });

  it('위치 파일', () => {
    const { positions, reserveCells, bulkCells } = exportPositions(L, codes);
    const nonCart = positions.filter((p) => !p.locationCode.startsWith('CRT-'));
    expect(new Set(nonCart.map((p) => p.locationCode)).size).toBe(nonCart.length);
    expect(positions.filter((p) => p.kind === 'SHELF').length).toBe(12706);
    expect(reserveCells.length).toBe(765);
    expect(bulkCells.length).toBe(10);
    if (env.WRITE_LAYOUT === '1') {
      const out = new URL('../docs/layout-export/busan-namgu/', import.meta.url);
      fs.writeFileSync(new URL('location-positions.json', out), '[\n' + positions.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
      fs.writeFileSync(new URL('reserve-rack-cells.json', out), JSON.stringify(reserveCells) + '\n');
      fs.writeFileSync(new URL('bulk-pallet-cells.json', out), JSON.stringify(bulkCells) + '\n');
    }
  });
});
