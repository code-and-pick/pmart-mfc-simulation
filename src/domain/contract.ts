// pmart-backend/contracts/openapi/mfc-fulfillment-service.yaml (0.11.0) 의 부분 사본 + _common.yaml 공통 형
// + mfc-capacity-service.yaml (0.14.0) 의 작업자 목록 형 일부
// + delivery-dispatch-service.yaml (0.3.3)·delivery-execution-service.yaml (0.4.0) 의 조회 형 일부(실서버 관찰, rider 시뮬레이터 요청 M-01·M-02).
// 이 파일의 이름·상태값은 계약을 그대로 따른다. 계약이 바뀌면 여기를 먼저 맞춘다.
// 시뮬레이터가 쓰지 않는 경로(중지·재포장·인계 판정 등)의 형은 옮기지 않았다.
// 0.4.11(2026-11-13): 배차 자동 요청 없음 — 점원 요청(MANUAL)만. 형 변화 없음(AUTO_ON_READY 는 예전 기록 때문에 남음).
// 0.5.0·0.6.0(2026-11-16): 재발송 작업 지시(ConfirmOrder kind)·예약 시간 변경 — 내부 경로라 옮긴 형 변화 없음.
// 0.7.0(2026-11-16): 작업 상세 TaskLine.barcodes(활성 바코드 전부), barcode 는 그 첫 값(조회 때 채움, R-20 해소).
// 0.8.0(2026-11-17, d5386b2f): 피킹 도착지 = 장바구니(구역 CART) — 집은 양이 있으면 toLocation 필수(400 TO_LOCATION_REQUIRED),
//   한 출고 = 한 장바구니(409 CART_MISMATCH), 장바구니로 집품했으면 밀봉 packingLocation(패킹대) 필수. 형 변화 없음(설명만).
// 0.9.0·0.10.0(2026-11-17): 백오피스 목록·주문별 현장 조회 — 시뮬레이터가 쓰지 않는 경로라 옮긴 형 없음.
// 0.11.0(2026-11-17, 45ad5671): PICK 상세 picks[].lotNo — LOT 라벨 GS1-128 (10) 과 대조(inventory 0.21.0).

export type TaskState =
  | 'WAITING'
  | 'READY'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED'
  | 'CLOSED_PARTIAL';

/** RETURN(0.3.0) = 집품 뒤 취소의 복귀 작업(포장 위치 → 선반) */
export type TaskType = 'PICK' | 'PACK' | 'DISPATCH' | 'RETURN';
export type ShipmentState =
  | 'PREPARING'
  | 'READY'
  | 'PARTIALLY_HANDED_OVER'
  | 'HANDED_OVER'
  | 'CANCELLED'
  | 'CLOSED_PARTIAL';
export type PackageState = 'OPEN' | 'SEALED' | 'HANDED_OVER' | 'INVALIDATED' | 'VOIDED';
export type FenceState = 'NONE' | 'HANDOVER_IN_PROGRESS' | 'COMMITTED' | 'EXPIRED';
export type TemperatureZone = 'AMBIENT' | 'CHILLED' | 'FROZEN';

/** hr-service EmployeeLabel(0.8.0) — 운영자 ID → 이름·사번(화면 표시용, 모든 직원) */
export interface EmployeeLabel {
  operatorId: string;
  name: string;
  /** 사번(P2026-00012) */
  employeeNo: string;
}

/** rider-service VehicleType — 라이더 배달 수단 */
export type VehicleType = 'MOTORCYCLE' | 'BICYCLE' | 'E_BIKE' | 'KICKBOARD' | 'CAR' | 'WALK';
export const VEHICLE_TYPES: readonly VehicleType[] = ['MOTORCYCLE', 'BICYCLE', 'E_BIKE', 'KICKBOARD', 'CAR', 'WALK'];
export type ShortageReason = 'SHORT' | 'DAMAGED' | 'BLOCKED';
export type CommandStatus = 'ACCEPTED' | 'APPLIED' | 'REJECTED' | 'UNKNOWN_RESULT';

/** _common.yaml AsOf — 조회 사본의 기준시각·신선도. 조회 결과로 성공을 확정하지 않는다. */
export interface AsOf {
  asOf?: string;
  sourceVersion?: number;
  freshness?: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
}

/** mfc-capacity 배정 정본의 투영 */
export interface TaskAssignment {
  workerId: string | null;
  assignmentVersion: number;
  asOf?: AsOf;
}

export interface TaskSummary {
  taskId: string;
  taskType: TaskType;
  state: TaskState;
  version: number;
  mfcId: string;
  fulfillmentId: string;
  shipmentId: string | null;
  assignment: TaskAssignment;
  lineCount: number;
  plannedQty: number;
  completedQty: number;
  remainingQty: number;
  promisedReadyAt: string | null;
  /** (0.12.0) COMPLETED·CLOSED_PARTIAL 이 된 시각 */
  completedAt?: string | null;
  createdAt: string;
  /** (0.4.8) 시작 뒤 예상 시간의 2배를 넘김 — 표시만 */
  late?: boolean;
  /** (0.4.8) 진행 중인데 30분 동안 실적 없음 — 알림만 */
  idle?: boolean;
  /** (0.4.8) 시작 또는 마지막 실적 시각 */
  lastActivityAt?: string | null;
  /** (0.4.9) 목록 표시용 "상품명 외 N건" */
  headline?: { productName: string | null; otherLineCount: number };
  /** (fulfillment 0.13.0, F-5) 화면용 주문번호(숫자 8자리). 번호 전 주문은 null */
  orderNumber?: string | null;
  /** (0.18.0) PACK 만 — 같은 출고 PICK 을 끝낸 담당. 다음 작업 받기가 이 사람에게만 이 PACK 을 준다(capacity 0.19.0) */
  pickedBy?: string | null;
}

/** mfc-inventory WorkState (0.16.0) — 단위 행의 업무 상태 */
export type StockWorkState = 'UNSTOWED' | 'STORED' | 'PICKED' | 'PACKED' | 'CANCEL_RETURN_PENDING';
export type StockQualityState = 'PENDING_INSPECTION' | 'NORMAL' | 'QUARANTINED' | 'DISPOSAL_PENDING';

/** mfc-inventory CenterStock (GET /mfcs/{mfcId}/stock?sku=) — SKU 하나의 LOT 요약과 위치·상태별 단위 행 */
export interface CenterStock {
  mfcId: string;
  sku: string;
  lots: { lotId: string; onHand: number; quarantined: number; sellable: number; reserved: number; available: number; expiryDate?: string | null }[];
  units: { locationCode: string; lotId: string; qualityState: StockQualityState; workState: StockWorkState; qty: number }[];
}

/** mfc-capacity Worker (GET /mfcs/{mfcId}/workers) — 시뮬레이터는 표시 이름만 쓴다. */
export interface CapacityWorker {
  mfcId: string;
  /** 로그인 계정(운영자 ID, OP-…) */
  workerId: string;
  displayName: string;
  state: 'ACTIVE' | 'SUSPENDED' | 'LEFT';
  /** capacity TaskType(RECEIVE·INSPECT·PUTAWAY·REPLENISH·MOVE 포함) — fulfillment TaskType 보다 넓다 */
  effectiveTaskTypes?: string[];
  onBreak?: boolean;
  /** (capacity 0.11.0) 속도 배율 — 배정 추천의 작업 시간 = 추정 분 ÷ 배율(1.0 보통, 센터 관리자가 정함, 0.5~2.0) */
  speedFactor?: number;
}

export type PickStatus = 'OK' | 'PARTIAL' | 'NOT_FOUND' | 'DONE';

/** PICK 지시(0.2.0) — 한 줄이 여러 LOT 예약 조각으로 나뉠 수 있다. RETURN 은 복귀량·포장 위치. */
export interface TaskPick {
  lotId: string;
  /** (fulfillment 0.11.0, PICK 만) LOT 번호 = LOT 라벨 GS1-128 의 (10). 재고 조회가 안 되면 null. MOCK·0.10 이하는 없음 */
  lotNo?: string | null;
  expiresOn: string | null;
  /** 이 LOT 조각에서 더 집을 양 */
  remainingQty: number;
  locations: {
    locationCode: string;
    /** 그 위치의 LOT 선반 잔량(이 주문 몫만이 아님) */
    qty: number;
    /** (0.4.3) 그 위치에서 이 주문 몫으로 배정된 남은 양 — 배정된 위치가 앞에 온다 */
    allocatedQty?: number;
  }[];
  /** (0.4.10, PICK 만) 방문 순서(1부터). 줄·조각은 이 순서로 온다 */
  visitSeq?: number | null;
  /** (0.4.6, RETURN 만) 돌려놓을 추천 선반 */
  suggestedToLocations?: string[];
  /** (0.4.9, PICK 만) 칸을 못 정한 양 */
  unallocatedQty?: number | null;
  /** (0.4.9, PICK 만) 화면 표시용 */
  pickStatus?: PickStatus | null;
  /** (0.4.9) 화면에 그대로 보일 짧은 안내 */
  notice?: string | null;
}

export interface TaskLine {
  taskLineId: string;
  orderLineId: string;
  sku: string;
  productName?: string;
  /** 필수 스캔 대조값 — barcodes 의 첫 값(0.7.0 부터 채움). 모르면 null */
  barcode: string | null;
  /** (0.7.0) 그 SKU 의 활성 바코드 전부(선행 0 보존). 스캔 값이 이 중 하나면 같은 상품. 모르면 빈 배열. MOCK·0.6 이하는 없음 */
  barcodes?: string[];
  /** 지시 로케이션(첫 지시의 사본). PACK·DISPATCH 는 null 일 수 있음 */
  locationId: string | null;
  lotId: string | null;
  expiresOn: string | null;
  /** 재고 조회가 안 되면 빈 배열(asOf freshness STALE). MOCK 은 LOT 이 없어 채우지 않는다 */
  picks?: TaskPick[];
  plannedQty: number;
  completedQty: number;
  cancelledQty: number;
  remainingQty: number;
  pendingQty: number;
}

export type RouteMethod = 'ROUTING' | 'NEAREST_FALLBACK' | 'CODE_ORDER';

export interface TaskDetail extends TaskSummary {
  lines: TaskLine[];
  /** 성공한 시작 점유. IN_PROGRESS 일 때만 */
  activeStart?: { requestId: string; workerId: string; deviceId: string | null; startedAt: string };
  /** 재고 확정 전 실행 결과 */
  pendingExecutions?: { executionId: string; state: 'RECORDED' | 'INVENTORY_PENDING' | 'UNKNOWN_RESULT'; recordedAt: string }[];
  blockReason: string | null;
  /** PACK — 이 출고의 집품분이 놓인 위치(PICK 실적의 도착지 — 장바구니 CRT- 또는 포장 위치, 0.8.0) */
  packingLocations?: string[];
  /** (0.4.10, PICK 만) 방문 순서를 정한 방법. 피킹 시작 때 정한다 */
  routeMethod?: RouteMethod | null;
  asOf?: AsOf;
}

/** GET /tasks/{id}/starts/{requestId} */
export interface TaskStart {
  requestId: string;
  taskId: string;
  outcome: 'STARTED' | 'REJECTED';
  rejectCode: 'ALREADY_STARTED' | 'NOT_ASSIGNEE' | 'PREDECESSOR_NOT_COMPLETED' | 'INVALID_STATE' | 'VERSION_CONFLICT' | null;
  workerId: string;
  assignmentVersion: number;
  taskVersion: number;
  decidedAt: string;
}

export interface PackageContentLine {
  orderLineId: string;
  sku: string;
  qty: number;
  lotId?: string;
}

/** 출고 행(2026-11-07 — PackageContentLine 에 단말 표시용 사본을 더함) */
export interface ConfirmOrderLine extends PackageContentLine {
  productName?: string;
  unitsPerSku?: number;
  /** 행 전체 중량 */
  weightG?: number;
}

export interface ConfirmOrderRequest {
  orderId: string;
  orderVersion?: number;
  /** 작업 버전(2026-11-07). 첫 요청 1, 같은 MFC 재시도마다 1씩 증가 */
  workVersion?: number;
  sagaId?: string;
  mfcId: string;
  reservationId: string;
  capacityHoldId?: string;
  deliveryMode?: 'SINGLE' | 'BUNDLED' | 'SCHEDULED';
  outOfStockPreference?: string;
  arrivalWindow?: { start: string; end: string };
  promisedReadyAt?: string;
  shipments: { shipmentId: string; deliveryId?: string; weightG?: number; lines: ConfirmOrderLine[] }[];
}

/** retryable(같은 MFC 재시도 대상) = INVENTORY_MISMATCH·OPERATION_RESTRICTED */
export type WorkRejectReason = 'INVENTORY_MISMATCH' | 'OPERATION_RESTRICTED' | 'CAPACITY_EXCEEDED' | 'LOT_INELIGIBLE' | 'ALREADY_STOPPED';

/** ConfirmOrder 결정(2026-11-07). 업무 거절도 201 + REJECTED 로 온다 */
export interface WorkOrderDecision {
  fulfillmentId?: string;
  orderId: string;
  workVersion: number;
  decision: 'ACCEPTED' | 'REJECTED';
  rejectReason?: WorkRejectReason;
  retryable?: boolean;
  message?: string;
  shipmentIds?: string[];
  taskIds?: string[];
  decidedAt: string;
}

export interface TaskExecutionRequest {
  /** PICK·RETURN 만 받는다. PACK 실적은 포장 밀봉(POST /shipments/{id}/packages) — PACK 은 422 UNSUPPORTED_EXECUTION */
  executionType: 'PICK' | 'PACK' | 'RETURN';
  workerId: string;
  assignmentVersion?: number;
  /** PICK — 집은 선반(한 실행 = 한 선반). RETURN — 복귀 대상이 놓인 위치(장바구니·패킹대) */
  fromLocation?: string;
  /** PICK — 담은 장바구니(구역 CART, 0.8.0) 또는 포장 위치(PACKING, 예전 흐름). 집은 양이 있으면 필수. RETURN — 되돌린 선반 */
  toLocation?: string;
  /** 결품 보고는 집품과 섞지 않은 한 줄(pickedQty 0 + shortage, lotId·fromLocation 필수) — 서버 규칙(ADR-0044) */
  lines: {
    orderLineId: string;
    sku: string;
    lotId?: string;
    pickedQty: number;
    /** RETURN 만 */
    resultQuality?: 'NORMAL' | 'QUARANTINED';
    shortage?: { qty: number; reason: ShortageReason; note?: string; evidenceRef?: string };
  }[];
  durationSec?: number;
}

export interface TaskExecution {
  executionId: string;
  taskId: string;
  state: 'RECORDED' | 'INVENTORY_PENDING' | 'APPLIED' | 'REJECTED' | 'UNKNOWN_RESULT';
  inventoryCommitId: string | null;
  appliedQty: number;
  shortages: { orderLineId: string; qty: number; reason: ShortageReason }[];
  recordedAt: string;
  /** (0.16.0) REJECTED 일 때 재고 거절 코드 그대로(LOT_MISMATCH·PICK_QTY_EXCEEDED·INSUFFICIENT_STOCK 등, 모르는 코드도 그대로), 아니면 null */
  rejectCode?: string | null;
  /** (0.16.0) REJECTED 일 때 짧은 설명 — 화면에 그대로 */
  rejectReason?: string | null;
}

export interface SealPackageRequest {
  /** 포장 위치(패킹대). 장바구니로 집품했으면 필수(0.8.0 — 장바구니 → 패킹대로 옮기며 PACKED). 없으면 집품분 위치가 하나일 때 그 위치(0.2.0) */
  packingLocation?: string;
  contents: PackageContentLine[];
  bagCount: number;
  containsAlcohol?: boolean;
  temperatureZone?: TemperatureZone;
  weightG?: number;
  volumeCm3?: number;
  packedBy?: string;
}

export interface PackageFence {
  state: FenceState;
  handoverAuthorizationId: string | null;
  fenceVersion: number;
  riderId: string | null;
  expiresAt: string | null;
}

export interface Package {
  packageId: string;
  packageVersion: number;
  shipmentId: string;
  orderId: string;
  version: number;
  state: PackageState;
  qrCode: string;
  /** (0.13.0, F-5) 화면용 주문번호(숫자 8자리) — 라벨에 크게. 번호 전 주문은 null */
  orderNumber?: string | null;
  /** (0.13.0, F-8) 라벨 숫자 6자리 — QR 이 안 찍힐 때 라이더가 입력 */
  handoverCode?: string | null;
  /** (0.20.0, F-12) 밀봉한 패킹대 */
  packingLocation?: string | null;
  /** (0.20.0, F-12) 올려 둔 출하대기 랙(DSP-…) — null 이면 아직 패킹대 */
  stagingLocation?: string | null;
  contents: PackageContentLine[];
  bagCount: number;
  containsAlcohol: boolean;
  /** 계약은 string. 시뮬레이터는 세 온도대만 만든다 */
  temperatureZone: TemperatureZone;
  weightG: number;
  fence: PackageFence;
  sealedAt: string | null;
  handedOverAt: string | null;
  invalidatedReason: string | null;
}

/** 0.4.5 배차 요청 */
export interface DispatchRequest {
  shipmentId: string;
  trigger: 'MANUAL' | 'AUTO_ON_READY';
  estimatedPackMinutes?: number | null;
  estimatedReadyAt: string;
  requestedAt: string;
  requestedBy?: string | null;
}

export interface Shipment {
  shipmentId: string;
  fulfillmentId: string;
  orderId: string;
  /** (0.13.0, F-5) 화면용 주문번호(숫자 8자리). 번호 전 주문은 null */
  orderNumber?: string | null;
  deliveryId: string | null;
  version: number;
  state: ShipmentState;
  holdReason: string | null;
  packages: Package[];
  packingDurationSec?: number;
  bagCount: number;
  containsAlcohol?: boolean;
  weightG: number;
  volumeCm3?: number;
  readyAt: string | null;
  dispatchRequest?: DispatchRequest | null;
  /** 점원 화면용 ETA 투영 (delivery 사본) */
  riderEta?: { eta: string; asOf?: AsOf };
}

export interface HandoverAuthorization {
  handoverAuthorizationId: string;
  packageId: string;
  packageVersion: number;
  fenceVersion: number;
  riderId: string;
  deliveryId: string;
  fenceExpiresAt: string;
  authorizedAt: string;
}

export interface HandoverCommitResult {
  status: CommandStatus;
  requestId?: string;
  handoverId: string;
  inventoryCommitId: string | null;
  packageState: PackageState;
  shipmentState: ShipmentState;
  handedOverAt: string;
  nextAction?: string;
  /** 0.4.1 — REJECTED 사유(코드: 상세) */
  rejectReason?: string | null;
}

/** _common.yaml CommandResponse */
export interface CommandResponse {
  status: CommandStatus;
  requestId: string;
  /** 소유 서비스가 발급한 결과 식별자 (commitId / executionId 등) */
  resultId?: string;
  appliedQty?: number;
  version?: number;
  retryable?: boolean;
  nextAction?: string;
}

/** _common.yaml ErrorResponse(Problem) 의 부분. */
export interface Problem {
  status: number;
  code: string;
  detail?: string;
  retryable?: boolean;
  /** 칸별 사유(예 HANDOVER_CODE_MISMATCH 의 {field: 'attemptsLeft', reason: '남은 횟수'} — fulfillment 0.23.0) */
  details?: { field: string; reason: string }[];
}

/** 서버가 Problem 으로 거절했을 때. 타임아웃·연결 끊김은 이 오류가 아니다(결과 불명). */
export class ApiProblem extends Error {
  constructor(readonly problem: Problem) {
    super(`${problem.status} ${problem.code}${problem.detail ? ` — ${problem.detail}` : ''}`);
  }
}

/** 응답을 받지 못함 — 실패로 단정하지 않는다(같은 키 재전송 또는 원결과 조회로 해소). */
export class ResultUnknown extends Error {}

// ── mfc-capacity 다음 작업 받기 (0.14.0) — 가상 작업자(mfcw-pp-01~10) 본인 토큰으로 부른다 ──

/** PDA 에서 고르는 업무. 가상 작업자는 PICK_PACK(PICK·PACK) → STOCK_MOVE(PUTAWAY·REPLENISH·MOVE·RETURN) → INSPECTION(INSPECT) 순으로 묻는다 */
export type WorkArea = 'INBOUND' | 'INSPECTION' | 'STOCK_MOVE' | 'STOCK_COUNT' | 'PICK_PACK';

/** capacity Assignment 일부 — POST /mfcs/{mfcId}/workers/{workerId}/next-tasks 응답(200 들고 있던 작업, 201 새 배정) */
export interface CapacityAssignment {
  assignmentId: string;
  mfcId: string;
  taskId: string;
  taskType: string;
  workerId: string;
  assignmentVersion: number;
  state: 'ACTIVE' | 'SUPERSEDED' | 'RELEASED';
  source?: 'MANUAL' | 'PLAN' | 'SYSTEM' | null;
  warnings?: string[];
  /** (capacity 0.9.1) 다음 작업 받기 응답에만 — 받은 작업의 상세(NextTaskDetail, 아래). 다른 응답은 null */
  detail?: NextTaskDetail | null;
}

/** product-service SkuDetail 일부 (GET /skus/{sku}) — 바코드만 쓴다(스캔 판) */
export interface SkuBarcodes {
  sku: string;
  barcodes?: string[];
}

// ── 주문 번호로 현장 상태(fulfillment 0.10.0 GET /work-orders?orderId= — 백오피스 통합 조회 MFC 칸, 개인정보 없음) ──

export interface OrderFulfillmentView {
  orderId: string;
  workOrders: {
    fulfillmentId: string;
    kind: 'ORIGINAL' | 'RESHIPMENT';
    mfcId: string;
    workVersion: number;
    acceptance: 'ACCEPTED' | 'REJECTED';
    rejectReason?: string | null;
    decidedAt?: string | null;
    /** 첫 PICK 시작(준비 시작) */
    preparationStartedAt?: string | null;
    createdAt: string;
    shipments: {
      shipmentId: string;
      state: Shipment['state'];
      readyAt?: string | null;
      dispatchRequestedAt?: string | null;
      tasks: {
        taskId: string;
        taskType: 'PICK' | 'PACK' | 'RETURN' | 'DISPATCH';
        state: TaskState;
        workerId?: string | null;
        startedBy?: string | null;
        startedAt?: string | null;
        endedAt?: string | null;
        blockReason?: string | null;
        plannedQty: number;
        completedQty: number;
        cancelledQty: number;
        remainingQty: number;
      }[];
      shortages: { taskId: string; orderLineId: string; sku: string; qty: number; reason?: string | null; reportedAt: string; executionState: string }[];
      packages: { packageId: string; state: string; sealedAt?: string | null; fenceState: string; handoverAuthorizedAt?: string | null; handoverStatus?: string | null }[];
    }[];
  }[];
  stopRequests: unknown[];
}

// ── 배송(읽기만) — 라이더 API 는 rider 시뮬레이터만 부른다(backend-requests.md "rider 시뮬레이터 요청") ──

/** delivery-dispatch DispatchState — 배차 관점. 수행 상태(ExecutionState)와 다른 서비스의 다른 값이라 합치지 않는다 */
export type DispatchState = 'CREATED' | 'DISPATCHING' | 'ASSIGNED' | 'PICKED_UP' | 'CANCELLED_BEFORE_PICKUP' | 'DISPATCH_FAILED' | 'CLOSED' | 'BLOCKED';

/** delivery-execution ExecutionState — 배송 수행 관점 */
export type ExecutionState =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'ARRIVED_AT_STORE'
  | 'PICKED_UP'
  | 'ARRIVED_AT_CUSTOMER'
  | 'FAILURE_REPORTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'SUSPENDED'
  | 'RETURN_IN_PROGRESS'
  | 'RETURN_PICKED_UP'
  | 'RETURNED_TO_STORE'
  | 'CANCELLED';

/** delivery-execution StaffDeliverySummary (GET /deliveries?mfcId= — 센터 직원은 mfcId 필수). 개인정보 없음 */
export interface StaffDeliverySummary {
  deliveryId: string;
  version: number;
  type: 'FORWARD' | 'RETURN' | 'RESHIPMENT';
  orderId: string | null;
  /** (execution, 2026-11-18) 화면용 주문번호 8자리 — 배정 사건이 실어 준 값(배정 전 null) */
  orderNumber?: string | null;
  /** (execution 0.26.0, ADR-0070) 화면 배송 번호 = 주문번호-순번(예 74939255-1). 모르면 null */
  deliveryNumber?: string | null;
  mfcId: string | null;
  riderId: string | null;
  state: ExecutionState;
  assignedAt: string | null;
  pickedUpAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** delivery-execution ReturnHandover(0.28.0) — MFC 반납 기다리는 회수·반납 배송과 반납 인증번호(센터 직원 화면) */
export interface ReturnHandover {
  deliveryId: string;
  deliveryNumber?: string | null;
  /** CLAIM_RETURN · MISDELIVERY_RECOVERY · FAILED_DELIVERY_RETURN */
  purpose?: string | null;
  state: string;
  riderId?: string | null;
  /** 반납 인증번호 4자리 — 라이더에게 불러 주거나 보여 준다 */
  code: string;
  failedAttempts: number;
  /** 5번 틀려 잠김 — 새로 내기로 풀린다 */
  locked: boolean;
  issuedAt: string;
}

/** delivery-dispatch DispatchAttempt 일부 */
export interface DispatchAttempt {
  attemptId: string;
  trigger?: 'AUTO' | 'STORE_STAFF' | 'REASSIGN' | 'RETRY';
  state: 'SEARCHING' | 'OFFERING' | 'ASSIGNED' | 'FAILED' | 'CANCELLED';
  currentRadiusKm?: number;
  retryCount?: number;
  startedAt?: string;
  deadlineAt?: string;
  failureReason?: 'NO_RIDER' | 'REPEATED_REJECTION' | 'EXPIRED' | 'SYSTEM_FAILURE';
}

/** delivery-dispatch Delivery (GET /deliveries/{deliveryId}/dispatch) 일부 */
export interface DeliveryDispatch {
  deliveryId: string;
  version: number;
  /** (delivery-dispatch 0.13.1, R-27 PR #263) 배송지 동 단위(예 "서초구 서초동") — 회수면 회수지, 모르면 null. 배포 전엔 칸 없음 */
  dropAreaLabel?: string | null;
  orderId?: string;
  shipmentId?: string;
  mfcId?: string;
  state: DispatchState;
  /** vehicleType = 배정 때 라이더 수단(dispatch Assignment, rider VehicleType) */
  assignment?: { riderId: string; vehicleType?: string | null; state: 'ASSIGNED' | 'PICKED_UP' | 'CANCELLED' | 'COMPLETED'; assignedAt?: string; pickedUpAt?: string } | null;
  attempts?: DispatchAttempt[];
  updatedAt?: string;
}

// ── 재고 이동·품질검사 업무(가상 작업자 STOCK_MOVE·INSPECTION) — capacity 0.14.0 NextTaskDetail, mfc-inbound 0.9.0, mfc-location 적치 후보 ──

/** capacity NextTaskDetail (0.9.1) — 다음 작업 받기 응답의 받은 작업 상세. 정본은 각 서비스 상세 */
export interface NextTaskDetail {
  /** 상세를 읽었나(false 면 나머지는 비어 있음) */
  available: boolean;
  promisedReadyAt?: string | null;
  urgent?: boolean;
  packingLocations?: string[];
  lines?: {
    sku: string;
    productName?: string | null;
    lotId?: string | null;
    expiresOn?: string | null;
    /** 남은 양 */
    qty: number;
    /** 집을 칸(PICK 배정 칸·RETURN 포장 위치·이동 출발 칸) */
    fromLocation?: string | null;
    /** 놓을 칸(RETURN 추천 칸·이동 도착 칸) */
    toLocation?: string | null;
    notice?: string | null;
  }[];
}

/** mfc-inbound InboundTask (0.9.0) — 품질검사(INSPECT)·적치(PUTAWAY). 담당(assigneeId)이 있으면 담당만 실행(409 NOT_ASSIGNEE) */
/** mfc-inventory listStockUnits 한 줄(GET /mfcs/{mfcId}/stock-units, 0.26.0·0.33.0 R-15) — 수량 > 0 인 위치·SKU·LOT 단위 */
export interface StockUnitRow {
  locationCode: string;
  sku: string;
  productName?: string | null;
  lotId: string;
  lotNo?: string | null;
  expiryDate?: string | null;
  qualityState: StockQualityState;
  workState: StockWorkState;
  qty: number;
  zone?: string | null;
  temperatureZone?: string | null;
}

/** mfc-fulfillment CenterShipment(0.15.0 F-9, GET /shipments?mfcId=) 중 시뮬레이터가 쓰는 것 — 피킹·패킹 시작 시각, 출하 대기 시각 */
export interface CenterShipment {
  shipmentId: string;
  orderId: string;
  orderNumber?: string | null;
  state: string;
  createdAt: string;
  readyAt?: string | null;
  dispatchRequestedAt?: string | null;
  pick?: { state: TaskState; startedAt?: string | null } | null;
  pack?: { state: TaskState; startedAt?: string | null } | null;
}

/** delivery-execution 배송 상세(GET /deliveries/{id}, 그 센터 운영자) 중 주문 요약 — 품목·수량·줄 금액·상품 합계·배송 요청사항(주소 없음) */
export interface DeliveryOrderSummary {
  orderNumber?: string | null;
  items?: { orderLineId?: string; name: string; optionLabel?: string | null; qty: number; lineAmount: number }[];
  itemAmount?: number;
  deliveryNote?: string | null;
}

/** mfc-inbound InitialStockLoad(0.14.0 시험 입고도 같은 모양) — EXPECTED → 현장 수령 → PENDING → APPLIED(품질검사 작업 생성) */
export interface InitialStockLoad {
  receiptId: string;
  approvalId: string;
  mfcId: string | null;
  state: 'EXPECTED' | 'PENDING' | 'APPLIED' | 'REJECTED';
  rejectReason?: string | null;
  lines: { sku: string; productName?: string | null; qty: number; receivedQty?: number | null }[];
}

export interface InboundTask {
  taskId: string;
  taskType: 'INSPECT' | 'PUTAWAY';
  mfcId: string;
  receiptId: string;
  parentTaskId?: string | null;
  sku: string;
  productName?: string | null;
  barcodes?: string[];
  /** (0.11.0, BR-52 R18) 보관 온도대 — 모르면 null */
  storageType?: TemperatureZone | null;
  /** (0.11.0) 정상 판정 최소 잔여일 — 상품 보장, 없으면 보관 유형 기본값. 둘 다 없으면 null(0·무제한 아님 — PDA 는 기준 미설정으로 막음) */
  minRemainingDays?: number | null;
  /** (0.11.0) 제조 후 최대 경과일 — 있으면 제조일 필수 */
  maxDaysSinceManufacture?: number | null;
  /** 품질검사 = 수령 LOT, 적치 = 나뉜 LOT */
  lotId: string;
  /** 출발 위치 */
  locationCode: string;
  plannedQty: number;
  doneQty: number;
  state: 'READY' | 'COMPLETED';
  version: number;
  assigneeId?: string | null;
  createdAt?: string;
}

/** mfc-inbound InboundTaskExecution — CAPTURED·UNKNOWN_RESULT 는 같은 Idempotency-Key 로 다시 보내 확정한다 */
export interface InboundTaskExecution {
  executionId: string;
  taskId: string;
  applyStatus: 'CAPTURED' | 'APPLIED' | 'REJECTED' | 'UNKNOWN_RESULT';
  inventoryCommitId?: string | null;
  rejectReason?: string | null;
  /** 품질검사가 만든 적치 작업 */
  createdTaskIds?: string[];
  task?: InboundTask;
}

/** POST /inbound-tasks/{taskId}/inspections 결과 줄(qty·resultQuality 필수, 나머지 선택). 합계 ≤ 작업 잔량 */
/** mfc-inventory LotLabel (0.20.0·0.21.0) — 가상 작업자 품질검사가 쓰는 칸만 */
export interface LotLabel {
  lotId: string;
  lotNo: string;
  sku: string;
  gs1?: string | null;
  tracking: 'TRACKED' | 'UNTRACKED';
  sourceLotRef?: string | null;
  expiryDate?: string | null;
  manufactureDate?: string | null;
  onHand: number;
}

export interface InspectionResult {
  qty: number;
  resultQuality: 'NORMAL' | 'QUARANTINED';
  sourceLotRef?: string;
  expiryDate?: string;
  manufactureDate?: string;
}

/** mfc-inbound MoveOrder (0.7.1) — MOVE 센터 관리자 재배치, REPLENISH 자동 보충. 배정 taskId = moveId */
export interface MoveOrder {
  moveId: string;
  kind: 'MOVE' | 'REPLENISH';
  mfcId: string;
  sku: string;
  productName?: string | null;
  barcodes?: string[];
  lotId: string;
  fromLocation: string;
  toLocation: string;
  cartLocation: string | null;
  qty: number;
  pickedQty: number;
  droppedQty: number;
  onCartQty: number;
  state: 'ACTIVE' | 'CANCEL_PENDING' | 'COMPLETED' | 'CANCELLED';
  reason?: string | null;
  urgent?: boolean;
  /** 담당 — 있으면 담당만 집어 올림 */
  assigneeId?: string | null;
  /** 카트에 실은 사람 — 그 사람만 내려놓음 */
  pickedBy?: string | null;
}

/** mfc-location GET /putaway-candidates 항목(rank 순) */
export interface PutawayCandidate {
  locationId?: string;
  locationCode: string;
  zone?: string;
  /** V 사본. null 은 불명 */
  remainingSpace?: number | null;
  rank?: number;
}
