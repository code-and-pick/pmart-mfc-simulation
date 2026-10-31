// 가상 MFC 평면 배치.
// 면적·랙 규격·패킹대 규격은 MFC-business-logic.md 1장(463평) 을 따른다. 실측 도면이 없어(문서 7-5 "현장 실측 도면 아님")
// 구역의 위치·모양·문 위치는 이 시뮬레이터의 가정이다. 좌표 단위는 m, x=동쪽, z=남쪽(화면 아래), y=높이.

import type { TemperatureZone } from './contract';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type ZoneKind =
  | 'FROZEN'
  | 'CHILLED'
  | 'AMBIENT'
  | 'INBOUND_STORE'
  | 'RECEIVING'
  | 'OFFICE'
  | 'PACKING'
  | 'QUARANTINE'
  | 'SHIPPING'
  | 'PARKING';

export interface Zone {
  id: string;
  kind: ZoneKind;
  label: string;
  rect: Rect;
  /** 문서 면적(평). 배치 면적과 다를 수 있다. */
  docPyeong?: number;
}

export interface Rack {
  id: string;
  temp: TemperatureZone;
  group: string; // 예: B04, C01
  rackNo: number;
  cx: number;
  cz: number;
  /** 랙 긴 변(1.25m)이 놓인 축 */
  along: 'x' | 'z';
  /** 피킹 면이 향하는 방향(+1/-1, along 의 수직축) */
  face: 1 | -1;
  levels: number;
  slotsPerLevel: number;
}

export interface Location {
  /** 로케이션 코드. 문서 8-2 가설 `B04-02-205`(구역·그룹 / 랙 / 단·슬롯) 형식 */
  code: string;
  rackId: string;
  temp: TemperatureZone;
  level: number;
  slot: number;
  /** 작업자가 서는 지점(통로) */
  pick: { x: number; z: number };
  /** 선반 위 실제 위치(표시용) */
  shelf: { x: number; y: number; z: number };
}

export interface PackingStation {
  id: string;
  index: number;
  table: { x: number; z: number };
  stand: { x: number; z: number };
  /** 포장 완료 봉투를 잠시 두는 자리 */
}

export interface ShippingSlot {
  id: string;
  rackIndex: number;
  pos: { x: number; y: number; z: number };
}

export interface Wall {
  rect: Rect;
  height: number;
  glass?: boolean;
}

export interface Obstacle {
  rect: Rect;
  height: number;
  kind: 'PALLET' | 'TABLE' | 'SHIP_RACK' | 'MATERIAL';
}

export interface Layout {
  width: number;
  depth: number; // 외부 앞마당 포함
  buildingDepth: number;
  zones: Zone[];
  walls: Wall[];
  racks: Rack[];
  locations: Location[];
  locationsByTemp: Record<TemperatureZone, Location[]>;
  obstacles: Obstacle[];
  stations: PackingStation[];
  shippingSlots: ShippingSlot[];
  points: {
    cartDepot: { x: number; z: number };
    idle: { x: number; z: number }[];
    packQueue: { x: number; z: number };
    shipDrop: { x: number; z: number };
    riderPickup: { x: number; z: number };
    riderParking: { x: number; z: number }[];
    riderEntry: { x: number; z: number };
  };
}

export const RACK_LEN = 1.25;
export const RACK_DEPTH = 0.45;
export const RACK_HEIGHT = 2.1;
const AISLE = 0.7;

const W = 48;
const BD = 32; // 건물 깊이
const D = 40;

/** 랙 블록 채우기: 등을 맞댄 두 줄(0.9m) + 통로 0.7m 를 반복한다. */
function fillRacks(opts: {
  temp: TemperatureZone;
  area: Rect;
  along: 'x' | 'z';
  /** along 축으로 이 위치에 횡단 통로(폭 1.4m)를 둔다 */
  crossAisleAt?: number;
  target: number;
  levels: number;
  slotsPerLevel: number;
  /** 줄 → 그룹 코드 */
  groupOf: (rowIndex: number, rackIndexInZone: number) => string;
  /** 줄 순서 우선: 낮을수록 먼저 채운다(문 가까운 줄부터) */
  rowPriority?: (rowCross: number) => number;
  idPrefix: string;
}): Rack[] {
  const { area, along } = opts;
  const crossMin = along === 'z' ? area.x0 : area.z0;
  const crossMax = along === 'z' ? area.x1 : area.z1;
  const alongMin = along === 'z' ? area.z0 : area.x0;
  const alongMax = along === 'z' ? area.z1 : area.x1;

  // 줄의 cross 좌표(랙 중심)와 피킹 면
  const rows: { c: number; face: 1 | -1 }[] = [];
  let c = crossMin;
  while (c + 2 * RACK_DEPTH <= crossMax + 1e-6) {
    rows.push({ c: c + RACK_DEPTH / 2, face: -1 });
    rows.push({ c: c + RACK_DEPTH * 1.5, face: 1 });
    c += 2 * RACK_DEPTH + AISLE;
  }
  // along 방향 랙 위치
  const slotsAlong: number[] = [];
  const segments: [number, number][] =
    opts.crossAisleAt !== undefined
      ? [
          [alongMin, opts.crossAisleAt - 0.7],
          [opts.crossAisleAt + 0.7, alongMax],
        ]
      : [[alongMin, alongMax]];
  for (const [a0, a1] of segments) {
    const n = Math.floor((a1 - a0) / RACK_LEN);
    for (let i = 0; i < n; i++) slotsAlong.push(a0 + RACK_LEN * (i + 0.5));
  }

  const order = rows.map((r, i) => ({ ...r, i }));
  if (opts.rowPriority) {
    // 등을 맞댄 두 줄은 같이 채운다
    order.sort((a, b) => {
      const pa = opts.rowPriority!(rows[a.i - (a.i % 2)].c);
      const pb = opts.rowPriority!(rows[b.i - (b.i % 2)].c);
      return pa - pb || a.i - b.i;
    });
  }

  const racks: Rack[] = [];
  let rowOrdinal = 0;
  for (const row of order) {
    if (racks.length >= opts.target) break;
    rowOrdinal += 1;
    let rackNo = 0;
    for (const a of slotsAlong) {
      if (racks.length >= opts.target) break;
      rackNo += 1;
      const group = opts.groupOf(rowOrdinal - 1, racks.length);
      racks.push({
        id: `${opts.idPrefix}-${racks.length + 1}`,
        temp: opts.temp,
        group,
        rackNo,
        cx: along === 'z' ? row.c : a,
        cz: along === 'z' ? a : row.c,
        along,
        face: row.face,
        levels: opts.levels,
        slotsPerLevel: opts.slotsPerLevel,
      });
    }
  }
  return racks;
}

/** 상온 C~H 랙 수: 문서 10장 구역 면적(11.3/11.3/9.9/11.3/11.8/9.4평) 비례로 138개 [가정] */
const AMBIENT_GROUPS: [string, number][] = [
  ['C', 24],
  ['D', 24],
  ['E', 21],
  ['F', 24],
  ['G', 25],
  ['H', 20],
];

function ambientGroupOf(rackIndex: number): string {
  let acc = 0;
  for (const [g, n] of AMBIENT_GROUPS) {
    acc += n;
    if (rackIndex < acc) return g;
  }
  return 'H';
}

export function buildLayout(): Layout {
  const zones: Zone[] = [
    { id: 'A', kind: 'FROZEN', label: '냉동 A', rect: { x0: 0, z0: 0, x1: 12, z1: 30 }, docPyeong: 109 },
    { id: 'B', kind: 'CHILLED', label: '냉장 B', rect: { x0: 12.2, z0: 0, x1: 23, z1: 30 }, docPyeong: 100 },
    { id: 'C-H', kind: 'AMBIENT', label: '상온 C~H', rect: { x0: 23.2, z0: 0, x1: 37, z1: 15.4 }, docPyeong: 65 },
    { id: 'WH', kind: 'INBOUND_STORE', label: '입고창고', rect: { x0: 37.2, z0: 0, x1: 48, z1: 16.5 }, docPyeong: 55 },
    { id: 'RCV', kind: 'RECEIVING', label: '입고·검수', rect: { x0: 37.2, z0: 16.7, x1: 48, z1: 23 }, docPyeong: 22 },
    { id: 'OFF', kind: 'OFFICE', label: '휴게·사무', rect: { x0: 37.2, z0: 23.2, x1: 48, z1: 28.6 }, docPyeong: 18 },
    { id: 'PK', kind: 'PACKING', label: '패킹', rect: { x0: 25, z0: 20.5, x1: 35, z1: 28.5 }, docPyeong: 24 },
    { id: 'AQ', kind: 'QUARANTINE', label: '냉동 격리', rect: { x0: 0.2, z0: 26.6, x1: 3.8, z1: 29.8 }, docPyeong: 4 },
    { id: 'BQ', kind: 'QUARANTINE', label: '냉장 격리', rect: { x0: 12.4, z0: 26.6, x1: 16, z1: 29.8 }, docPyeong: 4 },
    { id: 'CQ', kind: 'QUARANTINE', label: '상온 격리', rect: { x0: 44.4, z0: 12.9, x1: 47.8, z1: 16.3 }, docPyeong: 4 },
    { id: 'SHIP', kind: 'SHIPPING', label: '외부 출하대기', rect: { x0: 27, z0: 32.4, x1: 33, z1: 35 }, docPyeong: 3 },
    { id: 'PARK', kind: 'PARKING', label: '라이더 대기', rect: { x0: 24, z0: 36.5, x1: 36, z1: 39.6 } },
  ];

  const T = 0.2; // 벽 두께
  const H = 3.0;
  const walls: Wall[] = [];
  const hWall = (z: number, x0: number, x1: number, doors: [number, number][] = [], glass = false) => {
    let cur = x0;
    for (const [d0, d1] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (d0 > cur) walls.push({ rect: { x0: cur, z0: z - T / 2, x1: d0, z1: z + T / 2 }, height: H, glass });
      cur = d1;
    }
    if (cur < x1) walls.push({ rect: { x0: cur, z0: z - T / 2, x1, z1: z + T / 2 }, height: H, glass });
  };
  const vWall = (x: number, z0: number, z1: number, doors: [number, number][] = [], glass = false) => {
    let cur = z0;
    for (const [d0, d1] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (d0 > cur) walls.push({ rect: { x0: x - T / 2, z0: cur, x1: x + T / 2, z1: d0 }, height: H, glass });
      cur = d1;
    }
    if (cur < z1) walls.push({ rect: { x0: x - T / 2, z0: cur, x1: x + T / 2, z1 }, height: H, glass });
  };

  // 외벽: 출하 인계문(남쪽), 입고 차량문(동쪽)
  hWall(0, 0, W);
  hWall(BD, 0, W, [[28.8, 31.2]]);
  vWall(0, 0, BD);
  vWall(W, 0, BD, [[18, 21.5]]);
  // 냉동 A / 냉장 B 실 (저온실은 벽으로 닫고 문 하나씩)
  vWall(12.1, 0, 30);
  hWall(30.1, 0, 12.1, [[5, 7]]);
  hWall(30.1, 12.1, 23.1, [[16.8, 18.8]]);
  vWall(23.1, 0, 30.1, [[17, 19]]);
  // 상온 ↔ 입고창고 (보충 통로)
  vWall(37.1, 0, 16.6, [[11.8, 14.2]]);
  hWall(16.6, 37.1, W, [[40, 42]]);
  vWall(37.1, 16.6, 28.7, [[18.4, 20.6]]);
  hWall(23.1, 37.1, W, [[44, 45.5]]);
  hWall(28.7, 37.1, W, [[40, 41.6]]);
  // 패킹실 (위: 피킹구역에서 장바구니 진입, 아래: 출하 인계문 방향)
  hWall(20.5, 25, 35, [[33.0, 34.8]], true);
  hWall(28.5, 25, 35, [[33.0, 34.8]], true);
  vWall(25, 20.5, 28.5, [], true);
  vWall(35, 20.5, 28.5, [], true);
  // 외부 앞마당 경계(낮은 울타리)
  const fence = 1.0;
  walls.push({ rect: { x0: 20, z0: 32, x1: 20.15, z1: D }, height: fence });
  walls.push({ rect: { x0: 39.85, z0: 32, x1: 40, z1: D }, height: fence });

  // ── 랙 ──────────────────────────────────────────────
  // 냉동 A 105개, 냉장 B 125개, 상온 138개 (문서 4-2, 3-1 계획 배치 [산출·가정])
  const frozen = fillRacks({
    temp: 'FROZEN',
    area: { x0: 1.0, z0: 1.0, x1: 11.2, z1: 25.6 },
    along: 'z',
    crossAisleAt: 13,
    target: 105,
    levels: 5,
    slotsPerLevel: 3,
    groupOf: (row) => `A${String(row + 1).padStart(2, '0')}`,
    rowPriority: (c) => Math.abs(c - 6),
    idPrefix: 'RA',
  });
  const chilled = fillRacks({
    temp: 'CHILLED',
    area: { x0: 13.2, z0: 1.0, x1: 22.2, z1: 25.6 },
    along: 'z',
    crossAisleAt: 13,
    target: 125,
    levels: 5,
    slotsPerLevel: 3,
    groupOf: (row) => `B${String(row + 1).padStart(2, '0')}`,
    rowPriority: (c) => Math.abs(c - 17.8),
    idPrefix: 'RB',
  });
  const ambientRaw = fillRacks({
    temp: 'AMBIENT',
    area: { x0: 24.0, z0: 0.8, x1: 36.4, z1: 14.6 },
    along: 'x',
    target: 138,
    levels: 6,
    slotsPerLevel: 4,
    groupOf: () => '',
    idPrefix: 'RC',
  });
  // 상온은 C~H 그룹, 그룹 안에서 줄 번호를 붙인다
  const ambient: Rack[] = [];
  const rowCounter = new Map<string, Map<number, number>>();
  ambientRaw.forEach((r, i) => {
    const g = ambientGroupOf(i);
    const rows = rowCounter.get(g) ?? new Map<number, number>();
    rowCounter.set(g, rows);
    const key = Math.round(r.cz * 100);
    if (!rows.has(key)) rows.set(key, rows.size + 1);
    ambient.push({ ...r, group: `${g}${String(rows.get(key)).padStart(2, '0')}` });
  });
  // 그룹 안 랙 번호 다시 매기기
  const perGroup = new Map<string, number>();
  for (const r of ambient) {
    const n = (perGroup.get(r.group) ?? 0) + 1;
    perGroup.set(r.group, n);
    r.rackNo = n;
  }
  const racks = [...frozen, ...chilled, ...ambient];

  // ── 로케이션 ─────────────────────────────────────────
  const locations: Location[] = [];
  const locationsByTemp: Record<TemperatureZone, Location[]> = { AMBIENT: [], CHILLED: [], FROZEN: [] };
  for (const r of racks) {
    const off = RACK_DEPTH / 2 + AISLE / 2;
    const pick =
      r.along === 'z' ? { x: r.cx + r.face * off, z: r.cz } : { x: r.cx, z: r.cz + r.face * off };
    for (let lv = 1; lv <= r.levels; lv++) {
      for (let s = 1; s <= r.slotsPerLevel; s++) {
        const t = (s - 0.5) / r.slotsPerLevel - 0.5; // -0.5..0.5
        const shelfY = 0.15 + ((lv - 1) * (RACK_HEIGHT - 0.25)) / r.levels;
        const shelf =
          r.along === 'z'
            ? { x: r.cx + (r.face * RACK_DEPTH) / 4, y: shelfY, z: r.cz + t * RACK_LEN * 0.9 }
            : { x: r.cx + t * RACK_LEN * 0.9, y: shelfY, z: r.cz + (r.face * RACK_DEPTH) / 4 };
        const loc: Location = {
          code: `${r.group}-${String(r.rackNo).padStart(2, '0')}-${lv}${String(s).padStart(2, '0')}`,
          rackId: r.id,
          temp: r.temp,
          level: lv,
          slot: s,
          pick,
          shelf,
        };
        locations.push(loc);
        locationsByTemp[r.temp].push(loc);
      }
    }
  }

  // ── 장애물: 저온 보충재고 팔레트, 입고창고 적재, 패킹대 ─────
  const obstacles: Obstacle[] = [];
  const pallets = (area: Rect, h: number) => {
    for (let x = area.x0; x + 1.1 <= area.x1 + 1e-6; x += 1.5) {
      for (let z = area.z0; z + 1.1 <= area.z1 + 1e-6; z += 1.5) {
        obstacles.push({ rect: { x0: x, z0: z, x1: x + 1.1, z1: z + 1.1 }, height: h, kind: 'PALLET' });
      }
    }
  };
  pallets({ x0: 7.8, z0: 26.8, x1: 11.6, z1: 29.6 }, 1.4); // 냉동 보충재고
  pallets({ x0: 19.4, z0: 26.8, x1: 22.6, z1: 29.6 }, 1.3); // 냉장 보충재고
  pallets({ x0: 38.2, z0: 1.0, x1: 47.2, z1: 11.6 }, 1.6); // 입고창고
  pallets({ x0: 38.4, z0: 17.6, x1: 43.4, z1: 19.2 }, 0.9); // 입고 검수 대기

  const stations: PackingStation[] = [];
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 0 : 1;
    const col = i % 4;
    const x = 25.9 + col * 2.0;
    const tableZ = row === 0 ? 21.15 : 27.85;
    const standZ = row === 0 ? 22.35 : 26.65;
    stations.push({ id: `PS-${i + 1}`, index: i, table: { x, z: tableZ }, stand: { x, z: standZ } });
    obstacles.push({
      rect: { x0: x - 0.8, z0: tableZ - 0.4, x1: x + 0.8, z1: tableZ + 0.4 },
      height: 0.9,
      kind: 'TABLE',
    });
  }
  obstacles.push({ rect: { x0: 34.1, z0: 23.0, x1: 34.85, z1: 24.4 }, height: 1.6, kind: 'MATERIAL' }); // 포장재
  obstacles.push({ rect: { x0: 34.1, z0: 24.8, x1: 34.85, z1: 26.2 }, height: 1.6, kind: 'MATERIAL' }); // 냉매·봉투

  // 외부 출하대기 랙 2개 (문서 5-3: 랙 2개, 라이더 내부 출입 없음)
  const shippingSlots: ShippingSlot[] = [];
  const shipRackX = [28.6, 31.4];
  shipRackX.forEach((x, ri) => {
    obstacles.push({
      rect: { x0: x - RACK_LEN / 2, z0: 33.4 - RACK_DEPTH / 2, x1: x + RACK_LEN / 2, z1: 33.4 + RACK_DEPTH / 2 },
      height: RACK_HEIGHT,
      kind: 'SHIP_RACK',
    });
    for (let lv = 0; lv < 4; lv++) {
      for (let s = 0; s < 4; s++) {
        shippingSlots.push({
          id: `SR${ri + 1}-${lv + 1}${s + 1}`,
          rackIndex: ri,
          pos: { x: x - 0.45 + s * 0.3, y: 0.25 + lv * 0.5, z: 33.4 },
        });
      }
    }
  });

  return {
    width: W,
    depth: D,
    buildingDepth: BD,
    zones,
    walls,
    racks,
    locations,
    locationsByTemp,
    obstacles,
    stations,
    shippingSlots,
    points: {
      cartDepot: { x: 33.2, z: 18.6 },
      idle: Array.from({ length: 24 }, (_, i) => ({ x: 24.2 + (i % 12) * 1.0, z: 16.4 + Math.floor(i / 12) * 0.8 })),
      packQueue: { x: 33.9, z: 19.4 },
      shipDrop: { x: 30, z: 32.75 },
      riderPickup: { x: 30, z: 34.2 },
      riderParking: Array.from({ length: 10 }, (_, i) => ({ x: 25 + i * 1.2, z: 38.4 })),
      riderEntry: { x: 30, z: 39.6 },
    },
  };
}
