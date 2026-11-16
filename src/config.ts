// 시뮬레이션 기본값과 그 근거.
// 근거 표기: [확정] = 업무 문서 확정 입력, [가정] = 업무 문서의 가정·산출값, [시뮬] = 이 시뮬레이터가 정한 값.
// 업무 문서: pmart-backend/docs/business/MFC-business-logic.md (이하 MFC), overview.md §4.

export interface SimParams {
  mfcId: string;
  /** 시간당 주문 수. MFC 7-1 기준안 피크 약 40.1건/시간 [가정] */
  ordersPerHour: number;
  /** 피킹·패킹 겸업 작업자 수. MFC 7-2 기준안 피크 약 10명 [가정] */
  workers: number;
  /** 가동 패킹대. 기본 4대·최대 8대 [확정/산출] (MFC 11장) */
  packingStations: number;
  /** 주문당 평균 판매 유닛. 8유닛 [가정] (MFC 6장 432행) */
  unitsPerOrder: number;
  /** 출고 유닛 온도대 비중 상온·냉장·냉동 50:30:20 [가정] */
  tempMix: { AMBIENT: number; CHILLED: number; FROZEN: number };
  /** 패킹 기본 소요. 주문당 4분 [가정] (MFC 7-1) — 여기서는 기본 + 유닛당 시간으로 나눈다 */
  packBaseSec: number;
  packPerUnitSec: number;
  /** 로케이션 도착 후 위치·상품 바코드 스캔 [시뮬] */
  pickScanSecPerLine: number;
  pickSecPerUnit: number;
  /** 보행 속도 m/s [시뮬] (장바구니를 밀며 이동) */
  walkSpeed: number;
  /** 피킹 시 결품(SHORT) 확률 [시뮬] */
  shortageRate: number;
  /** 결품 보고 → 결품 사가(CANCEL_ITEM) 해결까지 [시뮬] — MOCK 이 order-orchestration 역할을 대신할 때의 지연 */
  shortageSagaSec: number;
  /** 피킹 순서. 원본 관찰 B→A→C~H (MFC 8-3, 보존 기록) 또는 상온→냉장→냉동 */
  pickSequence: 'DOC_B_A_C' | 'AMBIENT_FIRST';
  /** 출하 준비 후 라이더 도착까지 [시뮬] — Delivery 미구현이라 가상 라이더 */
  riderArrivalMinSec: number;
  riderArrivalMaxSec: number;
  /** 피킹 칸 중 상품을 놓는 비율. 85% 운영 상한 [가정] (MFC 3-3) */
  skuFillRate: number;
  /** 시작 시 선반 충족률 범위 [시뮬] — 낮을수록 첫 입고·적치가 많다 */
  initialShelfFill: [number, number];
  /** 시작 시 보충재고를 가진 SKU 비율 [시뮬] */
  initialReserveShare: number;
  /** 입고(검수·적치·보충) 작업자. 기준 3명(검수 2 + 이송 1) [가정] (MFC 10장) */
  inboundWorkers: number;
  /** 입고 차량 주기(시간). 실제는 매일 오전 1회 [확정] (MFC 10장) — 시뮬은 적치 과정을 보이려고 짧게 [시뮬] */
  inboundIntervalHours: number;
  /** 첫 입고 차량 도착(시작 후 초) [시뮬] */
  firstInboundAfterSec: number;
  /** 입고 차량 1대 최대 품목 수 [시뮬] */
  inboundMaxLines: number;
  /** 적치 카트 1회 최대 품목 수 [시뮬] */
  putawayCartLines: number;
  /** 분할 기준: 총 상품중량 10,000g 초과 시 분할 [확정 정책] (overview §4) */
  splitOverWeightG: number;
  /** 인계 fence 유효시간. 백엔드 설정 기본 3분 [확정] (사용자 결정 D-2 2026-11-08, pmart-backend deploy/lan/.config-repo/mfc-fulfillment-service.yml handover-fence-ttl) — 계약은 fenceExpiresAt 만 정의 */
  fenceTtlSec: number;
  /** 시작 시각(시) — 고객 주문 운영 08:00~24:00 (center-master MFC-SEED-01) */
  startHour: number;
  seed: number;
}

export const DEFAULT_PARAMS: SimParams = {
  mfcId: 'MFC-SEED-01',
  ordersPerHour: 40,
  workers: 10,
  packingStations: 4,
  unitsPerOrder: 8,
  tempMix: { AMBIENT: 0.5, CHILLED: 0.3, FROZEN: 0.2 },
  packBaseSec: 130,
  packPerUnitSec: 10,
  pickScanSecPerLine: 9,
  pickSecPerUnit: 3,
  walkSpeed: 1.1,
  shortageRate: 0.01,
  shortageSagaSec: 5,
  pickSequence: 'DOC_B_A_C',
  riderArrivalMinSec: 90,
  riderArrivalMaxSec: 480,
  skuFillRate: 0.85,
  initialShelfFill: [0.5, 1],
  initialReserveShare: 0.35,
  inboundWorkers: 3,
  inboundIntervalHours: 2,
  firstInboundAfterSec: 120,
  inboundMaxLines: 40,
  putawayCartLines: 4,
  splitOverWeightG: 10_000,
  fenceTtlSec: 180,
  startHour: 9,
  seed: 20261031,
};

/**
 * 백엔드 시험 센터(MFC-SEED-01)가 정한 값 — 백엔드 공지가 근거다(pmart-backend docs/handoff/simulator/).
 * 실서버 모드에서는 위치 조회(GET /locations) 결과가 정본이고, 여기 값은 MOCK 화면 표시용 사본이다.
 */
export const BACKEND_FACTS = {
  /** E2E 시험용 고회전 칸 5개 [확정] (2026-11-09-simulator-notice-layout-bins.md, docs/simulator/mfc/layout/high-turnover.json). 그 밖의 선반은 일반 선반(임시) */
  highTurnoverBins: ['H01-01-101', 'H01-01-102', 'H01-01-103', 'H01-01-104', 'H01-01-201'],
  /** 회수 반입 자리 RTN-A-01, 입고·검수 구역 안 x 38.6 · z 22.0 m [확정] (2026-11-09-simulator-notice-return-location.md, backend-points.json) */
  returnIntake: { code: 'RTN-A-01', x: 38.6, z: 22.0 },
} as const;

export const SPEEDS = [0, 1, 5, 15, 30, 60, 120] as const;

/**
 * 실서버 연결(관찰) — 근거: pmart-backend docs/simulator/mfc/mfc-simulator-integration.md (SIM-1~11),
 * docs/operations/lan-test-accounts.md (2026-11-16).
 */
export const REAL_LINK = {
  /** 실서버 읽기(작업 목록·상세·작업자 목록)에 쓰는 계정. 백엔드 문서의 "시뮬레이터 작업자" [확정] */
  observerAccount: 'claude-mfc-wrk',
  /** 가상 작업자 계정 — 실서버에 쓰는 단계에서 쓴다(아직 안 씀). 사용자 결정 2026-11-16 [확정] */
  virtualAccounts: Array.from({ length: 10 }, (_, i) => `mfcw-pp-${String(i + 1).padStart(2, '0')}`),
  /** 작업 목록 주기 조회 간격(초). SIM-5 "시작 3초" [확정] */
  pollSec: 3,
  /** 작업자 목록(표시 이름) 다시 읽기 간격(초) [시뮬] */
  workerRefreshSec: 60,
  /** 토큰 만료 이만큼 전이면 새로 받는다(초). 직원 토큰 15분 [시뮬] */
  tokenRefreshMarginSec: 60,
  /** 끝난(목록에서 빠진) 작업을 화면에 남겨 두는 시간(초) [시뮬] */
  recentKeepSec: 600,
  /** 주문에 나온 SKU 재고를 작업이 바뀌지 않아도 다시 읽는 간격(초) — PDA 밖 변화(이동·정정) 반영용 [시뮬] */
  stockRefreshSec: 30,
  /** 한 번 조회에서 재고를 새로 읽는 최대 SKU 수 — SKU 하나씩만 조회할 수 있어 상한을 둔다 [시뮬] */
  maxStockPerPoll: 10,
  /** 열린 작업 상태 — 이 상태들만 주기 조회한다(완료 이력은 읽지 않음) [시뮬] */
  openStates: ['WAITING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED'] as const,
};
