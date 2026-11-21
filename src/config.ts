// 시뮬레이션 기본값과 그 근거.
// 근거 표기: [확정] = 업무 문서 확정 입력, [가정] = 업무 문서의 가정·산출값, [시뮬] = 이 시뮬레이터가 정한 값.
// 업무 문서: pmart-backend/docs/business/MFC-business-logic.md (이하 MFC), overview.md §4.

import type { TemperatureZone } from './domain/contract';

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
  /**
   * MOCK 상품(SKU) 수 — 온도대별. 백엔드 LAN 시험 상품과 같은 규모 [가정]
   * (백엔드 deploy/lan/seed/dimensions-estimated-2026-11-16.csv 503종: 상온 189·냉장 137·냉동 177. 이름·치수는 MOCK 이 지어냄).
   * 예전엔 칸의 85%(MFC 3-3 운영 상한)를 채웠다 — 칸 14,559 로 늘어 약 12,400종이 되어 실제와 너무 달라 바꿈(2026-11-17).
   */
  mockSkuCount: Record<TemperatureZone, number>;
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
  mockSkuCount: { AMBIENT: 189, CHILLED: 137, FROZEN: 177 },
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
 * 백엔드 시험 센터(MFC-SEED-01)가 정한 값 — 백엔드 공지가 근거다(pmart-backend docs/handoff/simulator/mfc/).
 * 실서버 모드에서는 위치 조회(GET /locations) 결과가 정본이고, 여기 값은 MOCK 화면 표시용 사본이다.
 */
export const BACKEND_FACTS = {
  /**
   * 칸 용량 = floor(칸 부피 × 이 값 ÷ 상품 부피), 어느 방향으로도 안 들어가면 0 [확정]
   * (백엔드 mfc-inventory 0.18.0 UnitSize.capacity·SkuSize.FILL_RATE = 0.8, 2026-11-16 6423db75). MOCK 칸 한도도 같은 식.
   */
  slotFillRate: 0.8,
  /** E2E 시험용 고회전 칸 5개 [확정] (2026-11-09-simulator-notice-layout-bins.md, docs/simulator/mfc/layout/high-turnover.json). 그 밖의 선반은 일반 선반(임시) */
  highTurnoverBins: ['H01-01-101', 'H01-01-102', 'H01-01-103', 'H01-01-104', 'H01-01-201'],
  /**
   * 회수 반입 자리 RTN-A-01. 백엔드 알림 좌표는 입고·검수 구역 x 38.6 · z 22.0 m [확정](2026-11-09-simulator-notice-return-location.md, backend-points.json).
   * 회수품은 입고 차량이 아니라 라이더가 들고 오므로 화면 자리만 인계 구역(외부 출하대기, 인계 랙 1·2 사이 앞) x 30.0 · z 34.3 으로 [시뮬]
   * (사용자 2026-11-21 "회수 반입은 … 라이더가 들고오니까 인계 구역에 있어야"; 그 전 11-20 x 44.0 · z 22.0). 서버 코드·좌표는 그대로 — 백엔드 요청 "시뮬레이터가 정한 값"
   */
  returnIntake: { code: 'RTN-A-01', x: 30.0, z: 34.3 },
  /**
   * 이동 카트(장바구니) 40대 `CRT-A-01~40` — **온도 구분 없음**(상온·냉장·냉동 상품을 한 카트에, 한 출고 = 한 카트), 구역 CART, 모두 카트 보관소 한 자리.
   * 코드의 A 는 위치 코드 규칙(ADR-0042)상 남긴 글자일 뿐. 옛 냉장·냉동 카트는 닫힘(CRT-C-01 만 재고가 있어 열림).
   * PDA 카트 스캔 값 = 위치 코드 [확정] (백엔드 deploy/lan/seed/mfc_carts.py·라벨 cart-labels-MFC-SEED-01.html 40장, 0cbfecaa 2026-11-17 사용자 "일단 상온으로").
   * 피킹 실적 도착지(toLocation) = 찍은 장바구니, 한 출고 = 한 장바구니(fulfillment 0.8.0, d5386b2f).
   */
  cartLocations: Array.from({ length: 40 }, (_, i) => ({ code: `CRT-A-${String(i + 1).padStart(2, '0')}`, label: `카트 ${i + 1}` })),
  /** 백엔드 인쇄용 위치 라벨 수(목차 합계) — 시뮬레이터 선반 14,559 + 그 밖 49 와 모두 맞음(11-17 대조) [확정] (deploy/lan/seed/labels/README.md·locations/index.html, ece5a2ad 2026-11-17) */
  labelLocationCount: 14608,
} as const;

export const SPEEDS = [0, 1, 5, 15, 30, 60, 120] as const;

/**
 * 실서버 연결(관찰) — 근거: pmart-backend docs/simulator/mfc/mfc-simulator-integration.md (SIM-1~11),
 * docs/operations/lan-test-accounts.md (2026-11-16).
 */
/** 실서버 가상 작업자(mfcw-pp-01~10) 동작 값 */
export const REAL_WORKERS = {
  /** 다음 작업 받기가 NO_TASK_AVAILABLE 이면 다시 묻는 간격(초) [시뮬] */
  noTaskRetrySec: 5,
  /** 거절·오류 뒤 다시 하기까지(초) [시뮬] */
  errorBackoffSec: 30,
  /** 배정이 작업(ASSIGNED)에 반영되기를 기다리는 최대 초 — 백엔드 E2E 도 30초 [시뮬] */
  assignWaitSec: 30,
  /** 다음 작업 받기에서 묻는 업무 순서 — 피패킹 먼저, 없으면 재고 이동(적치·보충·이동·취소품 복귀), 품질검사 [시뮬] */
  workAreas: ['PICK_PACK', 'STOCK_MOVE', 'INSPECTION'] as const,
  /**
   * 품질검사에 필요한데 LOT 정보에 없는 값 — 가상 작업자가 지어 넣는다(사용자 2026-11-20 "그냥 알아서 값 넣어") [시뮬].
   * 기준 없음 → minRemainingDays, 소비기한 = 오늘 + max(기준 + expiryMarginDays, expiryMinDays), 제조일 = 오늘 − manufactureDaysAgo
   */
  inspectAssume: { minRemainingDays: 7, expiryMarginDays: 30, expiryMinDays: 60, manufactureDaysAgo: 1 },
  /** 카트·출발 칸에서 싣거나 선반에 놓는 기본 시간(초, 스캔 포함) [시뮬] */
  shelveBaseSec: 6,
  /** 한 개 싣거나 놓는 데(초) [시뮬] */
  shelveSecPerUnit: 1.5,
  /** 품질검사 기본 시간(초, 라벨·기한 확인) [시뮬] */
  inspectBaseSec: 10,
  /** 품질검사 한 개당(초) [시뮬] */
  inspectSecPerUnit: 1,
  /** 입고 작업 실행이 CAPTURED·UNKNOWN_RESULT 로 오면 같은 키로 다시 보내는 최대 횟수와 간격(초) [시뮬] */
  unconfirmedResendMax: 5,
  unconfirmedResendSec: 3,
  /** 적치가 거절되면 다른 칸(서버 추천 → 이미 놓인 선반 → 위치 후보 순)으로 다시 보내는 최대 칸 수 [시뮬] */
  putawayTries: 3,
  /** 선반 가득으로 입고칸에 남긴 적치를 다시 시도하는 간격(초) — 그사이 피킹으로 선반에 자리가 날 수 있다 [시뮬] */
  overflowRetrySec: 300,
  /** 프레임이 늦게 오면(창 가려짐·뒤 탭) 가상 작업자·라이더가 한 번에 따라잡는 최대 초 — 넘는 시간은 버린다(오래 잠든 뒤 한꺼번에 몰리지 않게) [시뮬] */
  catchUpSec: 60,
  /** 화면이 안 그려질 때(뒤 탭은 프레임이 멈춤) 대신 진행시키는 간격(초) — 브라우저가 뒤 탭 타이머를 1초 이상으로 늦춘다 [시뮬] */
  backgroundTickSec: 1,
  /** RETURN 실적 뒤 서버 반영(pendingQty)을 기다리는 최대 초 [시뮬] */
  returnConfirmWaitSec: 30,
  /**
   * 속도 배수 최대 — 화면에서 고른 배수를 서버 속도 배율(speedFactor) 위에 곱한다(사용자 2026-11-18 "배수 넣어서 더 빠르게").
   * 가상 작업자의 걷기·손일, 실제 PDA 작업자 아바타의 걷기에만. 서버 응답 기다림·조회 주기는 그대로(실제 시각) [시뮬]
   */
  speedBoostMax: 10,
  /** 한 번에 켤 수 있는 최대 인원 = REAL_LINK.virtualAccounts 수(10) [확정 사용자 2026-11-16] */
};

/**
 * 앞마당 라이더 수단(그리기만 — 사용자 2026-11-18 "QR 찍고 나갈 때 운송수단으로", "수단에 따라 모델링"). 수단은 배차 배정의 vehicleType.
 * 입구 밖 먼 자리에서 수단을 타고 와 주차 자리에서 내리고, 걸어서 출하대기 랙 → 주차 자리에서 다시 타고 떠난다. 도보는 내내 걷는다 [시뮬]
 */
/**
 * 라이더 번호 인계 — QR 이 안 찍힐 때 포장 라벨 번호를 입력해 픽업(사용자 2026-11-20, 백엔드 요청 R-26).
 * 백엔드 회신(PC 3, PR #260 fulfillment 0.23.0 — 병합·LAN 배포 전): 새 포장 번호는 **4자리 고정**(사용자 결정 "앞으로 … 다 4자리로"),
 * 센터에서 쓰는(OPEN·SEALED) 포장끼리 겹치지 않음, 입력 pattern 4 또는 6자리(배포 전 포장 6자리), 5번 틀리면 HANDOVER_CODE_LOCKED [확정]
 */
export const HANDOVER_CODE = {
  minLen: 4,
  maxLen: 4,
  /** 자리 늘림 없음(min = max) — 남겨 둔 값 [확정: 4자리 고정] */
  maxFill: 1,
  /** 같은 라이더·배송이 번호를 이만큼 틀리면 잠금 — 맞는 번호도 거절, QR·점원 확인만, 푸는 API 없음 [확정] */
  failLimit: 5,
  /** 배포 전 포장의 옛 번호 자리(입력은 4 또는 6) [확정] */
  legacyLen: 6,
  /** MOCK 라이더가 QR 을 못 찍어 번호로 넘기는 비율 [시뮬] */
  qrFailRate: 0.2,
};

/** 실서버 그림 입고 차량(사용자 2026-11-20 "입고차량 부르기 했는데 입고차량이 안 오잖아") — 시험 입고가 서버에 들어가면 그림만 온다 */
export const REAL_TRUCK = {
  /** 입고 차량문에 서 있는 시간(초) — 서버 수령은 이미 끝났으므로 보여 주기만 [시뮬] */
  dockSec: 40,
};

/** 반납 인증번호(delivery-execution 0.28.0 — PC 5 요청 "시뮬에도 붙여"). 관리 탭 "반납 번호"는 보기만 */
export const RETURN_HANDOVER = {
  /** 틀리면 잠기는 횟수(계약 "5번 틀려 잠김") [확정] */
  failLimit: 5,
};

export const RIDER_VEHICLE = {
  /** 타고 움직이는 속도(m/s) — 앞마당 안이라 느리게 [시뮬] */
  rideSpeed: { MOTORCYCLE: 3, CAR: 2.5, E_BIKE: 2.6, BICYCLE: 2.2, KICKBOARD: 2.0, WALK: 1.4 } as Record<string, number>,
  /** 걷는 속도(m/s) [시뮬] */
  walkSpeed: 1.4,
  /** 입구에서 앞길을 따라 오른쪽으로 가 사라지는 거리(m) — 평면 폭 48 m 안(입구 x 30 → 47) [시뮬] */
  offLot: 17,
  /** 문·트렁크(배달통 뚜껑) 열고 닫는 데 쓰는 시간(초) — 그림 애니메이션과 같은 길이 [시뮬] */
  hatchSec: 0.7,
  /** 수단을 모를 때(옛 배정) [시뮬] */
  fallback: 'MOTORCYCLE' as const,
  /** MOCK 라이더 수단 비율(사용자 2026-11-20 "왜 오토바이 기사만 픽업하러 와?" → 섞기, 업무 문서에 비율 없음) [시뮬] */
  mockMix: { MOTORCYCLE: 0.6, CAR: 0.15, E_BIKE: 0.1, BICYCLE: 0.05, KICKBOARD: 0.05, WALK: 0.05 } as Record<string, number>,
};

export const REAL_LINK = {
  /** 실서버 읽기(작업 목록·상세·작업자 목록)에 쓰는 계정. 백엔드 문서의 "시뮬레이터 작업자" [확정] */
  observerAccount: 'claude-mfc-wrk',
  /** 관리 탭 쓰기(재배정·내놓기·인계 확인) 계정 — 그 센터 MFC_SUPERVISOR(lan-test-accounts.md). 사용자 허락 2026-11-20 [확정] */
  supervisorAccount: 'claude-mfc-sup',
  /** 관리 탭 지난 주문: 하루치 끝난 작업 목록 최대 쪽 수(쪽당 서버 기본) [시뮬] */
  historyMaxPages: 5,
  /** 가상 작업자 계정 — 앞에서부터 켠다(기본 0명, 화면에서 켬). 사용자 결정 2026-11-16 [확정] */
  virtualAccounts: Array.from({ length: 10 }, (_, i) => `mfcw-pp-${String(i + 1).padStart(2, '0')}`),
  /**
   * 입고 가상 작업자 — 시험 입고 "가상 작업자로" 때 켠다. 품질검사(INSPECT) mfcw-qc, 적치(PUTAWAY) mfcw-rcv
   * [확정 백엔드 docs/operations/lan-test-accounts.md — qc = INSPECT, rcv = RECEIVE·PUTAWAY] (피킹포장 mfcw-pp 는 입고 업무 권한이 없다)
   */
  inboundAccounts: [
    ...Array.from({ length: 10 }, (_, i) => `mfcw-qc-${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 10 }, (_, i) => `mfcw-rcv-${String(i + 1).padStart(2, '0')}`),
  ] as readonly string[],
  /**
   * 이 PC(PC 1)와 똑같이 쓰는 다른 기기 — 토큰을 받고 가상 작업자·입고·주문 넣기·관리 조치까지(사용자 2026-11-20 "가상 작업자랑 입고 그걸 PC5에서 뜨게 하라고").
   * PC 5 = 192.168.0.101(D603-13, 백엔드 docs/operations/2026-11-15-ssh-hostname-resolution.md) [확정]. 그 밖의 기기는 조회만
   */
  // 192.168.0.222(D603-15 — 백엔드 문서상 PC 3): 사용자가 "PC5에서 켜" 로 고른 크롬(이름 D603-15)이 이 주소 — 같은 권한(2026-11-20)
  lanViewers: ['192.168.0.101', '192.168.0.222'] as readonly string[],
  /** 상품 카테고리를 읽으려 SKU 를 조회할 때 한 회차 최대 개수와, 속도 제한(429)을 만나면 쉬는 초 [시뮬] — 몰아 보내면 게이트웨이 429(2026-11-21) */
  categorySkuBatch: 40,
  categoryBackoffSec: 60,
  /** 상품(SKU) 조회 동시 개수 — 바코드·카테고리가 같은 줄을 쓴다 [시뮬] */
  skuConcurrency: 2,
  /** 상품(SKU) 조회 사이 최소 간격(ms) — 동시 2개로도 초당 10건 넘게 나가 429(2026-11-21) → 초당 약 5건 [시뮬] */
  skuMinGapMs: 200,
  /** 입고 작업자 수 상한(입고·검수 대기 자리 8) · 처음 켤 때 기본(MOCK 과 같은 기준 3명 = 검사 2 + 적치 1, MFC 10장 가정) [시뮬] */
  inboundMax: 8,
  inboundDefault: 3,
  /** 작업 목록 주기 조회 간격(초). SIM-5 "시작 3초" [확정] */
  pollSec: 3,
  /** 작업자 목록(표시 이름) 다시 읽기 간격(초) [시뮬] */
  workerRefreshSec: 60,
  /** 토큰 만료 이만큼 전이면 새로 받는다(초). 직원 토큰 15분 [시뮬] */
  tokenRefreshMarginSec: 60,
  /** 실제 PDA 작업자가 열린 작업이 없어진 뒤(출하대기 랙까지 끝) 피킹 대기 자리에 서 있다가 화면에서 빠지기까지(초) [시뮬] */
  observedIdleKeepSec: 600,
  /** 실제 PDA 작업자의 열린 작업이 잠깐 안 보여도(피킹 끝 → 서버가 PACK 을 그 사람 것으로 보일 때까지 등) 이만큼(초)은 그 자리·그 상태로 둔다 [시뮬] */
  observedGraceSec: 15,
  /** 실제 PDA 작업자 아바타가 ⑤ 출하대기 랙에 도착하고 이만큼(초) 지나면 랙에 둔 것으로 넘긴다 — PDA 는 랙을 찍으면 다음 건으로 넘어가지만
   *  서버에 보내지 않아(BR-52 R20·R-20) 화면이 알 길이 없다. 랙은 "랙 N 찍음"을 안 눌렀으면 랙 1(추정) [시뮬] */
  rackAutoSec: 10,
  /** 가상 작업자 계정을 실제 PDA 가 쓰는 중으로 보는 기간 — 이 안에 그 운영자가 서버 작업에 담당·피킹한 사람으로 나왔으면 건너뛰고, 건너뛴 계정은 이 동안 다시 고르지 않는다(초) [시뮬] */
  pdaSkipSec: 900,
  /** 끝난(목록에서 빠진) 작업을 화면에 남겨 두는 시간(초) [시뮬] */
  recentKeepSec: 600,
  /** 주문에 나온 SKU 재고를 작업이 바뀌지 않아도 다시 읽는 간격(초) — PDA 밖 변화(이동·정정) 반영용 [시뮬] */
  stockRefreshSec: 30,
  /** 센터 전체 재고(stock-units, inventory 0.33.0 — R-15)를 다시 읽는 간격(초). 시험 센터 약 1,300줄·7쪽 0.2초(11-20 실측) [시뮬] */
  fullStockSec: 30,
  /** 전체 재고 한 번에 읽는 최대 쪽 수(쪽당 200줄) — 게이트웨이 부담 상한 [시뮬] */
  fullStockMaxPages: 60,
  /** 한 번 조회에서 재고를 새로 읽는 최대 SKU 수 — SKU 하나씩만 조회할 수 있어 상한을 둔다 [시뮬] */
  maxStockPerPoll: 10,
  /** 인계 전 출고의 출고·배차 상태를 작업이 안 바뀌어도 다시 읽는 간격(초) — 배차 중 반경·라이더 도착 반영 [시뮬] */
  shipmentRefreshSec: 3,
  /** 한 번 조회에서 출고·배차 상세를 새로 읽는 최대 건수(각각) [시뮬] */
  maxShipmentPerPoll: 5,
  /** 회수 배송(고객 반품·오배송 회수 → MFC, delivery-dispatch 0.5.0 type RETURN)을 찾는 간격(초) — 열린 출고가 없어도 [시뮬] */
  returnPickupRefreshSec: 15,
  /** MFC 에 반납된(RETURNED_TO_STORE) 회수 배송을 회수 반입 자리에 두는 시간(분) — 점원 수령 확인 API 가 없어 [시뮬] */
  returnShownMin: 60,
  /** 작업이 끝난 뒤에도 인계 전(출하 대기·픽업 전) 출고를 화면에 두는 최대 시간(초) — 배차 시도 10분 × 재시도 2회 넉넉히 [시뮬] */
  handoverKeepSec: 3 * 3600,
  /** 화면을 연(새로고침한) 첫 조회 때 이만큼(초) 안에 만든 끝난 작업 중 출고가 인계 전인 것을 한 번 불러 둔다 — 새로고침해도 출하 대기 주문이 안 빠지게 [시뮬] */
  backfillSec: 24 * 3600,
  /** 열린 작업 상태 — 이 상태들만 주기 조회한다(완료 이력은 첫 조회 한 번만 — backfillSec) [시뮬] */
  openStates: ['WAITING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED'] as const,
};

/** 실제 주문 넣기(R-21 — auth 0.3.0 개발용 고객 토큰·payment 0.2.0 시험 결제, 백엔드 알림 2026-11-19). 이 PC(루프백)에서만 */
export const REAL_ORDER = {
  /** 고를 수 있는 고객 — 백엔드 허용 목록에 있는 기존 계정만(목록 밖 403). 백엔드 알림 2026-11-19·6bf69d04 [확정] */
  customers: [
    {
      key: 'pc1',
      label: 'PC 1 지정 고객(사용자 Google 계정)',
      accountId: 'CU-eae131fa-886a-4733-9eee-86a158be281a',
      warn: '실제 계정 — 고객 앱 주문 내역에 보이고 배송 알림이 휴대폰으로 갑니다(결제만 시험).',
    },
    // 시험 고객 CU-fdccbd6b… 는 R-22 보류(실제 Google 계정·동의 전) — 허용 목록에 들어가면 다시 넣는다(사용자 2026-11-20 "테스트 계정 없지 않나")
  ],
  /** 한 번에 넣는 최대 건수 [시뮬] */
  maxCount: 5,
  /** 장바구니에 담을 최대 품목 수 [시뮬] */
  maxItems: 10,
  /** 고를 상품 단가 범위(원) — 한 개로 최소 주문을 다 채우지 않게 [시뮬] */
  priceMin: 1000,
  priceMax: 12000,
  /** 예약 시간대: 마감까지 이만큼(분) 넘게 남은 것만 [시뮬] — 요청서 R-21 */
  slotCutoffMarginMin: 5,
  /** 랜덤에서 예약이 뽑히면 가장 빠른 이 수 중 하나 [시뮬] — 요청서 R-21 */
  randomSlotPool: 3,
  /** 결제 진입 뒤 결제창 정보(PAY)를 기다리는 최대 시간(초)·간격 [시뮬] */
  checkoutWaitSec: 30,
  /** 승인 뒤 주문번호를 기다리는 최대 시간(초) [시뮬] */
  orderNumberWaitSec: 15,
  pollMs: 1000,
  /** 게이트웨이 응답 없음 때 같은 Idempotency-Key 로 다시 보내는 횟수·간격(사용자 2026-11-20 두 건째 응답 없음) [시뮬] */
  noResponseRetries: 2,
  noResponseRetryMs: 1500,
};

/** 시험 입고(MI-3·R-23 — mfc-inbound 0.14.0 POST /dev-initial-stock-loads, LAN 설정 켠 곳만). 재고만 채우는 시험 입구 */
export const TEST_INBOUND = {
  /** 한 번에 넣는 SKU 줄 수(계약 1~40) [시뮬] */
  lines: 8,
  /** 판매 가능 수량을 이만큼까지 채운다 [시뮬] */
  targetQty: 20,
  /** 줄마다 최소·최대 수량(계약 SKU 당 1~500) [시뮬] */
  minQty: 5,
  maxQty: 40,
  /** 재고를 읽어 볼 후보 SKU 수 — 품절(TEMPORARILY_SOLD_OUT) 먼저, 그다음 무작위 [시뮬] */
  readMax: 30,
  /** 수령 위치(입고·검수 구역, mfc-location) — locationCodes SIM_POINT.receiving [확정] */
  receivingLocation: 'RCV-A-01',
  /**
   * 온도대별 수령 위치 — 저온 상품은 그 저온구역 입고칸(입고재고 자리)에서 받는다 [확정](PC 3 R-31 회신 2026-11-21, (가) 수령 위치를 요청으로 —
   * 초기 보유 수령은 수령 하나에 칸 하나라 온도대마다 입고 예정을 따로). 저온 칸이 아직 없으면(PC 1 LAN 등록 전) 상온 칸으로 받는다
   */
  receivingByTemp: { AMBIENT: 'RCV-A-01', CHILLED: 'RCV-C-01', FROZEN: 'RCV-F-01' } as const,
};

/** "확인할 일" 띠(pmart-rider-simulation IssueBar 참고) 기준 — 업무 문서에 없는 화면 알림 기준 [시뮬] */
export const ISSUES = {
  /** 피킹한 사람이 이만큼(분) 넘게 그 주문 패킹을 안 받음(PACK READY·담당 없음) [시뮬] */
  packWaitMin: 5,
  /** PICK 이 이만큼(분) 넘게 배정 전(READY) [시뮬] */
  pickWaitMin: 10,
  /** 한 번에 보이는 카드 수 — 넘으면 "n건 더" [시뮬] */
  shown: 4,
};
