// 가상 MFC 평면 배치.
// 면적·랙 규격·패킹대 규격은 MFC-business-logic.md 1장(463평) 을 따른다. 실측 도면이 없어(문서 7-5 "현장 실측 도면 아님")
// 구역의 위치·모양·문 위치는 이 시뮬레이터의 가정이다. 좌표 단위는 m, x=동쪽, z=남쪽(화면 아래), y=높이.

import type { TemperatureZone } from './contract';

/** 1호점 회수 반입 화면 자리 — config BACKEND_FACTS.returnIntake 와 같은 값(순환 import 를 피해 여기 둠) */
const BACKEND_FACTS_RETURN = { x: 42.333, z: 35.9 };

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
  /** 같은 구역의 덧붙은 바닥(ㄱ자 구역 등) — 이름표를 따로 달지 않는다 */
  noTag?: boolean;
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
   * BULK = 상온 입고창고 대형 묶음(생수·음료·주류) 바닥 팔레트 — 보충재고(검수 끝)의 한 종류, 서버 칸 A-R2-NN-1-01(R-33 정정, MFC 5-1 대형 적재 22평)
   */
  role: 'RESERVE' | 'RECEIVING' | 'BULK';
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

/** 바닥 표시(보충재고·입고재고·격리 띠 등) — 판 + 흰 실선 + 바닥 글. 색 이름은 ZONE_FLOOR 키(없으면 격리 바닥색) */
export interface StoreArea {
  floor: [x0: number, z0: number, x1: number, z1: number];
  color?: 'FROZEN' | 'CHILLED';
  lines: [x0: number, z0: number, x1: number, z1: number][];
  texts: { t: string; x: number; z: number }[];
}

/** 지점마다 다른 건물 둘레 값(1호점은 아래 상수 그대로) */
export interface SiteGeo {
  /** 남쪽 앞마당(라이더) 울타리 안쪽 x 범위 */
  yardX: readonly [number, number];
  /** 승강기 별동(MFC 밖·건물 안) */
  liftAnnex: { x0: number; z0: number; x1: number; z1: number; truckDoor: readonly [number, number] };
  freightLifts: readonly { x0: number; x1: number; door: readonly [number, number] }[];
  liftZ0: number;
  /** 회수 반입 자리(RTN-A-01 화면 자리) */
  returnIntake: { x: number; z: number };
  /** 바닥 표시 — 없으면 1호점 표시(Stock STORE_AREAS) */
  storeAreas?: StoreArea[];
  /** 휴게·사무 테이블(없으면 1호점 OFFICE_TABLE, null = 휴게·사무 없음 — 춘천) */
  officeTable?: { x: number; z: number; w: number; d: number; h: number } | null;
  /** 입고·검수 롤테이너 장식 자리 */
  rollContainers?: { x: number; z: number }[];
  /** 장바구니 거치대를 세로(남북)로 — 카트 줄이 남쪽으로 늘어서고 시작점 판은 동쪽을 본다(세종, 사용자 2026-11-24) */
  cartDepotVertical?: boolean;
  /** 장바구니 거치대 카트 줄 수(기본 1) — 줄마다 남쪽으로 cartDepotRowGap(m) 띄움(춘천, 사용자 2026-11-24 "가로로 돌리고 간격 두고 2줄로") */
  cartDepotRows?: number;
  cartDepotRowGap?: number;
  /** 장바구니 거치대 줄마다 그리는 카트 대수(기본 DECOR.cartDepotDrawn ÷ 줄 수) — 거치대 자리가 넓은 지점(부산진구)에서 줄을 길게 */
  cartDepotPerRow?: number;
  /** 격리 구역 흰 랙 자리(구역 id → 랙 사각형들). 없으면 화면 기본(저온 서쪽 벽 세로 2개·상온 남쪽 가로 2개) */
  quarantineRacks?: Record<string, Rect[]>;
  /** 승강기 문 줄 z(기본 0 = 건물 북쪽 벽, 승강기는 그 북쪽). 부산진구는 별동이 건물 안이라 문이 남쪽 2.4 m(승강기 z 0~2.4) */
  liftDoorZ?: number;
  /** 입고 차량이 서쪽에서 동서 길로 들어와 뒷문을 건물 서쪽 벽(rearX)에 대고 선다(z = 차 가운데) — 부산진구(그림: 승강기 별동 서쪽 하역). 없으면 북쪽 동서 길(동쪽에서 옴) */
  truckFromWest?: { z: number; rearX: number };
  /** 구역 카드 가운데 x 를 구역마다 바꿈(부산진구 입고·검수 — 냉동 카드와 겹치지 않게) */
  zoneCardX?: Record<string, number>;
  /** 건물 바닥 시작 x(기본 0) — 부산진구는 서쪽 밖 라이더 마당 때문에 건물이 동쪽으로 밀림 */
  floorX0?: number;
  /** 건물 밖 마당(라이더 대기 등) 바닥 — 남쪽 앞마당(yardX) 말고 더 */
  outsideYards?: Rect[];
  /** 되돌릴 상품 탁자 자리(없으면 거치대 옆 RETURN_TABLE 오프셋), vertical = 긴 쪽을 남북으로 */
  returnTable?: { x: number; z: number; vertical?: boolean };
}

/** 장바구니 거치대 기준 상대 자리(가로 거치대 기준 dx·dz) → 평면 좌표. 세로 거치대는 90° 돌린다(가로 −x 줄 → 세로 +z 줄) */
export function depotPoint(L: Pick<Layout, 'geo' | 'points'>, dx: number, dz: number): { x: number; z: number } {
  const c = L.points.cartDepot;
  return L.geo.cartDepotVertical ? { x: c.x + dz, z: c.z - dx } : { x: c.x + dx, z: c.z + dz };
}

export interface Layout {
  /** 어느 평면인가 — SEED = 1호점(목포 같음), SEJONG = 3호점 세종(2026-11-23 R-41) */
  variant: 'SEED' | 'SEJONG' | 'CHUNCHEON' | 'BUSAN_NAMGU' | 'BUSANJIN';
  geo: SiteGeo;
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
export const AISLE = 0.7;
/** 패킹대 상판 길이(m) — 1.6 → 1.8(사용자 2026-11-22 "패킹대 공간 넓어진 만큼 패킹대 길이도 좀 길게") [시뮬] */
export const PACK_TABLE_W = 1.8;
/** 보충재고 랙 단·칸 — 보충 상자는 피킹 낱개보다 커서 칸을 적게 [가정] */
export const RESERVE_SLOTS: readonly [levels: number, slots: number] = [5, 3];

// 건물 크기 — 2026-11-21 재배치(사용자 스케치 "이런식으로" → "이대로 UI 깨지지 않게 재배치"): 서쪽부터 냉장 | 냉동 | 입고·검수/상온 | 휴게·사무/입고창고/패킹.
// 랙·칸·자리는 예전 평면(OLD_*)에서 만든 뒤 구역마다 통째로 옮긴다(relocate) — 칸 코드·랙 번호는 예전 그대로(서버 칸 코드 그대로).
const W = 49.2;
const BD = 33.8; // 건물 깊이(남쪽 통로 포함)
const D = 41.8;
const OLD_W = 48; // 예전 평면 폭(옮기기 전 좌표계)
/** 남쪽 앞마당(라이더) 울타리 안쪽 x 범위 — 길 찾기 격자가 건물 밖에서 걸을 수 있는 곳 */
export const YARD_X: readonly [number, number] = [30.168, 49.868]; // 2026-11-22 463평(+승강기 별동 11평) 맞춤으로 x −3.582
/** 냉동·냉장 서쪽 벽 띠(격리·입고재고·보충재고) — 띠 서쪽 끝 x, 폭. 새 평면 좌표 */
// 띠는 방 북쪽 끝(북쪽 벽 z 1.7 아래) — 사용자 2026-11-21 "입고랑보충이랑 격리재고 남쪽말고 북쪽으로 밀어". 북쪽부터 입고재고 → 보충재고 → 격리
// 폭 3.65 → 3.0 m(사용자 2026-11-22 "…가로 길이 줄여" → 2.4 m 는 보충재고 랙 서쪽 통로 0.7 m 라 빠듯해 3.0 m 로, "응").
// 서쪽 벽 ~ 보충재고 랙(등 맞댄 2줄 x +0.9~1.8) 통로 0.9 m, 랙 ~ 띠 끝 1.2 m, 입고재고 팔레트 ~ 피킹 랙 약 1.75 m
// mark = 바닥 표시(판·실선)와 격리 구역의 폭 1.7 m(2026-11-22 2.2 → 1.7 "실선 좀 더 서쪽으로 밀어") — 사용자 2026-11-22 "팔레트 위치 그대로 두고 바닥에 실선 표시만 가로길이를 더 줄여". width(3.0)는 피킹 랙 줄이 시작하는 자리라 그대로
// 2026-11-22 463평 맞춤: 냉동 방 x 10.889~21.578(폭 12.0 → 10.689), 냉장 x 0~10.689 — 띠는 방 서쪽 벽에서 그대로, 격리 2평씩(z 21.1~24.99)
export const COLD_BAND = { FROZEN: 10.889, CHILLED: 0.1, width: 3.0, mark: 1.7, z0: 1.8, z1: 24.99 } as const;

/** 예전 평면 좌표 → 새 평면 좌표. 구역마다 평행 이동(모양·랙 배치는 그대로) */
function moveOf(x: number, z: number): { dx: number; dz: number } {
  if (z >= 32) return { dx: 13.6, dz: 1.8 }; // 바깥 남쪽(출하대기·라이더 앞마당)
  if (x < 12.1) return { dx: 11.0, dz: 1.8 }; // 냉동 A
  // 냉장 B: 피킹 랙을 동쪽으로 1.8 m 더(서쪽 벽 띠 3.65 m 를 비워 격리·입고재고·보충재고를 세움 — 사용자 2026-11-21 "남쪽문을 막고있잖아. 왼쪽 벽면으로 다 옮겨")
  if (x < 23.1) return { dx: -10.4, dz: 1.8 }; // 냉장 B
  // 상온 C~H: 랙 묶음(예전 x 24.0~35.25)을 구역(x 24.2~38.0) 가운데로 — dx 1.475(사용자 2026-11-21 "상온구역 랙도 왼쪽으로 치우쳐졌잖아")
  if (x < 37.1) return z < 15.5 ? { dx: 1.475, dz: 13.0 } : { dx: 13.6, dz: 2.5 }; // 상온 C~H / 패킹 쪽(2026-11-22 패킹 0.5 m 북쪽, 사용자 "패킹구역도 아주 조금 북쪽으로")
  if (z < 16.6) return { dx: 1.0, dz: 5.6 }; // 상온 입고창고
  if (z < 23.1) return { dx: -11.4, dz: -16.7 }; // 입고·검수(2026-11-22 동쪽으로 1.4 m — 사용자 "입고검수 구역을 오른쪽으로 밀어서 … 북쪽통로 가는 공간을 확보해")
  return { dx: 1.0, dz: -23.2 }; // 휴게·사무
}
function mv<T extends { x: number; z: number }>(p: T): T {
  const { dx, dz } = moveOf(p.x, p.z);
  return { ...p, x: p.x + dx, z: p.z + dz };
}
function mvRect(r: Rect): Rect {
  const { dx, dz } = moveOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
  return { x0: r.x0 + dx, z0: r.z0 + dz, x1: r.x1 + dx, z1: r.z1 + dz };
}

/** 랙 블록 채우기: 등을 맞댄 두 줄(0.9m) + 통로 0.7m 를 반복한다. */
export function fillRacks(opts: {
  temp: TemperatureZone;
  area: Rect;
  along: 'x' | 'z';
  /** 줄 사이 통로 폭(m). 없으면 AISLE(0.7) */
  aisle?: number;
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
    c += 2 * RACK_DEPTH + (opts.aisle ?? AISLE);
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
export function roundHalfEven(x: number): number {
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

/** 랙 하나의 칸(buildLayout 안 addLocations 와 같은 식) — 다른 지점 평면용 */
export function rackLocations(r: Rack): Location[] {
  const out: Location[] = [];
  const off = RACK_DEPTH / 2 + AISLE / 2;
  const pick = r.along === 'z' ? { x: r.cx + r.face * off, z: r.cz } : { x: r.cx, z: r.cz + r.face * off };
  for (let lv = 1; lv <= r.levels; lv++) {
    for (let s = 1; s <= r.slotsPerLevel; s++) {
      const t = (s - 0.5) / r.slotsPerLevel - 0.5;
      const shelfY = 0.15 + ((lv - 1) * (RACK_HEIGHT - 0.25)) / r.levels;
      const shelf =
        r.along === 'z'
          ? { x: r.cx + (r.face * RACK_DEPTH) / 4, y: shelfY, z: r.cz + t * RACK_LEN * 0.9 }
          : { x: r.cx + t * RACK_LEN * 0.9, y: shelfY, z: r.cz + (r.face * RACK_DEPTH) / 4 };
      const loc: Location = {
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
      out.push(loc);
    }
  }
  return out;
}

export function buildLayout(): Layout {
  // 새 평면 구역(2026-11-21 재배치). 면적은 예전 구역 그대로(문서 평수). 상온 C~H·패킹은 벽 없음("상온구역이랑 패킹은 자유롭게 오갈 수 있게")
  const zones: Zone[] = [
    { id: 'A', kind: 'FROZEN', label: '냉동 A', rect: { x0: 11.0, z0: 1.8, x1: 23.0, z1: 31.8 }, docPyeong: 109 },
    { id: 'B', kind: 'CHILLED', label: '냉장 B', rect: { x0: 0, z0: 1.8, x1: 10.8, z1: 31.8 }, docPyeong: 100 },
    { id: 'C-H', kind: 'AMBIENT', label: '상온 C~H', rect: { x0: 24.2, z0: 11.7, x1: 38.0, z1: 28.4 }, docPyeong: 65 },
    // 상온 입고창고: 서쪽 벽을 동쪽으로 1.2 m(상온 랙 ~ 창고 벽 통로 1.4 → 2.6 m), 줄어든 만큼 휴게·사무를 줄여 북쪽으로 늘려 넓이 유지(9.6 × 18.55 ≈ 178 m², 사용자 2026-11-22)
    { id: 'WH', kind: 'INBOUND_STORE', label: '상온 입고창고', rect: { x0: 39.4, z0: 3.55, x1: 49.0, z1: 21.1 }, docPyeong: 51 }, // 2026-11-22 남쪽 1.0 m 줄임(보충재고 쪽) — 패킹 앞 통로 1.3 → 2.3 m(사용자 "상온보충재고 평수 조금 줄여서 북쪽으로 밀고 패킹 통로 넓히자"), 9.6 × 17.55 ≈ 168.5 m²
    { id: 'RCV', kind: 'RECEIVING', label: '입고·검수', rect: { x0: 25.8, z0: 0, x1: 36.6, z1: 6.3 }, docPyeong: 22 },
    { id: 'OFF', kind: 'OFFICE', label: '휴게·사무', rect: { x0: 39.4, z0: 0, x1: 49.0, z1: 3.35 }, docPyeong: 10 }, // 18평 → 약 10평, 서쪽 벽을 창고와 한 줄(x 39.3)로(사용자 2026-11-22 "서쪽에 튀어 나온 부분 없애") [가정]
    { id: 'PK', kind: 'PACKING', label: '패킹', rect: { x0: 38.6, z0: 23.0, x1: 48.6, z1: 31.0 }, docPyeong: 24 },
    // 냉동·냉장 격리: 서쪽 벽 띠 남쪽 끝(남쪽 문 앞을 비움, 사용자 2026-11-21)
    { id: 'AQ', kind: 'QUARANTINE', label: '냉동 격리', rect: { x0: 11.0, z0: 21.1, x1: 12.7, z1: 25.1 }, docPyeong: 4 },
    { id: 'BQ', kind: 'QUARANTINE', label: '냉장 격리', rect: { x0: 0.1, z0: 21.1, x1: 1.8, z1: 25.1 }, docPyeong: 4 },
    { id: 'CQ', kind: 'QUARANTINE', label: '상온 격리', rect: { x0: 43.0, z0: 18.9, x1: 49.0, z1: 21.1 }, docPyeong: 4 }, // 남쪽 벽에 붙은 가로로 긴 6.0 × 2.2 m(사용자 2026-11-22 "정사각형 … 직사각형으로 늘려서 구역 자체가 벽에 가깝게") // 입고창고 안 남동쪽("상온 격리는 입고 창고 안이야")
    { id: 'SHIP', kind: 'SHIPPING', label: '외부 출하대기', rect: { x0: 40.6, z0: 34.2, x1: 46.6, z1: 36.8 }, docPyeong: 3 },
    { id: 'PARK', kind: 'PARKING', label: '라이더 대기', rect: { x0: 37.6, z0: 38.3, x1: 49.6, z1: 41.4 } },
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

  // 외벽: 입고 차량문(북쪽, 입고·검수 앞), 출하 인계문(남쪽, 패킹 아래)
  hWall(0, 0, W, [[28.7, 33.7]]);
  hWall(BD, 0, W, [[42.4, 44.8]]);
  vWall(0, 0, BD);
  vWall(W, 0, BD);
  // 냉장 B·냉동 A: 북쪽 통로(z 0~1.6) 아래, 문은 북·남 하나씩("냉동냉장문은 남쪽 북쪽 2개만")
  hWall(1.7, 0, 23.1, [[4.6, 6.6], [19.5, 22.0]]);
  vWall(10.9, 1.7, 31.9);
  vWall(23.1, 1.7, 31.9);
  hWall(31.9, 0, 23.1, [[4.6, 6.6], [16.0, 18.0]]);
  // 입고·검수: 서쪽 문(세로 통로 → 북쪽 통로·냉장냉동), 남쪽 문(가운데 통로). 동쪽(휴게·사무 쪽) 문은 없음(사용자 2026-11-21 "입고검수에서 휴게사무쪽으로 난 문 없애고")
  // 입고·검수를 동쪽으로 1.4 m(2026-11-22): 서쪽(냉동 벽 x 23.1 ~ 입고 벽) 통로 1.2 → 2.6 m, 동쪽(입고 벽 ~ 휴게·사무 벽 x 38.1) 2.8 → 1.4 m
  // 서쪽 문은 북쪽 통로(z 0.1~1.6)와 일직선(z 0.1~2.0) — 나가서 꺾지 않고 곧장 냉장·냉동 북쪽 통로로(사용자 2026-11-22, 전엔 z 1.5~4.5)
  vWall(25.7, 0, 6.4, [[0.1, 2.0]]);
  hWall(6.4, 25.7, 36.7, [[29.7, 34.7]]);
  vWall(36.7, 0, 6.4);
  // 휴게·사무 / 상온 입고창고(서쪽 벽 문: 휴게·사무, 가운데 통로 → 창고 통로, 상온 보충) / 패킹(벽 없음)
  // 휴게·사무·입고창고 서쪽 벽 한 줄 x 39.3 — 상온 랙과의 사이 통로 약 2.6 m
  vWall(39.3, 0, 21.2, [[1.0, 2.5], [7.4, 9.5], [16.9, 18.8]]); // 휴게·사무 문 / 대형재고 앞 통로 / 보충재고 남쪽 통로
  hWall(3.45, 39.3, W);
  hWall(21.2, 39.3, W);
  // 외부 앞마당 경계(낮은 울타리)
  const fence = 1.0;
  walls.push({ rect: { x0: YARD_X[0] - 0.15, z0: BD, x1: YARD_X[0], z1: D }, height: fence });
  walls.push({ rect: { x0: YARD_X[1], z0: BD, x1: YARD_X[1] + 0.15, z1: D }, height: fence });

  // ── 랙 ──────────────────────────────────────────────
  // 냉동 A 105개, 냉장 B 125개, 상온 138개 (문서 4-2, 3-1 계획 배치 [산출·가정])
  // 냉동 A·냉장 B 피킹 랙은 새 평면에서 바로 만든다(옮기지 않음). 방 남쪽 끝까지 길게 써서 줄을 줄이고 통로를 넓힌다
  // (사용자 2026-11-22 "비좁아 보이는데 냉동냉장 랙 배치를 꼭 이렇게 해야돼?" → 남쪽까지 늘려 물리 줄 수를 줄이고 통로를 넓힘).
  // 한 줄 = 북쪽 11랙 + 가로 통로 1.4 m + 남쪽 10랙 = 21랙(z 2.95~30.6). 북쪽 통로 1.15 m·남쪽 통로 1.2 m 는 남북 문으로 이어진다.
  // 냉장 B(서쪽 띠 동쪽 x 3.85~10.7): 띠에 등 댄 홑줄 → 등 맞댄 2쌍 → 동쪽 벽에 등 댄 홑줄 = 6줄, 통로 3개 약 1.38 m. 125랙(마지막 줄 20).
  // 냉동 A(x 14.75~22.9): 띠에 등 댄 홑줄 → 등 맞댄 2쌍 = 5줄, 통로 3개 약 1.97 m. 105랙 = 5 × 21. [가정]
  const coldRows = (x0: number, x1: number, pattern: ('S+' | 'P' | 'S-')[]): { c: number; face: 1 | -1 }[] => {
    const nRows = pattern.reduce((n, p) => n + (p === 'P' ? 2 : 1), 0);
    const aisle = (x1 - x0 - nRows * RACK_DEPTH) / (pattern.length - (pattern[pattern.length - 1] === 'S-' ? 1 : 0));
    const rows: { c: number; face: 1 | -1 }[] = [];
    let x = x0;
    for (const p of pattern) {
      if (p === 'S+') { rows.push({ c: x + RACK_DEPTH / 2, face: 1 }); x += RACK_DEPTH + aisle; }
      else if (p === 'P') { rows.push({ c: x + RACK_DEPTH / 2, face: -1 }, { c: x + RACK_DEPTH * 1.5, face: 1 }); x += 2 * RACK_DEPTH + aisle; }
      else rows.push({ c: x + RACK_DEPTH / 2, face: -1 });
    }
    return rows;
  };
  const COLD_Z0 = 2.95;
  const coldAlong = [
    ...Array.from({ length: 11 }, (_, i) => COLD_Z0 + RACK_LEN * (i + 0.5)),
    ...Array.from({ length: 10 }, (_, i) => COLD_Z0 + 11 * RACK_LEN + 1.4 + RACK_LEN * (i + 0.5)),
  ];
  // 칸 코드(줄 그룹·랙 번호)는 예전 그대로 둔다(사용자 2026-11-22 "그 줄은 줄이지 말고 위치만 바꾸면 되잖아"):
  // 물리 줄 i 의 북쪽부터 랙 1~18 = 그룹 i(A01~A05·B01~B06), 각 줄 남쪽 끝 3자리(19~21번 자리)에 마지막 그룹(A06 15랙·B07 17랙)을 줄 순서대로 둔다.
  const coldRacks = (temp: TemperatureZone, g: 'A' | 'B', rows: { c: number; face: 1 | -1 }[], target: number, prefix: string): Rack[] => {
    const PER = 18;
    const lastG = rows.length + 1;
    const out: Rack[] = [];
    const push = (gi: number, rackNo: number, row: { c: number; face: 1 | -1 }, z: number) =>
      out.push({ id: `${prefix}-${out.length + 1}`, temp, group: `${g}${String(gi).padStart(2, '0')}`, rackNo, cx: row.c, cz: z, along: 'z', face: row.face, ...dims(g) });
    rows.forEach((row, ri) => { for (let k = 0; k < PER; k++) push(ri + 1, k + 1, row, coldAlong[k]); });
    let n = 0;
    rows.forEach((row) => { for (let k = PER; k < coldAlong.length && out.length < target; k++) push(lastG, ++n, row, coldAlong[k]); });
    return out;
  };
  const frozen = coldRacks('FROZEN', 'A', coldRows(COLD_BAND.FROZEN + COLD_BAND.width + 0.1, 21.478, ['S+', 'P', 'P']), 105, 'RA');
  const chilled = coldRacks('CHILLED', 'B', coldRows(COLD_BAND.CHILLED + COLD_BAND.width + 0.1, 10.589, ['S+', 'P', 'P', 'S-']), 125, 'RB');
  const placedNew = new Set([...frozen, ...chilled].map((r) => r.id));
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
  // 상온 자리 다시(사용자 2026-11-22 "상온랙이 가로로 9개 놓여있는데 중앙을 빼고 거길 통로로 … 4개 4개 … 뺀애들은 북쪽에 가로로 진열해.
  // 번호는 당연히 이어지게 미는 식으로" → "번호를 통째로 밀기"): 줄마다 가운데(5번째) 자리를 비워 세로 통로(폭 1.25 m), 4 | 통로 | 4.
  // 칸 코드는 그대로 두고, 북쪽에 새 등 맞댄 2줄(북쪽 줄은 북쪽을, 남쪽 줄은 남쪽을 봄)을 더해 북쪽 줄부터 순서대로(C01-1 …) 8자리씩 밀어 채운다.
  // 새 평면 z: 북쪽 줄 12.125·12.575(기존 1줄과 통로 1.0 m), 기존 줄 그대로. 예전 평면 z = 새 − 13.0
  {
    const rowsOld = [...new Map(ambient.map((r) => [r.cz.toFixed(4), { cz: r.cz, face: r.face }])).values()].sort((a, b) => a.cz - b.cz);
    const xs = [...new Set(ambient.map((r) => +r.cx.toFixed(4)))].sort((a, b) => a - b); // 9자리
    const keep = xs.filter((_, k) => k !== 4);
    const rowsNew = [{ cz: 12.125 - 13.0, face: -1 as const }, { cz: 12.575 - 13.0, face: 1 as const }, ...rowsOld];
    const slots = rowsNew.flatMap((row) => keep.map((x) => ({ x, ...row })));
    ambient.forEach((r, i) => {
      r.cx = slots[i].x;
      r.cz = slots[i].cz;
      r.face = slots[i].face;
    });
  }
  const racks = [...frozen, ...chilled, ...ambient];
  for (const r of racks) Object.assign(r, dims(r.group[0]));

  // 보충재고 랙 — 팔레트 대신 적치 랙과 같은 제품(사용자 2026-11-21 "보충재고는 팔레트가 아니라 랙으로 하자", 앞서 "랙 규격은 모든 구역에서 쓰는 적치 랙이랑 같은 제품").
  // 그룹 R01·랙 번호는 온도대마다 1부터 → 서버 칸 {A|C|F}-R1-NN-단-칸(지금 보충재고 칸 {T}-R1-NN-1-01 문법 그대로). 단·칸 RESERVE_SLOTS [가정]
  const reserveRacks = (temp: TemperatureZone, area: Rect, along: 'x' | 'z', prefix: string, aisle?: number): Rack[] => {
    const rs = fillRacks({ temp, area, along, aisle, target: 999, levels: RESERVE_SLOTS[0], slotsPerLevel: RESERVE_SLOTS[1], groupOf: () => 'R01', idPrefix: prefix });
    rs.forEach((r, i) => {
      r.rackNo = i + 1;
      r.reserve = true;
    });
    return rs;
  };
  racks.push(
    // 상온 입고창고 — 안쪽(북쪽 벽)부터 대형 묶음 → 입고재고 → 보충재고(문 쪽)
    // (사용자 2026-11-21 "대형묶음이 제일 안쪽에 있어야지. 여기는 지게차로 입고시키니까 이동통로 생각해서 배치하고 보충재고가 제일 밖에 있어야지").
    // 지게차 길: 남쪽 문(x 37.5~40.5) → 서쪽 세로 통로 x 37.3~40.3 → 대형 묶음 앞 가로 통로 z 2.55~5.5(3 m) [가정].
    // 보충재고 랙: 세로 통로 동쪽, 등 맞댄 3쌍 × 6 = 36랙, 사람 통로 1.0 m [가정] — 42 는 지게차 통로 때문에 안 들어감
    // 2026-11-22: 창고가 북쪽으로 늘어난 만큼 세 구역을 고르게 늘림(사용자 "대형재고, 입고재고, 보충재고 다 … 골고루 늘리라는 건데") — 보충재고 z 11.53~22.1 에서 랙 3쌍 앞뒤 통로 4개를 1.42 m 로(전 1.0)
    // 2026-11-22 보충재고 구역 z 11.53~21.1(남쪽 1.0 m 줄임) — 랙 3쌍 z 12.70~17.74, 앞뒤 통로 4개 1.17 m
    ...reserveRacks('AMBIENT', { x0: 40.35, z0: 12.70 - 5.6, x1: 47.86, z1: 17.74 - 5.6 }, 'x', 'RRA', 1.17),
    // 냉동 A·냉장 B: 저온실 남쪽(피킹 랙 뒤), 출입문 앞 통로는 비움 — 각 3쌍 × 2 = 12랙
    // 냉동·냉장 보충재고 랙은 옮긴 뒤 새 평면에서 서쪽 벽 띠에 만든다(아래 COLD_BAND)
  );

  // ── 로케이션 ─────────────────────────────────────────
  const locations: Location[] = [];
  const locationsByTemp: Record<TemperatureZone, Location[]> = { AMBIENT: [], CHILLED: [], FROZEN: [] };
  const addLocations = (rs: Rack[]) => { for (const r of rs) {
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
  } };
  addLocations(racks);

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
  // 냉동·냉장: 저온실 남쪽 보충재고 랙 옆 2자리 → 서버 입고칸 RCV-F-01·RCV-C-01(R-31). 상온: 입고창고 뒤 줄 5자리 → RCV-A-02(R-32·R-33)
  // 상온 5자리 = 문서 6-5 "상온 5자리의 여유"(1회 입고 9팔레트 상당 중 상온 약 4.5)
  // 냉동·냉장 입고재고 팔레트는 옮긴 뒤 새 평면에서(아래 COLD_BAND)
  // 상온 입고재고 5자리(문서 6-5 "상온 5자리") — 지게차 가로 통로 남쪽 줄, 사람은 남쪽 통로(z 6.6~7.6)에서 검수
  for (let c = 0; c < 5; c++) {
    const x0 = 40.45 + c * 1.5;
    // 입고재고 구역 z 8.75~11.53(대형재고를 북쪽으로 줄인 만큼 늘림, 사용자 2026-11-22 "대형재고 평수 줄여서 북쪽으로 밀고, 입고재고 평수 늘려") 가운데, 사람은 팔레트 남쪽(z 11.2)에서 검수
    addReserve(`WR-${String(c + 1).padStart(2, '0')}`, 'AMBIENT', x0, 9.59 - 5.6, { x: x0 + P / 2, z: 11.2 - 5.6 }, 'RECEIVING');
  }
  // 대형재고 바닥 팔레트 12자리 [가정] — 북쪽 벽 줄 6 | 사이 통로 1.4 m | 앞 줄 6 | 앞 통로. 줄마다 서쪽 3 | 틈 1.2 m | 동쪽 3
  // (사용자 2026-11-22 "대형재고 2 4 가 아니라 3 3 으로", 전엔 4 4 / 4 4 = 16 → 2 4). 사이 통로는 서쪽 끝(벽 ~ 첫 열 1.2 m)과 가운데 틈으로 들어간다.
  // 새 평면(+1.0, +5.6): 대형재고 구역 z 3.55~8.75(앞 통로 1.45 m), 벽 줄 z 3.7~4.8, 앞 줄 6.2~7.3, 열 x 40.6·41.8·43.0 | 45.3·46.5·47.7(+1.1).
  // 번호는 열마다 벽 쪽 → 앞, 서쪽 열부터(WB-01~12) — 서버 A-R2-13~16 은 쓰지 않음(R-37)
  {
    let n = 0;
    // 2026-11-22 5 / 5 = 10자리(사용자 "대형재고 팔레트 5 / 5 이렇게 해서 평수 줄인다음에") — 자리는 compact474 에서 다시 놓음
    for (const xNew of [40.6, 41.8, 43.0, 45.3, 46.5]) {
      const x0 = xNew - 1.0;
      addReserve(`WB-${String(++n).padStart(2, '0')}`, 'AMBIENT', x0, 3.7 - 5.6, { x: x0 + P / 2, z: 5.5 - 5.6 }, 'BULK');
      addReserve(`WB-${String(++n).padStart(2, '0')}`, 'AMBIENT', x0, 6.2 - 5.6, { x: x0 + P / 2, z: 7.75 - 5.6 }, 'BULK');
    }
  }
  // 휴게·사무 가운데 긴 사무용 테이블 3.6×0.8 m + 의자(양쪽 3개씩) 자리 — 걸어서 피해 가게 장애물로(그림은 Decor OfficeDecor) [시뮬]
  // (사용자 2026-11-21 "휴게실 중간에 사무용 길다란 테이블이랑 의자랑 PC1대 놔줘")
  obstacles.push({ rect: { x0: 40.8, z0: 23.95, x1: 44.4, z1: 25.85 }, height: 0.75, kind: 'TABLE' }); // 휴게·사무가 얕아져 1.0 m 북쪽(새 평면 z 0.75~2.65)
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

  // ── 예전 평면 → 새 평면(구역마다 평행 이동) ─────────────
  const rackMove = new Map<string, { dx: number; dz: number }>();
  for (const r of racks) {
    const m = placedNew.has(r.id) ? { dx: 0, dz: 0 } : moveOf(r.cx, r.cz);
    rackMove.set(r.id, m);
    r.cx += m.dx;
    r.cz += m.dz;
  }
  for (const l of locations) {
    const m = rackMove.get(l.rackId)!;
    l.pick = { x: l.pick.x + m.dx, z: l.pick.z + m.dz };
    l.shelf = { ...l.shelf, x: l.shelf.x + m.dx, z: l.shelf.z + m.dz };
  }
  for (const r of reserves) {
    const m = moveOf((r.rect.x0 + r.rect.x1) / 2, (r.rect.z0 + r.rect.z1) / 2);
    r.rect = { x0: r.rect.x0 + m.dx, z0: r.rect.z0 + m.dz, x1: r.rect.x1 + m.dx, z1: r.rect.z1 + m.dz };
    r.stand = { x: r.stand.x + m.dx, z: r.stand.z + m.dz };
  }
  // 장애물(팔레트 자리 포함 — 팔레트 장애물은 reserves 의 옮기기 전 rect 를 따로 들고 있다)도 가운데 점 기준으로 옮긴다
  for (const o of obstacles) o.rect = mvRect(o.rect);
  for (const st of stations) {
    const m = moveOf(st.table.x, st.table.z);
    st.table = { x: st.table.x + m.dx, z: st.table.z + m.dz };
    st.stand = { x: st.stand.x + m.dx, z: st.stand.z + m.dz };
  }
  for (const sl of shippingSlots) sl.pos = { ...sl.pos, ...mv({ x: sl.pos.x, z: sl.pos.z }) };
  for (const d of dockSlots) d.pos = mv(d.pos);

  // 냉동·냉장 서쪽 벽 띠(COLD_BAND, 폭 3.0 m, 방 북쪽 끝): 북쪽부터 입고재고 팔레트 2(북쪽 문 가까이) → 보충재고 랙 12(서쪽 벽 한 줄) → 격리(구역 AQ·BQ, z 21.1~25.1)
  // (사용자 2026-11-21 "냉장냉동구역에 격리랑 입고재고랑 보충고가 남쪽문을 막고있잖아. 왼쪽 벽면으로 다 옮겨 버려") — 남북 문 앞을 비운다
  for (const [temp, X0, prefix, rid] of [['FROZEN', COLD_BAND.FROZEN, 'RRF', 'AR'], ['CHILLED', COLD_BAND.CHILLED, 'RRC', 'BR']] as const) {
    // 보충재고 랙 12개는 서쪽 벽에 등 댄 한 줄(동쪽을 봄, z 5.6~20.6) — 앞 통로 약 2.45 m(사용자 2026-11-22 "보충재고 랙 통로만" 넓히기, 전엔 등 맞댄 2줄 × 6 통로 0.9·1.2 m)
    const rs: Rack[] = Array.from({ length: 12 }, (_, i) => ({
      id: `${prefix}-${i + 1}`, temp, group: 'R01', rackNo: i + 1, cx: X0 + 0.05 + RACK_DEPTH / 2, cz: 5.6 + RACK_LEN * (i + 0.5), along: 'z' as const, face: 1 as const,
      levels: RESERVE_SLOTS[0], slotsPerLevel: RESERVE_SLOTS[1], reserve: true,
    }));
    racks.push(...rs);
    addLocations(rs);
    // 입고재고 팔레트 2개는 서쪽 벽을 따라 세로(남북)로(사용자 2026-11-22 "냉동냉장 입고재고 팔레트 2개 가로로 놓아져있는거 세로로 돌려"), 사람은 동쪽에서
    [1.95, 3.2].forEach((z0, j) => addReserve(`${rid}-${j + 3}`, temp, X0 + 0.25, z0, { x: X0 + 2.0, z: 3.15 }, 'RECEIVING'));
  }

  // 장바구니 거치대(시작점)·작업자 대기는 상온 C~H 남쪽 앞(상온 z 28.4 ~ 남쪽 통로) — 예전 자리(상온 아래 통로)에서 +1.0, +11.8
  // (사용자 2026-11-21 "장바구니 거치대가 상온 앞 남쪽에 있어야 겠는데" — 전엔 가운데 통로)
  const hub = (p: { x: number; z: number }) => ({ x: p.x + 1.0, z: p.z + 11.8 });
  void OLD_W;
  void W;
  void BD;
  const points: Layout['points'] = {
    truckDoor: { x: 31.2, z: 0.9 },
    truckDock: { x: 31.2, z: -2.9 },
    inboundIdle: Array.from({ length: 8 }, (_, i) => mv({ x: 38.3 + (i % 4) * 0.8, z: 19.2 + Math.floor(i / 4) * 0.9 })),
    cartDepot: hub({ x: 33.2, z: 18.6 }),
    idle: Array.from({ length: 24 }, (_, i) => hub({ x: 24.2 + (i % 12) * 1.0, z: 16.4 + Math.floor(i / 12) * 0.8 })),
    packQueue: mv({ x: 33.9, z: 19.4 }),
    shipDrop: mv({ x: 30, z: 32.75 }),
    riderPickup: mv({ x: 30, z: 34.2 }),
    riderParking: Array.from({ length: 10 }, (_, i) => mv({ x: 25 + i * 1.2, z: 38.4 })),
    riderEntry: mv({ x: 30, z: 39.6 }),
  };

  compact474({ zones, walls, racks, locations, reserves, obstacles, stations, shippingSlots, dockSlots, points });

  return {
    variant: 'SEED',
    geo: { yardX: YARD_X, liftAnnex: LIFT_ANNEX, freightLifts: FREIGHT_LIFTS, liftZ0: LIFT_Z0, returnIntake: { x: BACKEND_FACTS_RETURN.x, z: BACKEND_FACTS_RETURN.z } },
    width: W2,
    depth: D,
    buildingDepth: BD2,
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
    points,
  };
}

// ── 건축면적 474.55평 맞춤(2026-11-22) ─────────────────────────────
// 사용자 결정: "건축면적은 474.55평으로 맞춰 / 지금 구역이나 통로 위치를 바꾸거나 없애지 말고 랙 갯수를 줄이지 않는다 /
// 인계구역은 건물 안 … 라이더 대기구역은 건물 밖 … 포함하지 않는다 / 냉장 95 냉동 97 상온 69 상온입고창고 45 격리 6(2+2+2) 입고검수 20 패킹 18
// 휴게사무 9 인계 3 벽두께 12.5 이동통로 100.05 총 474.55". MFC 는 2층 — 입고는 북쪽 화물 승강기 2대(MFC 밖·건물 안, 입고·검수로 바로 열림),
// 인계도 2층(남쪽 출하문 앞 돌출부, 라이더에게 건네는 창). 초안 그림(사용자 "이미지 먼저" → "응")대로.
// 구역 순서·통로·랙 수·칸 코드는 그대로 — 냉장·냉동은 방 폭만(COLD_BAND·coldRows), 나머지는 아래에서 구역 줄마다 옮기고 줄인다.
// 같은 날 다시(사용자): "냉장 95 냉동 95 상온 69 상온입고창고 45 격리 6(2+2+2) 입고검수 20 패킹 15 휴게사무 7 인계 3 벽두께 12.5 이동통로 95 … mfc 내부는 463평이고
// 엘레베이터 승강기 2대 입고차량에서 옮기는 통로는 474평에서 463평을 뺀 11평에 포함" + "화물승강기 크기 좀 키워주고, 화물승강기 왼쪽이나 오른쪽에서 입고차량 들어오는 것도".
// → MFC 46x.xx m(463평) + 북쪽 승강기 별동 11평(LIFT_ANNEX: 승강로 2 × 3.4 × 3.6 m + 동쪽 하역 통로 3.2 m, 입고 차량은 그 동쪽에 대고 내림) = 474평.
/** 건물 폭(m) */
export const W2 = 45.618;
/** 건물 깊이(m) — 냉장·냉동 남쪽 통로 1.9 → 1.3 m */
export const BD2 = 33.3;
/** 인계 돌출부(벽 바깥 면) — 남쪽 출하문 앞 6.2 × 1.853 m */
export const SHIP_BUMP = { x0: 36.918, z0: BD2, x1: 43.118, z1: 35.153 } as const;
/** 화물 승강기 2대(MFC 밖, 입고·검수 북쪽 벽에 붙은 승강로 3.4 × 3.6 m, 문 2.2 m) [가정 — 4~5 t 화물용, 사용자 2026-11-22 "화물승강기 크기 좀 키워주고"] */
export const FREIGHT_LIFTS: readonly { x0: number; x1: number; door: [number, number] }[] = [
  { x0: 23.778, x1: 27.178, door: [24.378, 26.578] },
  { x0: 27.278, x1: 30.678, door: [27.878, 30.078] },
];
/** 승강로 북쪽 끝 z(MFC 북쪽 외벽 z 0 바깥) */
export const LIFT_Z0 = -3.6;
/** 승강기 별동(MFC 밖·건물 안 11평 = 10.1 × 3.6 m): 승강로 2개 + 동쪽 하역 통로(입고 차량에서 승강기로 옮기는 길, 동쪽 벽 문으로 차량) */
export const LIFT_ANNEX = { x0: 23.778, z0: -3.6, x1: 33.878, z1: 0, truckDoor: [-3.0, -0.6] as [number, number] } as const;

/** 474.55평 이전 평면 좌표 → 지금 평면(냉장·냉동은 그대로, 그 동쪽은 구역 줄마다) */
function c474(x: number, z: number): { x: number; z: number } {
  if (x < 23.0) return { x, z }; // 냉장·냉동(방 폭은 만들 때 이미 줄임)
  if (z >= 33.8) return { x: x - 3.582, z }; // 남쪽 바깥(라이더)
  if (x < 38.3) {
    // 입고·검수·상온·장바구니 거치대 줄: 서쪽으로 1.4 m. 입고·검수 깊이 6.3 → 6.122, 상온 남쪽 앞 5.4 → 5.07 m
    const nz = z <= 6.4 ? z * (6.222 / 6.4) : z <= 28.4 ? z : 28.23 + (z - 28.4) * ((BD2 - 28.23) / (33.8 - 28.4));
    return { x: x - 1.922, z: nz };
  }
  if (z < 21.2) {
    // 휴게·사무·상온 입고창고: 동쪽 벽에 붙여(−2.415). 휴게·사무 깊이 3.35 → 3.297, 창고 북쪽 −0.053, 보충재고 랙 쪽 −0.2
    // 2026-11-22 대형재고 5/5·통로 좁힘으로 대형재고 구역 5.2 → 4.35 m — 그 남쪽(입고재고·보충재고·격리)을 0.85 m 북쪽으로
    const nz = z < 3.45 ? z * (2.663 / 3.35) : z < 12.6 ? z - 1.537 : z - 1.05;
    return { x: x - 3.582, z: nz };
  }
  // 패킹 줄: 서쪽으로 2.0, 깊이 8.0 → 5.959 m
  const nz = z < 23.0 ? 19.994 + (z - 21.2) * ((22.071 - 19.994) / 1.8) : 22.071 + (z - 23.0) * (6.159 / 8.0);
  return { x: x - 2.522, z: nz };
}

function compact474(o: {
  zones: Zone[];
  walls: Wall[];
  racks: Rack[];
  locations: Location[];
  reserves: ReserveSpot[];
  obstacles: Obstacle[];
  stations: PackingStation[];
  shippingSlots: ShippingSlot[];
  dockSlots: DockSlot[];
  points: Layout['points'];
}) {
  // 구역(목표 평수 — 사각형 넓이). 격리는 냉장·냉동·입고창고 안
  const R: Record<string, Rect> = {
    A: { x0: COLD_BAND.FROZEN, z0: 1.8, x1: 21.578, z1: 31.8 }, // 97평 = 냉동 95 + 격리 2
    B: { x0: 0, z0: 1.8, x1: 10.689, z1: 31.8 }, // 97평 = 냉장 95 + 격리 2
    'C-H': { x0: 22.278, z0: 11.7, x1: 36.078, z1: 28.23 }, // 69평
    WH: { x0: 36.729, z0: 2.863, x1: 45.418, z1: 19.894 }, // 약 44.8평 = 입고창고 약 42.8 + 상온 격리 2(대형재고 5/5·통로 좁힘 −0.85 m, 사용자 2026-11-22)
    RCV: { x0: 23.878, z0: 0, x1: 34.678, z1: 6.122 }, // 20평
    OFF: { x0: 36.729, z0: 0, x1: 45.418, z1: 2.663 }, // 7평
    PK: { x0: 36.078, z0: 22.071, x1: 45.418, z1: 28.23 }, // 남쪽 선을 상온 남쪽 선(z 28.23)과 같게(사용자 2026-11-22 "하얀실선으로 구역 표시해 놓은 거 상온이랑 같게 패킹구역 남쪽으로 밀어봐") // 약 17.4평 = 15 + 대형재고에서 줄인 만큼("대형재고에서 줄인 만큼 패킹구역 평수 늘려줘")
    AQ: { x0: COLD_BAND.FROZEN, z0: 21.1, x1: COLD_BAND.FROZEN + COLD_BAND.mark, z1: COLD_BAND.z1 }, // 2평
    BQ: { x0: COLD_BAND.CHILLED, z0: 21.1, x1: COLD_BAND.CHILLED + COLD_BAND.mark, z1: COLD_BAND.z1 }, // 2평
    CQ: { x0: 42.418, z0: 17.69, x1: 45.418, z1: 19.894 }, // 2평
    SHIP: { x0: 37.018, z0: BD2 + 0.1, x1: 43.018, z1: SHIP_BUMP.z1 - 0.1 }, // 3평(인계, 건물 안 돌출부)
  };
  const PY: Record<string, number> = { A: 95, B: 95, 'C-H': 69, WH: 42.8, RCV: 20, OFF: 7, PK: 17.4, AQ: 2, BQ: 2, CQ: 2, SHIP: 3 };
  for (const z of o.zones) {
    if (R[z.id]) {
      z.rect = R[z.id];
      z.docPyeong = PY[z.id];
    } else if (z.id === 'PARK') z.rect = { ...z.rect, x0: z.rect.x0 - 3.582, x1: z.rect.x1 - 3.582 };
    if (z.id === 'SHIP') z.label = '인계';
  }

  // 랙(냉장·냉동은 그대로) — 칸은 랙과 같은 만큼
  const delta = new Map<string, { dx: number; dz: number }>();
  for (const r of o.racks) {
    const n = c474(r.cx, r.cz);
    delta.set(r.id, { dx: n.x - r.cx, dz: n.z - r.cz });
    r.cx = n.x;
    r.cz = n.z;
  }
  for (const l of o.locations) {
    const d = delta.get(l.rackId)!;
    l.pick = { x: l.pick.x + d.dx, z: l.pick.z + d.dz };
    l.shelf = { ...l.shelf, x: l.shelf.x + d.dx, z: l.shelf.z + d.dz };
  }
  const shiftRect = (r: Rect) => {
    const c = c474((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    const dx = c.x - (r.x0 + r.x1) / 2;
    const dz = c.z - (r.z0 + r.z1) / 2;
    return { r: { x0: r.x0 + dx, z0: r.z0 + dz, x1: r.x1 + dx, z1: r.z1 + dz }, dx, dz };
  };
  // 팔레트 자리 장애물 ↔ 팔레트 자리(옮기기 전 사각형이 같다)
  const resOf = new Map<Obstacle, ReserveSpot>();
  for (const ob of o.obstacles) {
    if (ob.kind !== 'RESERVE') continue;
    const rs = o.reserves.find((q) => Math.abs(q.rect.x0 - ob.rect.x0) < 1e-6 && Math.abs(q.rect.z0 - ob.rect.z0) < 1e-6);
    if (rs) resOf.set(ob, rs);
  }
  // 대형재고 5 / 5(2026-11-22 사용자 "대형재고 팔레트 5 / 5" → "사이 통로도 좁힘"): 한 줄 5개, 열은 입고재고 팔레트와 같은 x(간격 1.5 m), 양 끝으로 두 줄 사이 통로에 들어감.
  // 벽 줄 z 3.013~4.113 | 사이 통로 1.0 m | 앞 줄 5.113~6.213 | 앞 통로 1.0 m | 입고재고 선 7.213. 번호는 열마다 벽 쪽 → 앞(WB-01~10)
  const BULK_X0 = (R.WH.x0 + R.WH.x1) / 2 - (5 * 1.1 + 4 * 0.15) / 2;
  for (const rs of o.reserves) {
    const { r, dx, dz } = shiftRect(rs.rect);
    rs.rect = r;
    rs.stand = { x: rs.stand.x + dx, z: rs.stand.z + dz };
  }
  // 대형재고 열 x = 입고재고 팔레트 x(간격 1.5 m 로 같게, 사용자 2026-11-22 "대형재고 팔레트 5개 간격 입고재고 팔레트 간격이랑 맞게")
  const wrX = o.reserves.filter((q) => q.id.startsWith('WR-')).sort((p, q) => p.id.localeCompare(q.id)).map((q) => q.rect.x0);
  for (const rs of o.reserves) {
    if (rs.role !== 'BULK') continue;
    const n = Number(rs.id.slice(3)) - 1;
    const x0 = wrX[Math.floor(n / 2)] ?? BULK_X0 + Math.floor(n / 2) * 1.25;
    const z0 = n % 2 === 0 ? R.WH.z0 + 0.15 : R.WH.z0 + 0.15 + 1.1 + 1.0;
    rs.rect = { x0, z0, x1: x0 + 1.1, z1: z0 + 1.1 };
    rs.stand = { x: x0 + 0.55, z: z0 + 1.1 + 0.5 };
  }
  // 패킹대: 두 줄을 새 패킹 구역 위·아래로(가운데 통로), 가로 자리는 서쪽으로 2.0
  const oldTableX = o.stations.map((st) => st.table.x);
  for (const st of o.stations) {
    const top = st.index < 4;
    const tz = top ? R.PK.z0 + 0.65 : R.PK.z1 - 0.65;
    // 포장재 랙 장식을 뺀 자리만큼 패킹대 사이를 벌림(사용자 2026-11-22 "패킹구역에 랙장식 없애주고 … 패킹대 사이사이에 공간 조금씩") — 양 끝 0.3 m, 사이 같게
    const col = st.index % 4;
    const gap = (R.PK.x1 - R.PK.x0 - 0.6 - 4 * PACK_TABLE_W) / 3;
    const tx = R.PK.x0 + 0.3 + PACK_TABLE_W / 2 + col * (PACK_TABLE_W + gap);
    st.table = { x: tx, z: tz };
    st.stand = { x: tx, z: top ? tz + 1.2 : tz - 1.2 };
  }
  const shipX = [38.618, 41.418];
  const shipZ = SHIP_BUMP.z0 + 0.1 + 0.25 + RACK_DEPTH / 2;
  for (const ob of o.obstacles) {
    const cx = (ob.rect.x0 + ob.rect.x1) / 2;
    const cz = (ob.rect.z0 + ob.rect.z1) / 2;
    if (ob.kind === 'RESERVE' && resOf.has(ob)) {
      ob.rect = { ...resOf.get(ob)!.rect }; // 팔레트 자리 장애물은 위 팔레트 자리와 같은 자리로
    } else if (ob.kind === 'TABLE' && cx >= 38.3 && cz < 3.45) {
      // 휴게·사무 바 테이블(Decor OFFICE_TABLE) + 의자 6
      ob.rect = { x0: 41.074 - 1.8, z0: 0.1, x1: 41.074 + 1.8, z1: 1.35 }; // 바 테이블(북쪽 벽 쪽 3.6 × 0.5) + 의자 한 줄
    } else if (ob.kind === 'TABLE' && cx >= 38.3 && cz >= 21.2) {
      // 패킹대 탁자 — 같은 열(예전 x)·같은 줄(위·아래)의 패킹대 자리로
      const top = cz < 27;
      const i = o.stations.findIndex((s, k) => Math.abs(oldTableX[k] - cx) < 0.05 && s.index < 4 === top);
      const t = o.stations[i];
      ob.rect = { x0: t.table.x - PACK_TABLE_W / 2, z0: t.table.z - 0.4, x1: t.table.x + PACK_TABLE_W / 2, z1: t.table.z + 0.4 };
    } else if (ob.kind === 'MATERIAL') {
      ob.rect = { x0: 0, z0: 0, x1: 0, z1: 0 }; // 아래에서 뺌(포장재 랙 장식 없앰)
    } else if (ob.kind === 'SHIP_RACK') {
      const i = cx < 43.5 ? 0 : 1;
      ob.rect = { x0: shipX[i] - RACK_LEN / 2, z0: shipZ - RACK_DEPTH / 2, x1: shipX[i] + RACK_LEN / 2, z1: shipZ + RACK_DEPTH / 2 };
    } else ob.rect = shiftRect(ob.rect).r;
  }
  for (let i = o.obstacles.length - 1; i >= 0; i--) if (o.obstacles[i].kind === 'MATERIAL') o.obstacles.splice(i, 1);
  for (const sl of o.shippingSlots) {
    const s = Math.round((sl.pos.x - (sl.rackIndex === 0 ? 42.2 : 45.0) + 0.45) / 0.3);
    sl.pos = { ...sl.pos, x: shipX[sl.rackIndex] - 0.45 + s * 0.3, z: shipZ };
  }
  for (const d of o.dockSlots) d.pos = c474(d.pos.x, d.pos.z);
  const P = o.points;
  // 점원이 받는 자리 = 두 승강기 문 사이 입고·검수 안, 입고 차량 = 별동 동쪽 하역 통로 문에 뒷문을 대고(차량 뒤끝 = 별동 동쪽 벽 + 0.3 m, 트럭 그림 뒷문 로컬 x −3.2)
  P.truckDoor = { x: (FREIGHT_LIFTS[0].door[1] + FREIGHT_LIFTS[1].door[0]) / 2, z: 0.9 };
  P.truckDock = { x: LIFT_ANNEX.x1 + 0.3 + 3.2, z: (LIFT_ANNEX.truckDoor[0] + LIFT_ANNEX.truckDoor[1]) / 2 };
  P.inboundIdle = P.inboundIdle.map((p) => c474(p.x, p.z));
  P.cartDepot = c474(P.cartDepot.x, P.cartDepot.z);
  P.idle = P.idle.map((p) => c474(p.x, p.z));
  // 패킹 대기 지점 = 패킹 구역 서쪽 입구(피킹 구역 쪽), 위·아래 패킹대 줄 사이 통로. 예전엔 c474 로 옮기다 동쪽 벽(입고창고·패킹 사이)에 가 있었다
  // (사용자 2026-11-23 "패킹할 때 왜 동쪽 벽에 한 번 박고 장바구니 거치대로 갔다가 패킹하러 가는거지?") [시뮬]
  P.packQueue = { x: R.PK.x0 + 0.5, z: (R.PK.z0 + R.PK.z1) / 2 };
  P.shipDrop = { x: (R.SHIP.x0 + R.SHIP.x1) / 2, z: BD2 - 0.4 }; // 출하문 안쪽(포장 봉투를 인계 랙으로)
  P.riderPickup = { x: (R.SHIP.x0 + R.SHIP.x1) / 2, z: SHIP_BUMP.z1 + 0.55 }; // 인계 창 밖
  P.riderParking = P.riderParking.map((p) => c474(p.x, p.z));
  P.riderEntry = c474(P.riderEntry.x, P.riderEntry.z);

  // 벽 다시(두께 0.2 m 그대로, 문 자리는 옮긴 구역에 맞춤)
  o.walls.length = 0;
  const T = 0.2;
  const H = 3.0;
  const hWall = (z: number, x0: number, x1: number, doors: [number, number][] = [], height = H) => {
    let cur = x0;
    for (const [d0, d1] of doors) {
      if (d0 > cur) o.walls.push({ rect: { x0: cur, z0: z - T / 2, x1: d0, z1: z + T / 2 }, height });
      cur = d1;
    }
    if (cur < x1) o.walls.push({ rect: { x0: cur, z0: z - T / 2, x1, z1: z + T / 2 }, height });
  };
  const vWall = (x: number, z0: number, z1: number, doors: [number, number][] = []) => {
    let cur = z0;
    for (const [d0, d1] of doors) {
      if (d0 > cur) o.walls.push({ rect: { x0: x - T / 2, z0: cur, x1: x + T / 2, z1: d0 }, height: H });
      cur = d1;
    }
    if (cur < z1) o.walls.push({ rect: { x0: x - T / 2, z0: cur, x1: x + T / 2, z1 }, height: H });
  };
  // 외벽: 북쪽 = 화물 승강기 문 2개(입고·검수로 바로), 남쪽 = 출하문(인계 돌출부로)
  hWall(0, 0, W2, FREIGHT_LIFTS.map((l) => l.door));
  hWall(BD2, 0, W2, [[38.818, 41.218]]);
  vWall(0, 0, BD2);
  vWall(W2, 0, BD2);
  // 인계 돌출부: 동·서 벽, 남쪽은 라이더에게 건네는 낮은 창
  vWall(SHIP_BUMP.x0 + T / 2, BD2, SHIP_BUMP.z1);
  vWall(SHIP_BUMP.x1 - T / 2, BD2, SHIP_BUMP.z1);
  hWall(SHIP_BUMP.z1 - T / 2, SHIP_BUMP.x0, SHIP_BUMP.x1, [], 1.1);
  // 냉장·냉동(문은 북·남 하나씩)
  hWall(1.7, 0, 21.678, [[4.6, 6.6], [19.0, 21.4]]);
  vWall(COLD_BAND.FROZEN - 0.1, 1.7, 31.9);
  vWall(21.678, 1.7, 31.9);
  hWall(31.9, 0, 21.678, [[4.6, 6.6], [16.0, 18.0]]);
  // 입고·검수(서쪽 문은 북쪽 통로와 일직선, 남쪽 문은 가운데 마당)
  vWall(23.778, 0, 6.222, [[0.1, 2.0]]);
  hWall(6.222, 23.778, 34.778, [[27.778, 32.778]]);
  vWall(34.778, 0, 6.222);
  // 승강기 별동(MFC 밖·건물 안): 서·북 벽, 동쪽 벽엔 입고 차량 하역 문
  vWall(LIFT_ANNEX.x0, LIFT_ANNEX.z0, 0);
  hWall(LIFT_ANNEX.z0, LIFT_ANNEX.x0, LIFT_ANNEX.x1);
  vWall(LIFT_ANNEX.x1, LIFT_ANNEX.z0, 0, [LIFT_ANNEX.truckDoor]);
  // 휴게·사무·상온 입고창고(서쪽 벽 한 줄, 문: 휴게·사무 / 대형재고 앞 통로 / 보충재고 남쪽 통로)
  vWall(36.629, 0, 19.994, [[0.6, 2.1], [6.1, 8.2], [15.85, 17.65]]);
  hWall(2.763, 36.629, W2);
  hWall(19.994, 36.629, W2);
  // 바깥 앞마당 울타리(라이더 대기)
  const fence = 1.0;
  o.walls.push({ rect: { x0: YARD_X[0] - 0.15, z0: BD2, x1: YARD_X[0], z1: D }, height: fence });
  o.walls.push({ rect: { x0: YARD_X[1], z0: BD2, x1: YARD_X[1] + 0.15, z1: D }, height: fence });
}
