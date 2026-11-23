// 3호점 세종 MFC(MFC-SEJ-01) 평면 — R-41(2026-11-23).
// 근거: 백엔드 요청 docs/handoff/simulator/mfc/2026-11-23-request-sejong-mfc.md 와 사용자 평면도 그림 2026-11-23-sejong-floorplan-user.webp
// (사용자 "이 평면도대로 세종 MFC 1개 더 만들어줘"). 구역 순서·자리는 그림, 크기는 표의 평수(1평 = 3.3058 m²)로 정했다 — 그림 눈금(약 45 × 33 m)은
// 표의 539평(1,781.8 m²)보다 작아(요청서 "정확한 좌표는 시뮬레이터가 평수에 맞춰 정한다") 깊이는 1호점과 같은 33.3 m, 폭을 53.2 m 로 늘렸다 [시뮬].
// 1호점 평면(layout.ts)처럼 예전 좌표를 옮겨 쌓지 않고 처음부터 이 좌표로 만든다. 좌표 단위 m, x = 동쪽, z = 남쪽.
//
// 위(북)에서 본 배치(그림 그대로):
//   서쪽 두 방 = 냉장 B | 냉동 A (방마다 서쪽 벽 띠: 북쪽부터 입고재고 팔레트 → 보충재고 랙 14 → 격리 2평), 두 방 북·남쪽 가로 통로
//   가운데 = 북쪽 바깥 승강기 별동(입고 차량) → 입고·검수 → 상온 구역 1(피킹 랙) → 남서 모서리 상온 격리 2평
//   가운데 오른쪽 = 패킹(패킹대 두 줄) → 그 남쪽 인계 돌출부(3평)
//   동쪽 = 상온 입고창고(보충재고 랙 42) → 상온 구역 2(피킹 랙) → 사무·휴게
//   건물 밖 남쪽 = 라이더 대기 11.3평

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

/** 건물 폭·깊이(m) — 539평 = 53.2 × 33.3 + 인계 돌출부 [시뮬] */
export const SJ_W = 53.2;
export const SJ_BD = 33.3;
const SJ_D = 41.6;

/** 사용자 표(요청서 §3) — 피킹 랙 수·랙당 칸(= SLOT_DESIGN 단 × 칸) [확정 사용자 표] */
export const SEJONG_RACKS = {
  B: 146, // 냉장 B 5단 × 7 = 35
  A: 122, // 냉동 A 5단 × 6 = 30
  C: 28, // 6 × 9 = 54
  D: 28, // 6 × 10 = 60
  E: 24, // 6 × 8 = 48
  F: 28, // 6 × 10 = 60
  G: 29, // 6 × 9 = 54
  H: 23, // 5 × 5 = 25
  reserveCold: 14, // 냉장·냉동 보충재고 랙 각 14, 랙당 15
  reserveAmbient: 42, // 상온 입고창고 보충재고 랙 42, 랙당 15
} as const;

/** 구역 사각형(평수는 docPyeong — 표 값) */
const R = {
  B: { x0: 0, z0: 1.8, x1: 12.45, z1: 31.8 }, // 냉장 110.9 + 격리 2
  A: { x0: 12.55, z0: 1.8, x1: 25.0, z1: 31.8 }, // 냉동 110.9 + 격리 2
  RCV: { x0: 26.4, z0: 0, x1: 38.0, z1: 6.9 }, // 24.27평 = 80.2 m²
  // 가운데 남쪽 = 패킹(가로로 길게, 맨 앞) → 그 북쪽 상온 구역 1(가로로 길게) — 사용자 2026-11-24 "패킹대 남쪽으로 가로로 길게 맨 앞에 두고 그 뒤로 상온구역1 시작하게 해 그것도 지금 세로로 길게 늘려져 있는데 가로로 길게 늘려. 상온구역2는 그대로"
  // 상온 구역 1 (18.0 × 13.6 m, 그 안 상온 격리 2평) — 입고·검수 남쪽 통로 1.9 m · 패킹 북쪽 주 통로 2.0 m 사이를 다 쓰고 피킹 통로를 넓힘
  // (사용자 2026-11-24 "넓은 곳은 너무 넓고 통로가 좁은 곳은 너무 좁아 보이는데" → 제안(주 통로 2.0 m·피킹 통로 1.6 m, 북쪽 빈 띠를 구역으로) "응"). 그 전: z 11.4~21.95, 피킹 통로 1.0 m
  // 2026-11-24 "상온 구역 사이 통로가 너무 늘었는데 … 조금 다시 줄여봐" — 피킹 통로 1.6 → 1.3 m, 여백 1.2 m(구역 깊이 12.1 m)
  CH1: { x0: 26.4, z0: 10.4, x1: 44.4, z1: 22.5 },
  // 상온 격리 2평 — 상온 구역 1 안 북서쪽 모서리(비워 둔 북쪽 줄 서쪽 6랙 자리). 사용자 2026-11-24 "상온격리 구역 지금 남쪽에 있는데 북쪽으로 옮겨" → "상온 구역1 안에 있어야지"
  CQ: { x0: 26.6, z0: 10.45, x1: 30.4, z1: 12.05 },
  // 패킹 20.26평 = 66.6 m²(10.0 × 6.66) — 패킹대 4 | 4 두 줄(사용자 2026-11-24 "패킹구역 너무 납작해졌잖아. 4 4 이렇게 해야지"), 남쪽 출하문 앞 통로(z 31.2~33.3)는 비움
  // 패킹은 상온 구역 1 아래 서쪽 끝에 붙임 — 사용자 2026-11-24 "패킹구역을 중앙 말고 왼쪽으로 붙이고 작업자가 왜 북쪽에 … 장바구니 거치대 근처에 있게 해 … 장바구니는 오른쪽에 작업자들이랑 같이 공간 확보"
  // 패킹대 10 = 5 | 5(사용자 2026-11-24 "패킹대 10개로 늘려") — 12.4 × 5.4 m = 67.0 m²(20.26평 그대로), 가운데 통로 1.7 m
  PK: { x0: 26.4, z0: 25.8, x1: 38.8, z1: 31.2 },
  // 상온 입고창고 ㄱ자 = 동쪽 다리(보충재고 랙 세로 3쌍) + 북쪽 띠 WH2. 합계 7.1 × 15.9 + 8.1 × 7.0 = 169.6 m² = 51.3평(표 51.31)
  // — 사용자 2026-11-24 "지금 ㄱ자는 그대로 두고 … 랙을 2 2 이거에서 2 2 2 로 … 그만큼 서쪽으로 부피가 늘어나고 남쪽으로 부피가 줄면 상온구역 2랙을 … 6, 6, 6, 6인데 5, 5, 5, 5, 4 … 사무휴게도 서쪽이 조금 줄고 북쪽으로 통통해지게"
  WH: { x0: 46.1, z0: 0, x1: SJ_W, z1: 15.9 },
  // 상온 입고창고 서쪽 덧붙은 바닥(입고·검수 동쪽 ~ 창고, 그림의 ㄱ자) — 사용자 2026-11-24 "입고검수 구역이랑 상온입고창고 구역 사이에 남는 공간이 원래 상온입고창고구역이어야 하는데?"
  WH2: { x0: 38.0, z0: 0, x1: 46.1, z1: 7.0 },
  CH2: { x0: 46.1, z0: 16.1, x1: SJ_W, z1: 28.5 }, // 상온 구역 2 — 등 맞댄 5쌍(줄 5·5·5·5·4대), 입고창고 동쪽 다리와 같은 서쪽 선
  // 사무·휴게 8.15평(7.1 × 3.79) — 서쪽 벽선을 상온 구역 2 서쪽 선(x 46.1)과 맞춤(사용자 2026-11-24 "휴게사무 구역 혼자 너무 동쪽으로 붙어있으니까 서쪽 벽라인 상온구역2 실선이랑 맞추고")
  OFF: { x0: 46.1, z0: 29.51, x1: SJ_W, z1: SJ_BD },
  SHIP: { x0: 40.7, z0: SJ_BD + 0.1, x1: 46.7, z1: SJ_BD + 1.5 }, // 인계(돌출부 안) 3평 — 2026-11-24 동쪽으로 3 m
  PARK: { x0: 38.6, z0: 37.9, x1: 49.8, z1: 41.3 }, // 라이더 대기 11.3평(건물 밖) — 인계와 같이 동쪽으로 3 m
} as const satisfies Record<string, Rect>;

/** 인계 돌출부(벽 바깥 면) 6.2 × 1.6 m = 3평 */
/** 인계 돌출부·출하문·인계 랙·라이더 앞마당을 동쪽으로 옮긴 거리 — 출하문 앞을 되돌릴 상품 탁자가 막아서(사용자 2026-11-24 "인계구역 문 앞에 책상있으니까 인계구역 동쪽으로 밀어라") [시뮬] */
const SHIP_DX = 3.0;
const BUMP = { x0: 37.6 + SHIP_DX, z0: SJ_BD, x1: 43.8 + SHIP_DX, z1: SJ_BD + 1.6 } as const;

/** 냉장·냉동 서쪽 벽 띠(1호점 COLD_BAND 와 같은 폭·표시 폭) — 북쪽부터 입고재고 팔레트 2 → 보충재고 랙 14 → 격리 */
const BAND = { CHILLED: 0.1, FROZEN: 12.65, width: 3.0, mark: 1.7, z0: 1.8, reserveZ0: 5.6, qz0: 23.6, qz1: 27.5 } as const;

/** 화물 승강기 2대 + 동쪽 하역 통로 = 별동 16.25평(14.9 × 3.6 m) [시뮬] */
const LIFTS = [
  { x0: 27.6, x1: 31.0, door: [28.2, 30.4] as const },
  { x0: 31.1, x1: 34.5, door: [31.7, 33.9] as const },
] as const;
const ANNEX = { x0: 27.0, z0: -3.6, x1: 41.9, z1: 0, truckDoor: [-3.0, -0.6] as const } as const;

const ZONE_PY: Record<string, number> = { B: 110.9, A: 110.9, 'C-H': 80.46, 'C-H2': 80.46, WH: 51.31, RCV: 24.27, OFF: 8.15, PK: 20.26, AQ: 2, BQ: 2, CQ: 2, SHIP: 3 };

const dims = (g: string) => ({ levels: SLOT_DESIGN[g][0], slotsPerLevel: SLOT_DESIGN[g][1] });

export function buildSejongLayout(): Layout {
  const zones: Zone[] = [
    { id: 'A', kind: 'FROZEN', label: '냉동 A', rect: R.A, docPyeong: ZONE_PY.A },
    { id: 'B', kind: 'CHILLED', label: '냉장 B', rect: R.B, docPyeong: ZONE_PY.B },
    { id: 'C-H', kind: 'AMBIENT', label: '상온 구역 1', rect: R.CH1, docPyeong: ZONE_PY['C-H'] },
    { id: 'C-H2', kind: 'AMBIENT', label: '상온 구역 2', rect: R.CH2, docPyeong: ZONE_PY['C-H2'] },
    { id: 'WH', kind: 'INBOUND_STORE', label: '상온 입고창고', rect: R.WH, docPyeong: ZONE_PY.WH },
    { id: 'WH2', kind: 'INBOUND_STORE', label: '상온 입고창고', rect: R.WH2, noTag: true },
    { id: 'RCV', kind: 'RECEIVING', label: '입고·검수', rect: R.RCV, docPyeong: ZONE_PY.RCV },
    { id: 'OFF', kind: 'OFFICE', label: '사무·휴게', rect: R.OFF, docPyeong: ZONE_PY.OFF },
    { id: 'PK', kind: 'PACKING', label: '패킹', rect: R.PK, docPyeong: ZONE_PY.PK },
    { id: 'AQ', kind: 'QUARANTINE', label: '냉동 격리', rect: { x0: BAND.FROZEN, z0: BAND.qz0, x1: BAND.FROZEN + BAND.mark, z1: BAND.qz1 }, docPyeong: 2 },
    { id: 'BQ', kind: 'QUARANTINE', label: '냉장 격리', rect: { x0: BAND.CHILLED, z0: BAND.qz0, x1: BAND.CHILLED + BAND.mark, z1: BAND.qz1 }, docPyeong: 2 },
    { id: 'CQ', kind: 'QUARANTINE', label: '상온 격리', rect: R.CQ, docPyeong: 2 },
    { id: 'SHIP', kind: 'SHIPPING', label: '인계', rect: R.SHIP, docPyeong: 3 },
    { id: 'PARK', kind: 'PARKING', label: '라이더 대기', rect: R.PARK },
  ];

  // ── 벽(두께 0.2 m, 높이 3 m) ─────────────────────────────
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
  // 외벽: 북쪽 = 화물 승강기 문 2개(입고·검수로 바로), 남쪽 = 출하문(인계 돌출부로)
  hWall(0, 0, SJ_W, LIFTS.map((l) => l.door));
  hWall(SJ_BD, 0, SJ_W, [[39.6 + SHIP_DX, 41.8 + SHIP_DX]]);
  vWall(0, 0, SJ_BD);
  vWall(SJ_W, 0, SJ_BD);
  // 인계 돌출부: 동·서 벽, 남쪽은 라이더에게 건네는 낮은 창
  vWall(BUMP.x0 + T / 2, SJ_BD, BUMP.z1);
  vWall(BUMP.x1 - T / 2, SJ_BD, BUMP.z1);
  hWall(BUMP.z1 - T / 2, BUMP.x0, BUMP.x1, [], 1.1);
  // 냉장·냉동(문은 북·남 하나씩) — 두 방 북·남쪽 가로 통로로
  hWall(1.7, 0, 25.0, [[4.6, 6.6], [17.4, 19.6]]);
  vWall(12.5, 1.7, 31.9);
  vWall(25.0, 1.7, 31.9);
  hWall(31.9, 0, 25.0, [[4.6, 6.6], [17.4, 19.6]]);
  // 입고·검수: 서쪽 문(북쪽 통로와 일직선 → 냉장·냉동), 남쪽 문(상온 구역 1), 동쪽 문(입고창고 앞 마당)
  vWall(R.RCV.x0, 0, R.RCV.z1 + 0.1, [[0.1, 1.9]]);
  hWall(R.RCV.z1 + 0.1, R.RCV.x0, R.RCV.x1); // 남쪽 문 없음 — 입고·검수에서 상온 구역으로 바로 가지 않는다(사용자 2026-11-24 "입고검수에서 바로 상온구역으로 가는 문 없애고"). 서쪽(냉장·냉동)·동쪽(입고창고) 문만
  vWall(R.RCV.x1, 0, R.RCV.z1 + 0.1, [[3.0, 5.2]]);
  // 상온 입고창고: 서쪽 벽 문 2(북쪽 = 입고·검수 쪽 마당, 남쪽 = 가운데 통로), 남쪽 벽(상온 구역 2 와 경계)
  // ㄱ자: 북쪽 덧붙은 바닥(x 38.0~44.6, z 0~7.0)과 창고 사이엔 벽 없음 — 입고·검수 동쪽 문이 창고로 바로 열림. 덧붙은 바닥 남쪽 벽에 가운데 통로 쪽 문
  vWall(R.WH.x0, R.WH2.z1, R.WH.z1, [[8.6, 11.0]]);
  hWall(R.WH2.z1, R.WH2.x0, R.WH.x0, [[40.2, 42.6]]);
  hWall(R.WH.z1, R.WH.x0, SJ_W);
  // 사무·휴게
  hWall(R.OFF.z0, R.OFF.x0, SJ_W);
  vWall(R.OFF.x0, R.OFF.z0, SJ_BD, [[R.OFF.z0 + 0.9, R.OFF.z0 + 2.5]]);
  // 승강기 별동(MFC 밖·건물 안): 서·북 벽, 동쪽 벽엔 입고 차량 하역 문
  vWall(ANNEX.x0, ANNEX.z0, 0);
  hWall(ANNEX.z0, ANNEX.x0, ANNEX.x1);
  vWall(ANNEX.x1, ANNEX.z0, 0, [ANNEX.truckDoor]);
  // 바깥 앞마당 울타리(라이더 대기)
  const yardX = [35.0 + SHIP_DX, 47.4 + SHIP_DX] as const;
  walls.push({ rect: { x0: yardX[0] - 0.15, z0: SJ_BD, x1: yardX[0], z1: SJ_D }, height: 1.0 });
  walls.push({ rect: { x0: yardX[1], z0: SJ_BD, x1: yardX[1] + 0.15, z1: SJ_D }, height: 1.0 });

  // ── 랙 ──────────────────────────────────────────────
  // 냉장·냉동 피킹: 1호점과 같은 한 줄 21랙(북쪽 11 | 가로 통로 1.4 m | 남쪽 10, z 2.95~30.6). 그룹 = 물리 줄(B01~B07, A01~A06), 랙 번호 1~21 [시뮬]
  const COLD_Z0 = 2.95;
  const coldAlong = [
    ...Array.from({ length: 11 }, (_, i) => COLD_Z0 + RACK_LEN * (i + 0.5)),
    ...Array.from({ length: 10 }, (_, i) => COLD_Z0 + 11 * RACK_LEN + 1.4 + RACK_LEN * (i + 0.5)),
  ];
  const coldRows = (x0: number, x1: number, pattern: ('S+' | 'P' | 'S-')[]) => {
    const nRows = pattern.reduce((n, p) => n + (p === 'P' ? 2 : 1), 0);
    const aisle = (x1 - x0 - nRows * RACK_DEPTH) / (pattern.length - (pattern[pattern.length - 1] === 'S-' ? 1 : 0));
    const rows: { c: number; face: 1 | -1 }[] = [];
    let x = x0;
    for (const p of pattern) {
      if (p === 'S+') {
        rows.push({ c: x + RACK_DEPTH / 2, face: 1 });
        x += RACK_DEPTH + aisle;
      } else if (p === 'P') {
        rows.push({ c: x + RACK_DEPTH / 2, face: -1 }, { c: x + RACK_DEPTH * 1.5, face: 1 });
        x += 2 * RACK_DEPTH + aisle;
      } else rows.push({ c: x + RACK_DEPTH / 2, face: -1 });
    }
    return rows;
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
  // 냉장 B 146 = 7줄(띠에 등 댄 홑줄 + 등 맞댄 3쌍) × 21 − 1, 통로 4개 약 1.5 m
  const chilled = coldRacks('CHILLED', 'B', coldRows(BAND.CHILLED + BAND.width + 0.1, R.B.x1 - 0.1, ['S+', 'P', 'P', 'P']), SEJONG_RACKS.B, 'RB');
  // 냉동 A 122 = 6줄(홑줄 + 2쌍 + 동쪽 벽에 등 댄 홑줄) × 21 − 4, 통로 3개 약 2.1 m
  const frozen = coldRacks('FROZEN', 'A', coldRows(BAND.FROZEN + BAND.width + 0.1, R.A.x1 - 0.1, ['S+', 'P', 'P', 'S-']), SEJONG_RACKS.A, 'RA');

  // 상온 피킹 160 = 구역 1(F·G·C·D 113) + 구역 2(E·H 47). 랙은 가로(동서)로 한 줄 6개, 등 맞댄 2줄씩.
  // 고회전 F 는 패킹·장바구니 거치대에 가까운 구역 1 남쪽 줄부터(R-40 상위 20 상품 자리), 큰 상품 H 는 구역 2 [시뮬]
  const ambient: Rack[] = [];
  // 칸 코드는 "6랙 묶음(unit)" 순서로 매긴다 — 한 줄에 묶음 1개(구역 2) 또는 2개(구역 1: 서쪽 6 | 가운데 통로 | 동쪽 6).
  // 구역 1 을 가로로 바꿀 때(2026-11-24) 칸 코드·피킹 순서는 그대로 두고 자리만 옮기려고 묶음 순서를 예전 줄 순서와 같게 했다(서버에 이미 재고가 있음).
  const ambientBlock = (area: Rect, groups: [string, number][], pairs: number, aisle: number, prefix: string, fromSouth: boolean, unitsPerRow = 1, centerGap = 0, southMargin?: number, lastRowEastFirst = false) => {
    const PER = 6;
    const rowW = unitsPerRow * PER * RACK_LEN + (unitsPerRow - 1) * centerGap;
    const x0 = (area.x0 + area.x1) / 2 - rowW / 2;
    const unitXs = Array.from({ length: unitsPerRow }, (_, u) => Array.from({ length: PER }, (_, i) => x0 + u * (PER * RACK_LEN + centerGap) + (i + 0.5) * RACK_LEN));
    const depth = pairs * 2 * RACK_DEPTH + (pairs - 1) * aisle;
    // 남쪽 여백을 주면 남쪽에 붙이고(북쪽에 빈 띠), 아니면 가운데
    const z0 = southMargin !== undefined ? area.z1 - southMargin - depth : (area.z0 + area.z1) / 2 - depth / 2;
    const rows: { cz: number; face: 1 | -1 }[] = [];
    for (let p = 0; p < pairs; p++) {
      const zz = z0 + p * (2 * RACK_DEPTH + aisle);
      rows.push({ cz: zz + RACK_DEPTH / 2, face: -1 }, { cz: zz + RACK_DEPTH * 1.5, face: 1 });
    }
    if (fromSouth) rows.reverse();
    // 마지막 줄은 동쪽 묶음부터(남는 서쪽 자리를 상온 격리로) — 칸 코드는 묶음 순서라 그대로
    const slots = rows.flatMap((row, ri) => {
      const order = lastRowEastFirst && ri === rows.length - 1 ? [...unitXs.keys()].reverse() : [...unitXs.keys()];
      return order.flatMap((u) => unitXs[u].map((x) => ({ x, ...row, unit: `${row.cz.toFixed(3)}:${u}` })));
    });
    let k = 0;
    for (const [g, n] of groups) {
      const rowNo = new Map<string, number>();
      for (let i = 0; i < n; i++, k++) {
        const s = slots[k];
        const key = s.unit;
        if (!rowNo.has(key)) rowNo.set(key, rowNo.size + 1);
        ambient.push({ id: `${prefix}-${k + 1}`, temp: 'AMBIENT', group: `${g}${String(rowNo.get(key)).padStart(2, '0')}`, rackNo: 0, cx: s.x, cz: s.cz, along: 'x', face: s.face, ...dims(g) });
      }
    }
  };
  // 피킹 통로 1.3 m, 가운데 세로 주 통로 2.0 m(입고·검수 남쪽 문과 일직선), 남·북 여백 1.2 m
  ambientBlock(R.CH1, [['F', SEJONG_RACKS.F], ['G', SEJONG_RACKS.G], ['C', SEJONG_RACKS.C], ['D', SEJONG_RACKS.D]], 5, 1.3, 'RC', true, 2, 2.0, 1.2, true);
  ambientBlock(R.CH2, [['E', SEJONG_RACKS.E], ['H', SEJONG_RACKS.H]], 4, 1.2, 'RC2', true);
  // 구역 2 자리: 칸 코드는 위(줄 6대 × 4쌍 순서) 그대로, 자리만 등 맞댄 5쌍(줄 5·5·5·5·4대, 북쪽부터)으로 — 만든 순서(남쪽 줄부터, 줄 안 서쪽부터)대로 채움
  {
    const lens = [5, 5, 5, 5, 4]; // 쌍마다 한 줄 랙 수(북쪽부터)
    const aisle = 1.2;
    const depth = lens.length * 2 * RACK_DEPTH + (lens.length - 1) * aisle;
    const z0 = (R.CH2.z0 + R.CH2.z1) / 2 - depth / 2;
    const rows: { cz: number; face: 1 | -1; n: number }[] = [];
    lens.forEach((n, p) => {
      const zz = z0 + p * (2 * RACK_DEPTH + aisle);
      rows.push({ cz: zz + RACK_DEPTH / 2, face: -1, n }, { cz: zz + RACK_DEPTH * 1.5, face: 1, n });
    });
    rows.reverse(); // 남쪽 줄부터
    const xw = R.CH2.x0 + (R.CH2.x1 - R.CH2.x0 - 5 * RACK_LEN) / 2; // 5대 줄 서쪽 끝(4대 줄도 같은 서쪽 선)
    const slots = rows.flatMap((r) => Array.from({ length: r.n }, (_, i) => ({ x: xw + (i + 0.5) * RACK_LEN, cz: r.cz, face: r.face })));
    ambient.filter((r) => r.id.startsWith('RC2-')).forEach((r, k) => Object.assign(r, { cx: slots[k].x, cz: slots[k].cz, face: slots[k].face }));
  }
  // 그룹(줄) 안 랙 번호 — 서쪽부터
  {
    const byGroup = new Map<string, Rack[]>();
    for (const r of ambient) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
    for (const rs of byGroup.values()) rs.forEach((r, i) => (r.rackNo = i + 1)); // 묶음 안 서쪽부터(만든 순서)
  }

  // 보충재고 랙(랙당 5단 × 3 = 15) — 냉장·냉동은 서쪽 벽 띠에 등 댄 한 줄 14, 상온은 입고창고에 가로 6개씩 7줄(등 맞댄 3쌍 + 홑줄) 42
  const reserve: Rack[] = [];
  for (const [temp, X0, prefix] of [['FROZEN', BAND.FROZEN, 'RRF'], ['CHILLED', BAND.CHILLED, 'RRC']] as const) {
    for (let i = 0; i < SEJONG_RACKS.reserveCold; i++) {
      reserve.push({ id: `${prefix}-${i + 1}`, temp, group: 'R01', rackNo: i + 1, cx: X0 + 0.05 + RACK_DEPTH / 2, cz: BAND.reserveZ0 + RACK_LEN * (i + 0.5), along: 'z', face: 1, levels: RESERVE_SLOTS[0], slotsPerLevel: RESERVE_SLOTS[1], reserve: true });
    }
  }
  {
    // 입고창고(ㄱ자): 북쪽 띠 서쪽(입고·검수 동쪽 문 앞) 입고재고 → 북동쪽 맨 안쪽 대형재고 → 동쪽 다리 보충재고 랙 42 = 세로 등 맞댄 3쌍 × 2줄 × 7
    // (통로 서쪽·동쪽 1.0 m, 쌍 사이 1.2 m) — "대형재고가 맨 안 쪽에", "랙을 2 2 … 2 2 2 로"(사용자 2026-11-24)
    let n = 0;
    const cols: [number, 1 | -1][] = [0, 1, 2].flatMap((p) => {
      const x = R.WH.x0 + 1.0 + p * (2 * RACK_DEPTH + 1.2);
      return [[x + RACK_DEPTH / 2, -1], [x + RACK_DEPTH * 1.5, 1]] as [number, 1 | -1][];
    });
    for (const [cx, face] of cols) for (let i = 0; i < 7; i++) reserve.push({ id: `RRA-${++n}`, temp: 'AMBIENT', group: 'R01', rackNo: n, cx, cz: 5.4 + RACK_LEN * (i + 0.5), along: 'z', face, levels: RESERVE_SLOTS[0], slotsPerLevel: RESERVE_SLOTS[1], reserve: true });
  }

  const racks = [...frozen, ...chilled, ...ambient, ...reserve];
  const locations: Location[] = racks.flatMap(rackLocations);
  const locationsByTemp: Record<TemperatureZone, Location[]> = { AMBIENT: [], CHILLED: [], FROZEN: [] };
  for (const l of locations) if (!l.reserve) locationsByTemp[l.temp].push(l);

  // ── 팔레트 자리·장애물 ──────────────────────────────────
  const obstacles: Obstacle[] = [];
  const reserves: ReserveSpot[] = [];
  const P = 1.1;
  const addReserve = (id: string, temp: TemperatureZone, x0: number, z0: number, stand: { x: number; z: number }, role: ReserveSpot['role']) => {
    const rect = { x0, z0, x1: x0 + P, z1: z0 + P };
    reserves.push({ id, temp, rect, stand, role });
    obstacles.push({ rect, height: 0.15, kind: 'RESERVE' });
  };
  // 냉장·냉동 입고재고 팔레트 2(서쪽 벽을 따라 세로) → 서버 RCV-C-01·RCV-F-01
  for (const [temp, X0, rid] of [['FROZEN', BAND.FROZEN, 'AR'], ['CHILLED', BAND.CHILLED, 'BR']] as const) {
    [1.95, 3.2].forEach((z0, j) => addReserve(`${rid}-${j + 3}`, temp, X0 + 0.25, z0, { x: X0 + 2.0, z: 3.15 }, 'RECEIVING'));
  }
  // 상온 입고재고 10자리(북쪽 띠 서쪽 — 입고·검수 동쪽 문 바로 앞) → 서버 RCV-A-02(자리는 화면만, 서버 칸 하나). 사람은 팔레트 남쪽에서 검수.
  // 문서 6-5 "상온 5자리" + 앞줄 5(사용자 2026-11-24 "입고재고구역에 공간 많이 남는 것 같으니까 팔레트 앞에 5개 더 추가해"), 두 줄 사이 1.0 m
  for (const [row, z0] of [[0, 0.5], [1, 2.6]] as const) {
    for (let c = 0; c < 5; c++) {
      const x0 = R.WH2.x0 + 0.6 + c * 1.5;
      addReserve(`WR-${String(row * 5 + c + 1).padStart(2, '0')}`, 'AMBIENT', x0, z0, { x: x0 + P / 2, z: z0 + P + 0.5 }, 'RECEIVING');
    }
  }
  // 대형재고 바닥 팔레트 10(1호점과 같은 5 | 5, 서버 A-R2-01~10-1-01) — 입고창고 맨 안쪽 북쪽 벽, 두 줄 사이 통로 1.0 m. 사람은 팔레트 남쪽에서.
  // 요청 표엔 없었지만 사용자 2026-11-24 "상온 입고 창고에 대형재고 자리 어디 갔어". 번호는 열마다 북쪽 → 남쪽, 서쪽 열부터(1호점과 같은 규칙)
  {
    let n = 0;
    for (let c = 0; c < 5; c++) {
      const x0 = R.WH.x1 - 0.2 - 1.1 - (4 - c) * 1.35; // 북동쪽 맨 안쪽(문에서 가장 먼 곳)
      for (const z0 of [0.5, 2.6]) addReserve(`WB-${String(++n).padStart(2, '0')}`, 'AMBIENT', x0, z0, { x: x0 + P / 2, z: z0 + P + 0.5 }, 'BULK');
    }
  }
  // 사무·휴게 테이블(가운데, 걸어서 피해 감)
  // 테이블은 북쪽 벽에 붙이고 의자는 그 남쪽(1호점과 같은 모양) — 사용자 2026-11-24 "사무휴게 의자 벽 뚫고 나왔잖아 북쪽 벽으로 의자를 붙여야지"
  const officeTable = { x: (R.OFF.x0 + R.OFF.x1) / 2 + 0.8, z: R.OFF.z0 + 0.4, w: 3.6, d: 0.5, h: 0.74 };
  obstacles.push({ rect: { x0: officeTable.x - 1.8, z0: R.OFF.z0 + 0.1, x1: officeTable.x + 1.8, z1: R.OFF.z0 + 1.35 }, height: 0.75, kind: 'TABLE' });

  // 하차 칸: 입고·검수 안 두 블록(가운데 통로 비움)
  const dockSlots: DockSlot[] = [];
  for (const z of [2.5, 3.25, 5.0, 5.75]) for (let c = 0; c < 9; c++) dockSlots.push({ id: `DK-${dockSlots.length + 1}`, pos: { x: 27.6 + c * 0.75, z } });

  // 패킹대 10 = 5 | 5 두 줄 — 위 줄 PS-1~5 는 북쪽 끝, 아래 줄 PS-6~10 은 남쪽 끝, 점원은 가운데 통로 쪽. 탁자 1.8 m
  const stations: PackingStation[] = [];
  const PER_ROW = 5;
  const gap = (R.PK.x1 - R.PK.x0 - 0.6 - PER_ROW * PACK_TABLE_W) / (PER_ROW - 1);
  for (let i = 0; i < 2 * PER_ROW; i++) {
    const top = i < PER_ROW;
    const tx = R.PK.x0 + 0.3 + PACK_TABLE_W / 2 + (i % PER_ROW) * (PACK_TABLE_W + gap);
    const tz = top ? R.PK.z0 + 0.65 : R.PK.z1 - 0.65;
    stations.push({ id: `PS-${i + 1}`, index: i, table: { x: tx, z: tz }, stand: { x: tx, z: top ? tz + 1.2 : tz - 1.2 } });
    obstacles.push({ rect: { x0: tx - PACK_TABLE_W / 2, z0: tz - 0.4, x1: tx + PACK_TABLE_W / 2, z1: tz + 0.4 }, height: 0.9, kind: 'TABLE' });
  }

  // 인계 랙 2(돌출부 안, 출하문 양옆) — 랙마다 4단 × 4칸
  const shippingSlots: ShippingSlot[] = [];
  const shipZ = BUMP.z0 + 0.1 + 0.25 + RACK_DEPTH / 2;
  [39.3 + SHIP_DX, 42.1 + SHIP_DX].forEach((x, ri) => {
    obstacles.push({ rect: { x0: x - RACK_LEN / 2, z0: shipZ - RACK_DEPTH / 2, x1: x + RACK_LEN / 2, z1: shipZ + RACK_DEPTH / 2 }, height: RACK_HEIGHT, kind: 'SHIP_RACK' });
    for (let lv = 0; lv < 4; lv++) for (let s = 0; s < 4; s++) shippingSlots.push({ id: `SR${ri + 1}-${lv + 1}${s + 1}`, rackIndex: ri, pos: { x: x - 0.45 + s * 0.3, y: 0.25 + lv * 0.5, z: shipZ } });
  });

  // ── 바닥 표시(냉장·냉동 띠, 입고창고) ─────────────────────
  const coldArea = (X0: number, color: 'FROZEN' | 'CHILLED'): StoreArea => {
    const X1 = X0 + BAND.mark;
    const L0 = X0 + 0.12, L1 = X1 - 0.12, Tz = BAND.z0 + 0.12, Bz = BAND.qz1 - 0.12, DIV = 5.3;
    return {
      floor: [X0, BAND.z0, X1, BAND.qz1],
      color,
      lines: [[L0, Tz, L1, Tz], [L0, Bz, L1, Bz], [L0, Tz, L0, Bz], [L1, Tz, L1, Bz], [L0, DIV, L1, DIV]],
      texts: [
        { t: '입고', x: (X0 + X1) / 2, z: 4.8 },
        { t: '보충', x: X0 + 1.05, z: 14.3 },
      ],
    };
  };
  const bulkX0 = R.WH.x1 - 0.2 - 1.1 - 4 * 1.35 - 0.3; // 대형재고 서쪽 끝 − 여유
  const storeAreas: StoreArea[] = [
    coldArea(BAND.FROZEN, 'FROZEN'),
    coldArea(BAND.CHILLED, 'CHILLED'),
    {
      // 북쪽 띠(입고재고)
      floor: [R.WH2.x0, R.WH2.z0 + 0.1, R.WH2.x1, R.WH2.z1],
      lines: [], // 띠 전체가 입고재고(예전 보충재고 가로 한 줄 경계선은 랙을 동쪽 다리로 옮기며 뺌 — 사용자 2026-11-24 "입고재고구역에 실선이 그어져있어서 공간이 2개로 나뉘는데 왜")
      texts: [{ t: '입고재고', x: R.WH2.x0 + 3.9, z: 5.4 }],
    },
    {
      // 동쪽 다리: 북쪽 대형재고 | 남쪽 보충재고 랙
      floor: [R.WH.x0, R.WH.z0 + 0.1, R.WH.x1, R.WH.z1],
      lines: [[R.WH.x0, 4.75, R.WH.x1 - 0.12, 4.75]],
      texts: [
        { t: '대형재고', x: (Math.max(bulkX0, R.WH.x0) + R.WH.x1) / 2, z: 4.45 },
        { t: '보충재고', x: (R.WH.x0 + R.WH.x1) / 2, z: 15.3 },
      ],
    },
  ];

  // ── 점 ───────────────────────────────────────────────
  // 장바구니 거치대(시작점) — 상온 구역 1 남쪽 앞, 패킹 옆. 세로(남북)로 카트 줄(사용자 2026-11-24 "장바구니 거치대 시작점도 패킹대 뒤랑 상온 구역 앞 남쪽에"
  // → "세로로 방향을 바꾸고" → 패킹을 서쪽으로 붙이고 거치대는 그 동쪽에 대기 작업자와 같이 공간을 둠). 카트 줄 x 38.0 · z 24.3~29.6,
  // 되돌릴 상품 탁자는 그 북쪽 끝, 대기 작업자는 거치대 동쪽(x 39.6~43.6). 그 남쪽은 출하문으로 가는 길로 비움 [시뮬]
  // 카트 줄 북쪽 끝 = 패킹 북쪽 선(사용자 2026-11-24 "장바구니 거치대 패킹구역이랑 북쪽에서 끝나는 지점 맞춰") — 첫 카트 중심 = 거치대 z − 0.7, 카트 반폭 0.24
  const cartDepot = { x: R.PK.x1 + 2.0, z: R.PK.z0 + 0.7 + 0.24 };
  const points: Layout['points'] = {
    truckDoor: { x: (LIFTS[0].door[1] + LIFTS[1].door[0]) / 2, z: 0.9 },
    truckDock: { x: ANNEX.x1 + 0.3 + 3.2, z: (ANNEX.truckDoor[0] + ANNEX.truckDoor[1]) / 2 },
    inboundIdle: Array.from({ length: 8 }, (_, i) => ({ x: 39.0 + (i % 4) * 0.8, z: 4.3 + Math.floor(i / 4) * 0.9 })),
    cartDepot,
    idle: Array.from({ length: 24 }, (_, i) => ({ x: R.PK.x1 + 3.0 + (i % 5) * 0.8, z: 24.6 + Math.floor(i / 5) * 0.9 })), // 장바구니 거치대 동쪽(북쪽 마당 아님)
    packQueue: { x: R.PK.x1 - 0.5, z: (R.PK.z0 + R.PK.z1) / 2 }, // 패킹 동쪽 입구(거치대 쪽)
    shipDrop: { x: (R.SHIP.x0 + R.SHIP.x1) / 2, z: SJ_BD - 0.4 },
    riderPickup: { x: (R.SHIP.x0 + R.SHIP.x1) / 2, z: BUMP.z1 + 0.55 },
    riderParking: Array.from({ length: 9 }, (_, i) => ({ x: 36.2 + SHIP_DX + i * 1.2, z: 39.4 })),
    riderEntry: { x: 41.2 + SHIP_DX, z: 41.2 },
  };

  const geo: SiteGeo = {
    yardX,
    liftAnnex: ANNEX,
    freightLifts: LIFTS,
    liftZ0: ANNEX.z0,
    returnIntake: { x: 45.6 + SHIP_DX, z: 35.6 }, // 인계 창 밖 동쪽(라이더가 들고 옴) [시뮬]
    storeAreas,
    officeTable,
    rollContainers: [35.2, 36.1, 37.0].map((x) => ({ x, z: 5.6 })),
    cartDepotVertical: true,
    // 되돌릴 상품 탁자 — 카트 줄 남쪽 끝(북쪽으로 튀어나오지 않게, 사용자 2026-11-24 "그 앞에 하얀 책상이 튀어나가잖아 그건 남쪽으로 옮기고")
    returnTable: { x: R.PK.x1 + 2.0 - 0.6, z: R.PK.z0 + 0.24 + 19 * 0.28 + 0.24 + 0.6 },
  };

  return {
    variant: 'SEJONG',
    geo,
    width: SJ_W,
    depth: SJ_D,
    buildingDepth: SJ_BD,
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
