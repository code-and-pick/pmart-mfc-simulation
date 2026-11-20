import type { TemperatureZone } from '../domain/contract';
import type { ZoneKind } from '../domain/layout';
import type { InboundState } from '../sim/inbound';
import type { WorkerState } from '../sim/worker';

export const ZONE_COLOR: Record<ZoneKind, number> = {
  // 바닥 — 진하고 탁한 색 대신 너무 밝지 않은 부드러운 색(사용자 2026-11-20 "부드러운 하늘색, 연두색, 노란색, 분홍색, 주황색, 남색", 첫 안보다 "좀 더 진하게")
  FROZEN: 0x67a6d6, // 냉동 — 하늘색
  CHILLED: 0x84bd63, // 냉장 — 연두색
  AMBIENT: 0xdcbd52, // 상온 — 노란색
  INBOUND_STORE: 0xd88b52, // 입고창고 — 주황색
  RECEIVING: 0x48589a, // 입고·검수 — 남색
  OFFICE: 0x3d3d44,
  PACKING: 0xd686a3, // 패킹 — 분홍색
  QUARANTINE: 0x1a1a1d, // 격리 — 검정(사용자 2026-11-20 "격리는 검정색으로")
  SHIPPING: 0xd4b43a, // 외부 출하대기 — 칙칙한 올리브 → 노랑(2026-11-20)
  PARKING: 0x2e2e2e,
};

/**
 * 밝은 도면풍 장면(사용자 2026-11-20 그림 참고 "랙, 점원 같은 거 이것처럼 우리 규칙에 맞게") —
 * 흰 바닥 + 구역은 구역색 점선 테두리·옅은 물빛(구역색은 위 ZONE_COLOR 그대로), 파란 기둥·주황 가로대 랙, 재고만큼 갈색 상자.
 */
export const SCENE = {
  backdrop: 0xe8ecf1,
  outside: 0xdde1e7,
  floor: 0xf4f5f7,
  yard: 0xc3c8cf,
  wall: 0xf7f8fa,
  /** 구역 바닥 물빛(구역색) 불투명도 — 흰 바닥 위 아주 옅게 */
  zoneTint: 0.14,
  rackPost: 0x1f5fbf,
  rackBeam: 0xf08c2b,
  rackDeck: 0xd3d8df,
  rackDivider: 0xa9b0ba,
  /** 상자(갈색 골판지) — 상품마다 조금씩 다르게 */
  box: 0xc8955a,
  /** 실서버 모드에서 수량을 모르는 시뮬레이터 상자 — 연회색(실제 재고처럼 보이지 않게) */
  boxUnknown: 0xc9ccd1,
  station: 0xe9ecef,
  stationOff: 0xb0b5bc,
};

export const TEMP_COLOR: Record<TemperatureZone, number> = {
  FROZEN: 0x5aa9ff,
  CHILLED: 0x4fd1c5,
  AMBIENT: 0xf2b84b,
};

export const STATE_COLOR: Record<WorkerState, number> = {
  IDLE: 0x9aa0a6,
  TO_CART: 0x8ab4f8,
  PICKING: 0x34a853,
  WAIT_STATION: 0xfbbc04,
  PACKING: 0xff7043,
  TO_SHIP: 0xc58af9,
  RETURNING: 0x9aa0a6,
  ERROR: 0xea4335,
};

export const INBOUND_COLOR: Record<InboundState, number> = {
  IDLE: 0x9aa0a6,
  RECEIVING: 0x7986cb,
  PUTAWAY: 0x9ccc65,
  REPLENISH: 0xf06292,
  RETURNING: 0x9aa0a6,
  ERROR: 0xea4335,
};

export const VEST_PICKER = 0x1e88e5;
export const VEST_INBOUND = 0xff9800;

export const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
