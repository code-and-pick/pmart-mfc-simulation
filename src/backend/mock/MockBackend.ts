// 계약(mfc-fulfillment-service.yaml)의 의미를 브라우저 안에서 흉내 내는 백엔드.
// pmart-backend 슬라이스 6(이행)이 아직 501 이라, 실서버와 같은 규칙으로 화면·흐름을 먼저 검증하기 위한 것이다.
// 여기서 정한 값(fence 유효시간 등)은 계약이 정하지 않은 시뮬 값이며 실서버 동작을 대신하지 않는다.

import {
  ApiProblem,
  type CommandResponse,
  type ConfirmOrderRequest,
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
} from '../../domain/contract';
import type { ApiCallRecord, ApiListener, DomainEventRecord, EventListener, FulfillmentPort } from '../port';
import { InventoryError, InventoryLedger } from './inventory';

interface TaskRec {
  detail: TaskDetail;
  predecessorId: string | null;
  orderId: string;
  reservationId: string;
}

interface WorkOrderRec {
  fulfillmentId: string;
  orderId: string;
  reservationId: string;
  shipmentIds: string[];
  preparationStartedAt: string | null;
}

interface ShipmentRec {
  shipment: Shipment;
  pickTaskId: string;
  packTaskId: string;
  riderId: string | null;
  packedQty: Map<string, number>; // orderLineId → 패킹 완료 수량
  sealedQty: Map<string, number>;
  temps: Map<string, TemperatureZone>; // sku → 온도대
}

interface IdemEntry {
  body: string;
  outcome: { ok: true; value: unknown } | { ok: false; problem: ApiProblem };
}

const problem = (status: number, code: string, detail?: string, retryable = false) =>
  new ApiProblem({ status, code, detail, retryable });

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

  /** [order-orchestration → fulfillment] ConfirmOrder. 재고 예약은 결제 전에 이미 잡혀 있다고 본다(S1-b). */
  orchestrationConfirmOrder(req: ConfirmOrderRequest, temps: Map<string, TemperatureZone>, locations: Map<string, { code: string; name: string; barcode: string }>): string {
    return this.callSync('POST', '/internal/work-orders', 201, () => {
      const fulfillmentId = this.id('FUL');
      const wo: WorkOrderRec = {
        fulfillmentId,
        orderId: req.orderId,
        reservationId: req.reservationId,
        shipmentIds: [],
        preparationStartedAt: null,
      };
      const created = this.iso();
      for (const s of req.shipments) {
        const pickId = this.id('TSK');
        const packId = this.id('TSK');
        const lines = (prefix: string, withLoc: boolean): TaskLine[] =>
          s.lines.map((l, i) => {
            const meta = locations.get(l.sku);
            return {
              taskLineId: `${prefix}-L${i + 1}`,
              orderLineId: l.orderLineId,
              sku: l.sku,
              productName: meta?.name,
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
        });
        this.tasks.set(pickId, {
          detail: base(pickId, 'PICK', 'READY', lines(pickId, true)),
          predecessorId: null,
          orderId: req.orderId,
          reservationId: req.reservationId,
        });
        this.tasks.set(packId, {
          detail: base(packId, 'PACK', 'WAITING', lines(packId, false)),
          predecessorId: pickId,
          orderId: req.orderId,
          reservationId: req.reservationId,
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
          },
          pickTaskId: pickId,
          packTaskId: packId,
          riderId: null,
          packedQty: new Map(),
          sealedQty: new Map(),
          temps,
        });
        wo.shipmentIds.push(s.shipmentId);
      }
      this.workOrders.set(fulfillmentId, wo);
      this.emit('WorkAccepted', `${req.orderId} → ${fulfillmentId} (출하 ${req.shipments.length})`);
      return fulfillmentId;
    });
  }

  /** [mfc-capacity] 작업 배정. 계약에는 OR-Tools 계획(/assignment-plans)만 있고 수동 배정 API 는 없다(요청 사항). */
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
        .map(({ lines: _l, activeStart: _a, blockReason: _b, ...summary }) => summary),
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
          if (p.state !== 'COMPLETED' && p.state !== 'CLOSED_PARTIAL') throw problem(409, 'PREDECESSOR_NOT_COMPLETED');
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
        return { status: 'APPLIED', resultId: taskId, version: d.version } satisfies CommandResponse;
      }),
    );
  }

  recordExecution(taskId: string, body: TaskExecutionRequest, key: string): Promise<CommandResponse> {
    return this.call('POST', `/tasks/${taskId}/executions`, 202, () =>
      this.idempotent(`exec:${taskId}`, key, body, () => {
        const t = this.mustTask(taskId);
        const d = t.detail;
        if (d.state !== 'IN_PROGRESS' && d.state !== 'ASSIGNED') throw problem(409, 'INVALID_STATE', d.state);
        if (d.assignment.workerId !== body.workerId) throw problem(409, 'NOT_ASSIGNEE');
        const sh = this.mustShipment(d.shipmentId!);
        const shortages: TaskExecution['shortages'] = [];
        let applied = 0;
        let commitId = '';
        for (const l of body.lines) {
          const line = d.lines.find((x) => x.orderLineId === l.orderLineId);
          if (!line) throw problem(400, 'VALIDATION_FAILED', `행 없음 ${l.orderLineId}`);
          const short = l.shortage?.qty ?? 0;
          if (l.pickedQty + short > line.remainingQty) throw problem(409, 'INVALID_STATE', '실적이 잔량을 넘는다(WK-03)');
          if (body.executionType === 'PICK') {
            if (l.pickedQty > 0) commitId = this.inventory.commitPick([{ sku: l.sku, qty: l.pickedQty }]);
            if (short > 0) {
              commitId = this.inventory.commitShortage(t.reservationId, l.sku, short);
              shortages.push({ orderLineId: l.orderLineId, qty: short, reason: l.shortage!.reason });
            }
          } else {
            if (l.pickedQty > 0) commitId = this.inventory.commitPack([{ sku: l.sku, qty: l.pickedQty }]);
            sh.packedQty.set(l.orderLineId, (sh.packedQty.get(l.orderLineId) ?? 0) + l.pickedQty);
          }
          line.completedQty += l.pickedQty;
          line.cancelledQty += short;
          line.remainingQty = line.plannedQty - line.completedQty - line.cancelledQty;
          applied += l.pickedQty;
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
          this.emit('LineShortageReported', `${taskId} 결품 ${shortages.map((s) => `${s.orderLineId}×${s.qty}`).join(', ')} → 품절 상품만 취소`);
        }
        if (d.remainingQty === 0) this.finishTask(t, sh);
        return { status: 'ACCEPTED', resultId: execId, version: d.version, nextAction: 'QUERY_RESULT' } satisfies CommandResponse;
      }),
    );
  }

  private finishTask(t: TaskRec, sh: ShipmentRec) {
    const d = t.detail;
    const anyCancelled = d.lines.some((l) => l.cancelledQty > 0);
    d.state = anyCancelled ? 'CLOSED_PARTIAL' : 'COMPLETED';
    d.activeStart = undefined;
    this.emit('TaskProgressed', `${d.taskId} ${d.taskType} ${d.state}`);
    if (d.taskType === 'PICK') {
      const pack = this.mustTask(sh.packTaskId).detail;
      for (const pl of pack.lines) {
        const src = d.lines.find((l) => l.orderLineId === pl.orderLineId)!;
        pl.plannedQty = src.completedQty;
        pl.remainingQty = src.completedQty;
      }
      pack.lines = pack.lines.filter((l) => l.plannedQty > 0);
      pack.lineCount = pack.lines.length;
      pack.plannedQty = pack.remainingQty = pack.lines.reduce((a, l) => a + l.plannedQty, 0);
      pack.version += 1;
      if (pack.plannedQty === 0) {
        pack.state = 'CANCELLED';
        sh.shipment.state = 'CANCELLED';
        sh.shipment.holdReason = 'ALL_LINES_SHORT';
        this.emit('TaskProgressed', `${pack.taskId} PACK CANCELLED (전량 결품)`);
      } else {
        // 피킹·패킹 같은 작업자(MFC 1장 운영 원칙) — 배정은 시뮬레이터 디스패처가 이어서 한다
        pack.state = 'READY';
      }
    } else {
      this.emit('PackingFinished', `${d.shipmentId} 패킹 완료 ${d.completedQty}개`);
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

  sealPackage(shipmentId: string, body: SealPackageRequest, key: string): Promise<Package> {
    return this.call('POST', `/shipments/${shipmentId}/packages`, 201, () =>
      this.idempotent(`seal:${shipmentId}`, key, body, () => {
        const sh = this.mustShipment(shipmentId);
        const s = sh.shipment;
        if (s.state === 'CANCELLED' || s.state === 'HANDED_OVER') throw problem(409, 'INVALID_STATE', s.state);
        for (const c of body.contents) {
          const packed = sh.packedQty.get(c.orderLineId) ?? 0;
          const sealed = sh.sealedQty.get(c.orderLineId) ?? 0;
          if (sealed + c.qty > packed) throw problem(409, 'CONTENT_MISMATCH', `${c.orderLineId} 패킹 완료 수량 초과`);
        }
        for (const c of body.contents) sh.sealedQty.set(c.orderLineId, (sh.sealedQty.get(c.orderLineId) ?? 0) + c.qty);
        const packageId = this.id('PKG');
        const pkg: Package = {
          packageId,
          packageVersion: 1,
          shipmentId,
          orderId: s.orderId,
          version: 0,
          state: 'SEALED',
          qrCode: `${packageId}:1`,
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
        const totalPacked = [...sh.packedQty.values()].reduce((a, b) => a + b, 0);
        const totalSealed = [...sh.sealedQty.values()].reduce((a, b) => a + b, 0);
        const packDone = this.mustTask(sh.packTaskId).detail.state === 'COMPLETED';
        if (packDone && totalSealed === totalPacked) {
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
      this.idempotent(`auth:${packageId}`, key, body, () => {
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
      }),
    );
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
        return { status: 'ACCEPTED', resultId: trfId } satisfies CommandResponse;
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
        return { status: 'APPLIED', resultId: receiptId } satisfies CommandResponse;
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
          return { status: 'APPLIED', resultId: commitId } satisfies CommandResponse;
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
