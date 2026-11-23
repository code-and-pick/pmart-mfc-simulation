// 4호점 춘천 MFC(MFC-CHC-01) 평면 — R-42(2026-11-24).
// 근거: 백엔드 요청 docs/handoff/simulator/mfc/2026-11-24-request-chuncheon-mfc.md 와 사용자 평면도 그림 2026-11-24-chuncheon-floorplan-user.webp
// (사용자 "mfc 하나 더 만들자. 평면도 대로 mfc 구조 설계하고, 랙수랑 평수는 아래 적은대로"). 건물 31.8 × 28.68 m + 인계 돌출부 = 278평(그림 31.8 × 28.9 m).
// 세종(layoutSejong.ts)처럼 처음부터 이 좌표로 만든다. 좌표 단위 m, x = 동쪽, z = 남쪽.
//
// 위(북)에서 본 배치(그림 그대로):
//   서쪽 두 방 = 냉장 B | 냉동 A (방마다 서쪽 벽 띠: 북쪽부터 입고재고 팔레트 2 → 보충재고 랙 7 → 남쪽 격리 1평), 피킹 랙은 남북 세로 줄, 가운데 가로 통로
//   북쪽 가운데 = 바깥 승강기 별동 22평(화물 승강기 2, 입고 차량 하역) → 입고·검수
//   북동 = 상온 입고창고(대형재고 10 → 입고재고 6 → 보충재고 랙 16, 남동 모서리 상온 격리 1평)
//   가운데 = 상온 구역 1(C·D·F·G) 서쪽, 상온 구역 2(E·H) 동쪽
//   남쪽 = 패킹(패킹대 4 | 4), 동쪽에 장바구니 거치대(세로)·대기 작업자 → 남쪽 인계 돌출부(인계 랙 2) → 건물 밖 라이더 대기

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

/** 건물 폭·깊이(m) — 31.8 × 28.68 + 인계 돌출부 6.94 m² = 919 m² = 278평 */
export const CHC_W = 31.8;
export const CHC_BD = 28.68;
const CHC_D = 37.0;

/** 사용자 표(요청서 §3) 랙 수 [확정 사용자 표] */
export const CHUNCHEON_RACKS = { B: 80, A: 67, C: 15, D: 15, E: 13, F: 15, G: 17, H: 13, reserveCold: 7, reserveAmbient: 16 } as const;

/**
 * 랙당 칸 = 단 × 칸 — 1호점·세종과 같은 SLOT_DESIGN(냉장 5×7·냉동 5×6·C·G 6×9·D·F 6×10·E 6×8·H 5×5).
 * 사용자 2026-11-24 "랙마다 칸 수는 세종이랑 동일하게"(PC1 전달 — 처음 표의 냉장 40·냉동 35·C·D·F 72 … 대신) → 피킹 235랙 9,287칸·보충 30랙 450칸·전체 9,737칸
 */
export const CHC_SLOTS: Record<string, readonly [levels: number, slots: number]> = SLOT_DESIGN;

const R = {
  B: { x0: 0, z0: 1.8, x1: 7.7, z1: 26.9 }, // 냉장 61.02 + 격리 1(약 58.5평 — 방 사각형, 표 값은 이름표)
  A: { x0: 7.8, z0: 1.8, x1: 15.4, z1: 26.9 }, // 냉동 61.02 + 격리 1
  RCV: { x0: 16.6, z0: 0, x1: 22.8, z1: 6.73 }, // 12.63평 = 41.7 m²
  WH: { x0: 24.2, z0: 0, x1: CHC_W, z1: 9.6 }, // 상온 입고창고(+ 상온 격리) — 그림 크기(7.6 × 9.6)
  // 상온 격리 1평 — 입고창고 동쪽 벽에 세로로 붙임(0.85 × 3.9 m), 보충재고 랙(동쪽 끝 x 30.0)과 사이 통로 0.85 m — 사용자 2026-11-24 "상온 격리 동쪽 벽으로 돌려서 붙여 사람이 지나갈 순 있게 해줘야지"
  CQ: { x0: 30.85, z0: 5.6, x1: 31.7, z1: 9.5 },
  // 상온 구역 1(C·D·F·G) — 등 맞댄 6쌍(G 맨 앞 줄은 구역 2 앞으로), 앞(남쪽) 통로 약 3.4 m — 사용자 2026-11-24 "G랙 맨 앞 한 줄 상온구역2 앞에 붙이면 G 가로로 이어지겠네"
  CH1: { x0: 16.6, z0: 8.1, x1: 23.6, z1: 19.2 },
  CH2: { x0: 24.6, z0: 11.6, x1: 31.6, z1: 19.2 }, // 상온 구역 2(E·H 3쌍 + 맨 앞 F02 한 줄 — 구역 1 맨 앞 F 줄과 같은 높이), 통로 모두 1.1 m
  // 패킹 12.63평 = 41.7 m²(7.4 × 5.64), 패킹대 6 = 3 | 3 — 출하문(x 24.2~26.4) 앞을 비움(사용자 2026-11-24 "냉장냉동 격리바닥 실선이랑 격리 랙이랑 안 맞잖아. 그리고 상온 격리 구역 랙 세로로 방향 돌려서 벽에 붙이라고. 인계랙 입구를 패킹대가 침범하네 패킹대 6대로 줄여주고 장바구니 거치대 조금 더 동쪽으로 … 인계랙도 세로로 돌려서 벽에 붙여줘. 입구를 막았잖아")
  PK: { x0: 16.6, z0: 21.5, x1: 24.0, z1: 27.14 }, // 2026-11-24 0.4 m 북쪽("패킹구역은 아주 조금 북쪽으로")
  SHIP: { x0: 23.7, z0: CHC_BD + 0.1, x1: 26.9, z1: CHC_BD + 1.94 }, // 인계대기 2.10평(돌출부 안)
  PARK: { x0: 19.6, z0: 33.0, x1: 30.6, z1: 36.4 }, // 라이더 대기 11.3평(건물 밖)
} as const satisfies Record<string, Rect>;

/** 인계 돌출부 3.4 × 2.04 m = 2.1평 */
const BUMP = { x0: 23.6, z0: CHC_BD, x1: 27.0, z1: CHC_BD + 2.04 } as const;
/** 냉장·냉동 서쪽 벽 띠 — 폭 1.6 m(방이 좁아 1호점 3.0 보다 좁게): 북쪽 입고재고 팔레트 2 → 보충재고 랙 7 → 남쪽 격리 1평(1.4 × 2.36) */
// 띠 폭 1.6 → 2.0 m, 입고재고 팔레트를 벽 쪽으로 — 팔레트 ~ 첫 피킹 줄 0.35 → 0.9 m(사용자 2026-11-24 "춘천mfc에 냉장냉동구역에 입고팔레트랑 그 옆에 적치랙이 너무 가까운데 간격 조정 좀"). 냉장 통로 약 1.05 m·냉동 1.75 m
const BAND = { CHILLED: 0.1, FROZEN: 7.9, width: 2.0, mark: 1.4, z0: 1.8, reserveZ0: 4.6 } as const;
/** 저온 격리 1.4 × 2.8 m(1.19평 — 세로 랙 2개가 벽 따라 앞뒤로 들어가게, 1평이면 2.36 m 라 안 들어감) — 보충재고 칸(실선) 폭 그대로(1.4 m), 보충재고 칸 끝 바로 남쪽(1호점·목포처럼, 사용자 2026-11-24 "냉장냉동 격리구역 보충재고 실선 크기 맞춰서 바로 딱 옆에 있게 해야지. 목포점처럼"). 흰 랙 2 세로로 서쪽 벽 따라 앞뒤로 */
const Q = { z0: BAND.reserveZ0 + 7 * RACK_LEN + 0.25, w: BAND.mark, len: 2.8 } as const;
 // 격리 1평 = 1.1 × 3.0(흰 랙 2개가 세로로 들어가게)
/** 화물 승강기 2대(입고·검수 북쪽 벽) + 별동 22평(10.9 × 6.66 m, 동쪽에 입고 차량 하역) */
const LIFTS = [
  { x0: 16.65, x1: 19.65, door: [17.05, 19.25] as const },
  { x0: 19.75, x1: 22.75, door: [20.15, 22.35] as const },
] as const;
const ANNEX = { x0: 16.6, z0: -6.66, x1: 27.5, z1: 0, truckDoor: [-4.0, -1.6] as const } as const;

const ZONE_PY: Record<string, number> = { B: 61.02, A: 61.02, 'C-H': 43.14, 'C-H2': 43.14, WH: 18.94, RCV: 12.63, PK: 12.63, AQ: 1, BQ: 1, CQ: 1, SHIP: 2.1 };

const dims = (g: string) => ({ levels: CHC_SLOTS[g][0], slotsPerLevel: CHC_SLOTS[g][1] });

export function buildChuncheonLayout(): Layout {
  const zones: Zone[] = [
    { id: 'A', kind: 'FROZEN', label: '냉동 A', rect: R.A, docPyeong: ZONE_PY.A },
    { id: 'B', kind: 'CHILLED', label: '냉장 B', rect: R.B, docPyeong: ZONE_PY.B },
    { id: 'C-H', kind: 'AMBIENT', label: '상온 구역 1', rect: R.CH1, docPyeong: ZONE_PY['C-H'] },
    { id: 'C-H2', kind: 'AMBIENT', label: '상온 구역 2', rect: R.CH2, docPyeong: ZONE_PY['C-H2'] },
    { id: 'WH', kind: 'INBOUND_STORE', label: '상온 입고창고', rect: R.WH, docPyeong: ZONE_PY.WH },
    { id: 'RCV', kind: 'RECEIVING', label: '입고·검수', rect: R.RCV, docPyeong: ZONE_PY.RCV },
    { id: 'PK', kind: 'PACKING', label: '패킹', rect: R.PK, docPyeong: ZONE_PY.PK },
    { id: 'AQ', kind: 'QUARANTINE', label: '냉동 격리', rect: { x0: BAND.FROZEN, z0: Q.z0, x1: BAND.FROZEN + Q.w, z1: Q.z0 + Q.len }, docPyeong: 1 },
    { id: 'BQ', kind: 'QUARANTINE', label: '냉장 격리', rect: { x0: BAND.CHILLED, z0: Q.z0, x1: BAND.CHILLED + Q.w, z1: Q.z0 + Q.len }, docPyeong: 1 },
    { id: 'CQ', kind: 'QUARANTINE', label: '상온 격리', rect: R.CQ, docPyeong: 1 },
    { id: 'SHIP', kind: 'SHIPPING', label: '인계', rect: R.SHIP, docPyeong: ZONE_PY.SHIP },
    { id: 'PARK', kind: 'PARKING', label: '라이더 대기', rect: R.PARK },
  ];

  // ── 랙 ──────────────────────────────────────────────
  // 냉장·냉동 피킹: 한 줄 17랙(북쪽 9 | 가로 통로 1.4 m | 남쪽 8, z 2.95~25.6). 그룹 = 물리 줄(B01~B05, A01~A04), 랙 번호 1~17 [시뮬]
  const COLD_Z0 = 2.95;
  const coldAlong = [
    ...Array.from({ length: 9 }, (_, i) => COLD_Z0 + RACK_LEN * (i + 0.5)),
    ...Array.from({ length: 8 }, (_, i) => COLD_Z0 + 9 * RACK_LEN + 1.4 + RACK_LEN * (i + 0.5)),
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
  // 냉장 B 80 = 5줄(띠에 등 댄 홑줄 + 등 맞댄 2쌍) × 17 − 5, 냉동 A 67 = 4줄(홑줄 + 1쌍 + 동쪽 벽 홑줄) × 17 − 1
  const bRows = coldRows(BAND.CHILLED + BAND.width + 0.1, R.B.x1 - 0.1, ['S+', 'P', 'P']);
  const aRows = coldRows(BAND.FROZEN + BAND.width + 0.1, R.A.x1 - 0.1, ['S+', 'P', 'S-']);
  const chilled = coldRacks('CHILLED', 'B', bRows.rows, CHUNCHEON_RACKS.B, 'RB');
  const frozen = coldRacks('FROZEN', 'A', aRows.rows, CHUNCHEON_RACKS.A, 'RA');

  // 상온: 가로(동서) 줄, 줄마다 5랙, 등 맞댄 쌍. 그룹은 남쪽 줄부터 채움(구역 1: G → F → D → C — 그림의 북쪽부터 C·D·F·G, 구역 2: H → E).
  // 그룹 안 줄 번호는 남쪽부터, 랙 번호는 줄 안 서쪽부터 [시뮬]
  const ambient: Rack[] = [];
  const ambientBlock = (area: Rect, groups: [string, number][], pairs: number, aisle: number, prefix: string) => {
    const PER = 5;
    const x0 = (area.x0 + area.x1) / 2 - (PER * RACK_LEN) / 2;
    const xs = Array.from({ length: PER }, (_, i) => x0 + (i + 0.5) * RACK_LEN);
    const depth = pairs * 2 * RACK_DEPTH + (pairs - 1) * aisle;
    const z0 = (area.z0 + area.z1) / 2 - depth / 2;
    const rows: { cz: number; face: 1 | -1 }[] = [];
    for (let p = 0; p < pairs; p++) {
      const zz = z0 + p * (2 * RACK_DEPTH + aisle);
      rows.push({ cz: zz + RACK_DEPTH / 2, face: -1 }, { cz: zz + RACK_DEPTH * 1.5, face: 1 });
    }
    rows.reverse(); // 남쪽 줄부터
    const slots = rows.flatMap((row) => xs.map((x) => ({ x, ...row })));
    let k = 0;
    for (const [g, n] of groups) {
      const rowNo = new Map<number, number>();
      const perRow = new Map<number, number>();
      for (let i = 0; i < n; i++, k++) {
        const s = slots[k];
        const key = Math.round(s.cz * 1000);
        if (!rowNo.has(key)) rowNo.set(key, rowNo.size + 1);
        perRow.set(key, (perRow.get(key) ?? 0) + 1);
        ambient.push({ id: `${prefix}-${k + 1}`, temp: 'AMBIENT', group: `${g}${String(rowNo.get(key)).padStart(2, '0')}`, rackNo: perRow.get(key)!, cx: s.x, cz: s.cz, along: 'x', face: s.face, ...dims(g) });
      }
    }
  };
  ambientBlock(R.CH1, [['G', CHUNCHEON_RACKS.G], ['F', CHUNCHEON_RACKS.F], ['D', CHUNCHEON_RACKS.D], ['C', CHUNCHEON_RACKS.C]], 7, 1.0, 'RC');
  ambientBlock(R.CH2, [['H', CHUNCHEON_RACKS.H], ['E', CHUNCHEON_RACKS.E]], 3, 1.1, 'RC2');
  // 자리 다시(칸 코드는 위 그대로 — 서버에 재고 있음): 구역 1 은 등 맞댄 6쌍(통로 1.0 m, 남·북 여백 0.35 m), 만든 순서(남쪽 줄부터)대로 채우되
  // G 첫 줄(G01, 5랙)은 구역 2 앞(남쪽)으로 — 구역 1 맨 앞 줄과 같은 높이라 G 가 가로로 이어진다. 구역 2 의 E·H 3쌍은 그 북쪽(z 10.6~17.6 가운데) — 사용자 2026-11-24 "G랙 맨 앞 한 줄 상온구역2 앞에 붙이면 G 가로로 이어지겠네"
  {
    const rowSlots = (area: Rect, pairs: number, aisle: number, southMargin: number) => {
      const xs = Array.from({ length: 5 }, (_, i) => (area.x0 + area.x1) / 2 + (i - 2) * RACK_LEN);
      const depth = pairs * 2 * RACK_DEPTH + (pairs - 1) * aisle;
      const z0 = area.z1 - southMargin - depth;
      const rows: { cz: number; face: 1 | -1 }[] = [];
      for (let p = 0; p < pairs; p++) {
        const zz = z0 + p * (2 * RACK_DEPTH + aisle);
        rows.push({ cz: zz + RACK_DEPTH / 2, face: -1 }, { cz: zz + RACK_DEPTH * 1.5, face: 1 });
      }
      rows.reverse();
      return rows.flatMap((row) => xs.map((x) => ({ x, ...row })));
    };
    const z1Racks = ambient.filter((r) => r.id.startsWith('RC-'));
    // 맨 앞(패킹 쪽) 줄 = 고회전 F — 구역 2 앞 줄 F02(코드상 F 의 5랙 줄 첫째 — F01 은 3랙), 구역 1 은 남쪽부터 F01·F03·F04 → G01~G04 → D → C(사용자 2026-11-24 "고회전F열이 패킹대에 제일 가까이 있어야 해 … G G F F 이렇게 바꾸자").
    // 칸 코드·만든 순서(피킹 순서)는 그대로, 자리만
    const moved = z1Racks.filter((r) => r.group === 'F02'); // 구역 2 앞 줄(5랙)
    const order = [...z1Racks.filter((r) => r.group[0] === 'F' && r.group !== 'F02'), ...z1Racks.filter((r) => r.group[0] === 'G'), ...z1Racks.filter((r) => r.group[0] === 'D'), ...z1Racks.filter((r) => r.group[0] === 'C')];
    const s1 = rowSlots(R.CH1, 6, 1.0, 0.35);
    order.forEach((r, k) => Object.assign(r, { cx: s1[k].x, cz: s1[k].cz, face: s1[k].face }));
    const frontCz = s1[0].cz; // 구역 1 맨 앞(남쪽) 줄 높이 — 구역 2 앞 F01 줄도 이 높이(F 가 가로로 이어짐)
    const xs2 = Array.from({ length: 5 }, (_, i) => (R.CH2.x0 + R.CH2.x1) / 2 + (i - 2) * RACK_LEN);
    moved.forEach((r, i) => Object.assign(r, { cx: xs2[i], cz: frontCz, face: 1 }));
    // E·H 3쌍은 맨 앞 F02 줄 북쪽에 붙여 쌍 사이·마지막 쌍과 F02 줄 사이 통로를 모두 1.1 m 로(사용자 2026-11-24 "춘천MfC 상온 구역 2 랙 사이 통로 일정하게")
    const s2 = rowSlots({ x0: R.CH2.x0, z0: R.CH2.z0, x1: R.CH2.x1, z1: frontCz - RACK_DEPTH / 2 - 1.1 }, 3, 1.1, 0);
    ambient.filter((r) => r.id.startsWith('RC2-')).forEach((r, k) => Object.assign(r, { cx: s2[k].x, cz: s2[k].cz, face: s2[k].face }));
  }

  // 보충재고 랙(랙당 5단 × 3 = 15) — 냉장·냉동은 서쪽 벽 띠에 등 댄 한 줄 7, 상온은 입고창고에 가로 4랙 × 4줄(등 맞댄 2쌍) 16
  const reserve: Rack[] = [];
  for (const [temp, X0, prefix] of [['FROZEN', BAND.FROZEN, 'RRF'], ['CHILLED', BAND.CHILLED, 'RRC']] as const) {
    for (let i = 0; i < CHUNCHEON_RACKS.reserveCold; i++) {
      reserve.push({ id: `${prefix}-${i + 1}`, temp, group: 'R01', rackNo: i + 1, cx: X0 + 0.05 + RACK_DEPTH / 2, cz: BAND.reserveZ0 + RACK_LEN * (i + 0.5), along: 'z', face: 1, levels: RESERVE_SLOTS[0], slotsPerLevel: RESERVE_SLOTS[1], reserve: true });
    }
  }
  {
    // 입고창고: 맨 안쪽(북쪽 벽) 대형재고 → 입고재고 → 보충재고 랙(문 쪽) — 1호점·세종과 같은 순서
    // 서쪽 벽 안쪽에 통로 0.8 m(문 → 대형재고·입고재고·보충재고)
    const xs = Array.from({ length: 4 }, (_, i) => R.WH.x0 + 0.8 + (i + 0.5) * RACK_LEN);
    const rows: { cz: number; face: 1 | -1 }[] = [];
    for (const zz of [5.9, 7.8]) rows.push({ cz: zz + RACK_DEPTH / 2, face: -1 }, { cz: zz + RACK_DEPTH * 1.5, face: 1 });
    let n = 0;
    for (const row of rows) for (const x of xs) reserve.push({ id: `RRA-${++n}`, temp: 'AMBIENT', group: 'R01', rackNo: n, cx: x, cz: row.cz, along: 'x', face: row.face, levels: RESERVE_SLOTS[0], slotsPerLevel: RESERVE_SLOTS[1], reserve: true });
  }

  const racks = [...frozen, ...chilled, ...ambient, ...reserve];
  const locations: Location[] = racks.flatMap(rackLocations);
  const locationsByTemp: Record<TemperatureZone, Location[]> = { AMBIENT: [], CHILLED: [], FROZEN: [] };
  for (const l of locations) if (!l.reserve) locationsByTemp[l.temp].push(l);

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
  const SHIP_DOOR: readonly [number, number] = [24.2, 26.4];
  hWall(0, 0, CHC_W, LIFTS.map((l) => l.door));
  hWall(CHC_BD, 0, CHC_W, [SHIP_DOOR]);
  vWall(0, 0, CHC_BD);
  vWall(CHC_W, 0, CHC_BD);
  vWall(BUMP.x0 + T / 2, CHC_BD, BUMP.z1);
  vWall(BUMP.x1 - T / 2, CHC_BD, BUMP.z1);
  hWall(BUMP.z1 - T / 2, BUMP.x0, BUMP.x1, [], 1.1);
  // 냉장·냉동: 문은 방마다 북·남 하나씩 — 첫 통로 앞
  const door = (a: [number, number]) => [(a[0] + a[1]) / 2 - 0.9, (a[0] + a[1]) / 2 + 0.9] as const;
  const bDoor = door(bRows.aisles[0]);
  const aDoor = door(aRows.aisles[0]);
  hWall(1.7, 0, 15.45, [bDoor, aDoor]);
  vWall(7.75, 1.7, 27.0);
  vWall(15.45, 1.7, 27.0);
  hWall(27.0, 0, 15.45, [bDoor, aDoor]);
  // 입고·검수: 서쪽 문(북쪽 통로 → 냉장·냉동), 동쪽 문(입고창고 쪽 통로). 상온 구역으로 바로 가는 남쪽 문은 두지 않음(세종과 같게)
  vWall(R.RCV.x0, 0, R.RCV.z1 + 0.1, [[0.1, 1.6]]);
  hWall(R.RCV.z1 + 0.1, R.RCV.x0, R.RCV.x1);
  vWall(R.RCV.x1, 0, R.RCV.z1 + 0.1, [[2.4, 4.4]]);
  // 상온 입고창고: 서쪽 벽 문(입고재고 앞), 남쪽 벽 문(상온 구역 2 보충)
  vWall(R.WH.x0, 0, R.WH.z1, [[3.6, 5.6]]);
  hWall(R.WH.z1, R.WH.x0, CHC_W, [[25.0, 26.8]]);
  // 승강기 별동
  vWall(ANNEX.x0, ANNEX.z0, 0);
  hWall(ANNEX.z0, ANNEX.x0, ANNEX.x1);
  vWall(ANNEX.x1, ANNEX.z0, 0, [ANNEX.truckDoor]);
  const yardX = [19.0, 31.3] as const;
  walls.push({ rect: { x0: yardX[0] - 0.15, z0: CHC_BD, x1: yardX[0], z1: CHC_D }, height: 1.0 });
  walls.push({ rect: { x0: yardX[1], z0: CHC_BD, x1: yardX[1] + 0.15, z1: CHC_D }, height: 1.0 });

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
    [1.95, 3.2].forEach((z0, j) => addReserve(`${rid}-${j + 3}`, temp, X0 + 0.1, z0, { x: X0 + 1.65, z: 3.15 }, 'RECEIVING'));
  }
  // 대형재고 10(5 | 5, 맨 안쪽 북쪽 벽) → 서버 A-R2-01~10-1-01. 번호는 열마다 북쪽 → 남쪽, 서쪽 열부터
  {
    let n = 0;
    for (let c = 0; c < 5; c++) {
      const x0 = R.WH.x0 + 0.8 + c * 1.3;
      for (const z0 of [0.3, 1.9]) addReserve(`WB-${String(++n).padStart(2, '0')}`, 'AMBIENT', x0, z0, { x: x0 + P / 2, z: z0 + P + 0.25 }, 'BULK');
    }
  }
  // 상온 입고재고 6(대형재고 남쪽 한 줄) → 서버 RCV-A-02(화면 자리만). 사람은 팔레트 남쪽에서
  for (let c = 0; c < 6; c++) {
    const x0 = R.WH.x0 + 0.8 + c * 1.1;
    addReserve(`WR-${String(c + 1).padStart(2, '0')}`, 'AMBIENT', x0, 3.7, { x: x0 + P / 2, z: 5.25 }, 'RECEIVING');
  }

  // 하차 칸: 입고·검수 안
  const dockSlots: DockSlot[] = [];
  for (const z of [2.4, 3.1, 4.2, 4.9]) for (let c = 0; c < 9; c++) dockSlots.push({ id: `DK-${dockSlots.length + 1}`, pos: { x: 17.0 + c * 0.6, z } });

  // 패킹대 6 = 3 | 3 — 위 줄 PS-1~3 북쪽 끝, 아래 줄 PS-4~6 남쪽 끝, 점원은 가운데 통로 쪽(처음 8대 → 출하문 앞을 막아 6대로)
  const stations: PackingStation[] = [];
  const gap = (R.PK.x1 - R.PK.x0 - 0.6 - 3 * PACK_TABLE_W) / 2;
  for (let i = 0; i < 6; i++) {
    const top = i < 3;
    const tx = R.PK.x0 + 0.3 + PACK_TABLE_W / 2 + (i % 3) * (PACK_TABLE_W + gap);
    const tz = top ? R.PK.z0 + 0.65 : R.PK.z1 - 0.65;
    stations.push({ id: `PS-${i + 1}`, index: i, table: { x: tx, z: tz }, stand: { x: tx, z: top ? tz + 1.2 : tz - 1.2 } });
    obstacles.push({ rect: { x0: tx - PACK_TABLE_W / 2, z0: tz - 0.4, x1: tx + PACK_TABLE_W / 2, z1: tz + 0.4 }, height: 0.9, kind: 'TABLE' });
  }

  // 인계 랙 2(돌출부 안, 출하문 양옆)
  const shippingSlots: ShippingSlot[] = [];
  const shipZ = BUMP.z0 + 0.1 + 0.25 + RACK_DEPTH / 2;
  // 인계 랙 2 — 세로(남북)로 돌려 돌출부 서·동 벽에 붙임(출하문 앞을 비움, 사용자 2026-11-24 "냉장냉동 격리바닥 실선이랑 격리 랙이랑 안 맞잖아. 그리고 상온 격리 구역 랙 세로로 방향 돌려서 벽에 붙이라고. 인계랙 입구를 패킹대가 침범하네 패킹대 6대로 줄여주고 장바구니 거치대 조금 더 동쪽으로 … 인계랙도 세로로 돌려서 벽에 붙여줘. 입구를 막았잖아")
  void shipZ;
  const shipCz = BUMP.z0 + 0.15 + RACK_LEN / 2;
  [BUMP.x0 + 0.15 + RACK_DEPTH / 2, BUMP.x1 - 0.15 - RACK_DEPTH / 2].forEach((x, ri) => {
    obstacles.push({ rect: { x0: x - RACK_DEPTH / 2, z0: shipCz - RACK_LEN / 2, x1: x + RACK_DEPTH / 2, z1: shipCz + RACK_LEN / 2 }, height: RACK_HEIGHT, kind: 'SHIP_RACK' });
    for (let lv = 0; lv < 4; lv++) for (let s = 0; s < 4; s++) shippingSlots.push({ id: `SR${ri + 1}-${lv + 1}${s + 1}`, rackIndex: ri, pos: { x, y: 0.25 + lv * 0.5, z: shipCz - 0.45 + s * 0.3 } });
  });

  // ── 바닥 표시 ───────────────────────────────────────
  const coldArea = (X0: number, color: 'FROZEN' | 'CHILLED'): StoreArea => {
    const X1 = X0 + BAND.mark;
    // 판·실선은 입고재고 팔레트(z 1.95~4.3)와 보충재고 랙(z 4.6~13.35)에 맞춤 — 격리는 남쪽 따로(구역 판). 사용자 2026-11-24 "냉동냉장 구역 바닥에 입고 보충 격리 나눈 실선 랙에 맞게 조절해"
    const rackEnd = BAND.reserveZ0 + CHUNCHEON_RACKS.reserveCold * RACK_LEN + 0.25;
    const L0 = X0 + 0.12, L1 = X1 - 0.12, Tz = BAND.z0 + 0.12, Bz = Q.z0 + Q.len - 0.12, DIV = (4.3 + BAND.reserveZ0) / 2;
    return {
      floor: [X0, BAND.z0, X1, Q.z0 + Q.len],
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
      lines: [[WHL, 3.4, WHR, 3.4], [WHL, 5.7, WHR, 5.7]], // 대형재고 | 입고재고 | 보충재고
      texts: [
        { t: '대형재고', x: (R.WH.x0 + R.WH.x1) / 2, z: 3.2 },
        { t: '입고재고', x: (R.WH.x0 + R.WH.x1) / 2, z: 5.45 },
        { t: '보충재고', x: R.WH.x0 + 2.9, z: 9.35 },
      ],
    },
  ];

  // ── 점 ───────────────────────────────────────────────
  // 장바구니 거치대 — 패킹 동쪽에 가로 2줄(줄마다 10대, 줄 사이 1.6 m)(사용자 2026-11-24 "장바구니 거치대 가로로 돌리고 간격 두고 2줄로").
  // 첫 줄 = 패킹 북쪽 선 높이, 카트는 거치대 점에서 서쪽으로(x −2.0 ~ +0.7). 되돌릴 상품 탁자는 두 줄 동쪽 끝, 대기 작업자는 그 북쪽
  // 2026-11-24 "장바구니 거치대 조금 더 동쪽으로" — 카트 줄 x 약 27.7~30.9 → "조금 남쪽으로"(첫 줄 z 23.0)
  const cartDepot = { x: 29.2, z: 24.1 }; // 사용자 2026-11-24 "…장바구니 거치대 조금만 더 서쪽으로 밀어" → "조금만 더 남쪽으로 밀고 조금 더 서쪽으로"(각 0.5 m)
  const points: Layout['points'] = {
    truckDoor: { x: (LIFTS[0].door[1] + LIFTS[1].door[0]) / 2, z: 0.9 },
    truckDock: { x: ANNEX.x1 + 0.3 + 3.2, z: (ANNEX.truckDoor[0] + ANNEX.truckDoor[1]) / 2 },
    inboundIdle: Array.from({ length: 8 }, (_, i) => ({ x: 17.4 + (i % 4) * 0.8, z: 5.6 + Math.floor(i / 4) * 0.7 })),
    cartDepot,
    idle: Array.from({ length: 24 }, (_, i) => ({ x: 25.2 + (i % 8) * 0.8, z: 19.9 + Math.floor(i / 8) * 0.7 })), // 거치대 북쪽(상온 구역 2 앞 G 줄 남쪽)
    packQueue: { x: R.PK.x1 - 0.5, z: (R.PK.z0 + R.PK.z1) / 2 },
    shipDrop: { x: (SHIP_DOOR[0] + SHIP_DOOR[1]) / 2, z: CHC_BD - 0.4 },
    riderPickup: { x: (BUMP.x0 + BUMP.x1) / 2, z: BUMP.z1 + 0.55 },
    riderParking: Array.from({ length: 9 }, (_, i) => ({ x: 20.2 + i * 1.2, z: 34.8 })),
    riderEntry: { x: 25.3, z: 36.6 },
  };

  const geo: SiteGeo = {
    yardX,
    liftAnnex: ANNEX,
    freightLifts: LIFTS,
    liftZ0: ANNEX.z0,
    returnIntake: { x: 29.0, z: 31.2 }, // 인계 창 밖 동쪽 [시뮬]
    storeAreas,
    officeTable: null, // 춘천은 휴게·사무 구역이 없음(요청서 표)
    // 롤테이너 장식 — 입고·검수 남동 모서리(승강기 문 앞을 비움, 사용자 2026-11-24 "롤컨테이너 장식인 것 같은데 승강기 앞에다가 두면 어떡해")
    rollContainers: [21.3, 22.1].map((x) => ({ x, z: 5.95 })),
    quarantineRacks: {
      // 저온 격리: 서쪽 벽에 세로로 2개(흰 실선 안, 사이 0.15 m)
      ...Object.fromEntries((['AQ', 'BQ'] as const).map((id) => {
        const X0 = id === 'AQ' ? BAND.FROZEN : BAND.CHILLED;
        return [id, [0, 1].map((i) => ({ x0: X0 + 0.1, z0: Q.z0 + 0.1 + i * (RACK_LEN + 0.1), x1: X0 + 0.1 + RACK_DEPTH, z1: Q.z0 + 0.1 + i * (RACK_LEN + 0.1) + RACK_LEN }))]; // 서쪽 벽에 세로로 앞뒤(남북) 나란히 — 둘 다 앞(동쪽)에서 꺼냄(사용자 2026-11-24 "2개를 나란히 해야지 겹치면 안에걸 어떻게 꺼내")
      })),
      // 상온 격리: 입고창고 동쪽 벽에 세로로 2개
      CQ: [0, 1].map((i) => ({ x0: R.CQ.x1 - 0.05 - RACK_DEPTH, z0: R.CQ.z0 + 0.25 + i * (RACK_LEN + 0.15), x1: R.CQ.x1 - 0.05, z1: R.CQ.z0 + 0.25 + i * (RACK_LEN + 0.15) + RACK_LEN })),
    },
    cartDepotVertical: false,
    cartDepotRows: 2,
    cartDepotRowGap: 1.6,
    // 되돌릴 상품 탁자 — 첫 카트 줄(시작점) 서쪽 끝 옆에 붙임 — 사용자 2026-11-24 "테이블은 시작점 장바구니 거치대 옆에 붙여줘. 그리고 조금 남쪽으로 오게 해. 패킹구역은 아주 조금 북쪽으로 밀고"
    // 되돌릴 상품 탁자 — 거치대 안쪽 동쪽 벽에 세로로(긴 쪽 남북) — 사용자 2026-11-24 "장바구니 거치대 안쪽 동쪽 벽에 테이블을 놔둬버려 세로로 돌려서. 그리고 장바구니 거치대 조금만 더 서쪽으로 밀어"
    returnTable: { x: CHC_W - 0.1 - 0.4, z: cartDepot.z + 0.2, vertical: true },
  };

  return {
    variant: 'CHUNCHEON',
    geo,
    width: CHC_W,
    depth: CHC_D,
    buildingDepth: CHC_BD,
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
