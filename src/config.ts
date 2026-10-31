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
  /** 피킹 순서. 원본 관찰 B→A→C~H (MFC 8-3, 보존 기록) 또는 상온→냉장→냉동 */
  pickSequence: 'DOC_B_A_C' | 'AMBIENT_FIRST';
  /** 출하 준비 후 라이더 도착까지 [시뮬] — Delivery 미구현이라 가상 라이더 */
  riderArrivalMinSec: number;
  riderArrivalMaxSec: number;
  /** SKU 수 (MFC 10,900 SKU [원본] 중 시뮬에 올리는 수) [시뮬] */
  skuCount: number;
  /** SKU당 초기 보유 [시뮬] */
  initialStockPerSku: number;
  /** 분할 기준: 총 상품중량 10,000g 초과 시 분할 [확정 정책] (overview §4) */
  splitOverWeightG: number;
  /** 인계 fence 유효시간 [시뮬] — 계약은 fenceExpiresAt 만 정의, 값은 미정 */
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
  pickSequence: 'DOC_B_A_C',
  riderArrivalMinSec: 90,
  riderArrivalMaxSec: 480,
  skuCount: 900,
  initialStockPerSku: 40,
  splitOverWeightG: 10_000,
  fenceTtlSec: 120,
  startHour: 9,
  seed: 20261031,
};

export const SPEEDS = [0, 1, 5, 15, 30, 60, 120] as const;
