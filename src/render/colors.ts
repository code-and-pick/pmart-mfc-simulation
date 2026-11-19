import type { TemperatureZone } from '../domain/contract';
import type { ZoneKind } from '../domain/layout';
import type { InboundState } from '../sim/inbound';
import type { WorkerState } from '../sim/worker';

// 구역 바닥 — 채도 낮추고 밝게(어두운 테마에서 칙칙·핏빛이던 것, 사용자 2026-11-20). 격리는 붉은 기만 남김
export const ZONE_COLOR: Record<ZoneKind, number> = {
  FROZEN: 0x4a78ad,
  CHILLED: 0x4a9590,
  AMBIENT: 0x9a8662,
  INBOUND_STORE: 0x707885,
  RECEIVING: 0x7a7488,
  OFFICE: 0x646b78,
  PACKING: 0x8c7494,
  QUARANTINE: 0xa86a6a,
  SHIPPING: 0xa39352,
  PARKING: 0x555d6a,
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
