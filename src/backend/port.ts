import type {
  CommandResponse,
  DispatchRequest,
  HandoverAuthorization,
  HandoverCommitResult,
  Package,
  SealPackageRequest,
  Shipment,
  TaskDetail,
  TaskExecution,
  TaskExecutionRequest,
  TaskState,
  TaskSummary,
} from '../domain/contract';

/**
 * 가상 MFC 현장(시뮬레이터)이 백엔드에 대해 하는 일.
 * 메서드 하나가 계약의 API 하나에 대응한다. 구현은 MockBackend(계약 의미를 브라우저 안에서 흉내)와
 * HttpBackend(게이트웨이 실호출) 두 가지다. 시뮬레이터는 이 인터페이스만 보고 움직인다.
 */
export interface FulfillmentPort {
  readonly mode: 'mock' | 'http';

  // mfc-fulfillment: 점원 단말
  listTasks(mfcId: string, states: TaskState[]): Promise<TaskSummary[]>;
  getTask(taskId: string): Promise<TaskDetail>;
  startTask(
    taskId: string,
    body: { workerId: string; assignmentVersion: number; deviceId?: string },
    idempotencyKey: string,
    expectedVersion?: number,
  ): Promise<CommandResponse>;
  recordExecution(taskId: string, body: TaskExecutionRequest, idempotencyKey: string): Promise<CommandResponse>;
  getExecution(taskId: string, executionId: string): Promise<TaskExecution>;

  // mfc-fulfillment: 출하·포장
  getShipment(shipmentId: string): Promise<Shipment>;
  sealPackage(shipmentId: string, body: SealPackageRequest, idempotencyKey: string): Promise<Package>;
  /** 배차 요청(fulfillment 0.4.11 — 점원 요청 MANUAL 만, 자동 요청 없음). 출고당 한 번, 이미 있으면 그 요청 */
  requestDispatch(shipmentId: string, estimatedPackMinutes: number, idempotencyKey: string): Promise<DispatchRequest>;

  // mfc-fulfillment: 라이더 QR 인계 fence
  authorizeHandover(
    packageId: string,
    body: { riderId: string; deliveryId: string; scannedCode: string; scannedAt?: string },
    idempotencyKey: string,
  ): Promise<HandoverAuthorization>;
  /** 라벨 번호로 인계 허가(F-8 — QR 이 안 찍힐 때). QR 허가와 같은 fence. 서버는 6자리, MOCK 은 2~4자리(R-26 제안) */
  authorizeHandoverByCode(body: { riderId: string; deliveryId: string; handoverCode: string }, idempotencyKey: string): Promise<HandoverAuthorization>;
  commitHandover(
    packageId: string,
    body: { handoverAuthorizationId: string; fenceVersion: number; riderId: string; handedOverAt?: string },
    idempotencyKey: string,
  ): Promise<HandoverCommitResult>;
}

/** API 호출 기록 — 화면의 "API 로그"와 연동 점검에 쓴다. */
export interface ApiCallRecord {
  at: number; // 시뮬레이션 시각(초)
  method: 'GET' | 'POST';
  path: string;
  status: number | 'ERR';
  code?: string;
  ms: number;
  /** 계약 공백 등 표시 */
  note?: string;
}

/** 계약 이벤트 이름 그대로의 사건 기록 (contracts/events/*.v1.json). */
export interface DomainEventRecord {
  at: number;
  type: string;
  summary: string;
}

export type ApiListener = (rec: ApiCallRecord) => void;
export type EventListener = (rec: DomainEventRecord) => void;
