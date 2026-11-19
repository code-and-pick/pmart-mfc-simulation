import type { TemperatureZone } from '../domain/contract';
import type { ZoneKind } from '../domain/layout';
import type { InboundState } from '../sim/inbound';
import type { WorkerState } from '../sim/worker';

export const ZONE_COLOR: Record<ZoneKind, number> = {
  // 냉동·냉장 바닥 — 칙칙한 남색·청록 대신 맑은 파랑·청록(사용자 2026-11-20 "파랑색 청록색 그게 칙칙하다고")
  FROZEN: 0x3d84cc,
  CHILLED: 0x2fae9f,
  AMBIENT: 0xe3be3c, // 상온 — 맑은 노랑(2026-11-20 "노란끼 돌게, 칙칙하다")
  INBOUND_STORE: 0xd07a45, // 입고창고 — 주황(입고·검수와 구분, 사용자 2026-11-20)
  RECEIVING: 0x2f3f8f, // 입고·검수 — 남색(사용자 2026-11-20)
  OFFICE: 0x3d3d44,
  PACKING: 0x9a6cc4, // 패킹 — 탁한 보라 → 맑은 보라(2026-11-20)
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
