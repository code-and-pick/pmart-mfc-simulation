// 게이트웨이(/api/v1) 실호출 어댑터. 계약 mfc-fulfillment-service.yaml·mfc-capacity-service.yaml(·가상 작업자 재고 이동·품질검사용 mfc-inbound·mfc-location) 그대로 부른다.
// 2026-11-16: 작업 목록·상세·작업자 목록(읽기)은 LAN 실서버로 확인. 쓰기(시작·실적·밀봉·인계)는 아직 실서버 검증 전.
// 토큰은 Vite 개발 서버가 LAN 시험 계정으로 받아 준다(TokenSource, SIM-11).

import { fitIdempotencyKey } from './idemKey';
import {
  ApiProblem,
  ResultUnknown,
  type CapacityWorker,
  type CapacityAssignment,
  type OrderFulfillmentView,
  type CenterStock,
  type DispatchRequest,
  type CommandResponse,
  type DeliveryDispatch,
  type HandoverAuthorization,
  type HandoverCommitResult,
  type InboundTask,
  type InitialStockLoad,
  type InboundTaskExecution,
  type InspectionResult,
  type LotLabel,
  type EmployeeLabel,
  type ReturnHandover,
  type MoveOrder,
  type Package,
  type PutawayCandidate,
  type Problem,
  type SealPackageRequest,
  type SkuBarcodes,
  type StaffDeliverySummary,
  type Shipment,
  type TaskDetail,
  type TaskExecution,
  type TaskExecutionRequest,
  type TaskState,
  type TaskSummary,
  type TemperatureZone,
  type WorkArea,
} from '../../domain/contract';
import type { ApiListener, FulfillmentPort } from '../port';

export interface HttpOptions {
  /** 기본 '/api/v1' — vite 개발 서버가 게이트웨이로 넘긴다 */
  baseUrl: string;
  /** 작업자 토큰 — TokenSource.get (만료 전에 새로 받는다) */
  token: () => string | null | Promise<string | null>;
  sourceSystem: string;
  now: () => number;
  timeoutMs: number;
}

export class HttpBackend implements FulfillmentPort {
  readonly mode = 'http' as const;
  private readonly listeners: ApiListener[] = [];

  constructor(private readonly opt: HttpOptions) {}

  onApi(l: ApiListener) {
    this.listeners.push(l);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; idempotencyKey?: string; expectedVersion?: number } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = await this.opt.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers['X-Source-System'] = this.opt.sourceSystem;
      if (init.idempotencyKey) headers['Idempotency-Key'] = fitIdempotencyKey(init.idempotencyKey);
      if (init.expectedVersion !== undefined) headers['X-Expected-Version'] = String(init.expectedVersion);
    }
    const t0 = performance.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opt.timeoutMs);
    const log = (status: number | 'ERR', code?: string) => {
      for (const l of this.listeners)
        l({ at: this.opt.now(), method, path, status, code, ms: performance.now() - t0 });
    };
    let res: Response;
    try {
      res = await fetch(`${this.opt.baseUrl}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctl.signal,
      });
    } catch (e) {
      log('ERR', 'NO_RESPONSE');
      // 타임아웃·연결 끊김 = 결과 불명. 실패로 단정하지 않고 같은 키 재전송/원결과 조회로 해소한다.
      throw new ResultUnknown(`${method} ${path}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    const json = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const p = (json ?? {}) as Partial<Problem> & { title?: string };
      const problem: Problem = {
        status: res.status,
        code: p.code ?? (res.status === 501 ? 'UNSUPPORTED_ACTION' : `HTTP_${res.status}`),
        detail: p.detail ?? p.title,
        retryable: p.retryable,
      };
      log(res.status, problem.code);
      throw new ApiProblem(problem);
    }
    log(res.status);
    return json as T;
  }

  /** 센터 작업 목록 — 페이지를 끝까지 따라간다(최대 maxPages). */
  async listTasks(mfcId: string, states: TaskState[], maxPages = 10): Promise<TaskSummary[]> {
    const out: TaskSummary[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < maxPages; i++) {
      const q = new URLSearchParams({ mfcId, pageSize: '100' });
      for (const s of states) q.append('state', s);
      if (cursor) q.set('cursor', cursor);
      const r: { items?: TaskSummary[]; page?: { nextCursor?: string | null } } = await this.request('GET', `/tasks?${q}`);
      out.push(...(r.items ?? []));
      cursor = r.page?.nextCursor ?? null;
      if (!cursor) break;
    }
    return out;
  }

  /** mfc-capacity listWorkers — 담당자 표시 이름용(그 센터 운영자면 읽을 수 있다). */
  async listWorkers(mfcId: string): Promise<CapacityWorker[]> {
    const r = await this.request<{ items?: CapacityWorker[] }>('GET', `/mfcs/${enc(mfcId)}/workers`);
    return r.items ?? [];
  }

  /** mfc-inventory getCenterStock — SKU 하나의 위치·상태별 수량(그 센터 운영자). SKU 마다 한 번씩만 부른다(SIM-5) */
  getCenterStock(mfcId: string, sku: string): Promise<CenterStock> {
    return this.request('GET', `/mfcs/${enc(mfcId)}/stock?${new URLSearchParams({ sku })}`);
  }

  /** product-service SKU 조회 — 스캔 판의 상품 바코드(서버 값이 정본, CSV 사본 아님) */
  getSku(sku: string): Promise<SkuBarcodes> {
    return this.request('GET', `/skus/${enc(sku)}`);
  }

  /** mfc-capacity 다음 작업 받기 — 작업자 본인 토큰(주체 = workerId). 들고 있는 작업이 있으면 그것(200) */
  pullNextTask(mfcId: string, workerId: string, workArea: WorkArea, idempotencyKey: string): Promise<CapacityAssignment> {
    return this.request('POST', `/mfcs/${enc(mfcId)}/workers/${enc(workerId)}/next-tasks`, { body: { workArea }, idempotencyKey });
  }

  /** mfc-fulfillment 배차 요청 — 점원(포장 시작 때, 사용자 2026-11-16). 출고당 한 번, 이미 요청됐으면 그 요청(200) */
  requestDispatch(shipmentId: string, estimatedPackMinutes: number, idempotencyKey: string): Promise<DispatchRequest> {
    return this.request('POST', `/shipments/${enc(shipmentId)}/dispatch-requests`, { body: { estimatedPackMinutes }, idempotencyKey });
  }

  /** delivery-execution 직원용 배송 찾기 — 그 센터 배송 최신순(배송 생긴 시각). 센터 직원은 mfcId 필수 */
  /** hr getEmployeeLabels(0.8.0) — 운영자 ID 1~50개 → 이름·사번. 모르는 ID 는 빠진다 */
  async getEmployeeLabels(operatorIds: string[]): Promise<EmployeeLabel[]> {
    const q = new URLSearchParams();
    for (const id of operatorIds.slice(0, 50)) q.append('operatorIds', id);
    const r: { items?: EmployeeLabel[] } = await this.request('GET', `/hr/employee-labels?${q}`);
    return r.items ?? [];
  }

  /** delivery-execution listReturnHandovers(0.28.0) — MFC 반납 기다리는 배송과 반납 인증번호(센터 직원). 번호가 없으면 서버가 이때 만든다 */
  async listReturnHandovers(mfcId: string): Promise<ReturnHandover[]> {
    const r: { items?: ReturnHandover[] } = await this.request('GET', `/return-handovers?${new URLSearchParams({ mfcId })}`);
    return r.items ?? [];
  }

  async searchDeliveries(mfcId: string, size = 50): Promise<StaffDeliverySummary[]> {
    const r: { items?: StaffDeliverySummary[] } = await this.request('GET', `/deliveries?${new URLSearchParams({ mfcId, size: String(size), sort: 'NEWEST' })}`);
    return r.items ?? [];
  }

  /** delivery-dispatch 배차 조회 — 배차 상태·배정 라이더·시도(반경) */
  getDeliveryDispatch(deliveryId: string): Promise<DeliveryDispatch> {
    return this.request('GET', `/deliveries/${enc(deliveryId)}/dispatch`);
  }

  /** 주문 번호로 현장 상태(fulfillment 0.10.0) — 작업 지시·출고별 작업·작업자·시작/끝·결품·포장·인계. 개인정보 없음 */
  getOrderFulfillment(orderId: string): Promise<OrderFulfillmentView> {
    return this.request('GET', `/work-orders?${new URLSearchParams({ orderId })}`);
  }

  getTask(taskId: string): Promise<TaskDetail> {
    return this.request('GET', `/tasks/${enc(taskId)}`);
  }

  startTask(
    taskId: string,
    body: { workerId: string; assignmentVersion: number; deviceId?: string },
    idempotencyKey: string,
    expectedVersion?: number,
  ): Promise<CommandResponse> {
    return this.request('POST', `/tasks/${enc(taskId)}/starts`, { body, idempotencyKey, expectedVersion });
  }

  recordExecution(taskId: string, body: TaskExecutionRequest, idempotencyKey: string): Promise<CommandResponse> {
    return this.request('POST', `/tasks/${enc(taskId)}/executions`, { body, idempotencyKey });
  }

  getExecution(taskId: string, executionId: string): Promise<TaskExecution> {
    return this.request('GET', `/tasks/${enc(taskId)}/executions/${enc(executionId)}`);
  }

  getShipment(shipmentId: string): Promise<Shipment> {
    return this.request('GET', `/shipments/${enc(shipmentId)}`);
  }

  /** mfc-fulfillment stagePackage(0.20.0, F-12·R-20) — 밀봉 포장을 출하대기 랙에. 포장분 PACKED 위치만 패킹대 → 랙(수량·예약 불변) */
  stagePackage(packageId: string, stagingLocation: string, idempotencyKey: string): Promise<Package> {
    return this.request('POST', `/packages/${enc(packageId)}/staging`, { body: { stagingLocation }, idempotencyKey });
  }

  sealPackage(shipmentId: string, body: SealPackageRequest, idempotencyKey: string): Promise<Package> {
    return this.request('POST', `/shipments/${enc(shipmentId)}/packages`, { body, idempotencyKey });
  }

  authorizeHandover(
    packageId: string,
    body: { riderId: string; deliveryId: string; scannedCode: string; scannedAt?: string },
    idempotencyKey: string,
  ): Promise<HandoverAuthorization> {
    return this.request('POST', `/packages/${enc(packageId)}/handover-authorizations`, { body, idempotencyKey });
  }

  /** mfc-fulfillment authorizeHandoverByCode(0.13.0, F-8) — 라벨 숫자(서버는 6자리 — 2~4자리는 R-26 뒤) */
  authorizeHandoverByCode(body: { riderId: string; deliveryId: string; handoverCode: string }, idempotencyKey: string): Promise<HandoverAuthorization> {
    return this.request('POST', '/packages/handover-code-authorizations', { body, idempotencyKey });
  }

  commitHandover(
    packageId: string,
    body: { handoverAuthorizationId: string; fenceVersion: number; riderId: string; handedOverAt?: string },
    idempotencyKey: string,
  ): Promise<HandoverCommitResult> {
    return this.request('POST', `/packages/${enc(packageId)}/handover-commits`, { body, idempotencyKey });
  }

  // ── 재고 이동·품질검사 업무(가상 작업자 STOCK_MOVE·INSPECTION) — mfc-inbound 0.9.0, mfc-location ──

  /** mfc-inventory getLotLabel(0.20.0) — LOT 인쇄 정보(소비기한·제조일·제조 LOT 표기). 가상 작업자 품질검사가 상품 표기 대신 읽는다 */
  getLotLabel(mfcId: string, lotId: string): Promise<LotLabel> {
    return this.request('GET', `/mfcs/${enc(mfcId)}/lot-labels/${enc(lotId)}`);
  }

  /** search searchProducts(익명 가능) — 센터 취급 상품(시험 입고 후보). 판매 상태는 색인 사본 */
  async searchProducts(mfcId: string): Promise<{ representativeSku?: string; name?: string; saleState?: string; carried?: boolean | null }[]> {
    const r: { items?: { representativeSku?: string; name?: string; saleState?: string; carried?: boolean | null }[] } = await this.request('GET', `/search/products?mfcId=${enc(mfcId)}&size=200`);
    return r.items ?? [];
  }

  /** mfc-inbound createDevInitialStockLoad(0.14.0, MI-3·R-23) — [LAN 시험 전용] 승인 없이 입고 예정(EXPECTED) 하나. 설정 꺼진 곳 404 */
  createDevInitialStockLoad(mfcId: string, lines: { sku: string; qty: number }[], idempotencyKey: string): Promise<InitialStockLoad> {
    return this.request('POST', '/dev-initial-stock-loads', { body: { mfcId, lines }, idempotencyKey });
  }

  /** mfc-inbound receiveInitialStock — 입고 예정의 현장 수령(상품·수량만, LOT·기한은 품질검사). 202 → 전기 뒤 품질검사 작업 */
  receiveInitialStock(receiptId: string, toLocationCode: string, lines: { sku: string; receivedQty: number }[], idempotencyKey: string): Promise<CommandResponse> {
    return this.request('POST', `/initial-stock-loads/${enc(receiptId)}/receipts`, { body: { toLocationCode, lines }, idempotencyKey });
  }

  /** mfc-inbound getInboundTask — 품질검사·적치 작업 한 건(배정 taskId) */
  getInboundTask(taskId: string): Promise<InboundTask> {
    return this.request('GET', `/inbound-tasks/${enc(taskId)}`);
  }

  /** mfc-inbound inspectInboundTask — 정상/격리 판정. CAPTURED·503 UNKNOWN_RESULT 는 같은 키로 다시 */
  inspectInboundTask(taskId: string, results: InspectionResult[], idempotencyKey: string): Promise<InboundTaskExecution> {
    return this.request('POST', `/inbound-tasks/${enc(taskId)}/inspections`, { body: { results }, idempotencyKey });
  }

  /** mfc-inbound putawayInboundTask — 선반 위치·수량(목적지 검사는 mfc-inventory) */
  putawayInboundTask(taskId: string, body: { toLocationCode: string; qty: number }, idempotencyKey: string): Promise<InboundTaskExecution> {
    return this.request('POST', `/inbound-tasks/${enc(taskId)}/putaways`, { body, idempotencyKey });
  }

  /** mfc-location listPutawayCandidates — 적치 후보(온도대·구역 적합, rank 순) */
  async listPutawayCandidates(mfcId: string, sku: string, qty?: number, temperatureZone?: TemperatureZone): Promise<PutawayCandidate[]> {
    const q = new URLSearchParams({ mfcId, sku });
    if (qty !== undefined) q.set('qty', String(qty));
    if (temperatureZone) q.set('temperatureZone', temperatureZone);
    const r: { items?: PutawayCandidate[] } = await this.request('GET', `/putaway-candidates?${q}`);
    return r.items ?? [];
  }

  /** mfc-inbound getMoveOrder — 이동·보충 지시(배정 taskId = moveId) */
  getMoveOrder(moveId: string): Promise<MoveOrder> {
    return this.request('GET', `/move-orders/${enc(moveId)}`);
  }

  /** mfc-inbound pickUpMoveOrder — 출발 칸 → 카트 */
  pickUpMoveOrder(moveId: string, body: { cartLocation: string; qty: number }, idempotencyKey: string): Promise<MoveOrder> {
    return this.request('POST', `/move-orders/${enc(moveId)}/pickups`, { body, idempotencyKey });
  }

  /** mfc-inbound dropMoveOrder — 카트 → 도착 칸(취소 뒤에는 출발 칸) */
  dropMoveOrder(moveId: string, body: { toLocation: string; qty: number }, idempotencyKey: string): Promise<MoveOrder> {
    return this.request('POST', `/move-orders/${enc(moveId)}/drops`, { body, idempotencyKey });
  }

  /** 연결 점검: 게이트웨이 도달·인증·구현 여부를 한 번에 본다. */
  async probe(mfcId: string): Promise<string> {
    try {
      await this.listTasks(mfcId, ['READY', 'ASSIGNED', 'IN_PROGRESS']);
      return '작업 목록 조회 성공';
    } catch (e) {
      if (e instanceof ApiProblem) {
        const p = e.problem;
        if (p.status === 401) return '401 — 토큰 없음/만료 (개발 서버 /sim-auth/tokens 확인)';
        if (p.status === 403) return '403 — 이 센터 권한 없음';
        if (p.status === 501) return '501 — 백엔드 미구현';
        return `${p.status} ${p.code}`;
      }
      return `응답 없음 — 게이트웨이 주소 확인 (${(e as Error).message})`;
    }
  }
}

const enc = encodeURIComponent;
function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}
