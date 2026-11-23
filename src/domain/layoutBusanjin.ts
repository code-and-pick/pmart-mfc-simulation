// 1호점 부산진구 MFC(MFC-SEED-01) 다시 설계 — R-45(2026-11-24).
// 근거: 백엔드 요청 docs/handoff/simulator/mfc/2026-11-24-request-busanjin-redesign.md, 사용자 평면도 2026-11-24-busanjin-floorplan-user.png
// (사용자 "부산 진구 mfc 수정해야해. 평면 설계랑 랙갯수랑 평수 전부. 이미지랑 적힌 것 대로"). 건물 37.0 × 25.3 m(MFC 265평 + 승강기 별동 10평).
// 사용자 결정(PC3·PC1 전달, 2026-11-24): 랙당 칸은 지금 1호점 그대로(SLOT_DESIGN), 칸 코드도 지금 1호점 코드를 되도록 그대로 —
//   그래서 옛 1호점 평면(buildLayout)의 랙 코드를 그룹마다 앞에서부터 골라 새 자리에 놓는다(재고는 같은 코드면 그대로, 없어지는 칸만 옮김).
//   H 는 1호점 넓은 칸 랙(H01-02~06·H02-07)이 남게 H01 8 + H02-01~03 + H02-07. 넓은 칸 59·닫힘 100 이 모두 남는다.
// 대형재고 10자리(A-R2-01~10)는 그림에 없지만 입고창고에 그대로(사용자 2026-11-24 "입고창고에 10자리 유지").
// 좌표 m, x = 동쪽, z = 남쪽. 건물 서쪽 밖(x 0~5)에 라이더 대기 마당을 두려고 건물을 OX 만큼 동쪽으로 민다.
//
// 위(북)에서 본 배치(그림 그대로):
//   북서 = 승강기 별동(화물 승강기 2 — 입고 차량은 건물 북쪽 길) → 입고·검수(북쪽 가운데) | 북동 = 상온 입고창고(대형재고 10·보충재고 랙 15)
//   가운데 위 = 냉동, 가운데 아래 = 냉장(방마다 북쪽 벽 보충재고 랙 7·입고재고 팔레트 2, 서쪽 벽 격리, 피킹 랙 가로 줄 등 맞댄 3쌍)
//   동쪽 세로 띠 + 남쪽 가로 띠 = 상온 C~H(동쪽 줄마다 3 | 3 한 면 9줄, 남쪽 등 맞댄 한 쌍) + 상온 격리(남쪽 띠 서쪽)
//   서쪽 = 인계(서쪽 벽 인계 창 → 건물 밖 라이더 대기), 장바구니 거치대(냉동·냉장 서쪽 벽), 패킹 8(4 | 4, 남서)

import type { TemperatureZone } from './contract';
import {
  PACK_TABLE_W,
  RACK_DEPTH,
  RACK_HEIGHT,
  RACK_LEN,
  buildLayout,
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

/** 건물 서쪽 밖 마당 폭(라이더 대기) */
export const BSJ_OX = 5.0;
const OX = BSJ_OX;
/** 건물 37.0 × 25.3 m = 936 m² ≈ 283평(MFC 265 + 별동 10 + 벽·기둥 오차) */
export const BSJ_W = 37.0;
export const BSJ_BD = 25.3;

/** 사용자 표(요청서 §3) 랙 수 [확정] — 랙당 칸은 지금 1호점 SLOT_DESIGN 그대로(사용자 결정) */
export const BUSANJIN_RACKS = { B: 76, A: 64, C: 14, D: 14, E: 12, F: 14, G: 16, H: 12, reserveChilled: 7, reserveFrozen: 7, reserveAmbient: 15 } as const;

const X = (x: number) => OX + x;
const R = {
  ANNEX: { x0: X(0), z0: 0, x1: X(5.6), z1: 5.9 }, // 승강기 별동 10평(MFC 밖)
  RCV: { x0: X(10.1), z0: 0, x1: X(26.3), z1: 2.5 }, // 입고·검수 12평(16.2 × 2.5 = 40.5 m²)
  A: { x0: X(5.6), z0: 2.55, x1: X(25.7), z1: 12.45 }, // 냉동 58평 + 격리
  B: { x0: X(5.6), z0: 12.45, x1: X(25.7), z1: 22.35 }, // 냉장 58평 + 격리
  WH: { x0: X(26.3), z0: 0, x1: X(37), z1: 5.8 }, // 상온 입고창고 18평(10.7 × 5.8 = 62 m²)
  CH: { x0: X(25.7), z0: 5.8, x1: X(37), z1: 22.35 }, // 상온 동쪽 세로 띠
  CH2: { x0: X(5.6), z0: 22.35, x1: X(37), z1: BSJ_BD }, // 상온 남쪽 가로 띠
  PK: { x0: X(0), z0: 14.85, x1: X(3.8), z1: BSJ_BD }, // 패킹 12평(3.8 × 10.45 = 39.7 m²) — 패킹대 2줄이 구역 안에
  SHIP: { x0: X(1.6), z0: 9.0, x1: X(3.6), z1: 12.3 }, // 인계 대기 2평(2.0 × 3.3) — 그림처럼 서쪽 통로 가운데 따로 선 칸
  CQ: { x0: X(10.3), z0: 23.0, x1: X(11.8), z1: 25.2 }, // 상온 격리 1평(1.5 × 2.2) — 그림처럼 남쪽 띠 G·H 줄 서쪽, 남쪽 벽에 붙음(북쪽 통로는 열어 둠)
  PARK: { x0: 0.6, z0: 7.3, x1: 4.6, z1: 16.6 }, // 라이더 대기 11.3평(건물 밖 서쪽, 입고 차량 남쪽)
} as const satisfies Record<string, Rect>;
/** 저온 방 안: 서쪽 벽 띠(격리), 북쪽 벽 띠(보충재고 랙 7 + 입고재고 팔레트 2), 피킹 줄 시작 x */
/** 격리는 그림처럼 서쪽 벽 북쪽(보충재고 랙 띠 바로 아래) */
const COLD = { x0: X(5.7), bandZ: 1.2, rowX0: X(7.6), q: { x0: X(5.8), w: 1.4, len: 2.8, dz: 1.4 } } as const;

const ZONE_PY: Record<string, number> = { B: 58, A: 58, 'C-H': 41, WH: 18, RCV: 12, PK: 12, AQ: 1, BQ: 1, CQ: 1, SHIP: 2 };

export function buildBusanjinLayout(): Layout {
  // ── 옛 1호점 랙 코드 고르기 ─────────────────────────────
  // 새 평면의 물리 줄(묶음)마다 옛 1호점의 한 줄 코드를 앞에서부터 — 한 줄 안에 다른 줄 번호가 섞이지 않게(사용자 2026-11-24 "니가 볼 땐 이 배치가 맞다고 생각하니? 손 볼게 너무 많잖아" → "다 고쳐" — "A03-16 옆 A02-17")
  const old = buildLayout();
  const oldRack = new Map(old.racks.filter((r) => !r.reserve).map((r) => [`${r.group}-${r.rackNo}`, r]));
  const run = (group: string, from: number, n: number): Rack[] =>
    Array.from({ length: n }, (_, i) => {
      const r = oldRack.get(`${group}-${from + i}`);
      if (!r) throw new Error(`옛 1호점에 ${group}-${from + i} 없음`);
      return r;
    });
  const resOld = (temp: TemperatureZone, n: number) => old.racks.filter((r) => !!r.reserve && r.temp === temp).slice(0, n);
  const place = (r: Rack, cx: number, cz: number, along: 'x' | 'z', face: 1 | -1): Rack => ({ ...r, cx, cz, along, face });

  // ── 냉동·냉장 방 ─────────────────────────────────────
  const reserves: ReserveSpot[] = [];
  const obstacles: Obstacle[] = [];
  const P = 1.1;
  const addReserve = (id: string, temp: TemperatureZone, x0: number, z0: number, stand: { x: number; z: number }, role: ReserveSpot['role']) => {
    const rect = { x0, z0, x1: x0 + P, z1: z0 + P };
    reserves.push({ id, temp, rect, stand, role });
    obstacles.push({ rect, height: 0.15, kind: 'RESERVE' });
  };
  /** 방마다 통로 z 범위(북쪽부터) — 문을 통로에 맞춤 */
  const coldAisles: Record<'FROZEN' | 'CHILLED', [number, number][]> = { FROZEN: [], CHILLED: [] };
  // 피킹: 그림처럼 한 면 가로 줄(북쪽을 봄, 줄마다 앞 통로), 고르게 6줄 — 줄마다 서쪽 묶음 | 통로 1.4 m | 동쪽 묶음.
  // (그림의 4줄 × 16랙은 랙 길이 1.25 m 로 한 줄 20 m 라 방 폭에 안 들어감 → 6줄)
  const coldRoom = (temp: 'FROZEN' | 'CHILLED', room: Rect, rows: Rack[][], resRacks: Rack[], rid: string): Rack[] => {
    const out: Rack[] = [];
    const z0 = room.z0 + 0.1;
    const z1 = room.z1 - 0.1;
    // 북쪽 벽 띠: 보충재고 랙 7(남쪽을 봄) → 입고재고 팔레트 2
    resRacks.forEach((r, i) => out.push(place(r, COLD.x0 + 0.1 + RACK_LEN * (i + 0.5), z0 + 0.05 + RACK_DEPTH / 2, 'x', 1)));
    const palX = COLD.x0 + 0.1 + resRacks.length * RACK_LEN + 0.4;
    [0, 1].forEach((j) => addReserve(`${rid}-${j + 3}`, temp, palX + j * (P + 0.3), z0 + 0.05, { x: palX + j * (P + 0.3) + P / 2, z: z0 + 0.05 + P + 0.4 }, 'RECEIVING'));
    const zA = z0 + COLD.bandZ;
    const a = (z1 - zA - rows.length * RACK_DEPTH) / rows.length;
    // 가운데 통로(x)는 모든 줄이 같은 자리, 줄 묶음은 방 폭 가운데로(짧은 줄은 동쪽 묶음이 짧음)
    const maxN = Math.max(...rows.map((r) => r.length));
    const west = Math.ceil(maxN / 2);
    const blockW = maxN * RACK_LEN + 1.4;
    const bx0 = COLD.rowX0 + (room.x1 - 0.15 - COLD.rowX0 - blockW) / 2;
    rows.forEach((row, k) => {
      const top = zA + k * (a + RACK_DEPTH);
      coldAisles[temp].push([top, top + a]);
      const cz = top + a + RACK_DEPTH / 2;
      row.forEach((r, i) => out.push(place(r, bx0 + (i < west ? (i + 0.5) * RACK_LEN : west * RACK_LEN + 1.4 + (i - west + 0.5) * RACK_LEN), cz, 'x', -1)));
    });
    return out;
  };
  const frozen = coldRoom('FROZEN', R.A, [run('A01', 1, 11), run('A02', 1, 11), run('A03', 1, 11), run('A04', 1, 11), run('A05', 1, 10), run('A06', 1, 10)], resOld('FROZEN', BUSANJIN_RACKS.reserveFrozen), 'AR');
  const chilled = coldRoom('CHILLED', R.B, [run('B01', 1, 13), run('B02', 1, 13), run('B03', 1, 13), run('B04', 1, 13), run('B05', 1, 12), run('B06', 1, 12)], resOld('CHILLED', BUSANJIN_RACKS.reserveChilled), 'BR');

  // ── 상온 C~H(그림대로) ─────────────────────────────────
  // 동쪽 세로 띠: 한 면 가로 줄 8(남쪽을 봄), 줄마다 서쪽 4 | 통로 1.0 m | 동쪽 나머지, 북쪽부터 C → D → E → F.
  // 남쪽 가로 띠: 등 맞댄 한 쌍 — 북쪽 줄 G, 남쪽 줄 H(+ G 2), 서쪽 묶음 6 | (가운데 빈 곳 — 그림의 구역 이름 자리) | 동쪽 묶음 8(동쪽 벽까지).
  // 넓은 칸 랙 H01-02~06·H02-07 이 남게 H01-01~06 + H02-02~07.
  const ambient: Rack[] = [];
  const EAST = { x0: X(26.4), z0: 6.05, z1: 21.9 } as const;
  const eastRows = [run('C01', 1, 7), run('C02', 1, 7), run('D02', 1, 7), run('D03', 1, 7), run('E02', 1, 6), run('E03', 1, 6), run('F02', 1, 7), run('F03', 1, 7)];
  const pitch = (EAST.z1 - EAST.z0 - RACK_DEPTH) / (eastRows.length - 1);
  eastRows.forEach((row, k) => {
    const cz = EAST.z0 + k * pitch + RACK_DEPTH / 2;
    row.forEach((r, i) => ambient.push(place(r, EAST.x0 + (i < 4 ? (i + 0.5) * RACK_LEN : 4 * RACK_LEN + 1.0 + (i - 3.5) * RACK_LEN), cz, 'x', 1)));
  });
  const SOUTH_Z = 23.4;
  const southSegs: [number, Rack[], Rack[]][] = [
    [X(12.6), run('G01', 1, 6), run('H01', 1, 6)],
    [X(BSJ_W) - 0.3 - 8 * RACK_LEN, run('G02', 1, 8), [...run('H02', 2, 6), ...run('G03', 1, 2)]],
  ];
  for (const [x0, north, south] of southSegs) {
    north.forEach((r, i) => ambient.push(place(r, x0 + (i + 0.5) * RACK_LEN, SOUTH_Z + RACK_DEPTH / 2, 'x', -1)));
    south.forEach((r, i) => ambient.push(place(r, x0 + (i + 0.5) * RACK_LEN, SOUTH_Z + 1.5 * RACK_DEPTH, 'x', 1)));
  }

  // ── 상온 입고창고: 맨 안쪽(북쪽 벽) 대형재고 10(5 | 5 두 줄) → 보충재고 랙 15(등 맞댄 한 쌍 8 + 7, 문 쪽) ──
  const whReserve: Rack[] = [];
  {
    const rs = resOld('AMBIENT', BUSANJIN_RACKS.reserveAmbient);
    const x0 = (R.WH.x0 + R.WH.x1) / 2 - 4 * RACK_LEN;
    const zp = 3.55;
    rs.forEach((r, i) => {
      const row = i < 8 ? 0 : 1;
      const j = row ? i - 8 : i;
      whReserve.push(place(r, x0 + (j + 0.5) * RACK_LEN, zp + (row ? 1.5 : 0.5) * RACK_DEPTH, 'x', row ? 1 : -1));
    });
    let n = 0;
    for (const z0 of [0.15, 1.35]) for (let c = 0; c < 5; c++) {
      const bx = R.WH.x0 + 0.5 + c * 2.0;
      addReserve(`WB-${String(++n).padStart(2, '0')}`, 'AMBIENT', bx, z0, { x: bx + P + 0.35, z: z0 + P / 2 }, 'BULK');
    }
  }
  // 상온 입고재고 팔레트 5(RCV-A-02) — 그림 입고창고에 자리가 없어 입고·검수 동쪽 끝 남쪽 벽에
  for (let c = 0; c < 5; c++) {
    const x0 = R.RCV.x1 - 0.15 - (5 - c) * (P + 0.15);
    addReserve(`WR-${String(c + 1).padStart(2, '0')}`, 'AMBIENT', x0, R.RCV.z1 - 0.1 - P, { x: x0 + P / 2, z: R.RCV.z1 - 0.1 - P - 0.4 }, 'RECEIVING');
  }

  const racks = [...frozen, ...chilled, ...ambient, ...whReserve];
  // 칸 순서 = 옛 1호점 순서(피킹 순서가 그대로 이어지게), 자리만 새로
  const fresh = new Map<string, Location>();
  for (const r of racks) for (const l of rackLocations(r)) fresh.set(l.code, l);
  const locations: Location[] = old.locations.filter((l) => fresh.has(l.code)).map((l) => fresh.get(l.code)!);
  const locationsByTemp: Record<TemperatureZone, Location[]> = { AMBIENT: [], CHILLED: [], FROZEN: [] };
  for (const l of locations) if (!l.reserve) locationsByTemp[l.temp].push(l);

  // ── 벽 ─────────────────────────────────────────────
  const T = 0.2;
  const H = 3.0;
  const walls: Wall[] = [];
  const hWall = (z: number, x0: number, x1: number, doors: (readonly [number, number])[] = []) => {
    let cur = x0;
    for (const [d0, d1] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (d0 > cur) walls.push({ rect: { x0: cur, z0: z - T / 2, x1: d0, z1: z + T / 2 }, height: H });
      cur = d1;
    }
    if (cur < x1) walls.push({ rect: { x0: cur, z0: z - T / 2, x1, z1: z + T / 2 }, height: H });
  };
  const vWall = (x: number, z0: number, z1: number, doors: (readonly [number, number])[] = []) => {
    let cur = z0;
    for (const [d0, d1] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (d0 > cur) walls.push({ rect: { x0: x - T / 2, z0: cur, x1: x + T / 2, z1: d0 }, height: H });
      cur = d1;
    }
    if (cur < z1) walls.push({ rect: { x0: x - T / 2, z0: cur, x1: x + T / 2, z1 }, height: H });
  };
  const SHIP_WINDOW: readonly [number, number] = [11.4, 12.6]; // 그림 인계 창(서쪽 벽, 인계 대기 칸 남쪽 끝 옆)
  hWall(0, X(0), X(BSJ_W));
  hWall(BSJ_BD, X(0), X(BSJ_W));
  vWall(X(0), 0, BSJ_BD, [SHIP_WINDOW]);
  walls.push({ rect: { x0: X(0) - T / 2, z0: SHIP_WINDOW[0], x1: X(0) + T / 2, z1: SHIP_WINDOW[1] }, height: 1.1 }); // 인계 창(허리 높이 창턱 — 라이더는 밖에서 받음)
  vWall(X(BSJ_W), 0, BSJ_BD);
  // 승강기 별동: 동쪽 문(입고·검수 쪽 통로)만 — 남쪽 벽 앞은 장바구니 거치대
  vWall(R.ANNEX.x1, 0, R.ANNEX.z1, [[0.3, 2.3]]);
  hWall(R.ANNEX.z1, R.ANNEX.x0, R.ANNEX.x1);
  // 냉동·냉장: 문은 통로에 맞춤 — 냉동 북쪽(입고·검수에서), 서쪽·동쪽은 두 번째 통로
  const door = (c: number) => [c - 0.9, c + 0.9] as const;
  // 서쪽·동쪽 문 = 다섯째 통로(격리·장바구니 거치대와 안 겹침)
  const fA1 = (coldAisles.FROZEN[4][0] + coldAisles.FROZEN[4][1]) / 2;
  const cA1 = (coldAisles.CHILLED[4][0] + coldAisles.CHILLED[4][1]) / 2;
  const FROZEN_NORTH_DOOR = door(X(19.8));
  hWall(R.A.z0, R.A.x0, R.A.x1, [FROZEN_NORTH_DOOR]);
  hWall(R.A.z1, R.A.x0, R.A.x1);
  hWall(R.B.z1, R.A.x0, R.A.x1);
  vWall(R.A.x0, R.A.z0, R.B.z1, [door(fA1), door(cA1)]);
  vWall(R.A.x1, R.A.z0, R.B.z1, [door(fA1), door(cA1)]);
  // 입고·검수 ↔ 입고창고 문, 입고창고 남쪽 문(상온 동쪽 띠 가운데 통로)
  vWall(R.WH.x0, 0, R.WH.z1, [[0.35, 2.25]]);
  hWall(R.WH.z1, R.WH.x0, R.WH.x1, [door(EAST.x0 + 4 * RACK_LEN + 0.5)]);
  // 패킹 북쪽 벽(그림)
  hWall(R.PK.z0, R.PK.x0, R.PK.x1);

  // ── 패킹대 8 = 서쪽 줄 4 | 동쪽 줄 4(사람은 남쪽에) ─────────────
  const stations: PackingStation[] = [];
  for (let i = 0; i < 8; i++) {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const tx = X(0.95 + col * 1.9);
    const tz = R.PK.z0 + 0.9 + row * 2.6;
    stations.push({ id: `PS-${i + 1}`, index: i, table: { x: tx, z: tz }, stand: { x: tx, z: tz + 0.85 } });
    obstacles.push({ rect: { x0: tx - PACK_TABLE_W / 2, z0: tz - 0.4, x1: tx + PACK_TABLE_W / 2, z1: tz + 0.4 }, height: 0.9, kind: 'TABLE' });
  }

  // ── 인계 랙 2 — 인계 대기 칸 북·남 끝에 가로로(그림), 가운데 비움 ─────────────
  const shippingSlots: ShippingSlot[] = [];
  const shipCx = R.SHIP.x0 + 0.1 + RACK_LEN / 2;
  [R.SHIP.z0 + 0.1 + RACK_DEPTH / 2, R.SHIP.z1 - 0.1 - RACK_DEPTH / 2].forEach((cz, ri) => {
    obstacles.push({ rect: { x0: shipCx - RACK_LEN / 2, z0: cz - RACK_DEPTH / 2, x1: shipCx + RACK_LEN / 2, z1: cz + RACK_DEPTH / 2 }, height: RACK_HEIGHT, kind: 'SHIP_RACK' });
    for (let lv = 0; lv < 4; lv++) for (let s2 = 0; s2 < 4; s2++) shippingSlots.push({ id: `SR${ri + 1}-${lv + 1}${s2 + 1}`, rackIndex: ri, pos: { x: shipCx - 0.45 + s2 * 0.3, y: 0.25 + lv * 0.5, z: cz } });
  });

  const dockSlots: DockSlot[] = [];
  for (const z of [0.6, 1.3]) for (let c = 0; c < 9; c++) dockSlots.push({ id: `DK-${dockSlots.length + 1}`, pos: { x: X(11.0) + c * 0.75, z } });

  // ── 구역 ─────────────────────────────────────────────
  const q = (room: Rect) => ({ x0: COLD.q.x0, z0: room.z0 + COLD.q.dz, x1: COLD.q.x0 + COLD.q.w, z1: room.z0 + COLD.q.dz + COLD.q.len });
  const zones: Zone[] = [
    { id: 'A', kind: 'FROZEN', label: '냉동 A', rect: R.A, docPyeong: ZONE_PY.A },
    { id: 'B', kind: 'CHILLED', label: '냉장 B', rect: R.B, docPyeong: ZONE_PY.B },
    { id: 'C-H', kind: 'AMBIENT', label: '상온 C~H', rect: R.CH, docPyeong: ZONE_PY['C-H'] },
    { id: 'C-H2', kind: 'AMBIENT', label: '상온 C~H', rect: R.CH2, noTag: true },
    { id: 'WH', kind: 'INBOUND_STORE', label: '상온 입고창고', rect: R.WH, docPyeong: ZONE_PY.WH },
    { id: 'RCV', kind: 'RECEIVING', label: '입고·검수', rect: R.RCV, docPyeong: ZONE_PY.RCV },
    { id: 'PK', kind: 'PACKING', label: '패킹', rect: R.PK, docPyeong: ZONE_PY.PK },
    { id: 'AQ', kind: 'QUARANTINE', label: '냉동 격리', rect: q(R.A), docPyeong: 1 },
    { id: 'BQ', kind: 'QUARANTINE', label: '냉장 격리', rect: q(R.B), docPyeong: 1 },
    { id: 'CQ', kind: 'QUARANTINE', label: '상온 격리', rect: R.CQ, docPyeong: 1 },
    { id: 'SHIP', kind: 'SHIPPING', label: '인계', rect: R.SHIP, docPyeong: ZONE_PY.SHIP },
    { id: 'PARK', kind: 'PARKING', label: '라이더 대기', rect: R.PARK },
  ];

  // ── 바닥 표시: 저온 북쪽 벽 띠(보충 | 입고), 입고창고(대형재고 | 보충재고) ──
  const coldArea = (room: Rect, color: 'FROZEN' | 'CHILLED'): StoreArea => {
    const z0 = room.z0 + 0.1, z1 = z0 + COLD.bandZ, x0 = COLD.x0, x1 = palEnd(), div = COLD.x0 + 0.1 + 7 * RACK_LEN + 0.2;
    return {
      floor: [x0, z0, x1, z1],
      color,
      lines: [[x0 + 0.12, z0 + 0.12, x1 - 0.12, z0 + 0.12], [x0 + 0.12, z1 - 0.12, x1 - 0.12, z1 - 0.12], [x0 + 0.12, z0 + 0.12, x0 + 0.12, z1 - 0.12], [x1 - 0.12, z0 + 0.12, x1 - 0.12, z1 - 0.12], [div, z0 + 0.12, div, z1 - 0.12]],
      texts: [
        { t: '보충', x: (x0 + div) / 2, z: z1 - 0.35 },
        { t: '입고', x: (div + x1) / 2, z: z1 - 0.35 },
      ],
    };
  };
  function palEnd() {
    return COLD.x0 + 0.1 + 7 * RACK_LEN + 0.4 + 2 * P + 0.3 + 0.3;
  }
  const storeAreas: StoreArea[] = [
    coldArea(R.A, 'FROZEN'),
    coldArea(R.B, 'CHILLED'),
    {
      floor: [R.WH.x0, R.WH.z0 + 0.1, R.WH.x1, R.WH.z1],
      lines: [[R.WH.x0 + 0.12, 2.95, R.WH.x1 - 0.12, 2.95]],
      texts: [
        { t: '대형재고', x: R.WH.x1 - 0.9, z: 2.65 },
        { t: '보충재고', x: R.WH.x1 - 0.9, z: 5.45 },
      ],
    },
  ];

  // ── 점 ───────────────────────────────────────────────
  // 장바구니 거치대: 냉동·냉장 서쪽 벽 앞 세로(카트 줄 x ≈ OX+4.4, 냉동 서쪽 문과 냉장 서쪽 문 사이)
  // 장바구니 거치대: 승강기 별동 남쪽 벽 앞 가로(카트 x OX+0.2~5.2), 시작점은 동쪽 끝
  const cartDepot = { x: X(4.5), z: R.ANNEX.z1 + 1.0 };
  const points: Layout['points'] = {
    truckDoor: { x: X(2.15), z: 3.0 },
    truckDock: { x: 20, z: 3.6 }, // 서쪽 마당 세로 차로(geo.truckLaneX) — z 는 서 있을 때 차 가운데, x 는 차로 위 거리 기준값
    inboundIdle: Array.from({ length: 8 }, (_, i) => ({ x: X(14.0) + (i % 4) * 0.8, z: 1.0 + Math.floor(i / 4) * 0.7 })),
    cartDepot,
    idle: Array.from({ length: 24 }, (_, i) => ({ x: X(0.5) + (i % 8) * 0.6, z: 12.9 + Math.floor(i / 8) * 0.5 })),
    packQueue: { x: X(4.7), z: R.PK.z0 + 0.6 },
    shipDrop: { x: (R.SHIP.x0 + R.SHIP.x1) / 2, z: (R.SHIP.z0 + R.SHIP.z1) / 2 },
    riderPickup: { x: X(-0.6), z: (SHIP_WINDOW[0] + SHIP_WINDOW[1]) / 2 },
    riderParking: Array.from({ length: 9 }, (_, i) => ({ x: 1.2 + (i % 3) * 1.3, z: 7.9 + Math.floor(i / 3) * 3.2 })),
    riderEntry: { x: 2.5, z: BSJ_BD + 0.3 },
  };

  const geo: SiteGeo = {
    yardX: [0, 0.01],
    truckLaneX: 2.5,
    liftAnnex: { ...R.ANNEX, truckDoor: [-3.0, -0.6] },
    freightLifts: [
      { x0: X(0.2), x1: X(2.1), door: [X(0.45), X(1.85)] },
      { x0: X(2.2), x1: X(4.1), door: [X(2.45), X(3.85)] },
    ],
    liftZ0: -2.3,
    liftDoorZ: 2.4,
    floorX0: OX,
    outsideYards: [{ x0: 0, z0: 0, x1: OX, z1: BSJ_BD + 0.6 }],
    returnIntake: { x: X(-1.3), z: SHIP_WINDOW[1] + 1.0 },
    storeAreas,
    officeTable: null, // 그림에 휴게·사무 없음
    rollContainers: [X(23.6), X(24.4)].map((x) => ({ x, z: 0.7 })),
    quarantineRacks: {
      ...Object.fromEntries(([['AQ', R.A], ['BQ', R.B]] as const).map(([id, room]) => {
        const r = q(room);
        return [id, [0, 1].map((i) => ({ x0: r.x0 + 0.1, z0: r.z0 + 0.1 + i * (RACK_LEN + 0.1), x1: r.x0 + 0.1 + RACK_DEPTH, z1: r.z0 + 0.1 + i * (RACK_LEN + 0.1) + RACK_LEN }))];
      })),
      // 상온 격리: 가로 2개, 남쪽 것은 남쪽 벽에 — 서로 마주 봐 가운데에서 둘 다 꺼냄
      CQ: [R.CQ.z1 - 0.1 - RACK_DEPTH, R.CQ.z0 + 0.05].map((z0) => ({ x0: R.CQ.x0 + 0.125, z0, x1: R.CQ.x0 + 0.125 + RACK_LEN, z1: z0 + RACK_DEPTH })),
    },
    cartDepotVertical: false,
    returnTable: { x: X(0.9), z: 8.3 },
  };

  return {
    variant: 'BUSANJIN',
    geo,
    width: X(BSJ_W),
    depth: BSJ_BD + 0.6,
    buildingDepth: BSJ_BD,
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
