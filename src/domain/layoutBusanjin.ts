// 1호점 부산진구 MFC(MFC-SEED-01) 다시 설계 — R-45(2026-11-24).
// 근거: 백엔드 요청 docs/handoff/simulator/mfc/2026-11-24-request-busanjin-redesign.md, 사용자 평면도 2026-11-24-busanjin-floorplan-user.png
// (사용자 "부산 진구 mfc 수정해야해. 평면 설계랑 랙갯수랑 평수 전부. 이미지랑 적힌 것 대로"). 건물 37.0 × 24.58 m = MFC 265평(876 m²) + 승강기 별동 10.1평(33.3 m²) = 275.1평.
// 사용자 결정(PC3·PC1 전달, 2026-11-24): 랙당 칸은 지금 1호점 그대로(SLOT_DESIGN), 칸 코드도 지금 1호점 코드를 되도록 그대로 —
//   그래서 옛 1호점 평면(buildLayout)의 랙 코드를 그룹마다 앞에서부터 골라 새 자리에 놓는다(재고는 같은 코드면 그대로, 없어지는 칸만 옮김).
//   H 는 1호점 넓은 칸 랙(H01-02~06·H02-07)이 남게 H01 8 + H02-01~03 + H02-07. 넓은 칸 59·닫힘 100 이 모두 남는다.
// 대형재고 10자리(A-R2-01~10)는 그림에 없지만 입고창고에 그대로(사용자 2026-11-24 "입고창고에 10자리 유지").
// 좌표 m, x = 동쪽, z = 남쪽. 건물 서쪽 밖(x 0~5)에 라이더 대기 마당을 두려고 건물을 OX 만큼 동쪽으로 민다.
//
// 위(북)에서 본 배치(그림 그대로):
//   북서 = 승강기 별동(화물 승강기 2 — 입고 차량은 건물 북쪽 길) → 입고·검수(북쪽 가운데) | 북동 = 상온 입고창고(대형재고 10·보충재고 랙 15)
//   가운데 위 = 냉동, 가운데 아래 = 냉장(방마다 북쪽 벽 보충재고 랙 7·입고재고 팔레트 2, 서쪽 벽 격리, 피킹 랙 가로 줄 등 맞댄 3쌍)
//   동쪽 세로 띠 + 남쪽 가로 띠 = 상온 C~H(동쪽 한 면 가로 줄 4 C 7·D 2, 남쪽 등 맞댄 2쌍 F02 E02 D02|F03 E03 D03 · G|H) + 상온 격리(남동 모서리)
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
export const BSJ_OX = 10.5; // 라이더 대기를 가로로 넓게(9.3 × 4 m) 놓으려고 서쪽 마당을 10.5 m 로(사용자 2026-11-24 "라이더 대기도 90도로 넓게 배치하게 바꿔야지")
const OX = BSJ_OX;
/** 건물 37.0 × 24.58 m = 909.3 m² = 275.1평(MFC 876 + 별동 33.3 m² — 그림 표 값). 그림의 '약 37.0 × 25.3 m' 는 283평이라 남북을 0.72 m 줄임(상온 남쪽 띠 통로)(사용자 2026-11-24 "지금 mfc 265평 유지되고 있는 거 맞지?" → "처음 준 게 265평이었잖아") */
export const BSJ_W = 37.0;
export const BSJ_BD = 24.58;

/** 사용자 표(요청서 §3) 랙 수 [확정] — 랙당 칸은 지금 1호점 SLOT_DESIGN 그대로(사용자 결정) */
export const BUSANJIN_RACKS = { B: 76, A: 64, C: 14, D: 14, E: 12, F: 14, G: 16, H: 12, reserveChilled: 7, reserveFrozen: 7, reserveAmbient: 15 } as const;

const X = (x: number) => OX + x;
// 처음 그림·표로 다시(사용자 2026-11-24 "아니 설계 이게 맞냐고. 안 이상해 이게? 왜 이렇게 바꾼 거야?" → 처음 그림·표로 다시(살릴 것은 살림) "응 일단 해봐"):
//   냉동·냉장 각 58평(20.1 × 9.54 m), 입고·검수 12평, 패킹 12평대, 인계 2평, 격리 1평 ×3. 입고창고는 대형재고 10·입고재고 5·보충재고 랙 15 가 들어가게 26평(사용자가 앞서 넓히라 함).
//   상온은 그림처럼 동쪽 띠(가로 줄) + 남쪽 띠(등 맞댄 한 쌍). 냉동·냉장 동쪽 벽 ~ 입고창고 사이 세로 통로 1.1 m(입고·검수 → 입고창고·상온).
/** 냉동·냉장(과 남쪽 띠) 서쪽 벽을 동쪽으로 민 거리 — 서쪽 패킹·장바구니 거치대 자리를 넓힘(사용자 2026-11-24 "냉동냉장 평수를 줄여서 패킹 부분이랑 장바구니 거치대 있는 곳 평수를 늘려줘").
 *  2.0 m = 냉동 피킹 줄(12 | 12) 동쪽 끝과 방 동쪽 벽 사이 0.8 m 가 남는 만큼 [시뮬] */
const DW = 2.0;
/** 냉동·냉장(크기 그대로)과 남쪽 띠 줄을 동쪽으로 민 거리 — 패킹·장바구니 거치대를 더 넓힘, 냉동·냉장 동쪽 벽 ~ 동쪽 상온 통로 3.6 → 2.6 m
 *  (사용자 2026-11-24 "냉동냉장구역을 동쪽으로 밀어서 패킹 부분이랑 장바구니 거치대 있는 곳 평수를 늘려줘") [시뮬] */
const SH = 1.0; // 2.0 → 1.0(동쪽 통로 1.6 → 2.6 m, 사용자 2026-11-24 "동쪽으로 너무 밀었네 동쪽 통로가 좀 얇아졌잖아. 다시 냉장냉동구역 조금만 서쪽으로 밀어")
/** 남쪽 띠 한 면 = [서쪽 묶음, 가운데 통로 동쪽 묶음, 셋째 묶음] */
type Face3 = [Rack[], Rack[], Rack[]];
const R = {
  ANNEX: { x0: X(0), z0: 0, x1: X(5.6), z1: 5.9 }, // 승강기 별동 10평(MFC 밖)
  RCV: { x0: X(10.1), z0: 0, x1: X(25.7), z1: 2.5 }, // 입고·검수 12평(15.6 × 2.5 = 39 m²)
  // 냉동·냉장 각 0.9 m 씩 줄여 남쪽 띠에 등 맞댄 쌍 하나 더(사용자 2026-11-24 "남쪽 상온 랙 2줄만 있는데 거기로 2줄 더 이동 시켜봐" → "냉동·냉장 0.9 m씩")
  A: { x0: X(5.6 + DW + SH), z0: 2.55, x1: X(25.7 + SH), z1: 11.19 }, // 냉동 47평(18.1 × 8.64 m, 격리 포함)
  B: { x0: X(5.6 + DW + SH), z0: 11.19, x1: X(25.7 + SH), z1: 19.83 }, // 냉장 47평
  // 입고창고·동쪽 상온을 동쪽으로 1.0 m 밀어 입고·검수 ~ 입고창고 통로 1.1 → 2.1 m, 입고창고는 남쪽으로 늘려 26평 그대로(사용자 2026-11-24 "동쪽으로 밀고 남쪽으로 내려오게 얇게 배치해서 입고검수랑 상온 입고창고 구역 통로 늘리자" → "입고창고만 평수 유지")
  // 한 번 더 1.0 m 동쪽으로(통로 2.1 → 3.1 m), 입고창고는 남쪽으로 늘려 26평 그대로(사용자 2026-11-24 "이거 조금 더 하자" + "동쪽 상온구역 랙이 7개씩 배치되어있는데 5개씩 배치하고 나머지는 남쪽 앞쪽에 배치하면 되잖아")
  // 또 0.5 m(통로 3.1 → 3.6 m, 사용자 2026-11-24 "이거 조금만 더 하자")
  // 다시 북쪽으로 줄여(z1 11.13 → 9.6) 동쪽 상온에 5랙 한 줄 더(사용자 2026-11-24 "상온입고창고 다시 북쪽으로 좀 줄이고 북동쪽 상온 구역에 랙 1줄 5개 더 놓자")
  WH: { x0: X(29.3), z0: 0, x1: X(37), z1: 9.6 }, // 상온 입고창고 22평(7.7 × 9.6): 대형재고 10 → 입고재고 5 → 보충재고 랙 5 / 5 / 5
  CH: { x0: X(29.3), z0: 9.6, x1: X(37), z1: 19.83 }, // 상온 동쪽 띠 24평(7.7 × 10.23, 가로 줄 5 — C01·C02-01~05, C01·C02-06~07 + D02-02, D02·D03-03~07) — 서쪽 실선을 입고창고에 맞춤(사용자 2026-11-24 "동쪽에 있는 상온 구역 실선도 랙도 상온입고창고에 맞춰")
  CH2: { x0: X(5.6 + DW + SH), z0: 19.83, x1: X(37), z1: BSJ_BD }, // 상온 남쪽 띠(등 맞댄 2쌍: F02 | F03, G | H)
  PK: { x0: X(0), z0: 13.55, x1: X(5.9), z1: BSJ_BD }, // 패킹 20평(5.9 × 11.03 — 사용자 2026-11-24 "패킹구역은 평수 줄여줘" 로 26 → 20) — 패킹대 4 | 4 가 구역 안에
  SHIP: { x0: X(0.1), z0: 6.8, x1: X(3.4), z1: 8.8 }, // 인계 대기 2평(3.3 × 2.0) — 거치대 북쪽 벽(z 8.9) 앞, 인계 랙은 그 벽에 붙임(사용자 2026-11-24 "인계랙 남쪽 벽에 붙여")
  CQ: { x0: X(35.7), z0: BSJ_BD - 0.1 - 2.8, x1: X(36.9), z1: BSJ_BD - 0.1 }, // 상온 격리 1평(1.2 × 2.8) — 남동 모서리 동쪽 벽(사용자 2026-11-24 "상온 격리 구역 랙 오른쪽 모퉁이 동쪽 벽에 붙여")
  PARK: { x0: 0.6, z0: 7.6, x1: 9.9, z1: 11.6 }, // 라이더 대기 11.3평(9.3 × 4 m 가로, 건물 밖 서쪽 — 사용자 2026-11-24 "라이더 대기도 90도로 넓게")
} as const satisfies Record<string, Rect>;
/** 남쪽 띠 등 맞댄 2쌍 — 띠 안쪽(냉장 남쪽 벽 ~ 건물 남쪽 벽)에 통로 3개를 같은 폭으로, 쌍 k 북쪽 면 z */
const SOUTH_AISLE = (BSJ_BD - 0.1 - (19.83 + 0.1) - 4 * RACK_DEPTH) / 3;
const SOUTH_PAIR_Z = (k: number) => 19.83 + 0.1 + SOUTH_AISLE + k * (SOUTH_AISLE + 2 * RACK_DEPTH);
/** 저온 방 북쪽 벽 띠(보충재고 랙 7 → 입고재고 팔레트 2 → 격리), 줄 서쪽 끝 x(저온·남쪽 띠 같은 선 — 사용자 "모든 줄을 서쪽 끝에 맞춤") */
const COLD = { x0: X(5.7 + DW + SH), bandZ: 1.2, rowX0: X(6.4 + DW + SH) } as const;

const ZONE_PY: Record<string, number> = { B: 47, A: 47, 'C-H': 24, WH: 22, RCV: 12, PK: 20, AQ: 1, BQ: 1, CQ: 1, SHIP: 2 };

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
  const coldRoom = (temp: 'FROZEN' | 'CHILLED', room: Rect, pairs: [Rack[], Rack[]][], resRacks: Rack[], rid: string, center = false, westW?: number): Rack[] => {
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
    // 모든 줄을 서쪽 끝(냉동·냉장 같은 x)에 맞추고 가운데 통로도 한 선 — 랙이 모자란 줄은 동쪽 끝만 짧음(사용자 2026-11-24 "이게 무슨 정돈된 거야 삐뚤빼뚤하구만" → "모든 줄을 서쪽 끝에 맞춤")
    const W = westW ?? Math.ceil(Math.max(...pairs.flat().map((r) => r.length)) / 2);
    // center: 묶음 전체(서쪽 W | 통로 1.4 | 동쪽 가장 긴 묶음)를 방 동서 가운데에 — 양옆 빈 곳을 같게(냉동, 사용자 2026-11-24 "냉동구역 랙 앞뒤 양옆 간격 남은 거 보고 중앙에 적절하게 재배치")
    const eastMax = Math.max(...pairs.flat().map((r) => r.length - W));
    const rowX0 = center ? (room.x0 + room.x1) / 2 - (W * RACK_LEN + 1.4 + eastMax * RACK_LEN) / 2 : COLD.rowX0;
    const xAt = (i: number, _n: number) => rowX0 + (i < W ? (i + 0.5) * RACK_LEN : W * RACK_LEN + 1.4 + (i - W + 0.5) * RACK_LEN);
    for (let k = 0; k <= pairs.length; k++) {
      const top = zA + k * (a + 2 * RACK_DEPTH);
      coldAisles[temp].push([top, top + a]);
    }
    // 동쪽 묶음 쌍 수가 서쪽보다 적으면(냉장 서쪽 4 · 동쪽 3) 동쪽 쌍은 남북으로 따로 같은 간격(사용자 2026-11-24 "냉장구역 서쪽4줄 동쪽 3줄랙 앞뒤 양옆 간격 남은 거 보고 중앙에 적절하게 재배치")
    const eastPairs = pairs.filter(([n, s2]) => n.length > W || s2.length > W).length;
    const aE = (z1 - zA - eastPairs * 2 * RACK_DEPTH) / (eastPairs + 1);
    let ke = 0;
    pairs.forEach(([north, south], k) => {
      const top = zA + a + k * (a + 2 * RACK_DEPTH);
      const hasEast = north.length > W || south.length > W;
      const topE = eastPairs < pairs.length && hasEast ? zA + aE + ke * (aE + 2 * RACK_DEPTH) : top;
      if (hasEast) ke++;
      const zOf = (i: number) => (i < W ? top : topE);
      north.forEach((r, i) => out.push(place(r, xAt(i, north.length), zOf(i) + RACK_DEPTH / 2, 'x', -1)));
      south.forEach((r, i) => out.push(place(r, xAt(i, south.length), zOf(i) + 1.5 * RACK_DEPTH, 'x', 1)));
    });
    return out;
  };
  // 한 면 = 옛 1호점 한 줄 코드의 이어진 번호. 냉동은 면마다 12 | 12 / 12 | 12 / 8 | 8(사용자 2026-11-24 "냉동 적치랙 8 8/8 8/8 8/8 8 이거에서 10 10/10 10/8 8 이렇게 바꾸고 남쪽 평수 줄여서 냉장구역 북쪽으로 당기고, 아래 상온 구역 북쪽으로 밀어" + 64대 맞춤 답 "12 12 / 12 12 / 8 8")
  const frozen = coldRoom('FROZEN', R.A, [
    // 면마다 서쪽 6 | 동쪽 5 / 5 / 4(사용자 2026-11-24 "냉동구역 동쪽에 2줄씩 6 6 2 이렇게 배치되어 있는 거 5 5 4 이렇게 배치해줘") — 64대 그대로
    [run('A01', 1, 11), run('A02', 1, 11)],
    [run('A03', 1, 11), run('A04', 1, 11)],
    [run('A05', 1, 10), run('A06', 1, 10)],
  ], resOld('FROZEN', BUSANJIN_RACKS.reserveFrozen), 'AR', true);
  // 냉장 76 = 10 | 10 ×3쌍 + 8 | 8(냉동처럼 마지막 쌍만 짧게 — 10 과 9 가 섞이던 것 정돈)
  const chilled = coldRoom('CHILLED', R.B, [
    // 면마다 서쪽 5 | 동쪽 6 / 6 / 6 / 0(사용자 2026-11-24 "냉장구역 동쪽에 2줄씩 5 5 5 3 이렇게 배치되어 있는 거 6 6 6 0 이렇게 배치해줘") — 76대 그대로
    [run('B01', 1, 11), run('B02', 1, 11)],
    [run('B03', 1, 11), run('B04', 1, 11)],
    [run('B05', 1, 11), run('B06', 1, 11)],
    [run('B07', 1, 5), run('B01', 12, 5)],
  ], resOld('CHILLED', BUSANJIN_RACKS.reserveChilled), 'BR', true, 5); // 동서 가운데(center)

  // ── 상온 C~H(그림대로) ─────────────────────────────────
  // 동쪽 세로 띠: 한 면 가로 줄 8(남쪽을 봄), 줄마다 서쪽 4 | 통로 1.0 m | 동쪽 나머지, 북쪽부터 C → D → E → F.
  // 남쪽 가로 띠: 등 맞댄 한 쌍 — 북쪽 줄 G, 남쪽 줄 H(+ G 2), 서쪽 묶음 6 | (가운데 빈 곳 — 그림의 구역 이름 자리) | 동쪽 묶음 8(동쪽 벽까지).
  // 넓은 칸 랙 H01-02~06·H02-07 이 남게 H01-01~06 + H02-02~07.
  const ambient: Rack[] = [];
  // 동쪽 띠(그림대로 가로 줄): 한 면 줄 4(남쪽을 봄), 서쪽 끝 한 선(입고창고 랙과 같은 x) — 5랙 한 묶음. 북쪽부터 C → D(E·F 2줄씩과 D 앞 2랙씩은 남쪽 띠 북쪽 쌍, C 6~7 은 남쪽 쌍으로)
  // 줄마다 한 묶음(5랙 6.25 m)을 구역 가운데에(입고창고 보충재고 랙과 같은 x — 사용자 2026-11-24 "북동쪽 상온랙 5개씩 배치한 거 왼쪽에 치우쳐져있잖아 중앙에 배치해야지").
  // 첫 줄은 입고창고 남쪽 벽에서 띄워(통로 1.2 m) 문에서 바로 들어옴
  const EAST = { x0: R.WH.x0 + 0.1, z0: R.CH.z0 + 1.2, z1: R.CH.z1 - 0.23 } as const;
  // C 는 5랙씩만(C01·C02-06~07 은 남쪽 띠 남쪽 쌍 동쪽 끝으로)
  // D 는 D02·D03-03~07 5랙씩(남쪽 띠 D 묶음 동쪽 3랙씩을 옮겨 옴 — 사용자 2026-11-24 "남쪽 통로에 제일 오른쪽에 있는 랙 6개 북쪽 구역에 놔줘" → "D 묶음 동쪽 3랙씩")
  // 셋째 줄 = 남쪽 띠에서 옮긴 C01-06~07 · C02-06~07 · D02-02(사용자 2026-11-24 "남쪽 띠 C 4랙 + D02-02")
  const eastRows = [run('C01', 1, 5), run('C02', 1, 5), [...run('C01', 6, 2), ...run('C02', 6, 2), ...run('D02', 2, 1)], run('D02', 3, 5), run('D03', 3, 5)];
  const ePitch = (EAST.z1 - EAST.z0 - RACK_DEPTH) / (eastRows.length - 1);
  eastRows.forEach((row, k) => row.forEach((r, i) => ambient.push(place(r, (R.CH.x0 + R.CH.x1) / 2 + (i - (row.length - 1) / 2) * RACK_LEN, EAST.z0 + k * ePitch + RACK_DEPTH / 2, 'x', 1))));
  // 남쪽 띠 정돈: 등 맞댄 한 쌍을 띠 가운데(남·북 통로 같게), 북쪽 면 G 8 | 8, 남쪽 면 H 6 | 6 — 같은 가운데 통로 양옆(사용자 2026-11-24 "지금 평수에서 랙 정돈되게 다시 배치해봐")
  // 서쪽 끝·가운데 통로 한 선: G 8 | 8, H 8 | 4 — 동쪽 끝만 짧음(사용자 2026-11-24 "이게 무슨 정돈된 거야 삐뚤빼뚤하구만" → "모든 줄을 서쪽 끝에 맞춤")
  const sX0 = COLD.rowX0;
  const sideAt = (i: number, _n: number) => sX0 + (i < 8 ? (i + 0.5) * RACK_LEN : 8 * RACK_LEN + 1.4 + (i - 7.5) * RACK_LEN);
  const gNorth = [...run('G02', 1, 8), ...run('G03', 1, 8)];
  const hSouth = [...run('H01', 1, 8), ...run('H02', 4, 4)]; // 서쪽 묶음 H01-01~08 | 동쪽 H02-04~07(넓은 칸 랙 H01-02~06·H02-07 포함)
  // 북쪽 쌍 = 동쪽 띠에서 옮긴 F02(북쪽 면) | F03(남쪽 면), 7랙씩 서쪽 묶음에(사용자 2026-11-24 "남쪽 상온 랙 2줄만 있는데 거기로 2줄 더 이동 시켜봐")
  //   가운데 통로 동쪽에도 E02 | E03(6랙씩)을 둠 — 동쪽 띠에서 옮겨 상온 랙 수는 그대로(사용자 2026-11-24 "북쪽 아래 통로동쪽에도 2줄 더 놔둬야지. 서쪽에만 추가됐잖아. 상온 랙 갯수는 그대로여야 하는 거 알지?")
  //   면마다 [서쪽 묶음, 동쪽 묶음] — 서쪽 묶음은 서쪽 끝부터, 동쪽 묶음은 가운데 통로 동쪽부터(G·H 와 같은 선)
  //   북쪽 쌍 동쪽 끝(통로 1.0 m 뒤) 셋째 묶음에 D02-01~02 | D03-01~02(처음 5랙, 동쪽 3랙씩은 다시 동쪽 상온으로)(사용자 2026-11-24 "남쪽 통로 동쪽에 상온 랙 더 올 수 있겠는데?" → "D 5랙씩만 옮김")
  const southPairs: [Face3, Face3][] = [
    [[run('F02', 1, 7), run('E02', 1, 6), run('D02', 1, 1)], [run('F03', 1, 7), run('E03', 1, 6), run('D03', 1, 2)]],
    [[gNorth.slice(0, 8), gNorth.slice(8), []], [hSouth.slice(0, 8), hSouth.slice(8), []]],
  ];
  /** 셋째 묶음 서쪽 끝 — 동쪽 묶음 동쪽 끝(북쪽 쌍 E 6랙, 남쪽 쌍 G03 8랙) + 통로 1.0 m. 남쪽 쌍 셋째는 지금 비어 있음(C 4랙은 동쪽 상온으로) */
  const thirdX0 = (k: number) => sX0 + 8 * RACK_LEN + 1.4 + (k === 0 ? 6 : 8) * RACK_LEN + 1.0;
  southPairs.forEach(([north, south], k) => {
    const face = ([w, e, t]: Face3, cz: number, f: 1 | -1) => {
      w.forEach((r, i) => ambient.push(place(r, sideAt(i, w.length), cz, 'x', f)));
      e.forEach((r, i) => ambient.push(place(r, sideAt(8 + i, e.length), cz, 'x', f)));
      t.forEach((r, i) => ambient.push(place(r, thirdX0(k) + (i + 0.5) * RACK_LEN, cz, 'x', f)));
    };
    face(north, SOUTH_PAIR_Z(k) + RACK_DEPTH / 2, -1);
    face(south, SOUTH_PAIR_Z(k) + 1.5 * RACK_DEPTH, 1);
  });

  // ── 상온 입고창고(22평): 북쪽 대형재고 10(5 × 2줄, 사이 통로) → 입고재고 팔레트 5(한 줄) → 보충재고 랙 5 / 5 / 5(한 면 줄 3, 같은 간격), 서쪽 끝 맞춤 ──
  const whReserve: Rack[] = [];
  /** 입고창고 보충재고 줄 앞 통로: 첫 통로 시작 z, 통로 폭(3개 같은 폭) */
  const RES_Z0 = 5.55;
  const resAisle = (R.WH.z1 - 0.1 - 0.05 - RES_Z0 - 3 * RACK_DEPTH) / 3;
  /** 입고창고 남쪽 벽 문 가운데 x = 동쪽 띠 가운데 통로 */
  const whCol = (c: number) => (R.WH.x0 + R.WH.x1) / 2 - (5 * P + 4 * 0.15) / 2 + c * (P + 0.15);
  {
    let n = 0;
    for (const [z0, sz] of [[0.2, 1.8], [2.3, 1.8]] as const) for (let c = 0; c < 5; c++) addReserve(`WB-${String(++n).padStart(2, '0')}`, 'AMBIENT', whCol(c), z0, { x: whCol(c) + P / 2, z: sz }, 'BULK');
    const rs = resOld('AMBIENT', BUSANJIN_RACKS.reserveAmbient);
    // 5 / 5 / 5 — 한 면 줄 3(모두 북쪽을 봄, 가운데 맞춤), 줄 앞 통로 3개를 같은 폭으로(입고재고 팔레트 남쪽 ~ 남쪽 벽), 마지막 줄은 남쪽 벽에 붙음
    // (사용자 2026-11-24 "상온입고창고에 보충재고 5 5 5 이렇게 간격 균일하게 재배치")
    rs.forEach((r, i) => {
      const row = Math.floor(i / 5);
      const cz = RES_Z0 + resAisle * (row + 1) + RACK_DEPTH * (row + 0.5);
      whReserve.push(place(r, (R.WH.x0 + R.WH.x1) / 2 + ((i % 5) - 2) * RACK_LEN, cz, 'x', -1)); // 입고창고 가운데(사용자 2026-11-24 "상온 입고 보충랙 왼쪽에 치우쳐져있잖아 중앙에 배치해야지") — 양 끝 0.6 m 로 줄 앞 통로가 이어짐
    });
  }
  // 상온 입고재고 팔레트 5(RCV-A-02) — 대형재고 남쪽 한 줄(북쪽에서 꺼냄)
  for (let c = 0; c < 5; c++) addReserve(`WR-${String(c + 1).padStart(2, '0')}`, 'AMBIENT', whCol(c), 4.4, { x: whCol(c) + P / 2, z: 3.9 }, 'RECEIVING');

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
  const SHIP_WINDOW: readonly [number, number] = [6.95, 7.95]; // 인계 창(서쪽 벽, 인계 대기 칸 옆 — 인계 랙 남쪽)
  hWall(0, X(0), X(BSJ_W));
  hWall(BSJ_BD, X(0), X(BSJ_W));
  vWall(X(0), 0, BSJ_BD, [SHIP_WINDOW]);
  walls.push({ rect: { x0: X(0) - T / 2, z0: SHIP_WINDOW[0], x1: X(0) + T / 2, z1: SHIP_WINDOW[1] }, height: 1.1 }); // 인계 창(허리 높이 창턱 — 라이더는 밖에서 받음)
  vWall(X(BSJ_W), 0, BSJ_BD);
  // 승강기 별동: 동쪽 문(입고·검수 쪽 통로) + 남쪽 문(그림 — 서쪽 통로로 바로, 사용자 2026-11-24 "승강기에서 바로 들어올 수 있는 문이 있는데 왜 거기다가 벽을 치고 장바구니 거치대를 뒀지")
  vWall(R.ANNEX.x1, 0, R.ANNEX.z1, [[0.3, 2.3]]);
  // 승강기 별동 남쪽 벽(인계 랙 뒤)은 없앰(사용자 2026-11-24 "인계랙 뒤에 잊는 벽 없애줘")
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
  // 입고창고 서쪽 벽: 북쪽 문(입고·검수 통로), 남쪽 끝 문(상온 동쪽 띠). 남쪽 벽은 막힘
  // 서쪽 벽 문 3: 대형재고 사이 통로(입고·검수 통로 쪽), 입고재고 앞 통로, 남쪽 보충재고 랙 끝 통로
  // 보충재고 줄 앞 통로마다 서쪽 벽 문(통로 폭) — 서쪽 통로에서 바로 들어감
  const resDoors = [0, 1, 2].map((k) => [RES_Z0 + k * (resAisle + RACK_DEPTH) + 0.05, RES_Z0 + k * (resAisle + RACK_DEPTH) + resAisle - 0.05] as const);
  vWall(R.WH.x0, 0, R.WH.z1, [[0.35, 2.25], [3.4, 4.4], ...resDoors]);
  hWall(R.WH.z1, R.WH.x0, R.WH.x1); // 남쪽 벽은 막힘 — 보충재고 랙을 가운데로 놓아 끝 통로가 0.6 m 라 문 자리가 없음(동쪽 상온은 서쪽 통로로 들어감)
  // 패킹 북쪽 벽은 없앰, 장바구니 거치대 북쪽에 벽 하나(서쪽 벽 ~ 거치대 동쪽 끝 — 사용자 2026-11-24 "패킹구역 북쪽에 있는벽 없애고 장바구니 거치대 북쪽으로 벽 하나 놔둬줘")
  // 거치대 북쪽 벽: 재진열 대기 탁자를 서쪽 벽으로 옮긴 만큼(0.7 m) 짧게 — X(6.25) 까지(사용자 2026-11-24 "재진열대기 테이블은 장바구니 거치대 앞에 서쪽 벽에 붙여버리고 그 테이블 없앤만큼 벽길이도 줄여버려")
  hWall(8.9, X(0), X(5.7)); // 승강기 별동 동쪽 벽 바깥면까지(거치대 줄과 같이 줄임)

  // ── 패킹대 8 = 서쪽 줄 4 | 동쪽 줄 4(사람은 남쪽에) ─────────────
  const stations: PackingStation[] = [];
  for (let i = 0; i < 8; i++) {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const tx = X(1.4 + col * 3.0); // 두 줄 사이 3.0 m
    const tz = R.PK.z0 + 0.9 + row * 2.4;
    stations.push({ id: `PS-${i + 1}`, index: i, table: { x: tx, z: tz }, stand: { x: tx, z: tz + 0.85 } });
    obstacles.push({ rect: { x0: tx - PACK_TABLE_W / 2, z0: tz - 0.4, x1: tx + PACK_TABLE_W / 2, z1: tz + 0.4 }, height: 0.9, kind: 'TABLE' });
  }

  // ── 인계 랙 2 — 인계 대기 칸 남쪽(거치대 북쪽 벽)에 붙여 가로로 나란히, 북쪽에서 꺼냄. 서쪽 벽 인계 창 앞 비움 ─────────────
  const shippingSlots: ShippingSlot[] = [];
  const shipCz = 8.9 - 0.1 - 0.05 - RACK_DEPTH / 2; // 남쪽 벽(거치대 북쪽 벽)에 붙임, 앞면 = 북쪽
  [R.SHIP.x0 + 0.15 + RACK_LEN / 2, R.SHIP.x0 + 0.25 + 1.5 * RACK_LEN].forEach((cx, ri) => {
    obstacles.push({ rect: { x0: cx - RACK_LEN / 2, z0: shipCz - RACK_DEPTH / 2, x1: cx + RACK_LEN / 2, z1: shipCz + RACK_DEPTH / 2 }, height: RACK_HEIGHT, kind: 'SHIP_RACK' });
    for (let lv = 0; lv < 4; lv++) for (let s2 = 0; s2 < 4; s2++) shippingSlots.push({ id: `SR${ri + 1}-${lv + 1}${s2 + 1}`, rackIndex: ri, pos: { x: cx - 0.45 + s2 * 0.3, y: 0.25 + lv * 0.5, z: shipCz - 0.15 } }); // 칸 자리는 랙 앞(북쪽) 절반 — 길찾기 끝점이 앞(북쪽)으로 오게 0.15
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
  // 입고창고 칸 나눔 선: 대형재고 | 보충재고 랙·입고재고
  const WH_DIV = [3.75, 5.55] as const;
  const storeAreas: StoreArea[] = [
    coldArea(R.A, 'FROZEN'),
    coldArea(R.B, 'CHILLED'),
    {
      floor: [R.WH.x0, R.WH.z0 + 0.1, R.WH.x1, R.WH.z1],
      lines: [[R.WH.x0 + 0.12, WH_DIV[0], R.WH.x1 - 0.12, WH_DIV[0]], [R.WH.x0 + 0.12, WH_DIV[1], R.WH.x1 - 0.12, WH_DIV[1]]], // 대형재고 | 입고재고 | 보충재고
      texts: [
        { t: '대형재고', x: R.WH.x1 - 0.9, z: WH_DIV[0] - 0.3 },
        { t: '입고재고', x: R.WH.x1 - 0.9, z: WH_DIV[1] - 0.3 },
        { t: '보충재고', x: R.WH.x1 - 0.9, z: R.WH.z1 - 0.45 },
      ],
    },
  ];

  // ── 점 ───────────────────────────────────────────────
  // 장바구니 거치대: 냉동·냉장 서쪽 벽 앞 세로(카트 줄 x ≈ OX+4.4, 냉동 서쪽 문과 냉장 서쪽 문 사이)
  // 장바구니 거치대: 승강기 별동 남쪽 문 서쪽, 가로 2줄(줄마다 카트 약 10대, 카트 x OX+0.5~3.0) — 문 앞은 비움
  // (인계 대기 칸과 자리 바꿈 — 서쪽 통로 가운데, 가로 2줄)
  // 넓어진 거치대 자리에 줄을 길게(줄마다 16대, 카트 x OX+0.5~4.7 — 사용자 2026-11-24 "넓어진 만큼 장바구니 거치대도 더 넓게 놓자"). 동쪽 끝 카트 = cartDepot.x + 0.7
  // 한 줄만, 북쪽 벽(z 8.9)에서 조금 떨어지게 — 카트 줄 가운데 z 9.45(사용자 2026-11-24 "장바구니 거치대 일렬로 하나만 놓자. 앞에 줄 없애고, 벽에서 조금만 떨어지게 해.")
  // 줄 길이 = 승강기 별동 동쪽 벽(X 5.6)까지 — 18대, 카트 가운데 x OX+0.54~5.3(사용자 2026-11-24 "장바구니 거치대 길이를 엘레베이터 구간에 벽이랑 맞추고, 뒤에 벽길이도 그만큼 조금만 줄여"). 줄 = cartDepot.z − 0.6
  const cartDepot = { x: X(4.6), z: 10.05 };
  const points: Layout['points'] = {
    truckDoor: { x: X(2.15), z: 3.0 },
    truckDock: { x: 20, z: 3.0 }, // 서쪽에서 들어오는 동서 길(geo.truckFromWest, 사용자 2026-11-24 "도로가 남북쪽으로 뻗어져있는데 서쪽에서 들어오게 도로 90도로 꺾어줘") — z 는 차 가운데, x 는 길 위 거리 기준값
    inboundIdle: Array.from({ length: 8 }, (_, i) => ({ x: X(14.0) + (i % 4) * 0.8, z: 1.0 + Math.floor(i / 4) * 0.7 })),
    cartDepot,
    idle: Array.from({ length: 24 }, (_, i) => ({ x: X(0.5) + (i % 8) * 0.6, z: 11.95 + Math.floor(i / 8) * 0.45 })),
    packQueue: { x: (R.PK.x1 + R.A.x0) / 2, z: R.PK.z0 + 0.6 }, // 패킹 구역 ~ 냉장 서쪽 벽 통로 가운데
    shipDrop: { x: (R.SHIP.x0 + R.SHIP.x1) / 2, z: (R.SHIP.z0 + R.SHIP.z1) / 2 },
    riderPickup: { x: X(-0.6), z: (SHIP_WINDOW[0] + SHIP_WINDOW[1]) / 2 },
    riderParking: Array.from({ length: 9 }, (_, i) => ({ x: 1.4 + (i % 5) * 1.8, z: 8.6 + Math.floor(i / 5) * 2.0 })),
    riderEntry: { x: 5.0, z: BSJ_BD + 0.3 },
  };

  const geo: SiteGeo = {
    yardX: [0, 0.01],
    truckFromWest: { z: 3.0, rearX: X(0) - 0.15 },
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
    zoneCardX: { RCV: X(21.5) },
    quarantineRacks: {
      ...Object.fromEntries(([['AQ', R.A], ['BQ', R.B]] as const).map(([id, room]) => {
        const r = q(room);
        // 흰 랙 2 북쪽 벽에 가로로 나란히(남쪽에서 꺼냄)
        return [id, [0, 1].map((i) => ({ x0: r.x0 + 0.1 + i * (RACK_LEN + 0.1), z0: r.z0 + 0.05, x1: r.x0 + 0.1 + i * (RACK_LEN + 0.1) + RACK_LEN, z1: r.z0 + 0.05 + RACK_DEPTH }))];
      })),
      // 상온 격리: 가로 2개, 남쪽 것은 남쪽 벽에 — 서로 마주 봐 가운데에서 둘 다 꺼냄
      // 흰 랙 2 동쪽 벽 따라 세로로 앞뒤(서쪽에서 꺼냄)
      CQ: [0, 1].map((i) => ({ x0: R.CQ.x1 - 0.05 - RACK_DEPTH, z0: R.CQ.z0 + 0.1 + i * (RACK_LEN + 0.1), x1: R.CQ.x1 - 0.05, z1: R.CQ.z0 + 0.1 + i * (RACK_LEN + 0.1) + RACK_LEN })),
    },
    cartDepotVertical: false,
    cartDepotRows: 1,
    cartDepotRowGap: 1.6,
    cartDepotPerRow: 18,
    shipRackFacesNorth: true,
    zoneCardMatch: [['WH', 'RCV']], // 상온 입고창고 카드 = 입고·검수 카드 크기(사용자 2026-11-24 "상온입고창고 구역카드 크기 입고검수구역카드 크기랑 맞춰")
    returnTable: { x: X(0.1 + 0.05 + 0.35), z: 10.65, vertical: true }, // 재진열 대기: 거치대 줄 앞(남쪽) 서쪽 벽에 붙임
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
