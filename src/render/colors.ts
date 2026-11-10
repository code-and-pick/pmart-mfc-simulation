import type { TemperatureZone } from '../domain/contract';
import type { ZoneKind } from '../domain/layout';
import type { InboundState } from '../sim/inbound';
import type { WorkerState } from '../sim/worker';

export const ZONE_COLOR: Record<ZoneKind, number> = {
  FROZEN: 0x2b4e7e,
  CHILLED: 0x2f6f73,
  AMBIENT: 0x6b5b3e,
  INBOUND_STORE: 0x4a4a52,
  RECEIVING: 0x55505e,
  OFFICE: 0x3d3d44,
  PACKING: 0x6a4a6e,
  QUARANTINE: 0x7a3434,
  SHIPPING: 0x7a6a2a,
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
