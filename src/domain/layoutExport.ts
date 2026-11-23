// 칸 위치 파일 — 백엔드가 이 파일로 센터 칸을 만든다(1호점 docs/layout-export/location-positions.json 과 같은 모양).
// R-41 세종(PC 3 #389 회신 2026-11-23): location-positions.json = locationCode·kind(SHELF/RESERVE_RACK/BULK_PALLET/SUPPORT)·xM·zM,
// 선반은 피킹 순서대로(그 순서가 pickSequence). reserve-rack-cells.json = 보충재고 칸마다 temperatureZone·dimMm.
// 좌표 = 작업자가 서는 자리(칸은 Location.pick, 팔레트·지원 칸은 아래 각 줄).

import type { TemperatureZone } from './contract';
import type { Layout } from './layout';
import { SIM_POINT, type LocationCodeMap } from './locationCodes';

export interface PositionRow {
  locationCode: string;
  kind: 'SHELF' | 'RESERVE_RACK' | 'BULK_PALLET' | 'SUPPORT';
  xM: number;
  zM: number;
}

export interface ReserveCellRow {
  locationCode: string;
  sim: string;
  rackId: string;
  temperatureZone: TemperatureZone;
  level: number;
  slot: number;
  position: { xM: number; zM: number };
  dimMm: { w: number; d: number; h: number };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pad2 = (n: number) => String(n).padStart(2, '0');

export interface BulkCellRow {
  locationCode: string;
  sim: string;
  temperatureZone: TemperatureZone;
  zone: 'STORAGE';
  reserveStock: true;
  position: { xM: number; zM: number };
  palletCenter: { xM: number; zM: number };
  dimMm: { w: number; d: number; h: number };
}

/** 대형재고 팔레트 칸 치수 — 1호점 bulk-pallet-cells.json 과 같은 값(팔레트 1.1 × 1.1, 높이 1.5 m) */
const BULK_DIM = { w: 1100, d: 1100, h: 1500 };

export function exportPositions(L: Layout, codes: LocationCodeMap, cartCount = 40): { positions: PositionRow[]; reserveCells: ReserveCellRow[]; bulkCells: BulkCellRow[] } {
  const positions: PositionRow[] = [];
  const reserveCells: ReserveCellRow[] = [];
  const bulkCells: BulkCellRow[] = [];
  const at = (code: string | null, kind: PositionRow['kind'], p: { x: number; z: number }) => {
    if (!code) throw new Error(`서버 코드 없음 (${kind} ${p.x},${p.z})`);
    positions.push({ locationCode: code, kind, xM: r3(p.x), zM: r3(p.z) });
  };
  // 선반(피킹 순서 = 평면의 칸 순서: 냉동 → 냉장 → 상온, 줄마다 북쪽부터) → 보충재고 랙
  for (const l of L.locations) if (!l.reserve) at(codes.toBackend(l.code), 'SHELF', l.pick);
  for (const l of L.locations) {
    if (!l.reserve) continue;
    const code = codes.toBackend(l.code);
    at(code, 'RESERVE_RACK', l.pick);
    reserveCells.push({ locationCode: code!, sim: l.code, rackId: l.rackId, temperatureZone: l.temp, level: l.level, slot: l.slot, position: { xM: r3(l.pick.x), zM: r3(l.pick.z) }, dimMm: l.dimMm });
  }
  for (const rs of L.reserves) {
    if (rs.role !== 'BULK') continue;
    const code = codes.toBackend(rs.id);
    at(code, 'BULK_PALLET', rs.stand);
    bulkCells.push({ locationCode: code!, sim: rs.id, temperatureZone: rs.temp, zone: 'STORAGE', reserveStock: true, position: { xM: r3(rs.stand.x), zM: r3(rs.stand.z) }, palletCenter: { xM: r3((rs.rect.x0 + rs.rect.x1) / 2), zM: r3((rs.rect.z0 + rs.rect.z1) / 2) }, dimMm: BULK_DIM });
  }
  // 지원 칸
  const P = L.points;
  at('RCV-A-01', 'SUPPORT', P.truckDoor);
  const wr = L.reserves.filter((r) => r.role === 'RECEIVING' && r.temp === 'AMBIENT');
  if (wr.length) {
    const cx = wr.reduce((a, r) => a + (r.rect.x0 + r.rect.x1) / 2, 0) / wr.length;
    const cz = wr.reduce((a, r) => a + (r.rect.z0 + r.rect.z1) / 2, 0) / wr.length;
    at('RCV-A-02', 'SUPPORT', { x: cx, z: cz });
  }
  for (const t of ['CHILLED', 'FROZEN'] as const) {
    const first = L.reserves.find((r) => r.role === 'RECEIVING' && r.temp === t);
    if (first) at(`RCV-${t === 'CHILLED' ? 'C' : 'F'}-01`, 'SUPPORT', { x: (first.rect.x0 + first.rect.x1) / 2, z: (first.rect.z0 + first.rect.z1) / 2 });
  }
  at(codes.toBackend(SIM_POINT.packQueue), 'SUPPORT', P.packQueue);
  at(codes.toBackend(SIM_POINT.packQueueFrozen), 'SUPPORT', { x: P.packQueue.x, z: P.packQueue.z + 0.9 });
  const racks = [...new Set(L.shippingSlots.map((s) => s.rackIndex))].sort((a, b) => a - b);
  for (const ri of racks) {
    const s = L.shippingSlots.filter((x) => x.rackIndex === ri).sort((a, b) => a.pos.x - b.pos.x)[0];
    at(`DSP-A-${pad2(ri + 1)}`, 'SUPPORT', s.pos);
  }
  for (const st of L.stations) at(codes.toBackend(st.id), 'SUPPORT', st.table);
  for (let i = 1; i <= cartCount; i++) at(`CRT-A-${pad2(i)}`, 'SUPPORT', P.cartDepot);
  for (const [zoneId, code] of [['AQ', 'QRT-F-01'], ['BQ', 'QRT-C-01'], ['CQ', 'QRT-A-01']] as const) {
    const z = L.zones.find((q) => q.id === zoneId);
    if (z) at(code, 'SUPPORT', { x: (z.rect.x0 + z.rect.x1) / 2, z: (z.rect.z0 + z.rect.z1) / 2 });
  }
  return { positions, reserveCells, bulkCells };
}
