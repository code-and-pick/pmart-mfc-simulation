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
  PK: { x0: X(0), z0: 14.4, x1: X(3.6), z1: BSJ_BD }, // 패킹 12평(3.6 × 10.9 = 39.2 m²)
  SHIP: { x0: X(0.1), z0: 8.4, x1: X(1.6), z1: 12.8 }, // 인계 2평(1.5 × 4.4)
  CQ: { x0: X(2.4), z0: 23.4, x1: X(6.1), z1: 24.3 }, // 상온 격리 1평(3.7 × 0.9) — 남쪽 띠 서쪽 끝, 랙 줄과 한 줄
  PARK: { x0: 0.6, z0: 6.3, x1: 4.6, z1: 15.6 }, // 라이더 대기 11.3평(건물 밖 서쪽)
} as const satisfies Record<string, Rect>;
/** 저온 방 안: 서쪽 벽 띠(격리), 북쪽 벽 띠(보충재고 랙 7 + 입고재고 팔레트 2), 피킹 줄 시작 x */
const COLD = { x0: X(5.7), bandZ: 1.2, rowX0: X(7.6), q: { x0: X(5.8), w: 1.4, len: 2.8, dz: 5.85 } } as const;

const ZONE_PY: Record<string, number> = { B: 58, A: 58, 'C-H': 41, WH: 18, RCV: 12, PK: 12, AQ: 1, BQ: 1, CQ: 1, SHIP: 2 };

export function buildBusanjinLayout(): Layout {
  // ── 옛 1호점 랙 코드 고르기 ─────────────────────────────
  const old = buildLayout();
  const pickRacks = (pred: (r: Rack) => boolean, n: number, keep?: (r: Rack) => boolean): Rack[] => {
    const all = old.racks.filter(pred);
    if (!keep) return all.slice(0, n);
    const must = all.filter(keep);
    return [...all.filter((r) => !must.includes(r)).slice(0, n - must.length), ...must].sort((a, b) => all.indexOf(a) - all.indexOf(b));
  };
  const pick = (temp: TemperatureZone, g: string, n: number, keep?: (r: Rack) => boolean) => pickRacks((r) => !r.reserve && r.temp === temp && r.group[0] === g, n, keep);
  const frozenOld = pick('FROZEN', 'A', BUSANJIN_RACKS.A);
  const chilledOld = pick('CHILLED', 'B', BUSANJIN_RACKS.B);
  const amb = {
    C: pick('AMBIENT', 'C', BUSANJIN_RACKS.C),
    D: pick('AMBIENT', 'D', BUSANJIN_RACKS.D),
    E: pick('AMBIENT', 'E', BUSANJIN_RACKS.E),
    F: pick('AMBIENT', 'F', BUSANJIN_RACKS.F),
    G: pick('AMBIENT', 'G', BUSANJIN_RACKS.G),
    // 넓은 칸 랙(H01-02~06 은 H01 앞 8 안, H02-07 은 따로 남김)
    H: pick('AMBIENT', 'H', BUSANJIN_RACKS.H, (r) => r.group === 'H02' && r.rackNo === 7),
  };
  const resOld = (temp: TemperatureZone, n: number) => pickRacks((r) => !!r.reserve && r.temp === temp, n);
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
  const coldDoors: Record<'FROZEN' | 'CHILLED', { aisle1: [number, number] }> = { FROZEN: { aisle1: [0, 0] }, CHILLED: { aisle1: [0, 0] } };
  const coldRoom = (temp: 'FROZEN' | 'CHILLED', room: Rect, pickRacksOld: Rack[], perRow: number[], resRacks: Rack[], rid: string): Rack[] => {
    const out: Rack[] = [];
    const z0 = room.z0 + 0.1;
    const z1 = room.z1 - 0.1;
    // 북쪽 벽 띠: 보충재고 랙 7(남쪽을 봄) → 입고재고 팔레트 2
    resRacks.forEach((r, i) => out.push(place(r, COLD.x0 + 0.1 + RACK_LEN * (i + 0.5), z0 + 0.05 + RACK_DEPTH / 2, 'x', 1)));
    const palX = COLD.x0 + 0.1 + resRacks.length * RACK_LEN + 0.4;
    [0, 1].forEach((j) => addReserve(`${rid}-${j + 3}`, temp, palX + j * (P + 0.3), z0 + 0.05, { x: palX + j * (P + 0.3) + P / 2, z: z0 + 0.05 + P + 0.4 }, 'RECEIVING'));
    // 피킹: 등 맞댄 3쌍(가로 줄), 줄마다 서쪽 묶음 | 통로 1.4 m | 동쪽 묶음
    const zA = z0 + COLD.bandZ;
    const a = (z1 - zA - 3 * 2 * RACK_DEPTH) / 4;
    coldDoors[temp].aisle1 = [zA + a + 2 * RACK_DEPTH, zA + 2 * a + 2 * RACK_DEPTH];
    let k = 0;
    for (let p = 0; p < 3; p++) {
      const top = zA + a + p * (2 * RACK_DEPTH + a);
      for (const [cz, face] of [[top + RACK_DEPTH / 2, -1], [top + 1.5 * RACK_DEPTH, 1]] as const) {
        const row = perRow[rowIdx(perRow, k)];
        const west = Math.ceil(row / 2);
        for (let i = 0; i < row; i++) {
          const x = COLD.rowX0 + (i < west ? (i + 0.5) * RACK_LEN : west * RACK_LEN + 1.4 + (i - west + 0.5) * RACK_LEN);
          out.push(place(pickRacksOld[k + i], x, cz, 'x', face));
        }
        k += row;
      }
    }
    return out;
  };
  // perRow 의 몇 번째 줄인지(앞 줄 합으로)
  function rowIdx(perRow: number[], k: number) {
    let acc = 0;
    for (let i = 0; i < perRow.length; i++) {
      if (k === acc) return i;
      acc += perRow[i];
    }
    return perRow.length - 1;
  }
  const frozen = coldRoom('FROZEN', R.A, frozenOld, [11, 11, 11, 11, 10, 10], resOld('FROZEN', BUSANJIN_RACKS.reserveFrozen), 'AR');
  const chilled = coldRoom('CHILLED', R.B, chilledOld, [13, 13, 13, 13, 12, 12], resOld('CHILLED', BUSANJIN_RACKS.reserveChilled), 'BR');

  // ── 상온 C~H ──────────────────────────────────────────
  // 남쪽 띠(패킹에서 가까움): 등 맞댄 한 쌍, 줄마다 6 | 4 | 4. 고회전 F 를 패킹 쪽(서쪽)부터(사용자 2026-11-24 "고회전F열이 패킹대에 제일 가까이"), 이어 G.
  // 동쪽 띠: 한 면 줄 9(남쪽을 봄), 줄마다 3 | 통로 1.4 m | 3, 남쪽 줄부터 G 나머지 → C → D → E → H.
  const ambient: Rack[] = [];
  const southSlots: { x: number; cz: number; face: 1 | -1 }[] = [];
  {
    const segs = [[X(6.6), 6], [X(6.6) + 6 * RACK_LEN + 1.4, 4], [X(6.6) + 10 * RACK_LEN + 2.8, 4]] as const;
    for (const [x0, n] of segs) for (let i = 0; i < n; i++) for (const [cz, face] of [[R.CQ.z0 + RACK_DEPTH / 2, -1], [R.CQ.z0 + 1.5 * RACK_DEPTH, 1]] as const) southSlots.push({ x: x0 + (i + 0.5) * RACK_LEN, cz, face });
  }
  southSlots.sort((p, q) => p.x - q.x || p.cz - q.cz);
  const eastSlots: { x: number; cz: number; face: 1 | -1 }[] = [];
  const EAST = { x0: X(26.9), rows: 9, z0: 6.0, pitch: 1.82 } as const;
  for (let k = EAST.rows - 1; k >= 0; k--) {
    const cz = EAST.z0 + k * EAST.pitch + RACK_DEPTH / 2;
    for (let i = 0; i < 6; i++) eastSlots.push({ x: EAST.x0 + (i < 3 ? (i + 0.5) * RACK_LEN : 3 * RACK_LEN + 1.4 + (i - 2.5) * RACK_LEN), cz, face: 1 });
  }
  const ambOrder = [...amb.F, ...amb.G, ...amb.C, ...amb.D, ...amb.E, ...amb.H];
  const ambSlots = [...southSlots, ...eastSlots];
  ambOrder.forEach((r, i) => ambient.push(place(r, ambSlots[i].x, ambSlots[i].cz, 'x', ambSlots[i].face)));

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
  const SHIP_WINDOW: readonly [number, number] = [9.95, 11.25];
  hWall(0, X(0), X(BSJ_W));
  hWall(BSJ_BD, X(0), X(BSJ_W));
  vWall(X(0), 0, BSJ_BD, [SHIP_WINDOW]);
  walls.push({ rect: { x0: X(0) - T / 2, z0: SHIP_WINDOW[0], x1: X(0) + T / 2, z1: SHIP_WINDOW[1] }, height: 1.1 }); // 인계 창(허리 높이 창턱 — 라이더는 밖에서 받음)
  vWall(X(BSJ_W), 0, BSJ_BD);
  // 승강기 별동: 동쪽 문(입고·검수 쪽 통로), 남쪽 문(서쪽 통로·장바구니 거치대 쪽)
  vWall(R.ANNEX.x1, 0, R.ANNEX.z1, [[0.3, 2.3]]);
  hWall(R.ANNEX.z1, R.ANNEX.x0, R.ANNEX.x1, [[X(1.0), X(2.8)]]);
  // 냉동·냉장: 문은 통로에 맞춤 — 냉동 북쪽(입고·검수에서), 서쪽·동쪽은 두 번째 통로
  const door = (c: number) => [c - 0.9, c + 0.9] as const;
  const fA1 = (coldDoors.FROZEN.aisle1[0] + coldDoors.FROZEN.aisle1[1]) / 2;
  const cA1 = (coldDoors.CHILLED.aisle1[0] + coldDoors.CHILLED.aisle1[1]) / 2;
  const FROZEN_NORTH_DOOR = door(X(19.8));
  hWall(R.A.z0, R.A.x0, R.A.x1, [FROZEN_NORTH_DOOR]);
  hWall(R.A.z1, R.A.x0, R.A.x1);
  hWall(R.B.z1, R.A.x0, R.A.x1);
  vWall(R.A.x0, R.A.z0, R.B.z1, [door(fA1), door(cA1)]);
  vWall(R.A.x1, R.A.z0, R.B.z1, [door(fA1), door(cA1)]);
  // 입고·검수 ↔ 입고창고 문, 입고창고 남쪽 문(상온 동쪽 띠 가운데 통로)
  vWall(R.WH.x0, 0, R.WH.z1, [[0.35, 2.25]]);
  hWall(R.WH.z1, R.WH.x0, R.WH.x1, [door(EAST.x0 + 3 * RACK_LEN + 0.7)]);
  // 패킹 북쪽 벽(그림)
  hWall(R.PK.z0, R.PK.x0, R.PK.x1);

  // ── 패킹대 8 = 서쪽 줄 4 | 동쪽 줄 4(사람은 남쪽에) ─────────────
  const stations: PackingStation[] = [];
  for (let i = 0; i < 8; i++) {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const tx = X(1.0 + col * 2.0);
    const tz = R.PK.z0 + 0.9 + row * 2.6;
    stations.push({ id: `PS-${i + 1}`, index: i, table: { x: tx, z: tz }, stand: { x: tx, z: tz + 0.85 } });
    obstacles.push({ rect: { x0: tx - PACK_TABLE_W / 2, z0: tz - 0.4, x1: tx + PACK_TABLE_W / 2, z1: tz + 0.4 }, height: 0.9, kind: 'TABLE' });
  }

  // ── 인계 랙 2 — 서쪽 벽에 세로로, 인계 창 앞 비움 ─────────────
  const shippingSlots: ShippingSlot[] = [];
  const shipX = R.SHIP.x0 + 0.05 + RACK_DEPTH / 2;
  [R.SHIP.z0 + 0.1 + RACK_LEN / 2, R.SHIP.z1 - 0.1 - RACK_LEN / 2].forEach((cz, ri) => {
    obstacles.push({ rect: { x0: shipX - RACK_DEPTH / 2, z0: cz - RACK_LEN / 2, x1: shipX + RACK_DEPTH / 2, z1: cz + RACK_LEN / 2 }, height: RACK_HEIGHT, kind: 'SHIP_RACK' });
    for (let lv = 0; lv < 4; lv++) for (let s = 0; s < 4; s++) shippingSlots.push({ id: `SR${ri + 1}-${lv + 1}${s + 1}`, rackIndex: ri, pos: { x: shipX, y: 0.25 + lv * 0.5, z: cz - 0.45 + s * 0.3 } });
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
  const cartDepot = { x: X(5.0), z: fA1 + 1.6 };
  const points: Layout['points'] = {
    truckDoor: { x: X(2.15), z: 3.0 },
    truckDock: { x: X(2.8) + 3.2, z: -1.8 },
    inboundIdle: Array.from({ length: 8 }, (_, i) => ({ x: X(14.0) + (i % 4) * 0.8, z: 1.0 + Math.floor(i / 4) * 0.7 })),
    cartDepot,
    idle: Array.from({ length: 24 }, (_, i) => ({ x: X(0.6) + (i % 6) * 0.55, z: 6.3 + Math.floor(i / 6) * 0.5 })),
    packQueue: { x: X(4.6), z: R.PK.z0 + 0.6 },
    shipDrop: { x: X(1.4), z: (SHIP_WINDOW[0] + SHIP_WINDOW[1]) / 2 },
    riderPickup: { x: X(-0.6), z: (SHIP_WINDOW[0] + SHIP_WINDOW[1]) / 2 },
    riderParking: Array.from({ length: 9 }, (_, i) => ({ x: 1.2 + (i % 3) * 1.3, z: 6.9 + Math.floor(i / 3) * 3.2 })),
    riderEntry: { x: 2.5, z: BSJ_BD + 0.3 },
  };

  const geo: SiteGeo = {
    yardX: [0, 0.01],
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
      CQ: [0, 1].map((i) => ({ x0: R.CQ.x0 + 0.5 + i * (RACK_LEN + 0.1), z0: R.CQ.z0 + 0.05, x1: R.CQ.x0 + 0.5 + i * (RACK_LEN + 0.1) + RACK_LEN, z1: R.CQ.z0 + 0.05 + RACK_DEPTH })),
    },
    cartDepotVertical: true,
    returnTable: { x: X(2.8), z: 13.6 },
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
