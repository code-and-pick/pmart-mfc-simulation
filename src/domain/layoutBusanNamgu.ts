// 5호점 부산남구 MFC(MFC-BNG-01) 평면 — R-44(2026-11-24).
// 근거: 백엔드 요청 docs/handoff/simulator/mfc/2026-11-24-request-busan-namgu-mfc.md 와 사용자 평면도 그림 2026-11-24-busan-namgu-floorplan-user.png
// (사용자 "mfc 하나 더 만들자. 평면도 대로 mfc 구조 설계하고, 랙수랑 평수는 아래 적은대로"). 건물 45.4 × 29.2 m + 인계 돌출부 = 404평(그림 약 47.7 × 30.6 m 를 평수에 맞춰 줄임).
// 세종·춘천에서 사용자가 고친 것(입고·검수 남쪽 문 없음, 출하문 앞 비움, 인계·격리 랙은 벽에 세로, 고회전 F 는 패킹 쪽, 상온 격리는 벽 쪽 통로 두고)을 처음부터 따른다.
// 좌표 단위 m, x = 동쪽, z = 남쪽.
//
// 위(북)에서 본 배치(그림 그대로):
//   서쪽 두 방 = 냉장 B | 냉동 A (방마다 서쪽 벽 띠: 북쪽 입고재고 팔레트 2 → 보충재고 랙 10 → 남쪽 격리 1평), 피킹 랙은 남북 세로 줄, 가운데 가로 통로
//   북쪽 가운데 = 바깥 승강기 별동 16평(화물 승강기 2 + 하역 통로, 동쪽에 입고 차량) → 입고·검수
//   가운데 = 상온 C~H(줄마다 4 | 통로 | 4, 등 맞댄 8쌍), 그 남쪽 장바구니 대기·거치대·시작점
//   동쪽 = 휴게·사무 → 상온 입고창고(대형재고 10 → 입고재고 5 → 보충재고 랙 31, 상온 격리는 동쪽 벽) → 패킹(패킹대 4 | 4)
//   남쪽 = 인계 돌출부(인계 랙 2) → 건물 밖 라이더 대기

import type { TemperatureZone } from './contract';
import {
  PACK_TABLE_W,
  RACK_DEPTH,
  RACK_HEIGHT,
  RACK_LEN,
  RESERVE_SLOTS,
  SLOT_DESIGN,
  rackLocations,
  type DockSlot,
  type Layout,
  type Location,
  type Obstacle,
  type PackingStation,
  type Rack,
  type Rect,
  type ReserveSpot,
  type ShippingSlot,
  type SiteGeo,
  type StoreArea,
  type Wall,
  type Zone,
} from './layout';

/** 건물 폭·깊이(m) — 45.4 × 29.2 + 인계 돌출부 9.9 m² = 1,335.6 m² = 404평 */
export const BNG_W = 45.4;
export const BNG_BD = 29.2;
const BNG_D = 37.8;

/** 사용자 표(요청서 §3) 랙 수 [확정], 랙당 칸 = 1호점·세종 SLOT_DESIGN */
export const BUSAN_NAMGU_RACKS = { B: 109, A: 92, C: 21, D: 21, E: 18, F: 21, G: 22, H: 17, reserveCold: 10, reserveAmbient: 31 } as const;

const R = {
  B: { x0: 0, z0: 1.6, x1: 10.6, z1: 28.0 }, // 냉장 82.96 + 격리 1
  A: { x0: 10.7, z0: 1.6, x1: 21.3, z1: 28.0 }, // 냉동 82.96 + 격리 1
  // 입고·검수 17.46평 = 57.75 m² — 1.4 m 동쪽(냉동 벽과 사이 통로 1.1 → 2.5 m, 사용자 2026-11-24 "입고검수구역 동쪽으로 이동해. 입고검수랑 냉동 사이가 좁잖아"). 승강기·별동·하차 칸도 같이
  RCV: { x0: 23.8, z0: 0, x1: 34.8, z1: 5.25 },
  CH: { x0: 23.0, z0: 7.0, x1: 34.9, z1: 23.6 }, // 상온 C~H 60.25평(11.9 × 16.6 = 197.5 m²)
  OFF: { x0: 36.8, z0: 0, x1: BNG_W, z1: 2.35 }, // 휴게·사무 6.11평(8.6 × 2.35)
  WH: { x0: 36.8, z0: 2.35, x1: BNG_W, z1: 17.05 }, // 상온 입고창고 37.34 + 상온 격리 1(8.6 × 14.7)
  // 상온 격리 1평 — 입고창고 남쪽 벽 동쪽 끝 가로(2.8 × 1.18), 흰 랙 2 가로로 남쪽 벽에(사용자 2026-11-24 "상온구역에 보충재고에서 패킹쪽으로 나있는 문 없애고, 상온격리 랙 위치 가로로 돌려서 남쪽벽에 붙여")
  CQ: { x0: 42.5, z0: 15.85, x1: 45.3, z1: 17.03 },
  PK: { x0: 36.8, z0: 19.5, x1: BNG_W, z1: 25.34 }, // 패킹 15.19평 = 50.2 m²(8.6 × 5.84)
  SHIP: { x0: 36.3, z0: BNG_BD + 0.1, x1: 41.1, z1: BNG_BD + 1.88 }, // 인계 3평(돌출부 안)
  PARK: { x0: 33.2, z0: 34.0, x1: 44.2, z1: 37.4 }, // 라이더 대기 11.3평(건물 밖)
} as const satisfies Record<string, Rect>;

/** 인계 돌출부 5.0 × 1.98 m = 3평 */
const BUMP = { x0: 36.2, z0: BNG_BD, x1: 41.2, z1: BNG_BD + 1.98 } as const;
/** 냉장·냉동 서쪽 벽 띠 2.4 m(입고재고 팔레트 ~ 첫 피킹 줄 약 1.3 m — 춘천에서 사용자 "너무 가까운데" 반영) */
const BAND = { CHILLED: 0.1, FROZEN: 10.8, width: 2.4, mark: 1.4, z0: 1.6, reserveZ0: 4.6, qz0: 22.6, qz1: 25.6, qw: 1.1 } as const;
/** 화물 승강기 2(입고·검수 북쪽 벽) + 별동 16평(14.7 × 3.6 m, 동쪽 하역 통로 → 입고 차량) */
const LIFTS = [
  { x0: 24.0, x1: 27.0, door: [24.4, 26.6] as const },
  { x0: 27.1, x1: 30.1, door: [27.5, 29.7] as const },
] as const;
const ANNEX = { x0: 23.8, z0: -3.6, x1: 38.5, z1: 0, truckDoor: [-3.0, -0.6] as const } as const;

const ZONE_PY: Record<string, number> = { B: 82.96, A: 82.96, 'C-H': 60.25, WH: 37.34, RCV: 17.46, OFF: 6.11, PK: 15.19, AQ: 1, BQ: 1, CQ: 1, SHIP: 3 };

const dims = (g: string) => ({ levels: SLOT_DESIGN[g][0], slotsPerLevel: SLOT_DESIGN[g][1] });

export function buildBusanNamguLayout(): Layout {
  const zones: Zone[] = [
    { id: 'A', kind: 'FROZEN', label: '냉동 A', rect: R.A, docPyeong: ZONE_PY.A },
    { id: 'B', kind: 'CHILLED', label: '냉장 B', rect: R.B, docPyeong: ZONE_PY.B },
    { id: 'C-H', kind: 'AMBIENT', label: '상온 C~H', rect: R.CH, docPyeong: ZONE_PY['C-H'] },
    { id: 'WH', kind: 'INBOUND_STORE', label: '상온 입고창고', rect: R.WH, docPyeong: ZONE_PY.WH },
    { id: 'RCV', kind: 'RECEIVING', label: '입고·검수', rect: R.RCV, docPyeong: ZONE_PY.RCV },
    { id: 'OFF', kind: 'OFFICE', label: '휴게·사무', rect: R.OFF, docPyeong: ZONE_PY.OFF },
    { id: 'PK', kind: 'PACKING', label: '패킹', rect: R.PK, docPyeong: ZONE_PY.PK },
    { id: 'AQ', kind: 'QUARANTINE', label: '냉동 격리', rect: { x0: BAND.FROZEN, z0: BAND.qz0, x1: BAND.FROZEN + BAND.qw, z1: BAND.qz1 }, docPyeong: 1 },
    { id: 'BQ', kind: 'QUARANTINE', label: '냉장 격리', rect: { x0: BAND.CHILLED, z0: BAND.qz0, x1: BAND.CHILLED + BAND.qw, z1: BAND.qz1 }, docPyeong: 1 },
    { id: 'CQ', kind: 'QUARANTINE', label: '상온 격리', rect: R.CQ, docPyeong: 1 },
    { id: 'SHIP', kind: 'SHIPPING', label: '인계', rect: R.SHIP, docPyeong: ZONE_PY.SHIP },
    { id: 'PARK', kind: 'PARKING', label: '라이더 대기', rect: R.PARK },
  ];

  // ── 랙 ──────────────────────────────────────────────
  // 냉장·냉동 피킹: 한 줄 19랙(북쪽 10 | 가로 통로 1.4 m | 남쪽 9, z 2.2~27.35). 그룹 = 물리 줄(B01~B06, A01~A05), 랙 번호 1~19 [시뮬]
  const COLD_Z0 = 2.2;
  const coldAlong = [
    ...Array.from({ length: 10 }, (_, i) => COLD_Z0 + RACK_LEN * (i + 0.5)),
    ...Array.from({ length: 9 }, (_, i) => COLD_Z0 + 10 * RACK_LEN + 1.4 + RACK_LEN * (i + 0.5)),
  ];
  const coldRows = (x0: number, x1: number, pattern: ('S+' | 'P' | 'S-')[]) => {
    const nRows = pattern.reduce((n, p) => n + (p === 'P' ? 2 : 1), 0);
    const aisle = (x1 - x0 - nRows * RACK_DEPTH) / (pattern.length - (pattern[pattern.length - 1] === 'S-' ? 1 : 0));
    const rows: { c: number; face: 1 | -1 }[] = [];
    const aisles: [number, number][] = [];
    let x = x0;
    for (const p of pattern) {
      if (p === 'S+') {
        rows.push({ c: x + RACK_DEPTH / 2, face: 1 });
        x += RACK_DEPTH;
      } else if (p === 'P') {
        rows.push({ c: x + RACK_DEPTH / 2, face: -1 }, { c: x + RACK_DEPTH * 1.5, face: 1 });
        x += 2 * RACK_DEPTH;
      } else {
        rows.push({ c: x + RACK_DEPTH / 2, face: -1 });
        x += RACK_DEPTH;
      }
      if (p !== 'S-') {
        aisles.push([x, x + aisle]);
        x += aisle;
      }
    }
    return { rows, aisles };
  };
  const coldRacks = (temp: TemperatureZone, g: 'A' | 'B', rows: { c: number; face: 1 | -1 }[], target: number, prefix: string): Rack[] => {
    const out: Rack[] = [];
    rows.forEach((row, ri) => {
      coldAlong.forEach((z, k) => {
        if (out.length >= target) return;
        out.push({ id: `${prefix}-${out.length + 1}`, temp, group: `${g}${String(ri + 1).padStart(2, '0')}`, rackNo: k + 1, cx: row.c, cz: z, along: 'z', face: row.face, ...dims(g) });
      });
    });
    return out;
  };
  // 냉장 B 109 = 6줄(홑줄 + 등 맞댄 2쌍 + 동쪽 벽 홑줄) × 19 − 5, 냉동 A 92 = 5줄(홑줄 + 등 맞댄 2쌍) × 19 − 3
  const bRows = coldRows(BAND.CHILLED + BAND.width + 0.1, R.B.x1 - 0.1, ['S+', 'P', 'P', 'S-']);
  const aRows = coldRows(BAND.FROZEN + BAND.width + 0.1, R.A.x1 - 0.1, ['S+', 'P', 'P']);
  const chilled = coldRacks('CHILLED', 'B', bRows.rows, BUSAN_NAMGU_RACKS.B, 'RB');
  const frozen = coldRacks('FROZEN', 'A', aRows.rows, BUSAN_NAMGU_RACKS.A, 'RA');

  // 상온 C~H 120: 가로(동서) 줄마다 4 | 가운데 통로 1.5 m | 4, 등 맞댄 8쌍(통로 1.2 m). 남쪽 줄부터 F → G → C → D → E → H
  // (고회전 F 는 패킹·장바구니 거치대 쪽 — 사용자 2026-11-24 "고회전F열이 패킹대에 제일 가까이"). 칸 코드 줄 = 4랙 묶음, 그룹 안 남쪽부터, 랙 번호는 묶음 안 서쪽부터 [시뮬]
  const ambient: Rack[] = [];
  {
    const PER = 4;
    const GAP = 1.5;
    const AISLE = 1.2;
    const PAIRS = 8;
    const rowW = 2 * PER * RACK_LEN + GAP;
    const x0 = (R.CH.x0 + R.CH.x1) / 2 - rowW / 2;
    const unitXs = [0, 1].map((u) => Array.from({ length: PER }, (_, i) => x0 + u * (PER * RACK_LEN + GAP) + (i + 0.5) * RACK_LEN));
    const depth = PAIRS * 2 * RACK_DEPTH + (PAIRS - 1) * AISLE;
    const z0 = (R.CH.z0 + R.CH.z1) / 2 - depth / 2;
    const rows: { cz: number; face: 1 | -1 }[] = [];
    for (let p = 0; p < PAIRS; p++) {
      const zz = z0 + p * (2 * RACK_DEPTH + AISLE);
      rows.push({ cz: zz + RACK_DEPTH / 2, face: -1 }, { cz: zz + RACK_DEPTH * 1.5, face: 1 });
    }
    rows.reverse(); // 남쪽 줄부터
    const slots = rows.flatMap((row) => unitXs.flatMap((xs, u) => xs.map((x) => ({ x, ...row, unit: `${row.cz.toFixed(3)}:${u}` }))));
    let k = 0;
    for (const [g, n] of [['F', BUSAN_NAMGU_RACKS.F], ['G', BUSAN_NAMGU_RACKS.G], ['C', BUSAN_NAMGU_RACKS.C], ['D', BUSAN_NAMGU_RACKS.D], ['E', BUSAN_NAMGU_RACKS.E], ['H', BUSAN_NAMGU_RACKS.H]] as const) {
      const rowNo = new Map<string, number>();
      const perUnit = new Map<string, number>();
      for (let i = 0; i < n; i++, k++) {
        const s = slots[k];
        if (!rowNo.has(s.unit)) rowNo.set(s.unit, rowNo.size + 1);
        perUnit.set(s.unit, (perUnit.get(s.unit) ?? 0) + 1);
        ambient.push({ id: `RC-${k + 1}`, temp: 'AMBIENT', group: `${g}${String(rowNo.get(s.unit)).padStart(2, '0')}`, rackNo: perUnit.get(s.unit)!, cx: s.x, cz: s.cz, along: 'x', face: s.face, ...dims(g) });
      }
    }
  }

  // 보충재고 랙(15칸) — 냉장·냉동 서쪽 벽 띠 한 줄 10, 입고창고 가로 6랙 × 6줄(등 맞댄 3쌍) 중 31
  const reserve: Rack[] = [];
  for (const [temp, X0, prefix] of [['FROZEN', BAND.FROZEN, 'RRF'], ['CHILLED', BAND.CHILLED, 'RRC']] as const) {
    for (let i = 0; i < BUSAN_NAMGU_RACKS.reserveCold; i++) {
      reserve.push({ id: `${prefix}-${i + 1}`, temp, group: 'R01', rackNo: i + 1, cx: X0 + 0.05 + RACK_DEPTH / 2, cz: BAND.reserveZ0 + RACK_LEN * (i + 0.5), along: 'z', face: 1, levels: RESERVE_SLOTS[0], slotsPerLevel: RESERVE_SLOTS[1], reserve: true });
    }
  }
  {
    // 입고창고: 맨 안쪽(북쪽, 휴게·사무 벽) 대형재고 → 입고재고 → 보충재고 랙 3쌍(문 쪽 남쪽). 서쪽 벽 안쪽 통로 0.8 m, 동쪽은 상온 격리와 통로 0.7 m
    const xs = Array.from({ length: 6 }, (_, i) => R.WH.x0 + 0.8 + (i + 0.5) * RACK_LEN);
    const rows: { cz: number; face: 1 | -1 }[] = [];
    // 0.4 m 남쪽 — 입고재고 팔레트와 간격(사용자 2026-11-24 "보충재고 랙 위치 전부 살짝 남쪽으로. 입고재고랑 너무 붙어있네")
    for (const zz of [9.7, 11.8, 13.9]) rows.push({ cz: zz + RACK_DEPTH / 2, face: -1 }, { cz: zz + RACK_DEPTH * 1.5, face: 1 });
    let n = 0;
    for (const row of rows) for (const x of xs) if (n < BUSAN_NAMGU_RACKS.reserveAmbient) reserve.push({ id: `RRA-${++n}`, temp: 'AMBIENT', group: 'R01', rackNo: n, cx: x, cz: row.cz, along: 'x', face: row.face, levels: RESERVE_SLOTS[0], slotsPerLevel: RESERVE_SLOTS[1], reserve: true });
  }

  const racks = [...frozen, ...chilled, ...ambient, ...reserve];
  const locations: Location[] = racks.flatMap(rackLocations);
  const locationsByTemp: Record<TemperatureZone, Location[]> = { AMBIENT: [], CHILLED: [], FROZEN: [] };
  for (const l of locations) if (!l.reserve) locationsByTemp[l.temp].push(l);

  // ── 벽 ─────────────────────────────────────────────
  const T = 0.2;
  const H = 3.0;
  const walls: Wall[] = [];
  const hWall = (z: number, x0: number, x1: number, doors: (readonly [number, number])[] = [], height = H) => {
    let cur = x0;
    for (const [d0, d1] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (d0 > cur) walls.push({ rect: { x0: cur, z0: z - T / 2, x1: d0, z1: z + T / 2 }, height });
      cur = d1;
    }
    if (cur < x1) walls.push({ rect: { x0: cur, z0: z - T / 2, x1, z1: z + T / 2 }, height });
  };
  const vWall = (x: number, z0: number, z1: number, doors: (readonly [number, number])[] = []) => {
    let cur = z0;
    for (const [d0, d1] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (d0 > cur) walls.push({ rect: { x0: x - T / 2, z0: cur, x1: x + T / 2, z1: d0 }, height: H });
      cur = d1;
    }
    if (cur < z1) walls.push({ rect: { x0: x - T / 2, z0: cur, x1: x + T / 2, z1 }, height: H });
  };
  const SHIP_DOOR: readonly [number, number] = [37.6, 39.8];
  hWall(0, 0, BNG_W, LIFTS.map((l) => l.door));
  hWall(BNG_BD, 0, BNG_W, [SHIP_DOOR]);
  vWall(0, 0, BNG_BD);
  vWall(BNG_W, 0, BNG_BD);
  vWall(BUMP.x0 + T / 2, BNG_BD, BUMP.z1);
  vWall(BUMP.x1 - T / 2, BNG_BD, BUMP.z1);
  hWall(BUMP.z1 - T / 2, BUMP.x0, BUMP.x1, [], 1.1);
  const door = (a: [number, number]) => [(a[0] + a[1]) / 2 - 0.9, (a[0] + a[1]) / 2 + 0.9] as const;
  const bDoor = door(bRows.aisles[0]);
  const aDoor = door(aRows.aisles[0]);
  hWall(R.B.z0 - 0.1, 0, R.A.x1, [bDoor, aDoor]);
  vWall(R.B.x1 + 0.05, R.B.z0 - 0.1, R.B.z1 + 0.1);
  vWall(R.A.x1, R.B.z0 - 0.1, R.B.z1 + 0.1);
  hWall(R.B.z1 + 0.1, 0, R.A.x1, [bDoor, aDoor]);
  // 입고·검수: 서쪽 문(북쪽 통로 → 냉장·냉동), 동쪽 문(휴게·사무·입고창고 쪽). 남쪽 문 없음(세종·춘천 사용자 결정과 같게)
  vWall(R.RCV.x0, 0, R.RCV.z1 + 0.1, [[0.1, 1.5]]);
  hWall(R.RCV.z1 + 0.1, R.RCV.x0, R.RCV.x1);
  vWall(R.RCV.x1, 0, R.RCV.z1 + 0.1, [[2.4, 4.4]]);
  // 휴게·사무 / 입고창고(서쪽 벽 문: 휴게·사무, 대형재고·입고재고 앞, 남쪽 보충재고 끝)
  vWall(R.WH.x0, 0, R.WH.z1, [[0.3, 1.9], [6.2, 8.2], [15.2, 16.9]]);
  hWall(R.OFF.z1, R.OFF.x0, BNG_W);
  hWall(R.WH.z1, R.WH.x0, BNG_W); // 남쪽(패킹 쪽) 문 없음 — 사용자 2026-11-24 "상온구역에 보충재고에서 패킹쪽으로 나있는 문 없애고, 상온격리 랙 위치 가로로 돌려서 남쪽벽에 붙여"
  // 승강기 별동
  vWall(ANNEX.x0, ANNEX.z0, 0);
  hWall(ANNEX.z0, ANNEX.x0, ANNEX.x1);
  vWall(ANNEX.x1, ANNEX.z0, 0, [ANNEX.truckDoor]);
  const yardX = [33.0, 45.0] as const;
  walls.push({ rect: { x0: yardX[0] - 0.15, z0: BNG_BD, x1: yardX[0], z1: BNG_D }, height: 1.0 });
  walls.push({ rect: { x0: yardX[1], z0: BNG_BD, x1: yardX[1] + 0.15, z1: BNG_D }, height: 1.0 });

  // ── 팔레트 자리·장애물 ──────────────────────────────────
  const obstacles: Obstacle[] = [];
  const reserves: ReserveSpot[] = [];
  const P = 1.1;
  const addReserve = (id: string, temp: TemperatureZone, x0: number, z0: number, stand: { x: number; z: number }, role: ReserveSpot['role']) => {
    const rect = { x0, z0, x1: x0 + P, z1: z0 + P };
    reserves.push({ id, temp, rect, stand, role });
    obstacles.push({ rect, height: 0.15, kind: 'RESERVE' });
  };
  for (const [temp, X0, rid] of [['FROZEN', BAND.FROZEN, 'AR'], ['CHILLED', BAND.CHILLED, 'BR']] as const) {
    [1.85, 3.1].forEach((z0, j) => addReserve(`${rid}-${j + 3}`, temp, X0 + 0.1, z0, { x: X0 + 1.8, z: 3.0 }, 'RECEIVING'));
  }
  // 대형재고 10(5 | 5, 맨 안쪽 북쪽) → A-R2-01~10-1-01, 열마다 북 → 남, 서쪽 열부터
  {
    let n = 0;
    for (let c = 0; c < 5; c++) {
      const x0 = R.WH.x0 + 0.8 + c * 1.5;
      for (const z0 of [2.65, 4.55]) addReserve(`WB-${String(++n).padStart(2, '0')}`, 'AMBIENT', x0, z0, { x: x0 + P / 2, z: z0 + P + 0.4 }, 'BULK');
    }
  }
  // 상온 입고재고 5 → RCV-A-02
  for (let c = 0; c < 5; c++) {
    const x0 = R.WH.x0 + 0.8 + c * 1.5;
    addReserve(`WR-${String(c + 1).padStart(2, '0')}`, 'AMBIENT', x0, 6.55, { x: x0 + P / 2, z: 8.1 }, 'RECEIVING');
  }
  // 휴게·사무 테이블(북쪽 벽, 의자 남쪽 — 세종에서 사용자 "북쪽 벽으로")
  const officeTable = { x: (R.OFF.x0 + R.OFF.x1) / 2, z: R.OFF.z0 + 0.4, w: 3.6, d: 0.5, h: 0.74 };
  obstacles.push({ rect: { x0: officeTable.x - 1.8, z0: R.OFF.z0 + 0.1, x1: officeTable.x + 1.8, z1: R.OFF.z0 + 1.35 }, height: 0.75, kind: 'TABLE' });

  const dockSlots: DockSlot[] = [];
  for (const z of [1.9, 2.6, 3.6, 4.3]) for (let c = 0; c < 9; c++) dockSlots.push({ id: `DK-${dockSlots.length + 1}`, pos: { x: 24.6 + c * 0.75, z } });

  // 패킹대 8 = 4 | 4
  const stations: PackingStation[] = [];
  const gap = (R.PK.x1 - R.PK.x0 - 0.6 - 4 * PACK_TABLE_W) / 3;
  for (let i = 0; i < 8; i++) {
    const top = i < 4;
    const tx = R.PK.x0 + 0.3 + PACK_TABLE_W / 2 + (i % 4) * (PACK_TABLE_W + gap);
    const tz = top ? R.PK.z0 + 0.65 : R.PK.z1 - 0.65;
    stations.push({ id: `PS-${i + 1}`, index: i, table: { x: tx, z: tz }, stand: { x: tx, z: top ? tz + 1.2 : tz - 1.2 } });
    obstacles.push({ rect: { x0: tx - PACK_TABLE_W / 2, z0: tz - 0.4, x1: tx + PACK_TABLE_W / 2, z1: tz + 0.4 }, height: 0.9, kind: 'TABLE' });
  }

  // 인계 랙 2 — 세로로 돌출부 서·동 벽에(출하문 앞 비움)
  const shippingSlots: ShippingSlot[] = [];
  const shipCz = BUMP.z0 + 0.15 + RACK_LEN / 2;
  [BUMP.x0 + 0.15 + RACK_DEPTH / 2, BUMP.x1 - 0.15 - RACK_DEPTH / 2].forEach((x, ri) => {
    obstacles.push({ rect: { x0: x - RACK_DEPTH / 2, z0: shipCz - RACK_LEN / 2, x1: x + RACK_DEPTH / 2, z1: shipCz + RACK_LEN / 2 }, height: RACK_HEIGHT, kind: 'SHIP_RACK' });
    for (let lv = 0; lv < 4; lv++) for (let s = 0; s < 4; s++) shippingSlots.push({ id: `SR${ri + 1}-${lv + 1}${s + 1}`, rackIndex: ri, pos: { x, y: 0.25 + lv * 0.5, z: shipCz - 0.45 + s * 0.3 } });
  });

  // ── 바닥 표시 ───────────────────────────────────────
  const coldArea = (X0: number, color: 'FROZEN' | 'CHILLED'): StoreArea => {
    const X1 = X0 + BAND.mark;
    const rackEnd = BAND.reserveZ0 + BUSAN_NAMGU_RACKS.reserveCold * RACK_LEN + 0.25;
    const L0 = X0 + 0.12, L1 = X1 - 0.12, Tz = BAND.z0 + 0.12, Bz = rackEnd - 0.12, DIV = (4.3 + BAND.reserveZ0) / 2;
    return {
      floor: [X0, BAND.z0, X1, rackEnd],
      color,
      lines: [[L0, Tz, L1, Tz], [L0, Bz, L1, Bz], [L0, Tz, L0, Bz], [L1, Tz, L1, Bz], [L0, DIV, L1, DIV]],
      texts: [
        { t: '입고', x: (X0 + X1) / 2, z: 4.1 },
        { t: '보충', x: X0 + 0.95, z: (BAND.reserveZ0 + rackEnd) / 2 },
      ],
    };
  };
  const WHL = R.WH.x0 + 0.12, WHR = R.WH.x1 - 0.12;
  const storeAreas: StoreArea[] = [
    coldArea(BAND.FROZEN, 'FROZEN'),
    coldArea(BAND.CHILLED, 'CHILLED'),
    {
      floor: [R.WH.x0, R.WH.z0 + 0.1, R.WH.x1, R.WH.z1],
      lines: [[WHL, 6.3, WHR, 6.3], [WHL, 9.0, WHR, 9.0]], // 대형재고 | 입고재고 | 보충재고
      texts: [
        { t: '대형재고', x: (R.WH.x0 + R.WH.x1) / 2, z: 6.05 },
        { t: '입고재고', x: (R.WH.x0 + R.WH.x1) / 2, z: 8.6 },
        { t: '보충재고', x: R.WH.x0 + 3.6, z: 16.4 },
      ],
    },
  ];

  // ── 점 ───────────────────────────────────────────────
  // 장바구니 거치대 — 상온 C~H 남쪽 앞, 가로 한 줄(그림 "장비대기·거치대·시작점"), 되돌릴 상품 탁자는 시작점 줄 서쪽 끝 옆, 대기 작업자는 그 북쪽
  const cartDepot = { x: 33.0, z: 26.4 };
  const points: Layout['points'] = {
    truckDoor: { x: (LIFTS[0].door[1] + LIFTS[1].door[0]) / 2, z: 0.9 },
    truckDock: { x: ANNEX.x1 + 0.3 + 3.2, z: (ANNEX.truckDoor[0] + ANNEX.truckDoor[1]) / 2 },
    inboundIdle: Array.from({ length: 8 }, (_, i) => ({ x: 30.6 + (i % 4) * 0.8, z: 4.0 + Math.floor(i / 4) * 0.7 })),
    cartDepot,
    idle: Array.from({ length: 24 }, (_, i) => ({ x: 23.6 + (i % 12) * 0.9, z: 24.3 + Math.floor(i / 12) * 0.7 })),
    packQueue: { x: R.PK.x0 + 0.5, z: (R.PK.z0 + R.PK.z1) / 2 },
    shipDrop: { x: (SHIP_DOOR[0] + SHIP_DOOR[1]) / 2, z: BNG_BD - 0.4 },
    riderPickup: { x: (BUMP.x0 + BUMP.x1) / 2, z: BUMP.z1 + 0.55 },
    riderParking: Array.from({ length: 9 }, (_, i) => ({ x: 33.8 + i * 1.2, z: 35.6 })),
    riderEntry: { x: 38.7, z: 37.4 },
  };

  const geo: SiteGeo = {
    yardX,
    liftAnnex: ANNEX,
    freightLifts: LIFTS,
    liftZ0: ANNEX.z0,
    returnIntake: { x: 43.0, z: 31.8 },
    storeAreas,
    officeTable,
    rollContainers: [33.0, 33.8].map((x) => ({ x, z: 4.6 })),
    quarantineRacks: {
      ...Object.fromEntries((['AQ', 'BQ'] as const).map((id) => {
        const X0 = id === 'AQ' ? BAND.FROZEN : BAND.CHILLED;
        return [id, [0, 1].map((i) => ({ x0: X0 + 0.2, z0: BAND.qz0 + 0.2 + i * (RACK_LEN + 0.15), x1: X0 + 0.2 + RACK_DEPTH, z1: BAND.qz0 + 0.2 + i * (RACK_LEN + 0.15) + RACK_LEN }))];
      })),
      CQ: [0, 1].map((i) => ({ x0: R.CQ.x0 + 0.1 + i * (RACK_LEN + 0.1), z0: R.CQ.z1 - 0.05 - RACK_DEPTH, x1: R.CQ.x0 + 0.1 + i * (RACK_LEN + 0.1) + RACK_LEN, z1: R.CQ.z1 - 0.05 })),
    },
    cartDepotVertical: false,
    returnTable: { x: cartDepot.x + 0.7 - 19 * 0.28 - 0.32 - 0.05 - 0.55, z: cartDepot.z - 0.6 },
  };

  return {
    variant: 'BUSAN_NAMGU',
    geo,
    width: BNG_W,
    depth: BNG_D,
    buildingDepth: BNG_BD,
    zones,
    walls,
    racks,
    locations,
    locationsByTemp,
    obstacles,
    stations,
    shippingSlots,
    reserves,
    reserveRackSpots: racks
      .filter((r) => r.reserve)
      .map((r) => {
        const hx = r.along === 'x' ? RACK_LEN / 2 : RACK_DEPTH / 2;
        const hz = r.along === 'x' ? RACK_DEPTH / 2 : RACK_LEN / 2;
        const off = RACK_DEPTH / 2 + 0.35;
        const stand = r.along === 'z' ? { x: r.cx + r.face * off, z: r.cz } : { x: r.cx, z: r.cz + r.face * off };
        return { id: r.id, temp: r.temp, rect: { x0: r.cx - hx, z0: r.cz - hz, x1: r.cx + hx, z1: r.cz + hz }, stand, role: 'RESERVE' as const, rack: r };
      }),
    dockSlots,
    points,
  };
}
