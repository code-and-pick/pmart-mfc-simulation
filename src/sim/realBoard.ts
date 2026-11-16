// 실서버 관찰: MFC 센터의 실제 작업(고객 앱 주문 → PICK·PACK, PDA 작업자의 진행)을 주기 조회로 읽어 들고 있는다.
// 쓰기는 하지 않는다 — 재고·작업을 바꾸지 않는다(사용자 2026-11-16 "일단 실제 주문만 연결").
// 근거: SIM-5(주기 조회, 3초), SIM-2a(PDA 작업자는 서버 기록으로 추적). 서버가 준 상태만 그린다 — 목록에서 빠진 작업은
// 상세를 다시 읽어 확정된 최종 상태를 받기 전까지 "확인 중"으로 둔다.

import type { CapacityWorker, CenterStock, StockQualityState, StockWorkState, TaskDetail, TaskState, TaskSummary } from '../domain/contract';

export interface RealReader {
  listTasks(mfcId: string, states: TaskState[]): Promise<TaskSummary[]>;
  getTask(taskId: string): Promise<TaskDetail>;
  listWorkers(mfcId: string): Promise<CapacityWorker[]>;
  getCenterStock(mfcId: string, sku: string): Promise<CenterStock>;
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
        if (t.closed && t.closed.state !== 'CHECKING' && now - t.closed.atMs > this.opt.recentKeepSec * 1000) this.tasks.delete(id);
      }
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
