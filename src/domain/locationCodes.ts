// 시뮬레이터 평면 코드 ↔ 백엔드 위치 코드(ADR-0042) 대응.
// 근거: pmart-backend docs/handoff/simulator/mfc/2026-11-09-simulator-notice-layout-bins.md, …/mfc/2026-11-16-simulator-notice-layout-v2-slots.md,
//       deploy/lan/seed/mfc_layout.py plan() — 백엔드는 이 평면(buildLayout)을 그대로 MFC-SEED-01 에 등록했다(SIM-6 보완).
// 실서버 모드에서는 백엔드 코드가 정본이다. 화면·MOCK 은 시뮬레이터 코드를 그대로 쓴다.

import { BACKEND_FACTS } from '../config';
import type { TemperatureZone } from './contract';
import type { Layout } from './layout';

/** 평면에 코드가 따로 없는 자리 — 시뮬레이터 쪽 이름. */
export const SIM_POINT = {
  packQueue: 'PACK-QUEUE',
  /** 패킹 대기 지점의 냉동 칸 — 화면에서는 packQueue 와 같은 자리 */
  packQueueFrozen: 'PACK-QUEUE-F',
  cartDepot: 'CART-DEPOT',
  receiving: 'RCV',
  receivingDock: 'RCV-DOCK',
  returnIntake: 'RTN',
} as const;

const TEMP_LETTER: Record<TemperatureZone, 'A' | 'C' | 'F'> = { AMBIENT: 'A', CHILLED: 'C', FROZEN: 'F' };
const QUARANTINE: Record<string, string> = { AQ: 'QRT-F-01', BQ: 'QRT-C-01', CQ: 'QRT-A-01' };

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 집은 상품을 내려놓는 포장 위치(PICK toLocation) — 시뮬레이터 코드.
 * 패킹 대기 지점 안에 냉장 칸(PAK-C-01)·냉동 칸(PAK-F-01)이 따로 있다(사용자 2026-11-10, 백엔드 mfc_layout.py).
 * 상온은 대기 지점에 상온 칸이 없어 냉장 칸(PAK-C-01)에 둔다 — 임시, R-13. 백엔드는 온도대를 검사하지 않는다(Locations.requirePacking).
 */
export function packDropPoint(temp: TemperatureZone): string {
  return temp === 'FROZEN' ? SIM_POINT.packQueueFrozen : SIM_POINT.packQueue;
}

export interface LocationCodeMap {
  /** 시뮬레이터 코드 → 백엔드 코드. 대응이 없으면 null. */
  toBackend(simCode: string): string | null;
  /** 백엔드 코드 → 시뮬레이터 코드. 평면에 없는 위치(MIGRATION 등)는 null. */
  toSim(backendCode: string): string | null;
  /** 선반 칸 수(대응표 점검용) */
  readonly shelfCount: number;
}

/** 선반 칸: `A01-01-101` → `F-A1-01-1-01` ({온도대}-{그룹 글자 + 줄 번호}-{랙 2자리}-{단}-{칸 2자리}). */
export function shelfBackendCode(temp: TemperatureZone, group: string, rackNo: number, level: number, slot: number): string {
  const area = group[0] + String(Number(group.slice(1)));
  return `${TEMP_LETTER[temp]}-${area}-${pad2(rackNo)}-${level}-${pad2(slot)}`;
}

export function buildLocationCodeMap(L: Layout): LocationCodeMap {
  const toB = new Map<string, string>();
  const toS = new Map<string, string>();
  const pair = (sim: string, backend: string, reverse = true) => {
    toB.set(sim, backend);
    if (reverse) toS.set(backend, sim);
  };

  const racks = new Map(L.racks.map((r) => [r.id, r]));
  for (const loc of L.locations) {
    const r = racks.get(loc.rackId)!;
    pair(loc.code, shelfBackendCode(loc.temp, r.group, r.rackNo, loc.level, loc.slot));
  }
  const shelfCount = toB.size;

  // 보충재고 랙 칸은 위 선반 규칙 그대로(그룹 R01 → {A|C|F}-R1-NN-단-칸).
  // 입고재고 팔레트(검수 전) = 그 온도대 입고칸 하나 — 저온 2개 RCV-C-01·RCV-F-01(R-31), 상온 입고창고 뒤 줄 6개 RCV-A-02(R-32)
  const rcvSeen = new Set<string>();
  for (const rs of L.reserves) {
    // 상온은 입고·검수 구역 RCV-A-01 이 이미 있어 입고창고 입고재고 줄은 RCV-A-02
    const code = rs.temp === 'AMBIENT' ? 'RCV-A-02' : `RCV-${TEMP_LETTER[rs.temp]}-01`;
    pair(rs.id, code, !rcvSeen.has(code));
    rcvSeen.add(code);
  }

  for (const st of L.stations) pair(st.id, `PAK-A-${pad2(Number(st.id.split('-')[1]))}`);
  // 패킹 대기 지점: 백엔드는 같은 좌표에 PAK-C-01(냉장)·PAK-F-01(냉동) 두 칸을 둔다
  pair(SIM_POINT.packQueue, 'PAK-C-01');
  pair(SIM_POINT.packQueueFrozen, 'PAK-F-01');

  for (const [zoneId, code] of Object.entries(QUARANTINE)) pair(zoneId, code);
  pair(SIM_POINT.receiving, 'RCV-A-01');
  pair(SIM_POINT.receivingDock, 'RCV-A-01', false);
  for (const d of L.dockSlots) pair(d.id, 'RCV-A-01', false);
  pair(SIM_POINT.returnIntake, 'RTN-A-01');

  // 외부 출하대기 랙 2개 → DSP-A-01·02 (칸 SR1-xx 는 랙 1)
  for (const s of L.shippingSlots) pair(s.id, `DSP-A-${pad2(s.rackIndex + 1)}`, false);
  toS.set('DSP-A-01', 'SHIP-RACK-1');
  toS.set('DSP-A-02', 'SHIP-RACK-2');

  // 장바구니 보관: 백엔드는 카트 보관소 한 자리에 CRT 40대(mfc_carts.py, 2026-11-17)
  pair(SIM_POINT.cartDepot, 'CRT-A-01');
  for (const c of BACKEND_FACTS.cartLocations) toS.set(c.code, SIM_POINT.cartDepot);

  return {
    toBackend: (c) => toB.get(c) ?? null,
    // 카트는 모두 카트 보관소 한 자리 — 목록 밖 카트(옛 냉장·냉동 CRT-C-01 처럼 재고가 남아 열린 카트, 0cbfecaa)도 같은 자리
    toSim: (c) => toS.get(c) ?? (/^CRT-[A-Z]-\d+$/.test(c) ? SIM_POINT.cartDepot : null),
    shelfCount,
  };
}
