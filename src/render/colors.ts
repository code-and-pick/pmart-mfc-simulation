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
  QUARANTINE: 0x7a3434,
  SHIPPING: 0xd4b43a, // 외부 출하대기 — 칙칙한 올리브 → 노랑(2026-11-20)
  PARKING: 0x2e2e2e,
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
