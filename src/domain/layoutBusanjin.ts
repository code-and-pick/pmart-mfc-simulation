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
  RCV: { x0: X(9.2), z0: 0, x1: X(24.7), z1: 2.5 }, // 입고·검수 12평(15.5 × 2.5 = 38.75 m²) — 동쪽 끝은 냉동 동쪽 벽 줄까지(입고창고 앞 통로 안 침범, 사용자 2026-11-24 "상온 구역 랙 통로 줄여서 입고 창고 크기 늘리고 입고 검수구역에 팔레트 없애 … 입고검수 실선도 상온입고창고 통로쪽에 침범하지마")
  // 냉동·냉장 동쪽도 1.0 m 줄여 입고창고 앞 통로 확보(x 24.7~26.3 = 1.6 m, 사용자 2026-11-24 "냉장냉동 동쪽 평수도 좀 줄여서 상온 입고창고 통로도 확보하자") — 방마다 18.1 × 9.9 = 54평(격리 포함)
  // 냉동·냉장 서쪽을 1.0 m 줄여 패킹 구역 확보(사용자 2026-11-24 "냉장냉동 서쪽 평수 좀 줄여서 패킹 구역 확보하자") — 방마다 19.1 × 9.9 = 57평(격리 포함)
  // 냉동은 등 맞댄 3쌍이라 남쪽을 줄임(18.1 × 8.05 = 44평), 냉장은 그만큼 북쪽으로(사용자 2026-11-24 "냉동 적치랙 8 8/8 8/8 8/8 8 이거에서 10 10/10 10/8 8 이렇게 바꾸고 남쪽 평수 줄여서 냉장구역 북쪽으로 당기고, 아래 상온 구역 북쪽으로 밀어" + 64대 맞춤 답 "12 12 / 12 12 / 8 8")
  A: { x0: X(6.6), z0: 2.55, x1: X(24.7), z1: 10.6 },
  B: { x0: X(6.6), z0: 10.6, x1: X(24.7), z1: 20.5 },
  // 상온 입고창고 29평(10.7 × 8.95 = 96 m²) — 상온 동쪽 줄 통로를 1.1 m 로 줄여 줄을 남쪽으로 몰고 입고창고를 남쪽으로 늘림(사용자 2026-11-24 "상온구역 랙 통로 간격 줄여서 남쪽으로 밀고 상온입고창고 남쪽으로 확장 시켜"), 입고재고 팔레트 5 안에
  WH: { x0: X(26.3), z0: 0, x1: X(37), z1: 8.95 },
  CH: { x0: X(24.7), z0: 8.95, x1: X(37), z1: 20.5 }, // 상온 동쪽 세로 띠
  CH2: { x0: X(6.6), z0: 20.5, x1: X(37), z1: BSJ_BD }, // 상온 남쪽 가로 띠(냉장을 북쪽으로 당긴 만큼 북쪽으로)
  PK: { x0: X(0), z0: 14.85, x1: X(4.8), z1: BSJ_BD }, // 패킹 15평(4.8 × 10.45 = 50 m²) — 냉동·냉장 서쪽을 줄여 넓힘(사용자 2026-11-24 "냉장냉동 서쪽 평수 좀 줄여서 패킹 구역 확보하자")
  SHIP: { x0: X(1.6), z0: 9.0, x1: X(3.6), z1: 12.3 }, // 인계 대기 2평(2.0 × 3.3) — 그림처럼 서쪽 통로 가운데 따로 선 칸
  CQ: { x0: X(10.3), z0: 22.05, x1: X(11.8), z1: 24.25 }, // 상온 격리 1평(1.5 × 2.2) — 남쪽 띠 G·H 쌍 서쪽, 쌍과 같은 높이
  PARK: { x0: 0.6, z0: 7.3, x1: 4.6, z1: 16.6 }, // 라이더 대기 11.3평(건물 밖 서쪽, 입고 차량 남쪽)
} as const satisfies Record<string, Rect>;
/** 저온 방 안: 서쪽 벽 띠(격리), 북쪽 벽 띠(보충재고 랙 7 + 입고재고 팔레트 2), 피킹 줄 시작 x */
/** 남쪽 띠 G·H 쌍 북쪽 면 z — 띠(냉장 남쪽 벽 20.5 ~ 건물 남쪽 벽 25.3) 가운데 */
const SOUTH_PAIR_Z = (20.6 + BSJ_BD - 0.1) / 2 - RACK_DEPTH;
/** 저온 방 북쪽 벽 띠(보충재고 랙 7 → 입고재고 팔레트 2 → 격리), 피킹 줄 시작 x */
const COLD = { x0: X(6.7), bandZ: 1.2, rowX0: X(7.1) } as const;

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
  // 피킹: 그림의 가로 4줄 = 등 맞댄 4쌍(사용자 2026-11-24 "냉장냉동구역에 다 6개씩 놔두다가 왜 2줄은 5개씩 두고 내 쪽에서 랙 식별값도 안 보여?").
  //   한 쌍의 북쪽 면·남쪽 면이 같은 묶음 모양(냉동 4 | 4, 냉장 5 | 5 와 5 | 4) — 남쪽 면은 남쪽(화면 앞)을 봐 번호판이 보임.
  //   그림 한 줄 16·19랙은 랙 길이 1.25 m 로 20 m 넘어 방에 안 들어가 한 줄을 등 맞댄 두 면으로 나눔.
  const coldRoom = (temp: 'FROZEN' | 'CHILLED', room: Rect, pairs: [Rack[], Rack[]][], resRacks: Rack[], rid: string): Rack[] => {
    const out: Rack[] = [];
    const z0 = room.z0 + 0.1;
    const z1 = room.z1 - 0.1;
    // 북쪽 벽 띠: 보충재고 랙 7(남쪽을 봄) → 입고재고 팔레트 2
    resRacks.forEach((r, i) => out.push(place(r, COLD.x0 + 0.1 + RACK_LEN * (i + 0.5), z0 + 0.05 + RACK_DEPTH / 2, 'x', 1)));
    const palX = COLD.x0 + 0.1 + resRacks.length * RACK_LEN + 0.4;
    [0, 1].forEach((j) => addReserve(`${rid}-${j + 3}`, temp, palX + j * (P + 0.3), z0 + 0.05, { x: palX + j * (P + 0.3) + P / 2, z: z0 + 0.05 + P + 0.4 }, 'RECEIVING'));
    const zA = z0 + COLD.bandZ;
    const a = (z1 - zA - pairs.length * 2 * RACK_DEPTH) / (pairs.length + 1);
    // 가운데 통로(x)는 모든 줄이 같은 자리, 묶음은 방 폭 가운데로
    // 가운데 통로 자리는 가장 긴 면 기준, 짧은 면은 가운데 통로 양옆에 붙임(냉동 12 = 6 | 6, 8 = 4 | 4)
    // 가운데 통로는 방 폭 한가운데(냉동·냉장이 같은 x — 사용자 2026-11-24 "지금 평수에서 랙 정돈되게 다시 배치해봐"), 면마다 통로 양옆으로 같은 수(6 | 6, 5 | 5, 4 | 4)
    const gapX = (room.x0 + room.x1) / 2 - 0.7;
    const xAt = (i: number, n: number) => {
      const w = Math.ceil(n / 2);
      return i < w ? gapX - (w - i - 0.5) * RACK_LEN : gapX + 1.4 + (i - w + 0.5) * RACK_LEN;
    };
    for (let k = 0; k <= pairs.length; k++) {
      const top = zA + k * (a + 2 * RACK_DEPTH);
      coldAisles[temp].push([top, top + a]);
    }
    pairs.forEach(([north, south], k) => {
      const top = zA + a + k * (a + 2 * RACK_DEPTH);
      north.forEach((r, i) => out.push(place(r, xAt(i, north.length), top + RACK_DEPTH / 2, 'x', -1)));
      south.forEach((r, i) => out.push(place(r, xAt(i, south.length), top + 1.5 * RACK_DEPTH, 'x', 1)));
    });
    return out;
  };
  // 한 면 = 옛 1호점 한 줄 코드의 이어진 번호. 냉동은 면마다 12 | 12 / 12 | 12 / 8 | 8(사용자 2026-11-24 "냉동 적치랙 8 8/8 8/8 8/8 8 이거에서 10 10/10 10/8 8 이렇게 바꾸고 남쪽 평수 줄여서 냉장구역 북쪽으로 당기고, 아래 상온 구역 북쪽으로 밀어" + 64대 맞춤 답 "12 12 / 12 12 / 8 8")
  const frozen = coldRoom('FROZEN', R.A, [
    [run('A01', 1, 12), run('A02', 1, 12)],
    [run('A03', 1, 12), run('A04', 1, 12)],
    [run('A05', 1, 8), run('A06', 1, 8)],
  ], resOld('FROZEN', BUSANJIN_RACKS.reserveFrozen), 'AR');
  // 냉장 76 = 10 | 10 ×3쌍 + 8 | 8(냉동처럼 마지막 쌍만 짧게 — 10 과 9 가 섞이던 것 정돈)
  const chilled = coldRoom('CHILLED', R.B, [
    [run('B01', 1, 10), run('B02', 1, 10)],
    [run('B03', 1, 10), run('B04', 1, 10)],
    [run('B05', 1, 10), run('B06', 1, 10)],
    [run('B07', 1, 8), run('B01', 11, 8)],
  ], resOld('CHILLED', BUSANJIN_RACKS.reserveChilled), 'BR');

  // ── 상온 C~H(그림대로) ─────────────────────────────────
  // 동쪽 세로 띠: 한 면 가로 줄 8(남쪽을 봄), 줄마다 서쪽 4 | 통로 1.0 m | 동쪽 나머지, 북쪽부터 C → D → E → F.
  // 남쪽 가로 띠: 등 맞댄 한 쌍 — 북쪽 줄 G, 남쪽 줄 H(+ G 2), 서쪽 묶음 6 | (가운데 빈 곳 — 그림의 구역 이름 자리) | 동쪽 묶음 8(동쪽 벽까지).
  // 넓은 칸 랙 H01-02~06·H02-07 이 남게 H01-01~06 + H02-02~07.
  const ambient: Rack[] = [];
  const EAST = { x0: X(26.4), z0: 9.2, z1: 20.5 } as const; // 줄 사이 통로 1.1 m(남쪽으로 몲)
  const eastRows = [run('C01', 1, 7), run('C02', 1, 7), run('D02', 1, 7), run('D03', 1, 7), run('E02', 1, 6), run('E03', 1, 6), run('F02', 1, 7), run('F03', 1, 7)];
  const pitch = (EAST.z1 - EAST.z0 - RACK_DEPTH) / (eastRows.length - 1);
  eastRows.forEach((row, k) => {
    const cz = EAST.z0 + k * pitch + RACK_DEPTH / 2;
    // 가운데 통로 자리 고정, 7랙 줄 = 4 | 3, 6랙 줄(E) = 3 | 3 — 통로 양옆으로 붙임
    const gap = EAST.x0 + 4 * RACK_LEN;
    const w = row.length === 6 ? 3 : 4;
    row.forEach((r, i) => ambient.push(place(r, i < w ? gap - (w - i - 0.5) * RACK_LEN : gap + 1.0 + (i - w + 0.5) * RACK_LEN, cz, 'x', 1)));
  });
  // 남쪽 띠 정돈: 등 맞댄 한 쌍을 띠 가운데(남·북 통로 같게), 북쪽 면 G 8 | 8, 남쪽 면 H 6 | 6 — 같은 가운데 통로 양옆(사용자 2026-11-24 "지금 평수에서 랙 정돈되게 다시 배치해봐")
  const SOUTH_Z = SOUTH_PAIR_Z;
  const sGap = (X(12.4) + X(BSJ_W) - 0.3) / 2 - 0.7;
  const sideAt = (i: number, n: number) => {
    const w = n / 2;
    return i < w ? sGap - (w - i - 0.5) * RACK_LEN : sGap + 1.4 + (i - w + 0.5) * RACK_LEN;
  };
  const gNorth = [...run('G02', 1, 8), ...run('G03', 1, 8)];
  const hSouth = [...run('H01', 1, 6), ...run('H02', 2, 6)];
  gNorth.forEach((r, i) => ambient.push(place(r, sideAt(i, gNorth.length), SOUTH_Z + RACK_DEPTH / 2, 'x', -1)));
  hSouth.forEach((r, i) => ambient.push(place(r, sideAt(i, hSouth.length), SOUTH_Z + 1.5 * RACK_DEPTH, 'x', 1)));

  // ── 상온 입고창고: 맨 안쪽(북쪽 벽) 대형재고 10(5 | 5 두 줄) → 보충재고 랙 15(등 맞댄 한 쌍 8 + 7, 문 쪽) ──
  const whReserve: Rack[] = [];
  {
    const rs = resOld('AMBIENT', BUSANJIN_RACKS.reserveAmbient);
    const x0 = (R.WH.x0 + R.WH.x1) / 2 - 4 * RACK_LEN;
    // 보충재고 랙 쌍은 대형재고(북쪽)와 입고재고 팔레트(남쪽 벽) 사이 가운데
    const zp = (2.45 + (R.WH.z1 - 0.15 - P) - 2 * RACK_DEPTH) / 2;
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
  // 상온 입고재고 팔레트 5(RCV-A-02) — 입고창고 남쪽(보충재고 랙 앞 통로 건너), 입고·검수에는 팔레트 없음(사용자 2026-11-24 "상온 구역 랙 통로 줄여서 입고 창고 크기 늘리고 입고 검수구역에 팔레트 없애 … 입고검수 실선도 상온입고창고 통로쪽에 침범하지마")
  for (let c = 0; c < 5; c++) {
    // 남쪽 문(상온 동쪽 줄 가운데 통로 위) 앞은 비움 — 서쪽 3 | 문 | 동쪽 2
    const x0 = c < 3 ? R.WH.x0 + 0.4 + c * (P + 0.4) : X(33.0) + (c - 3) * (P + 0.4);
    addReserve(`WR-${String(c + 1).padStart(2, '0')}`, 'AMBIENT', x0, R.WH.z1 - 0.15 - P, { x: x0 + P / 2, z: R.WH.z1 - 0.15 - P - 0.4 }, 'RECEIVING');
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
  // 승강기 별동: 동쪽 문(입고·검수 쪽 통로) + 남쪽 문(그림 — 서쪽 통로로 바로, 사용자 2026-11-24 "승강기에서 바로 들어올 수 있는 문이 있는데 왜 거기다가 벽을 치고 장바구니 거치대를 뒀지")
  vWall(R.ANNEX.x1, 0, R.ANNEX.z1, [[0.3, 2.3]]);
  hWall(R.ANNEX.z1, R.ANNEX.x0, R.ANNEX.x1, [[X(3.6), X(5.45)]]);
  // 냉동·냉장: 문은 서쪽 문 하나씩만(사용자 2026-11-24 "냉동이랑 냉장 문은 오직 서쪽문 뿐이야 문 다 없애고 냉장냉동 격리랙 입고팔레트 옆으로 옮겨") — 셋째 통로(둘째·셋째 쌍 사이)에 맞춤
  const door = (c: number) => [c - 0.9, c + 0.9] as const;
  const fA1 = (coldAisles.FROZEN[2][0] + coldAisles.FROZEN[2][1]) / 2;
  const cA1 = (coldAisles.CHILLED[2][0] + coldAisles.CHILLED[2][1]) / 2;
  hWall(R.A.z0, R.A.x0, R.A.x1);
  hWall(R.A.z1, R.A.x0, R.A.x1);
  hWall(R.B.z1, R.A.x0, R.A.x1);
  vWall(R.A.x0, R.A.z0, R.B.z1, [door(fA1), door(cA1)]);
  vWall(R.A.x1, R.A.z0, R.B.z1);
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
    const tx = X(1.25 + col * 2.4); // 두 줄 사이 0.6 m
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
  // 저온 격리 = 북쪽 벽 띠의 입고재고 팔레트 바로 동쪽, 2.8 × 1.2 m(1평)(사용자 2026-11-24 "냉동이랑 냉장 문은 오직 서쪽문 뿐이야 문 다 없애고 냉장냉동 격리랙 입고팔레트 옆으로 옮겨")
  const q = (room: Rect) => ({ x0: palEnd(), z0: room.z0 + 0.1, x1: palEnd() + 2.8, z1: room.z0 + 0.1 + COLD.bandZ });
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
  // 입고창고 칸 나눔 선: 대형재고 | 보충재고 랙 | 입고재고 — 각 사이 통로 가운데
  const whZp = (2.45 + (R.WH.z1 - 0.15 - P) - 2 * RACK_DEPTH) / 2;
  const WH_DIV = [(2.45 + whZp) / 2, (whZp + 2 * RACK_DEPTH + R.WH.z1 - 0.15 - P) / 2] as const;
  const storeAreas: StoreArea[] = [
    coldArea(R.A, 'FROZEN'),
    coldArea(R.B, 'CHILLED'),
    {
      floor: [R.WH.x0, R.WH.z0 + 0.1, R.WH.x1, R.WH.z1],
      lines: [[R.WH.x0 + 0.12, WH_DIV[0], R.WH.x1 - 0.12, WH_DIV[0]], [R.WH.x0 + 0.12, WH_DIV[1], R.WH.x1 - 0.12, WH_DIV[1]]], // 대형재고 | 보충재고 | 입고재고
      texts: [
        { t: '대형재고', x: R.WH.x1 - 0.9, z: WH_DIV[0] - 0.3 },
        { t: '보충재고', x: R.WH.x1 - 0.9, z: WH_DIV[1] - 0.3 },
        { t: '입고재고', x: R.WH.x0 + 0.9, z: R.WH.z1 - 0.45 },
      ],
    },
  ];

  // ── 점 ───────────────────────────────────────────────
  // 장바구니 거치대: 냉동·냉장 서쪽 벽 앞 세로(카트 줄 x ≈ OX+4.4, 냉동 서쪽 문과 냉장 서쪽 문 사이)
  // 장바구니 거치대: 승강기 별동 남쪽 문 서쪽, 가로 2줄(줄마다 카트 약 10대, 카트 x OX+0.5~3.0) — 문 앞은 비움
  const cartDepot = { x: X(2.3), z: R.ANNEX.z1 + 1.0 };
  const points: Layout['points'] = {
    truckDoor: { x: X(2.15), z: 3.0 },
    truckDock: { x: 20, z: 3.6 }, // 서쪽 마당 세로 차로(geo.truckLaneX) — z 는 서 있을 때 차 가운데, x 는 차로 위 거리 기준값
    inboundIdle: Array.from({ length: 8 }, (_, i) => ({ x: X(14.0) + (i % 4) * 0.8, z: 1.0 + Math.floor(i / 4) * 0.7 })),
    cartDepot,
    idle: Array.from({ length: 24 }, (_, i) => ({ x: X(0.5) + (i % 8) * 0.6, z: 12.9 + Math.floor(i / 8) * 0.5 })),
    packQueue: { x: X(5.7), z: R.PK.z0 + 0.6 },
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
    rollContainers: [X(22.8), X(23.6)].map((x) => ({ x, z: 0.7 })),
    // 구역 카드 x — 입고·검수 카드를 동쪽으로(냉동 카드와 안 겹침)
    zoneCardX: { RCV: X(22.0) },
    quarantineRacks: {
      ...Object.fromEntries(([['AQ', R.A], ['BQ', R.B]] as const).map(([id, room]) => {
        const r = q(room);
        // 흰 랙 2 북쪽 벽에 가로로 나란히(남쪽에서 꺼냄)
        return [id, [0, 1].map((i) => ({ x0: r.x0 + 0.1 + i * (RACK_LEN + 0.1), z0: r.z0 + 0.05, x1: r.x0 + 0.1 + i * (RACK_LEN + 0.1) + RACK_LEN, z1: r.z0 + 0.05 + RACK_DEPTH }))];
      })),
      // 상온 격리: 가로 2개, 남쪽 것은 남쪽 벽에 — 서로 마주 봐 가운데에서 둘 다 꺼냄
      CQ: [R.CQ.z1 - 0.1 - RACK_DEPTH, R.CQ.z0 + 0.05].map((z0) => ({ x0: R.CQ.x0 + 0.125, z0, x1: R.CQ.x0 + 0.125 + RACK_LEN, z1: z0 + RACK_DEPTH })),
    },
    cartDepotVertical: false,
    cartDepotRows: 2,
    cartDepotRowGap: 1.6,
    returnTable: { x: X(4.5), z: 10.6, vertical: true },
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
