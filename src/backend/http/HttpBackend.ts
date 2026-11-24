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
  type StockUnitRow,
  type CenterShipment,
  type DeliveryOrderSummary,
  type DispatchRequest,
  type CommandResponse,
  type DeliveryDispatch,
  type HandoverAuthorization,
  type HandoverCommitResult,
  type InboundTask,
  type InitialStockLoad,
  type SupplyRequest,
  type SupplyRequestBody,
  type SupplyRequestState,
  type SupplyRecommendations,
  type InboundTaskExecution,
  type ReturnArrival,
  type ReturnInspectionLine,
  type ReturnReceipt,
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
  type Assignment,
  type AssignTaskRequest,
  type PackageToCheck,
  type OperatorCancelRequest,
  type TaskControl,
  type AssignmentHistoryEntry,
  type Claim,
  type RiderDisplayName,
  type TaskExecutionRequest,
  type TaskState,
  type TaskSummary,
  type TemperatureZone,
  type WorkArea, CategoryNode } from '../../domain/contract';
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

/** mfc-inventory StockHold(0.38.0) 중 쓰는 칸 */
export type StockHold = { sku: string; lotId: string; locationCode: string; heldQty: number; resolution: 'CORRECTION' | 'COUNT'; productName?: string | null };

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

  /** (0.12.0) 그날(Asia/Seoul) 활동이 있는 작업 — 관리 탭 지난 주문. from·to = YYYY-MM-DD, 최대 31일 */
  async listTasksByActivity(mfcId: string, states: TaskState[], from: string, to: string, maxPages = 5): Promise<TaskSummary[]> {
    const out: TaskSummary[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < maxPages; i++) {
      const q = new URLSearchParams({ mfcId, pageSize: '100', activityFrom: from, activityTo: to });
      for (const s of states) q.append('state', s);
      if (cursor) q.set('cursor', cursor);
      const r: { items?: TaskSummary[]; page?: { nextCursor?: string | null } } = await this.request('GET', `/tasks?${q}`);
      out.push(...(r.items ?? []));
      cursor = r.page?.nextCursor ?? null;
      if (!cursor) break;
    }
    return out;
  }

  /** (0.24.0, R-17) 작업 실적 — 최근 순, 칸·시각·줄 */
  async listTaskExecutions(taskId: string, size = 200): Promise<TaskExecution[]> {
    const r = await this.request<{ items?: TaskExecution[] }>('GET', `/tasks/${enc(taskId)}/executions?size=${size}`);
    return r.items ?? [];
  }

  /** mfc-capacity 지금 담당(ACTIVE) — 재배정의 X-Expected-Version */
  async listAssignments(mfcId: string, taskId: string): Promise<Assignment[]> {
    const r = await this.request<{ items?: Assignment[] }>('GET', `/assignments?${new URLSearchParams({ mfcId, taskId })}`);
    return r.items ?? [];
  }

  /** mfc-capacity 수동 배정·재배정 — 그 센터 MFC_SUPERVISOR. expectedVersion = 지금 활성 assignmentVersion(없으면 0) */
  assignTask(body: AssignTaskRequest, expectedVersion: number, idempotencyKey: string): Promise<Assignment> {
    return this.request('POST', '/assignments', { body, expectedVersion, idempotencyKey });
  }

  /** claim 0.8.0 관리자 판단 전체 취소(OPERATOR_DECISION, ADR-0076) — 인계 전이면 피킹 시작 뒤라도. 접수일 뿐 확정은 S3 뒤 */
  createOperatorCancel(body: OperatorCancelRequest, idempotencyKey: string): Promise<Claim> {
    return this.request('POST', '/claims', { body, idempotencyKey });
  }

  /** (fulfillment 0.28.0, ADR-0079) 작업 중지 → BLOCKED. 배정·완료량·장바구니·재고·예약·배차 그대로. 센터 관리자 */
  blockTask(taskId: string, reason: string, idempotencyKey: string): Promise<TaskControl> {
    return this.request('POST', `/tasks/${enc(taskId)}/blocks`, { body: { reason }, idempotencyKey });
  }

  /** (0.29.0) 관리자 중지 해제 — cartChecked(실물 확인) 필수. 담당이 살아 있으면 ASSIGNED, 아니면 배정 해제·READY */
  unblockTask(taskId: string, reason: string, cartChecked: boolean, idempotencyKey: string): Promise<TaskControl> {
    return this.request('POST', `/tasks/${enc(taskId)}/unblocks`, { body: { reason, cartChecked }, idempotencyKey });
  }

  /** (0.30.0) PICK 남은 수량만 취소 — 결품 사가로 부분 환불, 집은 게 0 이면 422 NOTHING_EXECUTED(주문 취소로) */
  partialCloseTask(taskId: string, reason: string, idempotencyKey: string): Promise<TaskControl> {
    return this.request('POST', `/tasks/${enc(taskId)}/partial-closes`, { body: { reason }, idempotencyKey });
  }

  /** (0.28.0) 작업 조작 이력 — 최근 순 */
  async listTaskControls(taskId: string): Promise<TaskControl[]> {
    const r = await this.request<{ items?: TaskControl[] }>('GET', `/tasks/${enc(taskId)}/controls`);
    return r.items ?? [];
  }

  /** (capacity 0.31.0) 배정 이력 — 버전 순, 누가·언제 배정·끝냈나 */
  async listAssignmentHistory(mfcId: string, taskId: string): Promise<AssignmentHistoryEntry[]> {
    const r = await this.request<{ items?: AssignmentHistoryEntry[] }>('GET', `/assignments/history?${new URLSearchParams({ mfcId, taskId })}`);
    return r.items ?? [];
  }

  /** 작업 내놓기(0.4.8) — 담당 본인 또는 센터 관리자, READY 로 */
  releaseTask(taskId: string, body: { workerId: string; reason?: string }, idempotencyKey: string): Promise<TaskSummary> {
    return this.request('POST', `/tasks/${enc(taskId)}/releases`, { body, idempotencyKey });
  }

  /** 점원 확인이 필요한 포장(인계 허가 만료·확정 없음) — 그 센터 MFC_WORKER·MFC_SUPERVISOR */
  async listPackagesToCheck(mfcId: string): Promise<PackageToCheck[]> {
    const r = await this.request<{ items?: PackageToCheck[] }>('GET', `/packages?${new URLSearchParams({ mfcId, checkRequired: 'true' })}`);
    return r.items ?? [];
  }

  /** 점원 확인 — AT_STATION(아직 있음, 허가 해제) / TAKEN_BY_RIDER(라이더가 가져감, 인계 전기) */
  checkPackageHandover(packageId: string, body: { result: 'AT_STATION' | 'TAKEN_BY_RIDER'; note?: string }, idempotencyKey: string): Promise<unknown> {
    return this.request('POST', `/packages/${enc(packageId)}/handover-checks`, { body, idempotencyKey });
  }

  /** rider-service 0.18.0 — 라이더 번호·가린 이름(ADR-0070). 50개까지, 없는 ID 는 빠진다 */
  async getRiderDisplayNames(riderIds: string[]): Promise<RiderDisplayName[]> {
    if (!riderIds.length) return [];
    const r = await this.request<{ items?: RiderDisplayName[] }>('GET', `/riders/display-names?${new URLSearchParams({ riderIds: riderIds.slice(0, 50).join(',') })}`);
    return r.items ?? [];
  }

  /** mfc-capacity listWorkers — 담당자 표시 이름용(그 센터 운영자면 읽을 수 있다). */
  async listWorkers(mfcId: string): Promise<CapacityWorker[]> {
    const r = await this.request<{ items?: CapacityWorker[] }>('GET', `/mfcs/${enc(mfcId)}/workers`);
    return r.items ?? [];
  }

  /** mfc-inventory getCenterStock — SKU 하나의 위치·상태별 수량(그 센터 운영자). SKU 마다 한 번씩만 부른다(SIM-5) */
  /** mfc-inventory listStockUnits(0.33.0, R-15) — 센터 전체를 nextCursor 가 null 일 때까지(최대 maxPages 쪽) */
  async listAllStockUnits(mfcId: string, maxPages: number): Promise<StockUnitRow[]> {
    const out: StockUnitRow[] = [];
    let cursor: string | null = null;
    for (let p = 0; p < maxPages; p++) {
      const q = new URLSearchParams({ size: '200' });
      if (cursor) q.set('cursor', cursor);
      const r: { items?: StockUnitRow[]; nextCursor?: string | null } = await this.request('GET', `/mfcs/${enc(mfcId)}/stock-units?${q}`);
      out.push(...(r.items ?? []));
      cursor = r.nextCursor ?? null;
      if (!cursor) break;
    }
    return out;
  }

  getCenterStock(mfcId: string, sku: string): Promise<CenterStock> {
    return this.request('GET', `/mfcs/${enc(mfcId)}/stock?${new URLSearchParams({ sku })}`);
  }

  /** product-service SKU 조회 — 스캔 판의 상품 바코드(서버 값이 정본, CSV 사본 아님) */
  getSku(sku: string): Promise<SkuBarcodes> {
    return this.request('GET', `/skus/${enc(sku)}`);
  }

  /** product GET /categories/tree — 발효된 카테고리 트리(경로 "대 > 중 > …") */
  async getCategoryTree(): Promise<CategoryNode[]> {
    const r: { nodes?: CategoryNode[] } = await this.request('GET', '/categories/tree');
    return r.nodes ?? [];
  }

  /** product GET /products — 모든 쪽(page.nextCursor)을 읽어 상품 → 대표 카테고리(primaryCategoryId) */
  async listProductCategories(maxPages: number): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let cursor: string | null = null;
    for (let p = 0; p < maxPages; p++) {
      const q = new URLSearchParams({ size: '100' });
      if (cursor) q.set('cursor', cursor);
      const r: { items?: { productId: string; primaryCategoryId?: string | null }[]; page?: { nextCursor?: string | null } } = await this.request('GET', `/products?${q}`);
      for (const it of r.items ?? []) if (it.primaryCategoryId) out.set(it.productId, it.primaryCategoryId);
      cursor = r.page?.nextCursor ?? null;
      if (!cursor) break;
    }
    return out;
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
  /** center-master getCenter(OPERATOR) — 센터 이름만 쓴다(화면 번호 규칙: 센터는 이름으로, ADR-0070) */
  async getCenterName(centerId: string): Promise<string | null> {
    const r: { name?: string | null } = await this.request('GET', `/centers/${enc(centerId)}`);
    return r.name ?? null;
  }

  /** mfc-fulfillment listCenterShipments(0.15.0 F-9) — 끝나지 않은 출고(피킹·패킹 시작 시각, 출하 대기 시각). 개인정보 없음 */
  async listCenterShipments(mfcId: string): Promise<CenterShipment[]> {
    const r: { items?: CenterShipment[] } = await this.request('GET', `/shipments?mfcId=${enc(mfcId)}&size=100`);
    return r.items ?? [];
  }

  /** delivery-execution 배송 상세(그 센터 운영자) 중 주문 요약만 — 품목·금액·배송 요청사항. 주소 없음 */
  async getDeliveryOrderSummary(deliveryId: string): Promise<DeliveryOrderSummary | null> {
    const r: { orderSummary?: DeliveryOrderSummary | null } = await this.request('GET', `/deliveries/${enc(deliveryId)}`);
    return r.orderSummary ?? null;
  }

  getDeliveryDispatch(deliveryId: string): Promise<DeliveryDispatch> {
    return this.request('GET', `/deliveries/${enc(deliveryId)}/dispatch`);
  }

  /** 주문 번호로 현장 상태(fulfillment 0.10.0) — 작업 지시·출고별 작업·작업자·시작/끝·결품·포장·인계. 개인정보 없음 */
  getOrderFulfillment(orderId: string): Promise<OrderFulfillmentView> {
    return this.request('GET', `/work-orders?${new URLSearchParams({ orderId })}`);
  }

  /** (fulfillment 0.27.0, R-29) 화면 주문번호 8자리로 같은 조회 — 번호 사본이 없으면 404 */
  getOrderFulfillmentByNumber(orderNumber: string): Promise<OrderFulfillmentView> {
    return this.request('GET', `/work-orders?${new URLSearchParams({ orderNumber })}`);
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

  /** mfc-fulfillment authorizeHandoverByCode(0.13.0, F-8) — 라벨 번호(0.23.0 새 포장 4자리, 옛 포장 6자리) */
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

  /** search searchProducts(익명 가능) — 센터 취급 상품(입고 발주 후보). 판매 상태는 색인 사본. 쪽(200)을 끝까지(최대 maxPages) — 부산진구 503개 */
  async searchProducts(mfcId: string, maxPages = 10): Promise<{ representativeSku?: string; name?: string; saleState?: string; carried?: boolean | null }[]> {
    type Hit = { representativeSku?: string; name?: string; saleState?: string; carried?: boolean | null };
    const out: Hit[] = [];
    let cursor: string | null | undefined;
    for (let i = 0; i < maxPages; i++) {
      const r: { items?: Hit[]; page?: { nextCursor?: string | null } } = await this.request('GET', `/search/products?mfcId=${enc(mfcId)}&size=200${cursor ? `&cursor=${enc(cursor)}` : ''}`);
      out.push(...(r.items ?? []));
      cursor = r.page?.nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  /** mfc-inbound createDevInitialStockLoad(0.14.0, MI-3·R-23) — [LAN 시험 전용] 승인 없이 입고 예정(EXPECTED) 하나. 설정 꺼진 곳 404 */
  createDevInitialStockLoad(mfcId: string, lines: { sku: string; qty: number }[], idempotencyKey: string): Promise<InitialStockLoad> {
    return this.request('POST', '/dev-initial-stock-loads', { body: { mfcId, lines }, idempotencyKey });
  }

  // ── 센터 발주·승인·추천(mfc-inbound 0.21.0, MI-4 — R-48) ──

  /** createSupplyRequest — 발주(줄 1~200) → SUBMITTED. 같은 센터·SKU 미해결 요청이 있으면 409 DUPLICATE_OPEN_REQUEST */
  createSupplyRequest(body: SupplyRequestBody, idempotencyKey: string): Promise<SupplyRequest> {
    return this.request('POST', '/supply-requests', { body, idempotencyKey });
  }

  /** listSupplyRequests — 그 센터 발주 목록(state 비우면 끝나지 않은 것). 한 쪽(≤200)만 */
  async listSupplyRequests(mfcId: string, states: SupplyRequestState[] = []): Promise<SupplyRequest[]> {
    const q = [`mfcId=${enc(mfcId)}`, 'size=200', ...states.map((s) => `state=${s}`)].join('&');
    const r: { items?: SupplyRequest[] } = await this.request('GET', `/supply-requests?${q}`);
    return r.items ?? [];
  }

  /** approveSupplyRequest — [센터 관리자] SUBMITTED → APPROVED + 입고 예정. lines 에 없는 줄은 요청 수량 그대로, 줄이면 note 필수 */
  approveSupplyRequest(id: string, version: number, body: { lines?: { sku: string; approvedQty: number }[]; note?: string }, idempotencyKey: string): Promise<SupplyRequest> {
    return this.request('POST', `/supply-requests/${enc(id)}/approvals`, { body, idempotencyKey, expectedVersion: version });
  }

  /** rejectSupplyRequest — [센터 관리자] SUBMITTED → REJECTED(사유 필수) */
  rejectSupplyRequest(id: string, version: number, reason: string, idempotencyKey: string): Promise<SupplyRequest> {
    return this.request('POST', `/supply-requests/${enc(id)}/rejections`, { body: { reason }, idempotencyKey, expectedVersion: version });
  }

  /** listSupplyRecommendations — SKU 1~100 의 발주 수량 추천과 근거(저장 안 함, 부를 때마다 계산) */
  listSupplyRecommendations(mfcId: string, skus: readonly string[]): Promise<SupplyRecommendations> {
    const q = [`mfcId=${enc(mfcId)}`, ...skus.map((s) => `sku=${enc(s)}`)].join('&');
    return this.request('GET', `/supply-recommendations?${q}`);
  }

  /** mfc-inbound listInitialStockLoads(0.12.0, MB-1) — 센터의 입고 예정(기본 EXPECTED·PENDING, 오래된 순). 그 센터 운영자. 한 쪽(≤200)만 */
  async listInitialStockLoads(mfcId: string, states: InitialStockLoad['state'][] = ['EXPECTED']): Promise<InitialStockLoad[]> {
    const q = [`mfcId=${enc(mfcId)}`, 'size=200', ...states.map((s) => `state=${s}`)].join('&');
    const r: { items?: InitialStockLoad[] } = await this.request('GET', `/initial-stock-loads?${q}`);
    return r.items ?? [];
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

  /**
   * mfc-inbound reportInboundTaskException(0.15.0·0.17.0) — 적치 예외. BLOCKED = 도착 칸 가득·막힘(그 양은 분실 조사 보류로 빠지고 작업 잔량에서 뺀다,
   * 0 이면 COMPLETED). qty 생략 = 남은 양 전부
   */
  reportInboundTaskException(
    taskId: string,
    body: { reason: 'SHORT' | 'DAMAGED' | 'SPOILED' | 'BLOCKED'; qty?: number | null; locationCode?: string | null; note?: string | null },
    idempotencyKey: string,
  ): Promise<{ exceptionId: string; applyStatus?: string; rejectReason?: string | null }> {
    return this.request('POST', `/inbound-tasks/${enc(taskId)}/exceptions`, { body, idempotencyKey });
  }

  /** mfc-inventory listStockHolds(0.38.0) — 열린 분실 조사 보류. resolution CORRECTION(적치 전 UNSTOWED)은 정정 holdResolutions 한 줄과 1:1 */
  async listStockHolds(
    mfcId: string,
    q: { workState?: 'STORED' | 'UNSTOWED'; locationCode?: string } = {},
  ): Promise<StockHold[]> {
    const out: StockHold[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const p = new URLSearchParams({ size: '200' });
      if (q.workState) p.set('workState', q.workState);
      if (q.locationCode) p.set('locationCode', q.locationCode);
      if (cursor) p.set('cursor', cursor);
      const r: { items?: StockHold[]; nextCursor?: string | null } = await this.request('GET', `/mfcs/${enc(mfcId)}/stock-holds?${p}`);
      out.push(...(r.items ?? []));
      cursor = r.nextCursor ?? null;
      if (!cursor) break;
    }
    return out;
  }

  /** mfc-inventory correctStock — 센터 관리자(MFC_SUPERVISOR) 정정. holdResolutions = 적치 전 보류를 찾음/못 찾음으로(foundQty + lostQty = 열린 보류 합) */
  correctStock(
    mfcId: string,
    body: { reason: string; approvalRef?: string; holdResolutions?: { sku: string; lotId: string; locationCode: string; foundQty: number; lostQty: number }[] },
    idempotencyKey: string,
  ): Promise<{ resultId?: string; applyStatus?: string }> {
    return this.request('POST', `/mfcs/${enc(mfcId)}/stock-corrections`, { body, idempotencyKey });
  }

  /** mfc-inbound listReturnArrivals(0.13.0) — 반납 도착 대기(기본 WAITING, 오래된 순). 그 센터 운영자 */
  async listReturnArrivals(mfcId: string): Promise<ReturnArrival[]> {
    const r: { items?: ReturnArrival[] } = await this.request('GET', `/return-arrivals?${new URLSearchParams({ mfcId, state: 'WAITING', size: '50' })}`);
    return r.items ?? [];
  }

  /** mfc-inbound recordReturnReceipt — arrivalId 로 반입(줄은 대기 건 그대로). 반품 위치(RETURN 구역)에 격리로만. APPLIED·REJECTED·UNKNOWN_RESULT(같은 키로 다시) */
  recordReturnReceipt(body: { mfcId: string; toLocationCode: string; arrivalId: string; receivedBy: string }, idempotencyKey: string): Promise<CommandResponse> {
    return this.request('POST', '/return-receipts', { body, idempotencyKey });
  }

  /** mfc-inbound listReturnReceipts(0.15.0) — inspectionState=PENDING 이면 검수 대기 큐(오래된 순, 재고 반영 APPLIED 만) */
  async listPendingReturnReceipts(mfcId: string): Promise<ReturnReceipt[]> {
    const r: { items?: ReturnReceipt[] } = await this.request('GET', `/return-receipts?${new URLSearchParams({ mfcId, inspectionState: 'PENDING', size: '50' })}`);
    return r.items ?? [];
  }

  /** mfc-quality createReturnInspection — 회수품 검수 RESALE/DISPOSE(반입한 사람은 안 됨 422 SELF_APPROVAL) */
  createReturnInspection(
    body: { mfcId: string; returnReceiptId: string; claimId?: string | null; inspectedBy: string; lines: ReturnInspectionLine[] },
    idempotencyKey: string,
  ): Promise<CommandResponse> {
    return this.request('POST', '/return-inspections', { body, idempotencyKey });
  }

  /** mfc-inbound quarantineMoveInboundTask(0.17.0) — 격리품을 격리 구역 칸으로(담당만). 처리는 적치와 같다 */
  quarantineMoveInboundTask(taskId: string, body: { toLocationCode: string; qty: number }, idempotencyKey: string): Promise<InboundTaskExecution> {
    return this.request('POST', `/inbound-tasks/${enc(taskId)}/quarantine-moves`, { body, idempotencyKey });
  }

  /** mfc-inbound listInboundTasks — 센터 입고 작업(품질검사·적치) 목록. 상품 이름 포함(withLabels 기본 true) */
  async listInboundTasks(mfcId: string, state?: 'READY' | 'COMPLETED', taskType?: 'INSPECT' | 'PUTAWAY'): Promise<InboundTask[]> {
    const q = new URLSearchParams({ mfcId });
    if (state) q.set('state', state);
    if (taskType) q.set('taskType', taskType);
    const r: { items?: InboundTask[] } = await this.request('GET', `/inbound-tasks?${q}`);
    return r.items ?? [];
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
