// 계약(mfc-fulfillment-service.yaml 0.4.10)의 의미를 브라우저 안에서 흉내 내는 백엔드.
// 실서버 없이 같은 규칙으로 화면·흐름을 검증하기 위한 것이며 실서버 동작을 대신하지 않는다.
// 규칙 근거: pmart-backend services/mfc-fulfillment-service/CLAUDE.md(6a·6b·6c), TaskService·PackageService.
// MOCK 에는 LOT 이 없다 — picks[]·lotId 는 채우지 않는다(LOT 반영은 R-01 답 뒤 후속 작업).

import {
  ApiProblem,
  type CommandResponse,
  type ConfirmOrderRequest,
  type DispatchRequest,
  type HandoverAuthorization,
  type HandoverCommitResult,
  type Package,
  type PackageContentLine,
  type SealPackageRequest,
  type Shipment,
  type TaskDetail,
  type TaskExecution,
  type TaskExecutionRequest,
  type TaskLine,
  type TaskState,
  type TaskSummary,
  type TemperatureZone,
  type WorkOrderDecision,
} from '../../domain/contract';
import type { ApiCallRecord, ApiListener, DomainEventRecord, EventListener, FulfillmentPort } from '../port';
import { InventoryError, InventoryLedger } from './inventory';
import { HANDOVER_CODE } from '../../config';
import { handoverCodeValid, shortHandoverCode } from '../../domain/handoverCode';
import { Rng } from '../../util/rng';

interface TaskRec {
  detail: TaskDetail;
  predecessorId: string | null;
  orderId: string;
  reservationId: string;
  /** 결품 보고 뒤 결품 사가(CANCEL_ITEM)를 기다리는 양 */
  pendingShortages: { orderLineId: string; qty: number }[];
}

interface WorkOrderRec {
  fulfillmentId: string;
  orderId: string;
  reservationId: string;
  shipmentIds: string[];
  preparationStartedAt: string | null;
  decision: WorkOrderDecision;
}

interface ShipmentRec {
  shipment: Shipment;
  pickTaskId: string;
  packTaskId: string;
  riderId: string | null;
  temps: Map<string, TemperatureZone>; // sku → 온도대
}

interface IdemEntry {
  body: string;
  outcome: { ok: true; value: unknown } | { ok: false; problem: ApiProblem };
}

const problem = (status: number, code: string, detail?: string, retryable = false, details?: { field: string; reason: string }[]) =>
  new ApiProblem({ status, code, detail, retryable, ...(details ? { details } : {}) });

export interface MockOptions {
  mfcId: string;
  /** 시뮬레이션 시각(초, 자정 기준) */
  now: () => number;
  baseDate: string; // YYYY-MM-DD (Asia/Seoul)
  fenceTtlSec: number;
}

export class MockBackend implements FulfillmentPort {
  readonly mode = 'mock' as const;
  readonly inventory = new InventoryLedger();
  private readonly tasks = new Map<string, TaskRec>();
  private readonly workOrders = new Map<string, WorkOrderRec>();
  private readonly shipments = new Map<string, ShipmentRec>();
  private readonly packages = new Map<string, { pkg: Package; shipmentId: string }>();
  private readonly executions = new Map<string, TaskExecution>();
  private readonly idem = new Map<string, IdemEntry>();
  /** 번호 인계 틀린 횟수(라이더|배송) — HANDOVER_CODE.failLimit 넘으면 잠금 [시뮬] */
  private readonly codeFails = new Map<string, number>();
  private readonly codeRng = new Rng(20261120);
  private readonly apiListeners: ApiListener[] = [];
  private readonly eventListeners: EventListener[] = [];
  private seq = 0;

  constructor(private readonly opt: MockOptions) {}

  onApi(l: ApiListener) {
    this.apiListeners.push(l);
  }
  onEvent(l: EventListener) {
    this.eventListeners.push(l);
  }

  // ── 시각 ───────────────────────────────────────────
  private iso(sec = this.opt.now()): string {
    const d = new Date(`${this.opt.baseDate}T00:00:00+09:00`);
    return new Date(d.getTime() + sec * 1000).toISOString();
  }
  private secOf(iso: string): number {
    const d = new Date(`${this.opt.baseDate}T00:00:00+09:00`);
    return (new Date(iso).getTime() - d.getTime()) / 1000;
  }
  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(6, '0')}`;
  }
  private emit(type: string, summary: string) {
    const rec: DomainEventRecord = { at: this.opt.now(), type, summary };
    for (const l of this.eventListeners) l(rec);
  }

  /** 가상 HTTP 호출 기록. 실서버 모드에서 같은 경로가 호출된다. */
  private async call<T>(method: 'GET' | 'POST', path: string, okStatus: number, fn: () => T, note?: string): Promise<T> {
    const t0 = performance.now();
    const rec: ApiCallRecord = { at: this.opt.now(), method, path, status: okStatus, ms: 0, note };
    try {
      const v = (() => {
        try {
          return fn();
        } catch (e) {
          // mfc-inventory 거절은 계약의 422/409 로 바꿔 올린다
          if (e instanceof InventoryError) throw problem(e.code === 'INSUFFICIENT_STOCK' ? 422 : 409, e.code, e.message);
          throw e;
        }
      })();
      rec.ms = performance.now() - t0;
      for (const l of this.apiListeners) l(rec);
      return v;
    } catch (e) {
      rec.ms = performance.now() - t0;
      if (e instanceof ApiProblem) {
        rec.status = e.problem.status;
        rec.code = e.problem.code;
      } else rec.status = 'ERR';
      for (const l of this.apiListeners) l(rec);
      throw e;
    }
  }

  /** 같은 Idempotency-Key · 같은 본문 = 기존 결과, 다른 본문 = 409 IDEMPOTENCY_CONFLICT. */
  private idempotent<T>(scope: string, key: string, body: unknown, fn: () => T): T {
    const k = `${scope}|${key}`;
    const b = JSON.stringify(body);
    const prev = this.idem.get(k);
    if (prev) {
      if (prev.body !== b) throw problem(409, 'IDEMPOTENCY_CONFLICT', '같은 키에 다른 본문');
      if (prev.outcome.ok) return prev.outcome.value as T;
      throw prev.outcome.problem;
    }
    try {
      const v = fn();
      this.idem.set(k, { body: b, outcome: { ok: true, value: v } });
      return v;
    } catch (e) {
      // 업무 거절(4xx)만 기록한다. 503 은 기록하지 않는다(계약: 같은 키 재전송은 처음부터 다시 판정)
      if (e instanceof ApiProblem && e.problem.status < 500) this.idem.set(k, { body: b, outcome: { ok: false, problem: e } });
      throw e;
    }
  }

  // ── 시뮬레이터가 대신하는 다른 서비스의 역할 ─────────────
  // (실서버에서는 order-orchestration·mfc-capacity·delivery-dispatch 가 한다)

  /**
   * [order-orchestration → fulfillment] ConfirmOrder → WorkOrderDecision.
   * 출고마다 `<shipmentId>-PICK`(READY) + `-PACK`(WAITING). 같은 orderId·workVersion 재전달은 기존 결정을 돌려준다.
   * 재고 예약은 결제 전에 이미 잡혀 있다고 본다(S1-b) — 예약 대조(INVENTORY_MISMATCH)는 흉내 내지 않는다.
   */
  orchestrationConfirmOrder(
    req: ConfirmOrderRequest,
    temps: Map<string, TemperatureZone>,
    locations: Map<string, { code: string; name: string; barcode: string }>,
  ): WorkOrderDecision {
    return this.callSync('POST', '/internal/work-orders', 201, () => {
      const workVersion = req.workVersion ?? 1;
      const prev = [...this.workOrders.values()].find((w) => w.orderId === req.orderId);
      if (prev) {
        if (prev.decision.workVersion === workVersion) return structuredClone(prev.decision);
        throw problem(409, 'INVALID_STATE', `이미 접수된 주문(작업 버전 ${prev.decision.workVersion})`);
      }
      const fulfillmentId = this.id('FUL');
      const created = this.iso();
      const wo: WorkOrderRec = {
        fulfillmentId,
        orderId: req.orderId,
        reservationId: req.reservationId,
        shipmentIds: [],
        preparationStartedAt: null,
        decision: { fulfillmentId, orderId: req.orderId, workVersion, decision: 'ACCEPTED', shipmentIds: [], taskIds: [], decidedAt: created },
      };
      for (const s of req.shipments) {
        const pickId = `${s.shipmentId}-PICK`;
        const packId = `${s.shipmentId}-PACK`;
        const lines = (prefix: string, withLoc: boolean): TaskLine[] =>
          s.lines.map((l, i) => {
            const meta = locations.get(l.sku);
            return {
              taskLineId: `${prefix}-L${i + 1}`,
              orderLineId: l.orderLineId,
              sku: l.sku,
              productName: l.productName ?? meta?.name,
              barcode: meta?.barcode ?? null,
              locationId: withLoc ? (meta?.code ?? null) : null,
              lotId: null,
              expiresOn: null,
              plannedQty: l.qty,
              completedQty: 0,
              cancelledQty: 0,
              remainingQty: l.qty,
              pendingQty: 0,
            };
          });
        const base = (taskId: string, taskType: 'PICK' | 'PACK', state: TaskState, ls: TaskLine[]): TaskDetail => ({
          taskId,
          taskType,
          state,
          version: 0,
          mfcId: req.mfcId,
          fulfillmentId,
          shipmentId: s.shipmentId,
          assignment: { workerId: null, assignmentVersion: 0 },
          lineCount: ls.length,
          plannedQty: ls.reduce((a, l) => a + l.plannedQty, 0),
          completedQty: 0,
          remainingQty: ls.reduce((a, l) => a + l.plannedQty, 0),
          promisedReadyAt: req.promisedReadyAt ?? null,
          createdAt: created,
          lines: ls,
          blockReason: null,
          ...(taskType === 'PICK' ? { routeMethod: null } : { packingLocations: [] }),
        });
        this.tasks.set(pickId, {
          detail: base(pickId, 'PICK', 'READY', lines(pickId, true)),
          predecessorId: null,
          orderId: req.orderId,
          reservationId: req.reservationId,
          pendingShortages: [],
        });
        this.tasks.set(packId, {
          detail: base(packId, 'PACK', 'WAITING', lines(packId, false)),
          predecessorId: pickId,
          orderId: req.orderId,
          reservationId: req.reservationId,
          pendingShortages: [],
        });
        this.shipments.set(s.shipmentId, {
          shipment: {
            shipmentId: s.shipmentId,
            fulfillmentId,
            orderId: req.orderId,
            deliveryId: null,
            version: 0,
            state: 'PREPARING',
            holdReason: null,
            packages: [],
            bagCount: 0,
            weightG: s.weightG ?? 0,
            readyAt: null,
            dispatchRequest: null,
          },
          pickTaskId: pickId,
          packTaskId: packId,
          riderId: null,
          temps,
        });
        wo.shipmentIds.push(s.shipmentId);
        wo.decision.shipmentIds!.push(s.shipmentId);
        wo.decision.taskIds!.push(pickId, packId);
      }
      this.workOrders.set(fulfillmentId, wo);
      this.emit('WorkAccepted', `${req.orderId} → ${fulfillmentId} (출하 ${req.shipments.length})`);
      return structuredClone(wo.decision);
    });
  }

  /**
   * [mfc-capacity] 작업 배정 — 실서버의 수동 배정 `POST /assignments`(센터 관리자)·배정 계획 확정 자리.
   * MOCK 은 화면용 FIFO 규칙으로 바로 배정한다(OR-Tools 흉내 아님).
   */
  capacityAssign(taskId: string, workerId: string): number {
    const t = this.mustTask(taskId);
    const d = t.detail;
    if (d.state !== 'READY' && d.state !== 'ASSIGNED') throw problem(409, 'INVALID_STATE', d.state);
    d.assignment = { workerId, assignmentVersion: d.assignment.assignmentVersion + 1 };
    d.state = 'ASSIGNED';
    d.version += 1;
    this.emit('AssignmentPublished', `${taskId} → ${workerId} v${d.assignment.assignmentVersion}`);
    return d.assignment.assignmentVersion;
  }

  /**
   * [order-orchestration 결품 사가 → fulfillment] 결품 해결 CANCEL_ITEM(`POST /internal/work-orders/{id}/shortage-resolutions`, ADR-0045).
   * 고객 사전 선택 "품절 상품만 취소" 로 보고된 양을 취소한다 — PICK 행 cancelled +q, BLOCKED 는 시작자가 있으면 IN_PROGRESS,
   * 남은 집품이 0 이면 COMPLETED·포장 준비. 재고(E·R −q)는 결품 보고 때 이미 반영했다.
   * @returns 해결한 결품 건수
   */
  orchestrationResolveShortages(taskId: string): number {
    const t = this.mustTask(taskId);
    const d = t.detail;
    if (d.state !== 'BLOCKED' || t.pendingShortages.length === 0) return 0;
    return this.callSync('POST', `/internal/work-orders/${d.fulfillmentId}/shortage-resolutions`, 200, () => {
      const n = t.pendingShortages.length;
      for (const ps of t.pendingShortages) {
        const line = d.lines.find((l) => l.orderLineId === ps.orderLineId)!;
        line.cancelledQty += ps.qty;
        line.remainingQty = line.plannedQty - line.completedQty - line.cancelledQty;
        this.emit('TaskProgressed', `${taskId} ${ps.orderLineId} 결품 ${ps.qty}개 취소(품절 상품만 취소)`);
      }
      t.pendingShortages = [];
      d.remainingQty = d.lines.reduce((a, l) => a + l.remainingQty, 0);
      d.blockReason = null;
      d.state = d.activeStart ? 'IN_PROGRESS' : d.assignment.workerId ? 'ASSIGNED' : 'READY';
      d.version += 1;
      if (d.remainingQty === 0) this.finishTask(t, this.mustShipment(d.shipmentId!));
      return n;
    });
  }

  /** 결품 사가를 기다리는 PICK 작업 */
  blockedForShortage(): string[] {
    return [...this.tasks.values()].filter((t) => t.detail.state === 'BLOCKED' && t.pendingShortages.length > 0).map((t) => t.detail.taskId);
  }

  /** [delivery-dispatch] 배송 생성·라이더 배정 (DeliveryCreated·DeliveryAssigned). */
  deliveryAssign(shipmentId: string, riderId: string): string {
    const s = this.mustShipment(shipmentId);
    const deliveryId = s.shipment.deliveryId ?? this.id('DLV');
    s.shipment.deliveryId = deliveryId;
    s.riderId = riderId;
    this.emit('DeliveryAssigned', `${deliveryId} ${shipmentId} → ${riderId}`);
    return deliveryId;
  }

  private callSync<T>(method: 'GET' | 'POST', path: string, okStatus: number, fn: () => T): T {
    const rec: ApiCallRecord = { at: this.opt.now(), method, path, status: okStatus, ms: 0 };
    try {
      const v = fn();
      for (const l of this.apiListeners) l(rec);
      return v;
    } catch (e) {
      if (e instanceof ApiProblem) {
        rec.status = e.problem.status;
        rec.code = e.problem.code;
      }
      for (const l of this.apiListeners) l(rec);
      throw e;
    }
  }

  // ── 조회 투영 (화면용) ──────────────────────────────
  allTasks(): TaskDetail[] {
    return [...this.tasks.values()].map((t) => t.detail);
  }
  allShipments(): Shipment[] {
    return [...this.shipments.values()].map((s) => s.shipment);
  }
  /** 화면용 조용한 읽기(API 기록에 남기지 않음) — MOCK 화면이 실서버 화면처럼 주문을 그리려고 3초마다 읽는다(MockReader) */
  peekTasks(states: TaskState[]): TaskSummary[] {
    return [...this.tasks.values()]
      .map((t) => t.detail)
      .filter((d) => states.includes(d.state))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ lines: _l, activeStart: _a, blockReason: _b, routeMethod: _r, packingLocations: _p, pendingExecutions: _e, asOf: _o, ...summary }) => structuredClone(summary));
  }
  peekTask(taskId: string): TaskDetail {
    return structuredClone(this.mustTask(taskId).detail);
  }
  peekShipment(shipmentId: string): Shipment {
    return structuredClone(this.mustShipment(shipmentId).shipment);
  }
  riderOf(shipmentId: string): string | null {
    return this.shipments.get(shipmentId)?.riderId ?? null;
  }

  // ── FulfillmentPort (계약 API) ─────────────────────
  listTasks(mfcId: string, states: TaskState[]): Promise<TaskSummary[]> {
    const q = `?mfcId=${mfcId}${states.map((s) => `&state=${s}`).join('')}`;
    return this.call('GET', `/tasks${q}`, 200, () =>
      [...this.tasks.values()]
        .map((t) => t.detail)
        .filter((d) => d.mfcId === mfcId && states.includes(d.state))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(({ lines: _l, activeStart: _a, blockReason: _b, routeMethod: _r, packingLocations: _p, pendingExecutions: _e, asOf: _o, ...summary }) => summary),
    );
  }

  getTask(taskId: string): Promise<TaskDetail> {
    return this.call('GET', `/tasks/${taskId}`, 200, () => structuredClone(this.mustTask(taskId).detail));
  }

  startTask(
    taskId: string,
    body: { workerId: string; assignmentVersion: number; deviceId?: string },
    key: string,
    expectedVersion?: number,
  ): Promise<CommandResponse> {
    return this.call('POST', `/tasks/${taskId}/starts`, 201, () =>
      this.idempotent(`start:${taskId}`, key, body, () => {
        const t = this.mustTask(taskId);
        const d = t.detail;
        if (d.state === 'IN_PROGRESS') throw problem(409, 'ALREADY_STARTED');
        if (d.assignment.workerId !== body.workerId) throw problem(409, 'NOT_ASSIGNEE');
        if (d.assignment.assignmentVersion !== body.assignmentVersion) throw problem(409, 'VERSION_CONFLICT', 'assignmentVersion');
        if (expectedVersion !== undefined && expectedVersion !== d.version) throw problem(409, 'VERSION_CONFLICT', 'taskVersion');
        if (t.predecessorId) {
          const p = this.mustTask(t.predecessorId).detail;
          if (p.state !== 'COMPLETED') throw problem(409, 'PREDECESSOR_NOT_COMPLETED');
        }
        if (d.state !== 'ASSIGNED') throw problem(409, 'INVALID_STATE', d.state);
        d.state = 'IN_PROGRESS';
        d.version += 1;
        d.activeStart = { requestId: key, workerId: body.workerId, deviceId: body.deviceId ?? null, startedAt: this.iso() };
        this.emit('TaskProgressed', `${taskId} ${d.taskType} IN_PROGRESS (${body.workerId})`);
        if (d.taskType === 'PICK') {
          const wo = this.workOrders.get(d.fulfillmentId)!;
          if (!wo.preparationStartedAt) {
            wo.preparationStartedAt = this.iso();
            this.emit('PreparationStarted', `${wo.orderId} 상품준비 (예약 시간 변경 차단)`);
          }
        }
        return { status: 'APPLIED', requestId: key, resultId: taskId, version: d.version } satisfies CommandResponse;
      }),
    );
  }

  /**
   * 실적 등록. 0.2.0 부터 PICK·RETURN 만 — PACK 실적은 포장 밀봉으로(422 UNSUPPORTED_EXECUTION).
   * 집품은 fromLocation(선반)·toLocation(포장 위치) 필수. 결품 보고는 집품과 섞지 않은 한 줄(pickedQty 0 + shortage)이고,
   * 받으면 작업 BLOCKED + LineShortageReported — 결품 사가가 해결할 때까지 다음 실적을 받지 않는다(서버 규칙, ADR-0044).
   * 실서버는 결품 보고에 lotId 도 요구한다 — MOCK 은 LOT 이 없어 검사하지 않는다.
   */
  recordExecution(taskId: string, body: TaskExecutionRequest, key: string): Promise<CommandResponse> {
    return this.call('POST', `/tasks/${taskId}/executions`, 202, () =>
      this.idempotent(`exec:${taskId}`, key, body, () => {
        if (body.executionType !== 'PICK' && body.executionType !== 'RETURN')
          throw problem(422, 'UNSUPPORTED_EXECUTION', 'PACK 실적은 포장 밀봉(POST /shipments/{id}/packages)으로 등록합니다.');
        const t = this.mustTask(taskId);
        const d = t.detail;
        if (body.executionType !== d.taskType)
          throw problem(422, 'UNSUPPORTED_EXECUTION', `${body.executionType} 실적은 ${body.executionType} 작업에만 등록합니다.`);
        if (body.executionType === 'RETURN') throw problem(422, 'UNSUPPORTED_EXECUTION', 'MOCK 은 복귀 작업을 만들지 않는다');
        if (d.state !== 'IN_PROGRESS' && d.state !== 'ASSIGNED') throw problem(409, 'INVALID_STATE', d.state);
        if (d.assignment.workerId !== body.workerId) throw problem(409, 'NOT_ASSIGNEE');
        const sh = this.mustShipment(d.shipmentId!);
        const shortageLine = body.lines.find((l) => l.shortage);
        if (shortageLine) {
          if (body.lines.length !== 1 || shortageLine.pickedQty !== 0)
            throw problem(400, 'VALIDATION_FAILED', '결품 보고는 집품과 섞지 않고 한 줄(pickedQty 0 + shortage)로 따로 보냅니다.');
          if (!body.fromLocation) throw problem(400, 'VALIDATION_FAILED', '결품 보고는 fromLocation(발견한 선반)이 필요합니다.');
        } else if (!body.fromLocation || !body.toLocation) {
          throw problem(400, 'TO_LOCATION_REQUIRED', '집품은 fromLocation(선반)·toLocation(장바구니 또는 포장 위치)이 필요합니다.');
        }
        const shortages: TaskExecution['shortages'] = [];
        let applied = 0;
        let commitId = '';
        for (const l of body.lines) {
          const line = d.lines.find((x) => x.orderLineId === l.orderLineId);
          if (!line) throw problem(400, 'VALIDATION_FAILED', `작업에 없는 주문 줄입니다: ${l.orderLineId}`);
          const short = l.shortage?.qty ?? 0;
          if (l.pickedQty + short > line.remainingQty)
            throw problem(409, 'QTY_EXCEEDS_REMAINING', `주문 줄 ${l.orderLineId}: 집품 ${l.pickedQty} + 결품 ${short} > 남은 ${line.remainingQty}`);
          if (l.pickedQty > 0) {
            commitId = this.inventory.commitPick([{ sku: l.sku, qty: l.pickedQty }]);
            line.completedQty += l.pickedQty;
            line.remainingQty = line.plannedQty - line.completedQty - line.cancelledQty;
            applied += l.pickedQty;
          }
          if (short > 0) {
            // 재고: 판매 제외 E −q, 이 주문 예약 R −q, H 그대로(IV-09). MOCK 은 같은 SKU 다른 LOT 재확보가 없다 → 늘 BLOCKED
            commitId = this.inventory.commitShortage(t.reservationId, l.sku, short);
            shortages.push({ orderLineId: l.orderLineId, qty: short, reason: l.shortage!.reason });
            t.pendingShortages.push({ orderLineId: l.orderLineId, qty: short });
          }
        }
        if (body.toLocation && applied > 0) {
          const pack = this.mustTask(sh.packTaskId).detail;
          if (!pack.packingLocations!.includes(body.toLocation)) pack.packingLocations!.push(body.toLocation);
        }
        d.completedQty = d.lines.reduce((a, l) => a + l.completedQty, 0);
        d.remainingQty = d.lines.reduce((a, l) => a + l.remainingQty, 0);
        d.version += 1;
        const execId = this.id('EXE');
        this.executions.set(execId, {
          executionId: execId,
          taskId,
          state: 'APPLIED',
          inventoryCommitId: commitId || null,
          appliedQty: applied,
          shortages,
          recordedAt: this.iso(),
        });
        if (shortages.length > 0) {
          d.state = 'BLOCKED';
          d.blockReason = `SHORTAGE ${shortages.map((s) => `${s.orderLineId}×${s.qty} ${s.reason}`).join(', ')}`;
          this.emit('LineShortageReported', `${taskId} 결품 ${shortages.map((s) => `${s.orderLineId}×${s.qty}`).join(', ')} → 결품 사가 대기`);
        } else if (d.remainingQty === 0) this.finishTask(t, sh);
        return { status: 'ACCEPTED', requestId: key, resultId: execId, version: d.version, nextAction: 'QUERY_RESULT' } satisfies CommandResponse;
      }),
    );
  }

  /** PICK 다 집음 → COMPLETED, 같은 출고 PACK 준비(releasePack: 담당 있으면 ASSIGNED, 없으면 READY). PACK 은 밀봉으로 끝난다. */
  private finishTask(t: TaskRec, sh: ShipmentRec) {
    const d = t.detail;
    d.state = 'COMPLETED';
    d.activeStart = undefined;
    this.emit('TaskProgressed', `${d.taskId} ${d.taskType} ${d.state}`);
    if (d.taskType !== 'PICK') return;
    const pack = this.mustTask(sh.packTaskId).detail;
    for (const pl of pack.lines) {
      const src = d.lines.find((l) => l.orderLineId === pl.orderLineId)!;
      pl.cancelledQty = src.cancelledQty;
      pl.remainingQty = pl.plannedQty - pl.completedQty - pl.cancelledQty;
    }
    pack.remainingQty = pack.lines.reduce((a, l) => a + l.remainingQty, 0);
    pack.version += 1;
    if (pack.remainingQty === 0) {
      // 전량 결품 — 포장할 것이 없다
      pack.state = 'CANCELLED';
      sh.shipment.state = 'CANCELLED';
      sh.shipment.holdReason = 'ALL_LINES_SHORT';
      this.emit('TaskProgressed', `${pack.taskId} PACK CANCELLED (전량 결품)`);
    } else {
      pack.state = pack.assignment.workerId ? 'ASSIGNED' : 'READY';
      this.emit('TaskProgressed', `${pack.taskId} PACK ${pack.state} (포장 준비)`);
    }
  }

  getExecution(taskId: string, executionId: string): Promise<TaskExecution> {
    return this.call('GET', `/tasks/${taskId}/executions/${executionId}`, 200, () => {
      const e = this.executions.get(executionId);
      if (!e || e.taskId !== taskId) throw problem(404, 'NOT_FOUND');
      return structuredClone(e);
    });
  }

  getShipment(shipmentId: string): Promise<Shipment> {
    return this.call('GET', `/shipments/${shipmentId}`, 200, () => structuredClone(this.mustShipment(shipmentId).shipment));
  }

  /**
   * 배차 요청(fulfillment 0.4.11, BR-51) — 점원 요청(MANUAL)만. 출고당 한 번 — 이미 있으면 그 요청을 돌려준다.
   * PACK 이 시작됐거나 출고 READY 여야(아니면 409 INVALID_STATE). 예상 포장 분 1~180.
   */
  requestDispatch(shipmentId: string, estimatedPackMinutes: number, key: string): Promise<DispatchRequest> {
    return this.call('POST', `/shipments/${shipmentId}/dispatch-requests`, 201, () =>
      this.idempotent('dispatch', key, { shipmentId, estimatedPackMinutes }, () => {
        const sh = this.mustShipment(shipmentId);
        if (sh.shipment.dispatchRequest) return structuredClone(sh.shipment.dispatchRequest);
        if (!Number.isInteger(estimatedPackMinutes) || estimatedPackMinutes < 1 || estimatedPackMinutes > 180)
          throw problem(400, 'VALIDATION_FAILED', 'estimatedPackMinutes 는 1~180 입니다.');
        const packStarted = [...this.tasks.values()].some((t) => t.detail.shipmentId === shipmentId && t.detail.taskType === 'PACK' && t.detail.state !== 'WAITING' && t.detail.state !== 'READY' && t.detail.state !== 'ASSIGNED');
        if (!packStarted && sh.shipment.state !== 'READY') throw problem(409, 'INVALID_STATE', 'PACK 이 시작됐거나 출고가 READY 여야 합니다.');
        const now = this.iso();
        const req: DispatchRequest = {
          shipmentId,
          trigger: 'MANUAL',
          estimatedPackMinutes,
          estimatedReadyAt: this.iso(this.opt.now() + estimatedPackMinutes * 60),
          requestedAt: now,
        };
        sh.shipment.dispatchRequest = req;
        sh.shipment.version++;
        return structuredClone(req);
      }),
    );
  }

  /**
   * 포장 밀봉 = PACK 실적. 그 PACK 을 시작한 작업자만(IN_PROGRESS). 남은 포장량 = 집품 완료 − 포장 완료.
   * 재고 PACK(PICKED → PACKED, H/E/R 불변) → SEALED·QR. 다 포장하면 PACK COMPLETED·출고 READY·PackingFinished·ShipmentReady.
   */
  sealPackage(shipmentId: string, body: SealPackageRequest, key: string): Promise<Package> {
    return this.call('POST', `/shipments/${shipmentId}/packages`, 201, () =>
      this.idempotent(`seal:${shipmentId}`, key, body, () => {
        const sh = this.mustShipment(shipmentId);
        const s = sh.shipment;
        if (s.state === 'CANCELLED' || s.state === 'HANDED_OVER') throw problem(409, 'INVALID_STATE', s.state);
        const pack = this.mustTask(sh.packTaskId).detail;
        if (pack.state !== 'IN_PROGRESS') throw problem(409, 'INVALID_STATE', `포장 작업은 ${pack.state} 상태입니다(시작한 포장 작업만 밀봉).`);
        if (body.packedBy && pack.activeStart?.workerId !== body.packedBy)
          throw problem(409, 'NOT_ASSIGNEE', '이 포장 작업을 시작한 작업자가 아닙니다.');
        const pick = this.mustTask(sh.pickTaskId).detail;
        const want = new Map<string, number>();
        for (const c of body.contents) want.set(c.orderLineId, (want.get(c.orderLineId) ?? 0) + c.qty);
        for (const [ol, q] of want) {
          const picked = pick.lines.find((l) => l.orderLineId === ol)?.completedQty ?? 0;
          const packed = pack.lines.find((l) => l.orderLineId === ol)?.completedQty ?? 0;
          if (q > picked - packed) throw problem(409, 'CONTENT_MISMATCH', `주문 줄 ${ol}: 포장 ${q} > 포장할 수 있는 ${picked - packed}`);
        }
        const locs = pack.packingLocations ?? [];
        if (!body.packingLocation && locs.length !== 1)
          throw problem(400, 'VALIDATION_FAILED', `packingLocation 이 필요합니다(집품분 포장 위치 ${JSON.stringify(locs)}).`);
        if (body.packingLocation && !locs.includes(body.packingLocation))
          throw problem(400, 'VALIDATION_FAILED', `${body.packingLocation} 에 집품분이 없습니다(집품분 포장 위치 ${JSON.stringify(locs)}).`);
        this.inventory.commitPack(body.contents.map((c) => ({ sku: c.sku, qty: c.qty })));
        for (const [ol, q] of want) {
          const line = pack.lines.find((l) => l.orderLineId === ol)!;
          line.completedQty += q;
          line.remainingQty = line.plannedQty - line.completedQty - line.cancelledQty;
        }
        pack.completedQty = pack.lines.reduce((a, l) => a + l.completedQty, 0);
        pack.remainingQty = pack.lines.reduce((a, l) => a + l.remainingQty, 0);
        pack.version += 1;
        const packageId = this.id('PKG');
        // 라벨 번호(2~4자리, R-26 제안) — 센터에서 인계 기다리는 포장끼리 겹치지 않게
        const taken = new Set<string>();
        for (const { pkg: o } of this.packages.values()) if (o.state === 'SEALED' && o.handoverCode) taken.add(o.handoverCode);
        const pkg: Package = {
          packageId,
          packageVersion: 1,
          shipmentId,
          orderId: s.orderId,
          version: 0,
          state: 'SEALED',
          qrCode: `${packageId}:1`,
          handoverCode: shortHandoverCode(taken, () => this.codeRng.next(), HANDOVER_CODE),
          contents: structuredClone(body.contents) as PackageContentLine[],
          bagCount: body.bagCount,
          containsAlcohol: body.containsAlcohol ?? false,
          temperatureZone: body.temperatureZone ?? 'AMBIENT',
          weightG: body.weightG ?? 0,
          fence: { state: 'NONE', handoverAuthorizationId: null, fenceVersion: 0, riderId: null, expiresAt: null },
          sealedAt: this.iso(),
          handedOverAt: null,
          invalidatedReason: null,
        };
        this.packages.set(packageId, { pkg, shipmentId });
        s.packages.push(pkg);
        s.bagCount += body.bagCount;
        s.version += 1;
        if (pack.remainingQty === 0) {
          pack.state = 'COMPLETED';
          pack.activeStart = undefined;
          this.emit('TaskProgressed', `${pack.taskId} PACK COMPLETED`);
          this.emit('PackingFinished', `${shipmentId} 패킹 완료 ${pack.completedQty}개`);
          s.state = 'READY';
          s.readyAt = this.iso();
          this.emit('ShipmentReady', `${shipmentId} 포장 ${s.packages.length}개 · 봉투 ${s.bagCount} · ${s.weightG}g`);
        }
        return structuredClone(pkg);
      }),
    );
  }

  authorizeHandover(
    packageId: string,
    body: { riderId: string; deliveryId: string; scannedCode: string; scannedAt?: string },
    key: string,
  ): Promise<HandoverAuthorization> {
    return this.call('POST', `/packages/${packageId}/handover-authorizations`, 201, () =>
      this.idempotent(`auth:${packageId}`, key, body, () => this.authorizeCore(packageId, body)),
    );
  }

  /**
   * 라벨 번호로 인계 허가(F-8·fulfillment 0.23.0 흉내 — 4자리, R-26). 그 배송 출고에서 번호가 같은 SEALED 포장 → QR 허가와 같은 검사·fence.
   * 없으면 409 HANDOVER_CODE_MISMATCH(틀린 횟수 셈), 둘 이상 409 HANDOVER_CODE_AMBIGUOUS, failLimit 번 틀리면 409 HANDOVER_CODE_LOCKED [시뮬].
   */
  authorizeHandoverByCode(body: { riderId: string; deliveryId: string; handoverCode: string }, key: string): Promise<HandoverAuthorization> {
    return this.call('POST', '/packages/handover-code-authorizations', 201, () =>
      this.idempotent(`authcode:${body.riderId}`, key, body, () => {
        if (!handoverCodeValid(body.handoverCode, HANDOVER_CODE)) throw problem(400, 'VALIDATION_FAILED', `번호 ${HANDOVER_CODE.minLen}~${HANDOVER_CODE.maxLen}자리`);
        const fk = `${body.riderId}|${body.deliveryId}`;
        if ((this.codeFails.get(fk) ?? 0) >= HANDOVER_CODE.failLimit) throw problem(409, 'HANDOVER_CODE_LOCKED', 'QR 또는 직원 확인으로');
        const sh = [...this.shipments.values()].find((r) => r.shipment.deliveryId === body.deliveryId);
        if (!sh) throw problem(409, 'DELIVERY_MISMATCH');
        const hit = sh.shipment.packages.filter((p) => p.state === 'SEALED' && p.handoverCode === body.handoverCode);
        if (hit.length === 0) {
          const n = (this.codeFails.get(fk) ?? 0) + 1;
          this.codeFails.set(fk, n);
          // 0.23.0: 남은 횟수를 details 로 — 5번째 틀림부터 잠금
          throw problem(409, 'HANDOVER_CODE_MISMATCH', undefined, false, [{ field: 'attemptsLeft', reason: String(Math.max(0, HANDOVER_CODE.failLimit - n)) }]);
        }
        if (hit.length > 1) throw problem(409, 'HANDOVER_CODE_AMBIGUOUS', 'QR 로');
        this.codeFails.delete(fk);
        return this.authorizeCore(hit[0].packageId, { riderId: body.riderId, deliveryId: body.deliveryId, scannedCode: hit[0].qrCode });
      }),
    );
  }

  private authorizeCore(packageId: string, body: { riderId: string; deliveryId: string; scannedCode: string }): HandoverAuthorization {
    {
      {
        const rec = this.packages.get(packageId);
        if (!rec) throw problem(404, 'NOT_FOUND');
        const { pkg, shipmentId } = rec;
        const sh = this.mustShipment(shipmentId);
        if (pkg.state === 'HANDED_OVER') throw problem(409, 'ALREADY_HANDED_OVER');
        if (pkg.state === 'INVALIDATED' || body.scannedCode !== pkg.qrCode) throw problem(409, 'PACKAGE_INVALIDATED');
        if (pkg.state !== 'SEALED') throw problem(409, 'INVALID_STATE', pkg.state);
        if (sh.shipment.deliveryId !== body.deliveryId) throw problem(409, 'DELIVERY_MISMATCH');
        if (sh.riderId !== body.riderId) throw problem(403, 'FORBIDDEN', '배정 라이더 불일치');
        const now = this.opt.now();
        if (pkg.fence.state === 'HANDOVER_IN_PROGRESS' && pkg.fence.expiresAt && this.secOf(pkg.fence.expiresAt) > now) {
          throw problem(409, 'FENCE_ACTIVE');
        }
        const authId = this.id('HAU');
        pkg.fence = {
          state: 'HANDOVER_IN_PROGRESS',
          handoverAuthorizationId: authId,
          fenceVersion: pkg.fence.fenceVersion + 1,
          riderId: body.riderId,
          expiresAt: this.iso(now + this.opt.fenceTtlSec),
        };
        pkg.version += 1;
        return {
          handoverAuthorizationId: authId,
          packageId,
          packageVersion: pkg.packageVersion,
          fenceVersion: pkg.fence.fenceVersion,
          riderId: body.riderId,
          deliveryId: body.deliveryId,
          fenceExpiresAt: pkg.fence.expiresAt!,
          authorizedAt: this.iso(now),
        } satisfies HandoverAuthorization;
      }
    }
  }

  commitHandover(
    packageId: string,
    body: { handoverAuthorizationId: string; fenceVersion: number; riderId: string; handedOverAt?: string },
    key: string,
  ): Promise<HandoverCommitResult> {
    return this.call('POST', `/packages/${packageId}/handover-commits`, 201, () =>
      this.idempotent(`commit:${packageId}`, key, body, () => {
        const rec = this.packages.get(packageId);
        if (!rec) throw problem(404, 'NOT_FOUND');
        const { pkg, shipmentId } = rec;
        const sh = this.mustShipment(shipmentId);
        if (pkg.state === 'HANDED_OVER') throw problem(409, 'ALREADY_HANDED_OVER');
        const f = pkg.fence;
        if (f.state !== 'HANDOVER_IN_PROGRESS' || !f.expiresAt || this.secOf(f.expiresAt) <= this.opt.now())
          throw problem(409, 'INVALID_STATE', 'fence 없음·만료');
        if (f.handoverAuthorizationId !== body.handoverAuthorizationId || f.fenceVersion !== body.fenceVersion)
          throw problem(409, 'FENCE_VERSION_MISMATCH');
        const wo = this.workOrders.get(sh.shipment.fulfillmentId)!;
        const commitId = this.inventory.commitHandover(
          wo.reservationId,
          pkg.contents.map((c) => ({ sku: c.sku, qty: c.qty })),
        );
        const at = this.iso();
        pkg.state = 'HANDED_OVER';
        pkg.handedOverAt = at;
        pkg.fence = { ...f, state: 'COMMITTED' };
        pkg.version += 1;
        const s = sh.shipment;
        const all = s.packages.every((p) => p.state === 'HANDED_OVER' || p.packageId === packageId);
        // s.packages 는 sealPackage 때의 사본이 아닌 같은 객체이므로 상태가 함께 바뀐다
        s.state = all ? 'HANDED_OVER' : 'PARTIALLY_HANDED_OVER';
        s.version += 1;
        this.emit('PackageHandedOver', `${packageId} → ${body.riderId} (재고 ${commitId}: H·E·R −${pkg.contents.reduce((a, c) => a + c.qty, 0)})`);
        return {
          status: 'APPLIED',
          requestId: key,
          handoverId: this.id('HOV'),
          inventoryCommitId: commitId,
          packageState: pkg.state,
          shipmentState: s.state,
          handedOverAt: at,
        } satisfies HandoverCommitResult;
      }),
    );
  }

  // ── mfc-inbound: 입고 예정·도착·수령 / 적치·보충 ─────────
  private readonly promises = new Map<string, { trfId: string; state: 'EXPECTED' | 'RECEIVING' | 'TIN_POSTED'; lines: { sku: string; qty: number }[] }>();

  /** [replenishment·CDC·TMS] 승인 이관이 출발해 입고 예정이 생긴다 (TransferDeparted → InboundPromise EXPECTED). */
  inboundExpect(trfId: string, lines: { sku: string; qty: number }[]) {
    this.promises.set(trfId, { trfId, state: 'EXPECTED', lines });
    this.emit('TransferDeparted', `${trfId} (가상 CDC 출발) → 입고 예정 ${lines.length}품목 ${lines.reduce((a, l) => a + l.qty, 0)}개`);
  }

  recordArrival(trfId: string, body: { recordedBy: string; tripId?: string }, key: string): Promise<CommandResponse> {
    return this.call('POST', `/inbound-promises/${trfId}/arrivals`, 202, () =>
      this.idempotent(`arr:${trfId}`, key, body, () => {
        const p = this.promises.get(trfId);
        if (!p) throw problem(404, 'NOT_FOUND', trfId);
        if (p.state !== 'EXPECTED') throw problem(409, 'INVALID_STATE', p.state);
        p.state = 'RECEIVING';
        this.emit('InboundArrivalRecorded', `${trfId} 차량 도착·하차 시작 (${body.recordedBy})`);
        return { status: 'ACCEPTED', requestId: key, resultId: trfId } satisfies CommandResponse;
      }),
    );
  }

  /** 수령 등록 → ConfirmReceipt(TIN): H+q, E+q, 미적치(UNSTOWED)+q. */
  recordReceipt(
    trfId: string,
    body: { receivedBy: string; lines: { sku: string; normalQty: number; quarantinedQty: number; pendingQty: number; toLocationCode?: string }[] },
    key: string,
  ): Promise<CommandResponse> {
    return this.call('POST', `/inbound-promises/${trfId}/receipts`, 202, () =>
      this.idempotent(`rcp:${trfId}`, key, body, () => {
        const p = this.promises.get(trfId);
        if (!p) throw problem(404, 'NOT_FOUND', trfId);
        if (p.state !== 'RECEIVING') throw problem(409, 'INVALID_STATE', p.state);
        const commitId = this.inventory.receipt(body.lines.map((l) => ({ sku: l.sku, qty: l.normalQty })));
        p.state = 'TIN_POSTED';
        const receiptId = this.id('RCP');
        this.emit('MfcReceiptPosted', `${trfId} ${receiptId} TIN 전기 H+${body.lines.reduce((a, l) => a + l.normalQty, 0)} (${commitId}) — 적치 대기`);
        return { status: 'APPLIED', requestId: key, resultId: receiptId } satisfies CommandResponse;
      }),
    );
  }

  /**
   * 적치(PUTAWAY)·보충 이동(MOVE). mfc-inbound 계약에는 현장 단말용 적치 작업 API 가 없어
   * mfc-inventory 내부 경로(CommitTaskExecution)로 기록한다 — backend-requests R-10.
   */
  commitStock(
    taskId: string,
    body: { executionType: 'PUTAWAY' | 'MOVE'; sku: string; qty: number; to: 'shelf' | 'reserve'; fromLocation?: string; toLocation: string },
    key: string,
  ): Promise<CommandResponse> {
    return this.call(
      'POST',
      '/internal/task-executions',
      201,
      () =>
        this.idempotent(`stock:${taskId}`, key, body, () => {
          const commitId =
            body.executionType === 'PUTAWAY' ? this.inventory.putaway(body.sku, body.qty, body.to) : this.inventory.move(body.sku, body.qty);
          this.emit(
            'InventoryExecutionApplied',
            `${body.executionType} ${body.sku} ×${body.qty} → ${body.toLocation}${body.to === 'reserve' ? ' (보충재고)' : ''}`,
          );
          return { status: 'APPLIED', requestId: key, resultId: commitId } satisfies CommandResponse;
        }),
      `${body.executionType} · 계약 공백 R-10`,
    );
  }

  private mustTask(taskId: string): TaskRec {
    const t = this.tasks.get(taskId);
    if (!t) throw problem(404, 'NOT_FOUND', taskId);
    return t;
  }
  private mustShipment(shipmentId: string): ShipmentRec {
    const s = this.shipments.get(shipmentId);
    if (!s) throw problem(404, 'NOT_FOUND', shipmentId);
    return s;
  }
}
