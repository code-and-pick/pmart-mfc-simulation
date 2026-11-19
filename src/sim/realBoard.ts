// 실서버 관찰: MFC 센터의 실제 작업(고객 앱 주문 → PICK·PACK, PDA 작업자의 진행)을 주기 조회로 읽어 들고 있는다.
// 쓰기는 하지 않는다 — 재고·작업을 바꾸지 않는다(사용자 2026-11-16 "일단 실제 주문만 연결").
// 근거: SIM-5(주기 조회, 3초), SIM-2a(PDA 작업자는 서버 기록으로 추적). 서버가 준 상태만 그린다 — 목록에서 빠진 작업은
// 상세를 다시 읽어 확정된 최종 상태를 받기 전까지 "확인 중"으로 둔다.

import { ApiProblem } from '../domain/contract';
import type {
  OrderFulfillmentView,
  EmployeeLabel,
  ReturnHandover,
  TaskLine,
  TaskPick,
  CapacityWorker,
  CenterStock,
  CenterShipment,
  StockUnitRow,
  DeliveryOrderSummary,
  DeliveryDispatch,
  DispatchState,
  ExecutionState,
  Shipment,
  SkuBarcodes,
  StaffDeliverySummary,
  StockQualityState,
  StockWorkState,
  TaskDetail,
  TaskState,
  TaskSummary,
} from '../domain/contract';

export interface RealReader {
  listTasks(mfcId: string, states: TaskState[]): Promise<TaskSummary[]>;
  getTask(taskId: string): Promise<TaskDetail>;
  listWorkers(mfcId: string): Promise<CapacityWorker[]>;
  getCenterStock(mfcId: string, sku: string): Promise<CenterStock>;
  getShipment(shipmentId: string): Promise<Shipment>;
  searchDeliveries(mfcId: string, size?: number): Promise<StaffDeliverySummary[]>;
  getDeliveryDispatch(deliveryId: string): Promise<DeliveryDispatch>;
  getSku(sku: string): Promise<SkuBarcodes>;
  /** (hr 0.8.0) 운영자 ID → 이름·사번(ADR-0070 "이름 · 사번") — 없으면 capacity displayName 만 */
  getEmployeeLabels?(operatorIds: string[]): Promise<EmployeeLabel[]>;
  /** (delivery-execution 0.28.0) MFC 반납 인증번호 — 없으면 화면이 보이지 않는다 */
  listReturnHandovers?(mfcId: string): Promise<ReturnHandover[]>;
  /** (fulfillment 0.10.0) 없으면 화면이 현장 기록을 보이지 않는다 */
  getOrderFulfillment?(orderId: string): Promise<OrderFulfillmentView>;
  /** (inventory 0.33.0, R-15) 센터 전체 재고 단위 행 */
  listAllStockUnits?(mfcId: string, maxPages: number): Promise<StockUnitRow[]>;
  /** (center-master) 센터 이름 — 화면에 MFC ID 대신 */
  getCenterName?(centerId: string): Promise<string | null>;
  /** (fulfillment 0.15.0) 센터 출고 목록 — 피킹·패킹 시작 시각 */
  listCenterShipments?(mfcId: string): Promise<CenterShipment[]>;
  /** (delivery-execution) 배송 상세의 주문 요약 — 품목·금액·배송 요청사항 */
  getDeliveryOrderSummary?(deliveryId: string): Promise<DeliveryOrderSummary | null>;
}

export interface RealBoardOptions {
  pollSec: number;
  workerRefreshSec: number;
  recentKeepSec: number;
  openStates: readonly TaskState[];
  /** 한 번 조회에서 상세를 새로 읽는 최대 건수 (게이트웨이 부담 상한) */
  maxDetailPerPoll?: number;
  /** 작업이 안 바뀌어도 재고를 다시 읽는 간격(초) */
  stockRefreshSec: number;
  /** 한 번 조회에서 재고를 새로 읽는 최대 SKU 수 */
  maxStockPerPoll: number;
  /** 인계 전 출고(출고·배차 상태)를 작업이 안 바뀌어도 다시 읽는 간격(초) */
  shipmentRefreshSec: number;
  /** 한 번 조회에서 출고·배차 상세를 새로 읽는 최대 건수(각각) */
  maxShipmentPerPoll: number;
  /** 작업이 끝난 뒤에도 인계 전 출고를 화면에 두는 최대 시간(초) */
  handoverKeepSec: number;
  /** 회수 배송을 찾는 간격(초). 없으면 배차 요청된 출고가 있을 때만(그 배송 찾기 결과로) */
  returnPickupRefreshSec?: number;
  /** 반납된 회수 배송을 두는 시간(분). 없으면 60 */
  returnShownMin?: number;
  /**
   * 화면을 연 뒤 첫 조회 때, 이만큼(초) 안에 만든 끝난 작업(COMPLETED) 중 출고가 아직 인계 전(출하 대기 등)인 것을 한 번 불러 둔다.
   * 열린 작업만 주기 조회하므로, 새로고침 전에 포장까지 끝난 주문이 배차·라이더 단계에서 화면에서 빠지지 않게. 없으면 안 함
   */
  backfillSec?: number;
}

/** 실서버 재고 단위 행(주문에 나온 SKU 만) */
export interface RealStockUnit {
  sku: string;
  locationCode: string;
  workState: StockWorkState;
  qualityState: StockQualityState;
  qty: number;
}

/** 한 번 본 피킹 조각 — 서버는 다 집은 조각을 상세 picks 에서 뺀다(TaskService.detail remaining <= 0 건너뜀). 패킹까지 바코드를 보이려고 든다 */
export interface SeenPick {
  line: TaskLine;
  pick: TaskPick;
  /** 지시 칸(배정 칸 → 첫 칸 → 줄 지시 칸) */
  loc: string | null;
  /** 지금 상세에 없음 = 다 집음(또는 취소) */
  gone: boolean;
}

/** 목록 요약의 진행 서명 — version(상태 전이) + 완료·남은 수량 + 마지막 실적 시각(부분 집품마다 바뀜) */
export function progressSig(s: TaskSummary): string {
  return `${s.version}:${s.completedQty}:${s.remainingQty}:${s.lastActivityAt ?? ''}`;
}

export interface RealTask {
  summary: TaskSummary;
  /** 열린 작업의 상세(줄의 SKU, PICK·RETURN 지시 칸). 목록의 진행 서명(progressSig)이 바뀌면 다시 읽는다 */
  detail: TaskDetail | null;
  /** 상세를 읽을 때의 목록 진행 서명 */
  detailSig?: string;
  firstSeenMs: number;
  /** 열린 목록에서 빠진 뒤: 상세로 확인한 최종 상태. 확인 전이면 checking */
  closed: null | { atMs: number; state: TaskState | 'CHECKING' };
}

export interface RealShipment {
  shipmentId: string;
  fulfillmentId: string;
  pick?: RealTask;
  pack?: RealTask;
  ret?: RealTask;
  createdAt: string;
  /** GET /shipments/{id} — 출고 상태·배차 요청·포장 */
  info?: Shipment;
  /** 배송 찾기(GET /deliveries?mfcId=)에서 이 출고의 배송(정방향·재발송) — 수행 상태 */
  delivery?: StaffDeliverySummary;
  /** GET /deliveries/{id}/dispatch — 배차 상태·시도 */
  dispatch?: DeliveryDispatch;
}

/** 출고 줄에 보이는 배차·배송 단계 — 서버 상태에서만 정한다(추측해서 앞서 그리지 않음) */
export type DispatchStage =
  | 'UNKNOWN' // 출고 조회 전
  | 'NOT_REQUESTED' // 점원 배차 요청 전(0.4.11 자동 요청 없음)
  | 'REQUESTED' // 배차 요청됨, 배송 아직 안 보임
  | 'WAITING_DISPATCH' // 배송 생김, 배차 시작 전(CREATED) 또는 다시 배차 대기
  | 'DISPATCHING' // 라이더 찾는 중
  | 'DISPATCH_FAILED'
  | 'ASSIGNED' // 라이더 확정 — MFC 로 오는 중
  | 'AT_STORE' // 라이더 가게 도착
  | 'OUT_FOR_DELIVERY' // 픽업 뒤 배송 중
  | 'DELIVERED'
  | 'ENDED' // 배송 실패·취소 등 끝
  | 'SHIPMENT_CANCELLED';

export interface DispatchView {
  stage: DispatchStage;
  riderId: string | null;
  radiusKm: number | null;
  retryCount: number | null;
  failureReason: string | null;
  dispatchState: DispatchState | null;
  execState: ExecutionState | null;
  estimatedReadyAt: string | null;
}

const PRE_PICKUP: ReadonlySet<ExecutionState> = new Set(['UNASSIGNED', 'ASSIGNED', 'ARRIVED_AT_STORE']);
const OUT: ReadonlySet<ExecutionState> = new Set(['PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'FAILURE_REPORTED', 'SUSPENDED']);
/** 아직 인계 전이라 화면에 남겨 둘 출고 상태 */
const SHIPMENT_PENDING: ReadonlySet<string> = new Set(['PREPARING', 'READY', 'PARTIALLY_HANDED_OVER']);

export function dispatchView(r: RealShipment): DispatchView {
  const d = r.dispatch;
  const last = d?.attempts?.length ? d.attempts[d.attempts.length - 1] : null;
  const v: DispatchView = {
    stage: 'UNKNOWN',
    riderId: r.delivery?.riderId ?? d?.assignment?.riderId ?? null,
    radiusKm: last?.currentRadiusKm ?? null,
    retryCount: last?.retryCount ?? null,
    failureReason: last?.failureReason ?? null,
    dispatchState: d?.state ?? null,
    execState: r.delivery?.state ?? null,
    estimatedReadyAt: r.info?.dispatchRequest?.estimatedReadyAt ?? null,
  };
  const info = r.info;
  if (!info) return v;
  if (info.state === 'CANCELLED') return { ...v, stage: 'SHIPMENT_CANCELLED' };
  const ex = r.delivery?.state;
  if (!ex) return { ...v, stage: info.dispatchRequest ? 'REQUESTED' : 'NOT_REQUESTED' };
  if (ex === 'ARRIVED_AT_STORE') return { ...v, stage: 'AT_STORE' };
  if (ex === 'ASSIGNED') return { ...v, stage: 'ASSIGNED' };
  if (OUT.has(ex)) return { ...v, stage: 'OUT_FOR_DELIVERY' };
  if (ex === 'COMPLETED') return { ...v, stage: 'DELIVERED' };
  if (ex !== 'UNASSIGNED') return { ...v, stage: 'ENDED' };
  if (d?.state === 'DISPATCHING') return { ...v, stage: 'DISPATCHING' };
  if (d?.state === 'DISPATCH_FAILED') return { ...v, stage: 'DISPATCH_FAILED' };
  return { ...v, stage: 'WAITING_DISPATCH' };
}

export interface PickTarget {
  /** 백엔드 위치 코드 */
  locationCode: string;
  taskId: string;
  state: TaskState;
  workerId: string | null;
  qty: number;
}

const DETAIL_STATES: ReadonlySet<TaskState> = new Set(['ASSIGNED', 'IN_PROGRESS', 'BLOCKED']);

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

/** 배차·배송 단계 한 줄 (출고 줄 · 3D 출하대기 이름표 같이 씀). 서버 상태 그대로 */
export function dispatchText(r: RealShipment): string {
  const v = dispatchView(r);
  const rider = v.riderId ?? '';
  switch (v.stage) {
    case 'UNKNOWN':
      return '확인 중';
    case 'NOT_REQUESTED':
      return '배차 요청 전';
    case 'REQUESTED':
      return `배차 요청됨 · 준비 ${hhmm(v.estimatedReadyAt)}`;
    case 'WAITING_DISPATCH':
      return '배차 대기';
    case 'DISPATCHING':
      return `배차 중${v.radiusKm != null ? ` (반경 ${v.radiusKm} km${v.retryCount ? `, 재시도 ${v.retryCount}` : ''})` : ''}`;
    case 'DISPATCH_FAILED':
      return `배차 실패${v.failureReason ? ` ${v.failureReason}` : ''}`;
    case 'ASSIGNED':
      return `오는 중 ${rider}`;
    case 'AT_STORE':
      return `가게 도착 ${rider}`;
    case 'OUT_FOR_DELIVERY':
      return `픽업 완료 ${rider}`;
    case 'DELIVERED':
      return '전달 완료';
    case 'ENDED':
      return `배송 ${v.execState ?? ''}`;
    case 'SHIPMENT_CANCELLED':
      return '출고 취소';
  }
}


export class RealBoard {
  readonly tasks = new Map<string, RealTask>();
  readonly workers = new Map<string, CapacityWorker>();
  lastOkMs: number | null = null;
  lastError: string | null = null;
  polls = 0;
  /** 주문에 나온 SKU 의 재고 (SKU → 응답·읽은 시각) */
  readonly stock = new Map<string, { data: CenterStock; readMs: number }>();
  /** 재고가 바뀔 때마다 올라간다 — 화면이 다시 그릴지 판단 */
  stockVersion = 0;
  private readonly staleSkus = new Set<string>();
  /** 출고 조회 결과 (shipmentId → 응답·읽은 시각·그때의 작업 version 서명) */
  readonly shipmentInfo = new Map<string, { data: Shipment; readMs: number; sig: string }>();
  /** 주문 ID → 정방향 배송(최신) */
  /** 출고 ID → 배송. 배차 상세의 shipmentId 로 잇는다(재발송은 같은 주문의 두 번째 출고 — fulfillment 0.5.0) */
  readonly deliveries = new Map<string, StaffDeliverySummary>();
  /** 배송 ID → 배차 상세의 shipmentId(바뀌지 않으므로 한 번 읽으면 둔다). 배차 상세에 없으면 null */
  private readonly deliveryShipment = new Map<string, string | null>();
  readonly dispatches = new Map<string, { data: DeliveryDispatch; readMs: number }>();
  /** 출고·배차가 바뀔 때마다 올라간다 — 3D 이름표가 다시 그릴지 판단 */
  deliveryVersion = 0;
  /**
   * 이 센터로 오는 회수 배송(type RETURN — 고객 반품 CLAIM_RETURN·오배송 회수, delivery-dispatch 0.5.0). 진행 중 + 최근 반납.
   * 배송 찾기 요약만 쓴다 — 배차 상세에는 회수지(고객 집) 좌표가 같이 와서 읽지 않는다(개인정보).
   */
  returnPickups: StaffDeliverySummary[] = [];
  /** MFC 반납 기다리는 배송과 반납 인증번호(GET /return-handovers?mfcId=, 회수 배송 간격마다). 못 읽으면 이유 */
  returnHandovers: ReturnHandover[] = [];
  returnHandoverError: string | null = null;
  private lastHandoverMs = -Infinity;
  private lastReturnMs = -Infinity;
  private lastPollMs = -Infinity;
  private lastWorkersMs = -Infinity;
  private busy = false;

  constructor(
    private readonly reader: RealReader,
    readonly mfcId: string,
    private readonly opt: RealBoardOptions,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  /** 매 프레임 불러도 된다 — 간격이 되었을 때만 조회한다. */
  async tick(): Promise<void> {
    if (this.busy || this.nowMs() - this.lastPollMs < this.opt.pollSec * 1000) return;
    await this.poll();
  }

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.lastPollMs = this.nowMs();
    try {
      await this.refreshCenterName(this.nowMs());
      await this.refreshFullStock(this.nowMs());
      await this.refreshWorkers();
      const list = await this.reader.listTasks(this.mfcId, [...this.opt.openStates]);
      const now = this.nowMs();
      if (!this.backfilled && this.opt.backfillSec) await this.backfillPending(now);
      const seen = new Set<string>();
      let detailBudget = this.opt.maxDetailPerPoll ?? 10;
      for (const s of list) {
        seen.add(s.taskId);
        let t = this.tasks.get(s.taskId);
        if (!t) {
          t = { summary: s, detail: null, firstSeenMs: now, closed: null };
          this.tasks.set(s.taskId, t);
        } else {
          t.summary = s;
          t.closed = null; // 다시 열린 작업(내놓기 등)
        }
        // 상세는 모든 열린 작업 — 줄의 SKU 를 알아야 그 재고를 읽는다. 진행이 바뀌면 그 SKU 재고도 다시 읽는다.
        // 서버는 칸 하나 집품(부분 실적)에는 작업 version 을 올리지 않는다(상태가 바뀔 때만 — fulfillment TaskService) →
        // version 만 보면 첫 칸 뒤 상세가 멈춘다. 완료·남은 수량·마지막 실적 시각까지 본다.
        const sig = progressSig(s);
        if ((!t.detail || t.detailSig !== sig) && detailBudget > 0) {
          detailBudget--;
          const d = await this.reader.getTask(s.taskId).catch(() => null);
          if (d) {
            t.detail = d;
            t.detailSig = sig;
            this.rememberPicks(d);
            for (const l of d.lines) this.staleSkus.add(l.sku);
          }
        }
      }
      // 목록에서 빠진 작업: 상세로 최종 상태를 확인한다(빠졌다고 완료로 단정하지 않음)
      for (const t of this.tasks.values()) {
        if (seen.has(t.summary.taskId)) continue;
        if (!t.closed) t.closed = { atMs: now, state: 'CHECKING' };
        if (t.closed.state === 'CHECKING') {
          try {
            const d = await this.reader.getTask(t.summary.taskId);
            t.summary = d;
            t.detail = d;
            t.closed = { atMs: now, state: d.state };
            this.rememberPicks(d);
            for (const l of d.lines) this.staleSkus.add(l.sku); // 끝난 작업의 마지막 실적까지 재고에 반영
          } catch {
            /* 다음 조회에서 다시 확인 */
          }
        }
      }
      for (const [id, t] of this.tasks) {
        if (!t.closed || t.closed.state === 'CHECKING') continue;
        const age = now - t.closed.atMs;
        // 인계 전 출고(출하 대기·배차 중)는 작업이 끝나도 남긴다 — 배차·라이더 표시(rider 시뮬레이터 요청 M-01·M-02)
        const keep = this.pendingHandover(t.summary.shipmentId) ? this.opt.handoverKeepSec : this.opt.recentKeepSec;
        if (age > keep * 1000) this.tasks.delete(id);
      }
      const live = new Set([...this.tasks.values()].map((t) => t.summary.shipmentId));
      for (const sid of this.seenPicks.keys()) if (!live.has(sid)) this.seenPicks.delete(sid);
      await this.refreshShipments(now);
      await this.refreshOrderFacts(now);
      await this.refreshReturnHandovers(now);
      await this.refreshStock(now);
      this.lastOkMs = now;
      this.lastError = null;
      this.polls++;
    } catch (e) {
      this.lastError = describe(e);
    } finally {
      this.busy = false;
    }
  }

  private backfilled = false;
  /** 첫 조회 한 번: 최근 끝난 작업 중 출고가 인계 전인 것을 끝난 작업으로 들여 둔다(backfillSec). 실패하면 다음 조회에서 다시 */
  private async backfillPending(now: number) {
    const done = await this.reader.listTasks(this.mfcId, ['COMPLETED']);
    const since = now - this.opt.backfillSec! * 1000;
    const recent = done.filter((s) => s.shipmentId && Date.parse(s.createdAt) >= since && !this.tasks.has(s.taskId));
    for (const sid of new Set(recent.map((s) => s.shipmentId!))) {
      const sh = await this.reader.getShipment(sid).catch(() => null);
      if (!sh || !SHIPMENT_PENDING.has(sh.state)) continue;
      for (const s of recent.filter((x) => x.shipmentId === sid)) {
        const d = await this.reader.getTask(s.taskId).catch(() => null);
        this.tasks.set(s.taskId, { summary: d ?? s, detail: d, detailSig: progressSig(s), firstSeenMs: now, closed: { atMs: now, state: 'COMPLETED' } });
      }
    }
    this.backfilled = true;
  }

  /** 출고 → 센터 출고 목록 한 줄(피킹·패킹 시작 시각) — 매 조회 한 번(목록 하나) */
  readonly centerShipments = new Map<string, CenterShipment>();
  /** 배송 → 주문 요약(품목·금액·배송 요청사항) — 배송마다 한 번, 실패하면 1분 뒤 다시 */
  readonly orderSummaries = new Map<string, { data: DeliveryOrderSummary | null; readMs: number; failed?: boolean }>();

  /** 센터 이름(center-master) — 한 번 읽고, 못 읽으면 1분 뒤 다시. 모르면 null(화면은 ID) */
  centerName: string | null = null;
  private centerNameReadMs = 0;

  /** 센터 전체 재고(stock-units) — fullStockSec 마다. 구역·랙·단별 수량 화면용(사용자 2026-11-20) */
  fullStock: StockUnitRow[] = [];
  fullStockReadMs = 0;
  fullStockVersion = 0;
  fullStockError: string | null = null;
  fullStockOpt = { everySec: 30, maxPages: 60 };

  private async refreshFullStock(now: number) {
    if (!this.reader.listAllStockUnits || now - this.fullStockReadMs < this.fullStockOpt.everySec * 1000) return;
    this.fullStockReadMs = now;
    try {
      this.fullStock = await this.reader.listAllStockUnits(this.mfcId, this.fullStockOpt.maxPages);
      this.fullStockError = null;
      this.fullStockVersion++;
      this.stockVersion++; // 3D 재고가 다시 그린다
    } catch (e) {
      this.fullStockError = describe(e);
    }
  }

  /** 작업 조회가 실패해도 이름은 따로 — 조회 맨 앞에서 */
  private async refreshCenterName(now: number) {
    if (this.centerName || !this.reader.getCenterName || now - this.centerNameReadMs < 60_000) return;
    this.centerNameReadMs = now;
    try {
      this.centerName = await this.reader.getCenterName(this.mfcId);
    } catch {
      /* ID 로 보인다 */
    }
  }

  private async refreshOrderFacts(now: number) {
    if (this.reader.listCenterShipments) {
      try {
        const list = await this.reader.listCenterShipments(this.mfcId);
        this.centerShipments.clear();
        for (const c of list) this.centerShipments.set(c.shipmentId, c);
      } catch {
        /* 시간 칸만 비고 화면은 그대로 */
      }
    }
    if (!this.reader.getDeliveryOrderSummary) return;
    let budget = 3;
    for (const r of this.shipments()) {
      const did = r.delivery?.deliveryId ?? r.info?.deliveryId;
      if (!did || budget <= 0) continue;
      const hit = this.orderSummaries.get(did);
      if (hit && !(hit.failed && now - hit.readMs > 60_000)) continue;
      budget--;
      try {
        this.orderSummaries.set(did, { data: await this.reader.getDeliveryOrderSummary(did), readMs: now });
      } catch {
        this.orderSummaries.set(did, { data: null, readMs: now, failed: true });
      }
    }
  }

  /** 그 출고의 주문 요약(배송 상세) — 배송이 아직 없거나 못 읽었으면 null */
  orderSummaryOf(r: RealShipment): DeliveryOrderSummary | null {
    const did = r.delivery?.deliveryId ?? r.info?.deliveryId;
    return did ? (this.orderSummaries.get(did)?.data ?? null) : null;
  }

  /** 상품 바코드(스캔 판) — SKU → 서버 barcodes, 못 읽었으면 'ERR'. 화면이 볼 때만 한 번 읽는다(주기 조회 없음) */
  readonly skuBarcodes = new Map<string, string[] | 'ERR' | 'LOADING'>();
  skuVersion = 0;
  /** 주문 번호 → 현장 기록(GET /work-orders?orderId=) — 화면이 그 주문을 고르면 읽고, 고른 동안 orderViewRefreshSec 마다 다시 */
  /** notYet = 404 WORK_ORDER_NOT_FOUND — 작업 지시가 아직 MFC 에 안 옴(오류 아님, 백엔드 PC 1 회신 11-18) */
  readonly orderViews = new Map<string, { data: OrderFulfillmentView | null; error: string | null; readMs: number; loading: boolean; notYet?: boolean }>();
  orderViewVersion = 0;

  requestOrderView(orderId: string, refreshSec = 15) {
    const hit = this.orderViews.get(orderId);
    if (!this.reader.getOrderFulfillment || hit?.loading || (hit && this.nowMs() - hit.readMs < refreshSec * 1000)) return;
    this.orderViews.set(orderId, { data: hit?.data ?? null, error: hit?.error ?? null, readMs: hit?.readMs ?? 0, loading: true, notYet: hit?.notYet });
    this.reader
      .getOrderFulfillment(orderId)
      .then((d) => this.orderViews.set(orderId, { data: d, error: null, readMs: this.nowMs(), loading: false }))
      .catch((e: unknown) =>
        e instanceof ApiProblem && e.problem.code === 'WORK_ORDER_NOT_FOUND'
          ? this.orderViews.set(orderId, { data: null, error: null, readMs: this.nowMs(), loading: false, notYet: true })
          : this.orderViews.set(orderId, { data: hit?.data ?? null, error: (e as Error).message, readMs: this.nowMs(), loading: false }),
      )
      .finally(() => this.orderViewVersion++);
  }

  /** 출고(shipmentId) → 본 피킹 조각(orderLineId:lotId). 화면에서 빠진 출고와 같이 버린다 */
  readonly seenPicks = new Map<string, Map<string, SeenPick>>();

  private rememberPicks(d: TaskDetail) {
    if (d.taskType !== 'PICK' || !d.shipmentId) return;
    let m = this.seenPicks.get(d.shipmentId);
    if (!m) this.seenPicks.set(d.shipmentId, (m = new Map()));
    const now = new Set<string>();
    for (const l of d.lines)
      for (const p of l.picks ?? []) {
        const k = `${l.orderLineId}:${p.lotId}`;
        now.add(k);
        const locs = p.locations ?? [];
        m.set(k, { line: l, pick: p, loc: (locs.find((x) => (x.allocatedQty ?? 0) > 0) ?? locs[0])?.locationCode ?? l.locationId ?? null, gone: false });
      }
    for (const [k, v] of m) {
      if (now.has(k)) continue;
      const line = d.lines.find((l) => l.orderLineId === v.line.orderLineId) ?? v.line;
      m.set(k, { ...v, line, gone: true });
    }
  }

  /** 그 출고의 피킹 조각 — 지금 남은 것 + 이미 집어 서버 상세에서 빠진 것, 방문 순서대로 */
  picksOf(shipmentId: string): SeenPick[] {
    return [...(this.seenPicks.get(shipmentId)?.values() ?? [])].sort((a, b) => (a.pick.visitSeq ?? 9999) - (b.pick.visitSeq ?? 9999));
  }

  requestSkuBarcodes(skus: Iterable<string>) {
    for (const sku of skus) {
      if (this.skuBarcodes.has(sku)) continue;
      this.skuBarcodes.set(sku, 'LOADING');
      this.reader
        .getSku(sku)
        .then((d) => this.skuBarcodes.set(sku, d.barcodes ?? []))
        .catch(() => this.skuBarcodes.set(sku, 'ERR'))
        .finally(() => this.skuVersion++);
    }
  }

  /** 인계 전인가 — 출고 상태가 PREPARING·READY·부분 인계이거나, 배송이 픽업 전 */
  private pendingHandover(shipmentId: string | null | undefined): boolean {
    if (!shipmentId) return false;
    const info = this.shipmentInfo.get(shipmentId)?.data;
    if (!info) return false;
    if (SHIPMENT_PENDING.has(info.state)) return true;
    const dl = this.deliveries.get(shipmentId);
    return !!dl && PRE_PICKUP.has(dl.state);
  }

  /**
   * 출고 → 배송 → 배차를 읽는다(읽기만). 출고는 작업 version 이 바뀌었거나 인계 전이면 shipmentRefreshSec 마다,
   * 배송 찾기는 배차 요청된 출고가 있을 때 조회마다 한 번, 배차 상세는 픽업 전 배송만.
   * 출고의 deliveryId 가 비어 있어(R-19) 배송 찾기의 orderId 로 후보를 고르고, 배차 상세의 shipmentId 로 출고에 잇는다.
   * 같은 주문에 출고가 둘(원래 + 오배송 재발송, fulfillment 0.5.0)이어도 섞이지 않는다.
   * 배차 상세에 shipmentId 가 없으면 그 주문에 배차 요청된 출고가 하나일 때만 정방향 배송을 잇는다.
   */
  private async refreshShipments(now: number) {
    const rows = this.shipments();
    const onBoard = new Set(rows.map((r) => r.shipmentId));
    for (const id of [...this.shipmentInfo.keys()]) {
      if (!onBoard.has(id)) {
        this.shipmentInfo.delete(id);
        this.deliveryVersion++;
      }
    }
    let budget = this.opt.maxShipmentPerPoll;
    for (const r of rows) {
      if (budget <= 0) break;
      if (!(r.pick ?? r.pack ?? r.ret)?.summary.shipmentId) continue; // 출고 ID 없는 작업
      const sig = [r.pick, r.pack, r.ret].map((t) => (t ? `${t.summary.version}:${t.closed?.state ?? ''}` : '-')).join('|');
      const hit = this.shipmentInfo.get(r.shipmentId);
      // 포장 중이면 배차 요청·밀봉을 놓치지 않게 주기적으로(배차 요청은 작업 version 을 안 바꿀 수 있다 — 스캔 말풍선 포장 단계)
      const packing = !!r.pack && !r.pack.closed;
      const due = !hit || hit.sig !== sig || ((this.pendingHandover(r.shipmentId) || packing) && now - hit.readMs > this.opt.shipmentRefreshSec * 1000);
      if (!due) continue;
      budget--;
      try {
        const data = await this.reader.getShipment(r.shipmentId);
        if (!hit || hit.data.version !== data.version || hit.data.state !== data.state) {
          this.deliveryVersion++;
          // 출고가 바뀌면(밀봉·인계) 그 SKU 재고도 바로 다시 — 포장대의 PACKED 가 인계로 빠지는 것을 늦지 않게 그린다
          if (hit) for (const t of [r.pick, r.pack, r.ret]) for (const l of t?.detail?.lines ?? []) this.staleSkus.add(l.sku);
        }
        this.shipmentInfo.set(r.shipmentId, { data, readMs: now, sig });
      } catch {
        /* 다음 조회에서 다시 */
      }
    }

    const requested = [...this.shipmentInfo.values()].filter((v) => v.data.dispatchRequest);
    if (!requested.length && this.opt.returnPickupRefreshSec != null && now - this.lastReturnMs > this.opt.returnPickupRefreshSec * 1000) {
      try {
        this.setReturnPickups(await this.reader.searchDeliveries(this.mfcId, 50), now);
      } catch {
        /* 다음에 다시 */
      }
    }
    if (!requested.length) {
      if (this.deliveries.size || this.dispatches.size) this.deliveryVersion++;
      this.deliveries.clear();
      this.dispatches.clear();
      return;
    }
    let dBudget = this.opt.maxShipmentPerPoll;
    const readNow = new Set<string>(); // 이번 조회에서 이미 읽은 배송
    const readDispatch = async (d: StaffDeliverySummary) => {
      const hit = this.dispatches.get(d.deliveryId);
      if (readNow.has(d.deliveryId)) return;
      if (hit && this.deliveryShipment.has(d.deliveryId) && !PRE_PICKUP.has(d.state)) return; // 픽업 뒤는 한 번 읽은 것으로 충분
      if (dBudget <= 0) return;
      dBudget--;
      readNow.add(d.deliveryId);
      try {
        const data = await this.reader.getDeliveryDispatch(d.deliveryId);
        if (!hit || hit.data.version !== data.version || hit.data.state !== data.state) this.deliveryVersion++;
        this.dispatches.set(d.deliveryId, { data, readMs: now });
        this.deliveryShipment.set(d.deliveryId, data.shipmentId ?? null);
      } catch {
        /* 다음 조회에서 다시 */
      }
    };
    try {
      const list = await this.reader.searchDeliveries(this.mfcId, 50);
      this.setReturnPickups(list, now);
      const byShipment = new Map(requested.map((v) => [v.data.shipmentId, v.data]));
      const perOrder = new Map<string, string[]>();
      for (const v of requested) perOrder.set(v.data.orderId, [...(perOrder.get(v.data.orderId) ?? []), v.data.shipmentId]);
      // 최신순 — 출고마다 처음 나온 배송
      const candidates = list.filter((d) => (d.type === 'FORWARD' || d.type === 'RESHIPMENT') && d.orderId && perOrder.has(d.orderId));
      for (const d of candidates) if (!this.deliveryShipment.has(d.deliveryId)) await readDispatch(d);
      const next = new Map<string, StaffDeliverySummary>();
      for (const d of candidates) {
        let sid = this.deliveryShipment.get(d.deliveryId);
        if (!sid) {
          const only = perOrder.get(d.orderId!)!;
          if (d.type !== 'FORWARD' || only.length !== 1) continue;
          sid = only[0];
        }
        if (byShipment.has(sid) && !next.has(sid)) next.set(sid, d);
      }
      for (const [k, d] of next) {
        const old = this.deliveries.get(k);
        if (!old || old.version !== d.version || old.state !== d.state) this.deliveryVersion++;
      }
      this.deliveries.clear();
      for (const [k, d] of next) this.deliveries.set(k, d);
      const seen = new Set(list.map((d) => d.deliveryId));
      for (const id of [...this.deliveryShipment.keys()]) if (!seen.has(id)) this.deliveryShipment.delete(id);
    } catch {
      /* 배송 표시만 못 한다 — 지난 값 유지 */
    }
    for (const d of this.deliveries.values()) await readDispatch(d);
    const live = new Set([...this.deliveries.values()].map((d) => d.deliveryId));
    for (const id of [...this.dispatches.keys()]) if (!live.has(id)) this.dispatches.delete(id);
  }

  /** 회수 배송만 골라 둔다 — 진행 중(취소·실패 아님) + 반납 뒤 returnShownMin 분 */
  private async refreshReturnHandovers(now: number) {
    const sec = this.opt.returnPickupRefreshSec;
    if (!this.reader.listReturnHandovers || sec == null || now - this.lastHandoverMs < sec * 1000) return;
    this.lastHandoverMs = now;
    try {
      const next = await this.reader.listReturnHandovers(this.mfcId);
      const sig = (x: ReturnHandover[]) => x.map((h) => `${h.deliveryId}:${h.state}:${h.code}:${h.locked}`).join(',');
      if (sig(next) !== sig(this.returnHandovers)) this.deliveryVersion++;
      this.returnHandovers = next;
      this.returnHandoverError = null;
    } catch (e) {
      this.returnHandoverError = describe(e);
    }
  }

  private setReturnPickups(list: StaffDeliverySummary[], now: number) {
    this.lastReturnMs = now;
    const keepMs = (this.opt.returnShownMin ?? 60) * 60_000;
    const next = list.filter(
      (d) =>
        d.type === 'RETURN' &&
        d.state !== 'CANCELLED' &&
        d.state !== 'FAILED' &&
        (d.state !== 'RETURNED_TO_STORE' && d.state !== 'COMPLETED' ? true : !!d.completedAt && now - Date.parse(d.completedAt) < keepMs),
    );
    const sig = (x: StaffDeliverySummary[]) => x.map((d) => `${d.deliveryId}:${d.version}:${d.state}`).join(',');
    if (sig(next) !== sig(this.returnPickups)) this.deliveryVersion++;
    this.returnPickups = next;
  }

  /** 화면에 남아 있는 작업(열림 + 최근 끝남)에 나온 SKU */
  watchedSkus(): Set<string> {
    const out = new Set<string>();
    for (const t of this.tasks.values()) for (const l of t.detail?.lines ?? []) out.add(l.sku);
    return out;
  }

  private async refreshStock(now: number) {
    const watched = this.watchedSkus();
    for (const sku of [...this.stock.keys()]) {
      if (!watched.has(sku)) {
        this.stock.delete(sku);
        this.stockVersion++;
      }
    }
    const due = [...watched].filter((sku) => {
      const hit = this.stock.get(sku);
      return !hit || this.staleSkus.has(sku) || now - hit.readMs > this.opt.stockRefreshSec * 1000;
    });
    // 바뀐 SKU 먼저, 그다음 오래된 순
    due.sort((a, b) => Number(this.staleSkus.has(b)) - Number(this.staleSkus.has(a)) || (this.stock.get(a)?.readMs ?? 0) - (this.stock.get(b)?.readMs ?? 0));
    for (const sku of due.slice(0, this.opt.maxStockPerPoll)) {
      try {
        const data = await this.reader.getCenterStock(this.mfcId, sku);
        this.stock.set(sku, { data, readMs: now });
        this.staleSkus.delete(sku);
        this.stockVersion++;
      } catch {
        /* 다음 조회에서 다시 — 못 읽은 SKU 는 화면에서 "수량 모름"으로 남는다 */
      }
    }
    for (const sku of this.staleSkus) if (!watched.has(sku)) this.staleSkus.delete(sku);
  }

  /**
   * 읽은 재고 단위 행 전부(서버 응답 그대로) — 주문 상품은 자주 읽는 SKU 조회(최신), 나머지는 센터 전체 stock-units(fullStockSec 마다).
   * 3D 선반이 센터 전체를 실제 수량으로 그린다(사용자 2026-11-20).
   */
  stockUnits(): RealStockUnit[] {
    const out: RealStockUnit[] = [];
    for (const { data } of this.stock.values()) {
      for (const u of data.units) {
        if (u.qty > 0) out.push({ sku: data.sku, locationCode: u.locationCode, workState: u.workState, qualityState: u.qualityState, qty: u.qty });
      }
    }
    for (const u of this.fullStock) {
      if (u.qty > 0 && !this.stock.has(u.sku)) out.push({ sku: u.sku, locationCode: u.locationCode, workState: u.workState, qualityState: u.qualityState, qty: u.qty });
    }
    return out;
  }

  private async refreshWorkers() {
    if (this.nowMs() - this.lastWorkersMs < this.opt.workerRefreshSec * 1000) return;
    this.lastWorkersMs = this.nowMs();
    try {
      const ws = await this.reader.listWorkers(this.mfcId);
      this.workers.clear();
      for (const w of ws) this.workers.set(w.workerId, w);
    } catch {
      /* 이름 표시만 못 한다 — 작업 조회는 계속 */
    }
    // 이름·사번(hr 0.8.0) — 50개씩. 못 읽으면(다른 기기 조회 경로 밖 403 등) 사번(displayName)만
    if (this.reader.getEmployeeLabels && this.workers.size) {
      const ids = [...this.workers.keys()];
      try {
        for (let i = 0; i < ids.length; i += 50) for (const l of await this.reader.getEmployeeLabels(ids.slice(i, i + 50))) this.labels.set(l.operatorId, l);
      } catch {
        /* 이름 없이 사번만 */
      }
    }
  }

  /** 운영자 ID → 이름·사번(hr employee-labels) */
  readonly labels = new Map<string, EmployeeLabel>();

  workerName(workerId: string | null | undefined): string {
    if (!workerId) return '미배정';
    // ADR-0070: 직원은 이름 · 사번만 — 운영자 ID(OP-…)는 화면에 내지 않는다(끝자리도). 이름을 아직 못 읽었으면 "작업자 확인 중"
    const l = this.labels.get(workerId);
    if (l) return `${l.name} · ${l.employeeNo}`;
    return this.workers.get(workerId)?.displayName ?? '작업자 확인 중';
  }

  /** 화면용 주문번호(fulfillment 0.13.0 — 작업·출고 응답의 orderNumber, ADR-0070). 없으면 null */
  orderNumberOf(shipmentId: string): string | null {
    const s = this.shipmentInfo.get(shipmentId)?.data.orderNumber;
    if (s) return s;
    for (const t of this.tasks.values()) if (t.summary.shipmentId === shipmentId && t.summary.orderNumber) return t.summary.orderNumber;
    return null;
  }

  /** 작업자 속도 배율(capacity 0.11.0 `speedFactor` — 배정 추천의 작업 시간 = 추정 ÷ 배율). 모르면 1, 0.5~2.0 으로 자름 */
  speedFactor(workerId: string | null | undefined): number {
    const f = workerId ? this.workers.get(workerId)?.speedFactor : undefined;
    return typeof f === 'number' && Number.isFinite(f) ? Math.min(2, Math.max(0.5, f)) : 1;
  }

  /** 열린 작업 수 (유형:상태 → 건수) */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of this.tasks.values()) {
      if (t.closed) continue;
      const k = `${t.summary.taskType}:${t.summary.state}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  /** 출고 단위로 묶은 작업 — 최근 것 먼저 */
  shipments(): RealShipment[] {
    const by = new Map<string, RealShipment>();
    for (const t of this.tasks.values()) {
      const s = t.summary;
      const key = s.shipmentId ?? s.fulfillmentId;
      let g = by.get(key);
      if (!g) {
        g = { shipmentId: key, fulfillmentId: s.fulfillmentId, createdAt: s.createdAt };
        by.set(key, g);
      }
      if (s.taskType === 'PICK') g.pick = t;
      else if (s.taskType === 'PACK') g.pack = t;
      else if (s.taskType === 'RETURN') g.ret = t;
      if (s.createdAt < g.createdAt) g.createdAt = s.createdAt;
    }
    for (const g of by.values()) {
      const info = this.shipmentInfo.get(g.shipmentId)?.data;
      if (!info) continue;
      g.info = info;
      g.delivery = this.deliveries.get(g.shipmentId);
      if (g.delivery) g.dispatch = this.dispatches.get(g.delivery.deliveryId)?.data;
    }
    return [...by.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** 진행 중 PICK·RETURN 의 남은 지시 칸. 배정(allocatedQty) 칸이 있으면 그 칸, 없으면 첫 후보 칸. */
  pickTargets(): PickTarget[] {
    const out: PickTarget[] = [];
    for (const t of this.tasks.values()) {
      if (t.closed || !t.detail) continue;
      const s = t.summary;
      if ((s.taskType !== 'PICK' && s.taskType !== 'RETURN') || !DETAIL_STATES.has(s.state)) continue;
      for (const line of t.detail.lines) {
        for (const p of line.picks ?? []) {
          if (p.remainingQty <= 0) continue;
          const locs = p.locations ?? [];
          const allocated = locs.filter((l) => (l.allocatedQty ?? 0) > 0);
          const chosen = allocated.length ? allocated : locs.slice(0, 1);
          for (const l of chosen) {
            out.push({
              locationCode: l.locationCode,
              taskId: t.summary.taskId,
              state: t.summary.state,
              workerId: t.summary.assignment?.workerId ?? null,
              qty: allocated.length ? (l.allocatedQty ?? 0) : p.remainingQty,
            });
          }
        }
      }
    }
    return out;
  }
}

function describe(e: unknown): string {
  const p = (e as { problem?: { status: number; code: string } }).problem;
  if (p) return `${p.status} ${p.code}`;
  return (e as Error).message ?? String(e);
}
