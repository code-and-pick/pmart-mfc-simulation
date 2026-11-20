import * as THREE from 'three';
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
  // 참고 그림 색 그대로(사용자 2026-11-20 "벽이랑 배경이랑 바닥색이 너무 밝게 됐는데 이미지랑 같은 색으로") — 연보라빛 회색 배경, 옅은 회청 바닥, 흰 유리 벽
  backdrop: 0xe3e6ef,
  outside: 0xdfe2eb,
  floor: 0xeceef4,
  yard: 0xd6d9e2,
  wall: 0xeaf0fb,
  /** 구역 바닥 물빛(구역색) 불투명도 — 흰 바닥 위 아주 옅게 */
  zoneTint: 0.14,
  rackPost: 0x1f73f0,
  rackBeam: 0xff9d2e,
  /** 선반 판 — 그림의 나무 팔레트 빛 */
  rackDeck: 0xe7cfa6,
  rackDivider: 0x9aa6b8,
  /** 상자(갈색 골판지) — 상품마다 조금씩 다르게 */
  box: 0xe2b27a,
  /** 실서버 모드에서 수량을 모르는 시뮬레이터 상자 — 연회색(실제 재고처럼 보이지 않게) */
  boxUnknown: 0xd6dae0,
  station: 0xffffff,
  stationOff: 0xc2c8d0,
  /** 바깥벽(낮고 두꺼운 흰 벽)·안쪽 칸막이(낮은 선)·유리(사무·패킹) */
  outerWallH: 1.0,
  innerWallH: 0.35,
  innerWall: 0xe2e6ec,
  /** 구역 이름표(보라 둥근 판)·격리 이름표(남색) */
  pill: '#5b4fd6',
  /** 판 그라데이션 위쪽(밝은 보라) — 그림의 "상온 C~H" 판 */
  pillTop: '#7a62ee',
  pillDim: '#2f3a63',
  /** 작업 중 칸 빛(보라) */
  working: 0x8b5cf6,
  walkway: 0xffffff,
};

/**
 * 구역 바닥색(사용자 2026-11-20 참고 그림 "그림처럼") — 냉동 옅은 하늘·냉장 옅은 연두만 색, 나머지는 거의 흰색. 격리 옅은 회색.
 * (그 전 6색 ZONE_COLOR 는 점선·물빛에서 빠짐 — 아래 ZONE_COLOR 는 왼쪽 구역 패널 등 다른 곳 호환용으로 남김)
 */
export const ZONE_FLOOR: Record<ZoneKind, number> = {
  FROZEN: 0xd3e2f6,
  CHILLED: 0xdaeacf,
  AMBIENT: 0xeceef4,
  INBOUND_STORE: 0xeceef4,
  RECEIVING: 0xeceef4,
  OFFICE: 0xeef0f6,
  PACKING: 0xeceef4,
  QUARANTINE: 0xdfe2ea,
  SHIPPING: 0xeceef4,
  PARKING: 0xe2e5ec,
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

/**
 * 선반 상품 상자 색 = 그 구역 바닥색(사용자 2026-11-20 "구역별로 박스 색 바닥색으로 바꿔줘").
 * 바닥 그대로면 흰 랙·바닥에 묻혀 안 보여 채도 +0.18, 밝기 −0.1 만 진하게(무늬 텍스처와 곱해짐).
 */
export function zoneBoxColor(temp: 'AMBIENT' | 'CHILLED' | 'FROZEN', out = new THREE.Color()): THREE.Color {
  return out.setHex(ZONE_FLOOR[temp]).offsetHSL(0, 0.18, -0.1);
}
