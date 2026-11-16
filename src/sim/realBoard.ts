// 실서버 관찰: MFC 센터의 실제 작업(고객 앱 주문 → PICK·PACK, PDA 작업자의 진행)을 주기 조회로 읽어 들고 있는다.
// 쓰기는 하지 않는다 — 재고·작업을 바꾸지 않는다(사용자 2026-11-16 "일단 실제 주문만 연결").
// 근거: SIM-5(주기 조회, 3초), SIM-2a(PDA 작업자는 서버 기록으로 추적). 서버가 준 상태만 그린다 — 목록에서 빠진 작업은
// 상세를 다시 읽어 확정된 최종 상태를 받기 전까지 "확인 중"으로 둔다.

import type {
  CapacityWorker,
  CenterStock,
  DeliveryDispatch,
  DispatchState,
  ExecutionState,
  Shipment,
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
}

/** 실서버 재고 단위 행(주문에 나온 SKU 만) */
export interface RealStockUnit {
  sku: string;
  locationCode: string;
  workState: StockWorkState;
  qualityState: StockQualityState;
  qty: number;
}

export interface RealTask {
  summary: TaskSummary;
  /** 열린 작업의 상세(줄의 SKU, PICK·RETURN 지시 칸). 목록 version 이 바뀌면 다시 읽는다 */
  detail: TaskDetail | null;
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
  /** 배송 찾기(GET /deliveries?mfcId=)에서 이 출고 주문의 정방향 배송 — 수행 상태 */
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
  readonly deliveries = new Map<string, StaffDeliverySummary>();
  readonly dispatches = new Map<string, { data: DeliveryDispatch; readMs: number }>();
  /** 출고·배차가 바뀔 때마다 올라간다 — 3D 이름표가 다시 그릴지 판단 */
  deliveryVersion = 0;
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
      await this.refreshWorkers();
      const list = await this.reader.listTasks(this.mfcId, [...this.opt.openStates]);
      const now = this.nowMs();
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
        // 상세는 모든 열린 작업 — 줄의 SKU 를 알아야 그 재고를 읽는다. version 이 바뀌면 그 SKU 재고도 다시 읽는다
        if ((!t.detail || t.detail.version !== s.version) && detailBudget > 0) {
          detailBudget--;
          const d = await this.reader.getTask(s.taskId).catch(() => null);
          if (d) {
            t.detail = d;
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
      await this.refreshShipments(now);
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

  /** 인계 전인가 — 출고 상태가 PREPARING·READY·부분 인계이거나, 배송이 픽업 전 */
  private pendingHandover(shipmentId: string | null | undefined): boolean {
    if (!shipmentId) return false;
    const info = this.shipmentInfo.get(shipmentId)?.data;
    if (!info) return false;
    if (SHIPMENT_PENDING.has(info.state)) return true;
    const dl = this.deliveries.get(info.orderId);
    return !!dl && PRE_PICKUP.has(dl.state);
  }

  /**
   * 출고 → 배송 → 배차를 읽는다(읽기만). 출고는 작업 version 이 바뀌었거나 인계 전이면 shipmentRefreshSec 마다,
   * 배송 찾기는 배차 요청된 출고가 있을 때 조회마다 한 번, 배차 상세는 픽업 전 배송만.
   * 출고의 deliveryId 가 비어 있어(R-19) 배송 찾기의 orderId 로 잇는다.
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
      const due = !hit || hit.sig !== sig || (this.pendingHandover(r.shipmentId) && now - hit.readMs > this.opt.shipmentRefreshSec * 1000);
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
    if (!requested.length) {
      if (this.deliveries.size || this.dispatches.size) this.deliveryVersion++;
      this.deliveries.clear();
      this.dispatches.clear();
      return;
    }
    try {
      const list = await this.reader.searchDeliveries(this.mfcId, 50);
      const wanted = new Set(requested.map((v) => v.data.orderId));
      // 최신순 — 주문마다 처음 나온 정방향 배송
      const next = new Map<string, StaffDeliverySummary>();
      for (const d of list) if (d.type === 'FORWARD' && d.orderId && wanted.has(d.orderId) && !next.has(d.orderId)) next.set(d.orderId, d);
      for (const [o, d] of next) {
        const old = this.deliveries.get(o);
        if (!old || old.version !== d.version || old.state !== d.state) this.deliveryVersion++;
      }
      this.deliveries.clear();
      for (const [o, d] of next) this.deliveries.set(o, d);
    } catch {
      /* 배송 표시만 못 한다 — 지난 값 유지 */
    }
    let dBudget = this.opt.maxShipmentPerPoll;
    for (const d of this.deliveries.values()) {
      if (dBudget <= 0) break;
      const hit = this.dispatches.get(d.deliveryId);
      if (hit && !PRE_PICKUP.has(d.state)) continue; // 픽업 뒤는 한 번 읽은 것으로 충분
      dBudget--;
      try {
        const data = await this.reader.getDeliveryDispatch(d.deliveryId);
        if (!hit || hit.data.version !== data.version || hit.data.state !== data.state) this.deliveryVersion++;
        this.dispatches.set(d.deliveryId, { data, readMs: now });
      } catch {
        /* 다음 조회에서 다시 */
      }
    }
    const live = new Set([...this.deliveries.values()].map((d) => d.deliveryId));
    for (const id of [...this.dispatches.keys()]) if (!live.has(id)) this.dispatches.delete(id);
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

  /** 읽은 재고 단위 행 전부 (서버 응답 그대로) */
  stockUnits(): RealStockUnit[] {
    const out: RealStockUnit[] = [];
    for (const { data } of this.stock.values()) {
      for (const u of data.units) {
        if (u.qty > 0) out.push({ sku: data.sku, locationCode: u.locationCode, workState: u.workState, qualityState: u.qualityState, qty: u.qty });
      }
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
  }

  workerName(workerId: string | null | undefined): string {
    if (!workerId) return '미배정';
    return this.workers.get(workerId)?.displayName ?? `${workerId.slice(0, 11)}…`;
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
      g.delivery = this.deliveries.get(info.orderId);
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
