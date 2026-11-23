// 2호점 목포 평면(1호점 + 목포만 고친 자리, 2026-11-24) — 상온 F 가 가장 남쪽 줄, 인계 랙이 출하문을 막지 않음, 칸 코드·순서는 1호점과 같음.
// WRITE_LAYOUT=1 이면 위치 파일을 docs/layout-export/mokpo/ 에 쓴다.
import { describe, expect, it } from 'vitest';
import { buildLayout, SHIP_BUMP } from '../src/domain/layout';
import { applyMokpo } from '../src/domain/layoutMokpo';
import { buildLocationCodeMap } from '../src/domain/locationCodes';
import { exportPositions } from '../src/domain/layoutExport';
import { NavGrid } from '../src/domain/navgrid';

const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as { writeFileSync(p: URL, s: string): void };
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe('목포 평면', () => {
  const seed = buildLayout();
  const L = applyMokpo(buildLayout());

  it('칸 코드·순서는 1호점과 같고 상온 F 가 가장 남쪽 줄들', () => {
    expect(L.locations.map((l) => l.code)).toEqual(seed.locations.map((l) => l.code));
    const amb = L.racks.filter((r) => !r.reserve && r.temp === 'AMBIENT');
    const f = amb.filter((r) => r.group[0] === 'F');
    const rest = amb.filter((r) => r.group[0] !== 'F');
    expect(Math.min(...f.map((r) => r.cz))).toBeGreaterThanOrEqual(Math.max(...rest.map((r) => r.cz)) - 1e-6);
    // 맨 앞(가장 남쪽) 줄은 8랙 F 이고 남쪽(패킹 쪽)을 봄 — 번호판이 앞에서 보임
    const frontZ = Math.max(...amb.map((r) => r.cz));
    const front = amb.filter((r) => Math.abs(r.cz - frontZ) < 1e-6);
    expect(front.length).toBe(8);
    for (const r of front) expect(r.group[0] === 'F' && r.face === 1).toBe(true);
    // 나머지는 원래 남 → 북 순서 그대로(뒤로 밀림)
    const key = (r: { cx: number; cz: number }) => -r.cz * 1000 + r.cx;
    const before = seed.racks.filter((r) => !r.reserve && r.temp === 'AMBIENT' && r.group[0] !== 'F').sort((a, b) => key(a) - key(b)).map((r) => r.id);
    const after = [...rest].sort((a, b) => key(a) - key(b)).map((r) => r.id);
    expect(after).toEqual(before);
  });

  it('인계 랙이 출하문을 막지 않고, 모든 칸에 걸어갈 수 있다', () => {
    const doorX: [number, number] = [38.818, 41.218];
    for (const o of L.obstacles.filter((x) => x.kind === 'SHIP_RACK')) {
      expect(o.rect.x1 <= doorX[0] + 1e-6 || o.rect.x0 >= doorX[1] - 1e-6).toBe(true);
      expect(o.rect.x0).toBeGreaterThanOrEqual(SHIP_BUMP.x0);
      expect(o.rect.x1).toBeLessThanOrEqual(SHIP_BUMP.x1);
    }
    const nav = new NavGrid(L);
    const picks = [...new Map(L.locations.filter((l) => l.temp === 'AMBIENT' && !l.reserve).map((l) => [`${l.pick.x.toFixed(2)},${l.pick.z.toFixed(2)}`, l.pick])).values()];
    expect(picks.filter((p) => !nav.isFreeAt(p) || !nav.findPath(L.points.cartDepot, p))).toEqual([]);
    expect(nav.findPath(L.points.packQueue, L.points.shipDrop)).toBeTruthy();
  }, 60_000);

  it('위치 파일', () => {
    const { positions, reserveCells, bulkCells } = exportPositions(L, buildLocationCodeMap(L));
    expect(positions.filter((p) => p.kind === 'SHELF').length).toBe(seed.locations.filter((l) => !l.reserve).length);
    if (env.WRITE_LAYOUT === '1') {
      const out = new URL('../docs/layout-export/mokpo/', import.meta.url);
      fs.writeFileSync(new URL('location-positions.json', out), '[\n' + positions.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
      fs.writeFileSync(new URL('reserve-rack-cells.json', out), JSON.stringify(reserveCells) + '\n');
      fs.writeFileSync(new URL('bulk-pallet-cells.json', out), JSON.stringify(bulkCells) + '\n');
    }
  });
});
