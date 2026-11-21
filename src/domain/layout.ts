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
  /** 보충재고 랙(입고창고·저온 보충재고 — 적치 랙과 같은 제품, 그룹 R01 → 서버 {A|C|F}-R1-NN-단-칸, reserveStock). 피킹 랙 수·칸 목록에서 뺀다 */
  reserve?: boolean;
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
  /** 선반 위 실제 위치(표시용, 칸 중심·선반 윗면 높이) */
  shelf: { x: number; y: number; z: number };
  /** 칸 배치 (적재 표현용) */
  along: 'x' | 'z';
  face: 1 | -1;
  slotW: number;
  levelH: number;
  /**
   * 칸 치수(mm) — 백엔드 LAN 등록값과 같은 식(deploy/lan/seed/mfc_layout_v2.py: 폭 = 랙 1.25 m 의 90 % ÷ 칸 수, 깊이 450, 높이 = 2.1 m ÷ 단 수).
   * 11-16 실서버 표본(F 188·냉장 161·C 125·D 112·E 141·H 225 폭, 높이 420/350)과 같음. 칸 용량 계산용(그림의 levelH 와 다름)
   */
  dimMm: { w: number; d: number; h: number };
  /** 넓은 칸(layout-v3-wide, 2026-11-18) — 합친 칸 수(가로)·단 수(세로). 없으면 한 칸 */
  span?: { slots: number; levels: number };
  /** 합쳐져 닫힌 칸(백엔드 CLOSED) — 재고·안내·라벨에서 뺀다 */
  closed?: boolean;
  /** 보충재고 랙 칸(Rack.reserve) */
  reserve?: boolean;
}

/** 보충재고 팔레트 자리 (입고창고 = 상온, 저온실 안 = 냉장·냉동). MFC 4-3, 5-1 */
export interface ReserveSpot {
  id: string;
  temp: TemperatureZone;
  rect: Rect;
  /** 작업자가 서는 지점 */
  stand: { x: number; z: number };
  /**
   * 쓰임 — RESERVE = 보충재고(검수 끝, 바로 적치 가능·선반 넘침), RECEIVING = 입고재고(들여왔지만 검수 전).
   * 둘 다 그 온도대의 입고 공간에 두되 자리로 구분한다(사용자 2026-11-21 "다 입고구역에 둬야하는데 둘이 구분이 가능해야 해",
   * "냉장냉동 보충재고랑 입고재고는 다 각각 냉장냉동 구역 안에 … 지금 팔레트 4개씩 있는 게 그 공간") — 저온 팔레트 4개 = 보충 2 + 입고 2 [가정]
   */
  role: 'RESERVE' | 'RECEIVING';
  /** 보충재고 랙이면 그 랙(MOCK 보충재고 자리 — 팔레트가 아니라 랙 칸에 그린다) */
  rack?: Rack;
}

/** 입고·검수 구역의 하차 적치 칸 (롤테이너·박스) */
export interface DockSlot {
  id: string;
  pos: { x: number; z: number };
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
  kind: 'PALLET' | 'RESERVE' | 'TABLE' | 'SHIP_RACK' | 'MATERIAL';
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
  /** 넓은 칸 자리(applyWideCells 뒤) — 칸막이·선반을 그 안에서 뺀다 */
  wideSpans?: import('./wideCells').WideSpan[];
  obstacles: Obstacle[];
  stations: PackingStation[];
  shippingSlots: ShippingSlot[];
  /** 입고재고(검수 전) 팔레트 자리 */
  reserves: ReserveSpot[];
  /** 보충재고 랙마다 한 자리(MOCK 보충재고 — 상품마다 하나 배정). 실서버는 랙 칸(locations, reserve)으로 본다 */
  reserveRackSpots: ReserveSpot[];
  dockSlots: DockSlot[];
  points: {
    /** 입고 차량문 안쪽(하차·검수 작업자 위치) */
    truckDoor: { x: number; z: number };
    /** 차량 정차 위치(건물 밖, 차량 뒷문이 문에 붙는 지점) */
    truckDock: { x: number; z: number };
    inboundIdle: { x: number; z: number }[];
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
/** 보충재고 랙 단·칸 — 보충 상자는 피킹 낱개보다 커서 칸을 적게 [가정] */
export const RESERVE_SLOTS: readonly [levels: number, slots: number] = [5, 3];

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

/**
 * 그룹 첫 글자 → [단, 칸] — MFC-business-logic 1장 3-3(상온 슬롯 수용량)·4-2(저온 피킹 랙) 설계 [확정].
 * 백엔드 LAN MFC-SEED-01 이 2026-11-16 이 설계로 바꿈(선반 14,559칸, deploy/lan/seed/mfc_layout_v2.py DESIGN,
 * docs/handoff/simulator/mfc/2026-11-16-simulator-notice-layout-v2-slots.md). 이전 시뮬레이터 값은 냉동·냉장 5×3, 상온 6×4.
 */
export const SLOT_DESIGN: Record<string, readonly [levels: number, slots: number]> = {
  A: [5, 6],
  B: [5, 7],
  C: [6, 9],
  D: [6, 10],
  E: [6, 8],
  F: [6, 10],
  G: [6, 9],
  H: [5, 5],
};

/** Python round 와 같은 반올림(.5 는 짝수로) — 백엔드 등록 스크립트가 칸 폭을 이렇게 냈다(D 칸 112.5 → 112, 실서버 112) */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

const dims = (g: string) => ({ levels: SLOT_DESIGN[g][0], slotsPerLevel: SLOT_DESIGN[g][1] });

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
    { id: 'WH', kind: 'INBOUND_STORE', label: '상온 입고창고', rect: { x0: 37.2, z0: 0, x1: 48, z1: 16.5 }, docPyeong: 55 },
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
  // 패킹 구역은 벽 없이 바닥 구역만(사용자 2026-11-21 "패킹구역은 벽 없애줘" — 전엔 유리벽 4면, 문 둘). 구역 카드는 바닥에(ZoneNames)
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
    ...dims('A'),
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
    ...dims('B'),
    groupOf: (row) => `B${String(row + 1).padStart(2, '0')}`,
    rowPriority: (c) => Math.abs(c - 17.8),
    idPrefix: 'RB',
  });
  const ambientRaw = fillRacks({
    temp: 'AMBIENT',
    area: { x0: 24.0, z0: 0.8, x1: 36.4, z1: 14.6 },
    along: 'x',
    target: 138,
    ...dims('C'), // 그룹(C~H)이 정해진 뒤 SLOT_DESIGN 으로 다시 맞춘다
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
  for (const r of racks) Object.assign(r, dims(r.group[0]));

  // 보충재고 랙 — 팔레트 대신 적치 랙과 같은 제품(사용자 2026-11-21 "보충재고는 팔레트가 아니라 랙으로 하자", 앞서 "랙 규격은 모든 구역에서 쓰는 적치 랙이랑 같은 제품").
  // 그룹 R01·랙 번호는 온도대마다 1부터 → 서버 칸 {A|C|F}-R1-NN-단-칸(지금 보충재고 칸 {T}-R1-NN-1-01 문법 그대로). 단·칸 RESERVE_SLOTS [가정]
  const reserveRacks = (temp: TemperatureZone, area: Rect, along: 'x' | 'z', prefix: string): Rack[] => {
    const rs = fillRacks({ temp, area, along, target: 999, levels: RESERVE_SLOTS[0], slotsPerLevel: RESERVE_SLOTS[1], groupOf: () => 'R01', idPrefix: prefix });
    rs.forEach((r, i) => {
      r.rackNo = i + 1;
      r.reserve = true;
    });
    return rs;
  };
  racks.push(
    // 상온 입고창고: 뒤 줄(입고재고 팔레트) 앞, 등 맞댄 3쌍 × 7 = 42랙
    ...reserveRacks('AMBIENT', { x0: 38.4, z0: 3.6, x1: 47.6, z1: 7.7 }, 'x', 'RRA'),
    // 냉동 A·냉장 B: 저온실 남쪽(피킹 랙 뒤), 출입문 앞 통로는 비움 — 각 3쌍 × 2 = 12랙
    ...reserveRacks('FROZEN', { x0: 4.4, z0: 26.4, x1: 8.6, z1: 29.0 }, 'z', 'RRF'),
    ...reserveRacks('CHILLED', { x0: 16.4, z0: 26.4, x1: 20.6, z1: 29.0 }, 'z', 'RRC'),
  );

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
          // 보충재고 랙은 온도대마다 R01 이라 화면 코드 앞에 온도대 글자(AR01·CR01·FR01) — 서버 코드는 {T}-R1-…
          code: `${r.reserve ? { AMBIENT: 'A', CHILLED: 'C', FROZEN: 'F' }[r.temp] : ''}${r.group}-${String(r.rackNo).padStart(2, '0')}-${lv}${String(s).padStart(2, '0')}`,
          rackId: r.id,
          temp: r.temp,
          level: lv,
          slot: s,
          pick,
          shelf,
          along: r.along,
          face: r.face,
          slotW: (RACK_LEN * 0.9) / r.slotsPerLevel,
          levelH: (RACK_HEIGHT - 0.25) / r.levels,
          dimMm: { w: roundHalfEven((RACK_LEN * 900) / r.slotsPerLevel), d: Math.round(RACK_DEPTH * 1000), h: roundHalfEven((RACK_HEIGHT * 1000) / r.levels) },
        };
        if (r.reserve) loc.reserve = true;
        locations.push(loc);
        if (!r.reserve) locationsByTemp[r.temp].push(loc);
      }
    }
  }

  // ── 장애물: 저온 보충재고 팔레트, 입고창고 적재, 패킹대 ─────
  const obstacles: Obstacle[] = [];
  const reserves: ReserveSpot[] = [];
  const P = 1.1; // 팔레트 1.1×1.1m [가정] (MFC 5-1)
  const addReserve = (id: string, temp: TemperatureZone, x0: number, z0: number, stand: { x: number; z: number }, role: ReserveSpot['role'] = 'RESERVE') => {
    const rect = { x0, z0, x1: x0 + P, z1: z0 + P };
    reserves.push({ id, temp, rect, stand, role });
    obstacles.push({ rect, height: 0.15, kind: 'RESERVE' });
  };
  // 입고재고(검수 전) 팔레트 자리만 팔레트로 남는다 — 보충재고는 랙(위 reserveRacks).
  // 냉동·냉장: 저온실 남쪽 보충재고 랙 옆 2자리 → 서버 입고칸 RCV-F-01·RCV-C-01(R-31). 상온: 입고창고 뒤 줄 6자리 → RCV-A-02(R-32)
  [9.4].forEach((x) => [26.8, 28.3].forEach((z, j) => addReserve(`AR-${j + 3}`, 'FROZEN', x, z, { x: x + P / 2, z: 26.25 }, 'RECEIVING')));
  [21.0].forEach((x) => [26.8, 28.3].forEach((z, j) => addReserve(`BR-${j + 3}`, 'CHILLED', x, z, { x: x + P / 2, z: 26.25 }, 'RECEIVING')));
  for (let c = 0; c < 6; c++) {
    const x0 = 38.6 + c * 1.5;
    addReserve(`WR-${String(c + 1).padStart(2, '0')}`, 'AMBIENT', x0, 1.0, { x: x0 + P / 2, z: 1.0 + P + 0.55 }, 'RECEIVING');
  }
  // 하차 칸: 입고·검수 구역 북·남 두 블록, 가운데는 통로로 비운다
  const dockSlots: DockSlot[] = [];
  for (const z of [17.15, 17.9, 21.35, 22.1]) {
    for (let c = 0; c < 9; c++) dockSlots.push({ id: `DK-${dockSlots.length + 1}`, pos: { x: 40.6 + c * 0.75, z } });
  }

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
    reserves,
    reserveRackSpots: racks
      .filter((r) => r.reserve)
      .map((r) => {
        const hx = r.along === 'x' ? RACK_LEN / 2 : RACK_DEPTH / 2;
        const hz = r.along === 'x' ? RACK_DEPTH / 2 : RACK_LEN / 2;
        const off = RACK_DEPTH / 2 + AISLE / 2;
        const stand = r.along === 'z' ? { x: r.cx + r.face * off, z: r.cz } : { x: r.cx, z: r.cz + r.face * off };
        return { id: r.id, temp: r.temp, rect: { x0: r.cx - hx, z0: r.cz - hz, x1: r.cx + hx, z1: r.cz + hz }, stand, role: 'RESERVE' as const, rack: r };
      }),
    dockSlots,
    points: {
      truckDoor: { x: 47.2, z: 19.75 },
      truckDock: { x: 52.6, z: 19.75 },
      inboundIdle: Array.from({ length: 8 }, (_, i) => ({ x: 38.3 + (i % 4) * 0.8, z: 19.2 + Math.floor(i / 4) * 0.9 })),
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
