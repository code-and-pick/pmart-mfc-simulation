// pmart-backend/contracts/openapi/mfc-fulfillment-service.yaml (0.1.0) 의 부분 사본.
// 이 파일의 이름·상태값은 계약을 그대로 따른다. 계약이 바뀌면 여기를 먼저 맞춘다.

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

export type TaskType = 'PICK' | 'PACK' | 'DISPATCH';
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
export type ShortageReason = 'SHORT' | 'DAMAGED' | 'BLOCKED';
export type CommandStatus = 'ACCEPTED' | 'APPLIED' | 'REJECTED' | 'UNKNOWN_RESULT';

export interface TaskAssignment {
  workerId: string | null;
  assignmentVersion: number;
}

export interface TaskLine {
  taskLineId: string;
  orderLineId: string;
  sku: string;
  productName?: string;
  barcode: string | null;
  locationId: string | null;
  lotId: string | null;
  expiresOn: string | null;
  plannedQty: number;
  completedQty: number;
  cancelledQty: number;
  remainingQty: number;
  pendingQty: number;
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
  createdAt: string;
}

export interface TaskDetail extends TaskSummary {
  lines: TaskLine[];
  activeStart?: { requestId: string; workerId: string; deviceId: string | null; startedAt: string };
  blockReason: string | null;
}

export interface PackageContentLine {
  orderLineId: string;
  sku: string;
  qty: number;
  lotId?: string;
}

export interface ConfirmOrderRequest {
  orderId: string;
  orderVersion?: number;
  mfcId: string;
  reservationId: string;
  capacityHoldId?: string;
  deliveryMode?: 'SINGLE' | 'BUNDLED' | 'SCHEDULED';
  promisedReadyAt?: string;
  shipments: { shipmentId: string; deliveryId?: string; weightG?: number; lines: PackageContentLine[] }[];
}

export interface TaskExecutionRequest {
  executionType: 'PICK' | 'PACK';
  workerId: string;
  assignmentVersion?: number;
  fromLocation?: string;
  toLocation?: string;
  lines: {
    orderLineId: string;
    sku: string;
    lotId?: string;
    pickedQty: number;
    shortage?: { qty: number; reason: ShortageReason; note?: string };
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
}

export interface SealPackageRequest {
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
  contents: PackageContentLine[];
  bagCount: number;
  containsAlcohol: boolean;
  temperatureZone: TemperatureZone;
  weightG: number;
  fence: PackageFence;
  sealedAt: string | null;
  handedOverAt: string | null;
  invalidatedReason: string | null;
}

export interface Shipment {
  shipmentId: string;
  fulfillmentId: string;
  orderId: string;
  deliveryId: string | null;
  version: number;
  state: ShipmentState;
  holdReason: string | null;
  packages: Package[];
  bagCount: number;
  weightG: number;
  readyAt: string | null;
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
}

export interface CommandResponse {
  status: CommandStatus;
  resultId?: string;
  version?: number;
  nextAction?: string;
}

/** _common.yaml ErrorResponse(Problem) 의 부분. */
export interface Problem {
  status: number;
  code: string;
  detail?: string;
  retryable?: boolean;
}

/** 서버가 Problem 으로 거절했을 때. 타임아웃·연결 끊김은 이 오류가 아니다(결과 불명). */
export class ApiProblem extends Error {
  constructor(readonly problem: Problem) {
    super(`${problem.status} ${problem.code}${problem.detail ? ` — ${problem.detail}` : ''}`);
  }
}

/** 응답을 받지 못함 — 실패로 단정하지 않는다(같은 키 재전송 또는 원결과 조회로 해소). */
export class ResultUnknown extends Error {}
