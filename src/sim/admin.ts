// 관리 탭(실서버 전용) — 지난 주문 조회와 관리자 조치(사용자 2026-11-20 "관리자가 바로 피패킹 제어가능한 탭", "API 받아오면 되잖아. 허락 받았어", R-29).
// React 없이: 화면은 subscribe/getVersion 으로 다시 그린다.
// - 조회는 관찰 계정(claude-mfc-wrk), 쓰기(재배정·내놓기·인계 확인)는 센터 관리자 계정(claude-mfc-sup, MFC_SUPERVISOR) — 계약에 있는 경로만.
// - 서버가 확정한 결과만 확정으로. 응답이 없으면 결과 불명 — 같은 Idempotency-Key 로 다시 보낸다(실패로 단정하지 않음).
import { ApiProblem, ResultUnknown, type OrderFulfillmentView, type PackageToCheck, type TaskExecution, type TaskState, type TaskSummary } from '../domain/contract';
import type { HttpBackend } from '../backend/http/HttpBackend';

export type ActionState = { state: 'sending' | 'unknown' | 'done' | 'error'; msg: string; key: string };

export interface HistoryOrder {
  /** 주문번호(8자리) — 없으면 출고 ID 끝 */
  orderNumber: string | null;
  shipmentId: string;
  tasks: TaskSummary[];
  /** 마지막 끝 시각(작업 completedAt·lastActivityAt 중 가장 늦은 것) */
  lastAt: string | null;
}

export interface OrderDetail {
  shipmentId: string;
  orderNumber: string | null;
  /** SKU → 상품 이름(작업 상세 줄에서) — 끝난 주문은 관찰판에 없어 따로 읽는다 */
  names: Map<string, string>;
  orderId: string | null;
  view: OrderFulfillmentView | null;
  /** 작업 ID → 실적(최근 순) */
  execs: Map<string, TaskExecution[]>;
  loading: boolean;
  error: string | null;
}

const ENDED: TaskState[] = ['COMPLETED', 'CLOSED_PARTIAL', 'CANCELLED'];

/** 서울 날짜 YYYY-MM-DD */
export function seoulDate(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
}

function errText(e: unknown): string {
  if (e instanceof ApiProblem) return `${e.problem.status} ${e.problem.code}${e.problem.detail ? ` — ${e.problem.detail}` : ''}`;
  return (e as Error).message;
}

export class AdminDesk {
  private version = 0;
  private readonly subs = new Set<() => void>();

  historyDate: string;
  history: { loading: boolean; error: string | null; orders: HistoryOrder[]; readAt: number | null } = { loading: false, error: null, orders: [], readAt: null };
  detail: OrderDetail | null = null;
  checks: { loading: boolean; error: string | null; items: PackageToCheck[]; readAt: number | null } = { loading: false, error: null, items: [], readAt: null };
  /** 조치 키(예 `release:<taskId>`) → 진행 상태. 결과 불명이면 같은 키로 다시 보낸다 */
  readonly actions = new Map<string, ActionState>();

  constructor(
    private readonly obs: HttpBackend,
    private readonly sup: HttpBackend,
    readonly mfcId: string,
    private readonly nowMs: () => number,
    private readonly maxPages: number,
    /** 관리자 계정 운영자 ID(키·사유 기록용) — 모르면 null */
    private readonly supervisorId: () => string | null,
    /** 작업자 이름·사번 읽어 두기(hr employee-labels) — 끝난 작업의 담당이 관찰판 작업자 목록에 없을 때 */
    private readonly labelWorkers: (ids: string[]) => Promise<void> = async () => undefined,
  ) {
    this.historyDate = seoulDate(nowMs());
  }

  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    for (const f of this.subs) f();
  }

  /** 그날 끝난(완료·부분 종료·취소) 작업을 출고별로 — 최근 끝난 것이 위 */
  async loadHistory(date = this.historyDate) {
    this.historyDate = date;
    this.history = { ...this.history, loading: true, error: null };
    this.bump();
    try {
      const tasks = await this.obs.listTasksByActivity(this.mfcId, ENDED, date, date, this.maxPages);
      const by = new Map<string, HistoryOrder>();
      for (const t of tasks) {
        const key = t.shipmentId ?? t.fulfillmentId;
        const o = by.get(key) ?? { orderNumber: t.orderNumber ?? null, shipmentId: key, tasks: [], lastAt: null };
        o.tasks.push(t);
        o.orderNumber ??= t.orderNumber ?? null;
        const at = t.completedAt ?? t.lastActivityAt ?? null;
        if (at && (!o.lastAt || at > o.lastAt)) o.lastAt = at;
        by.set(key, o);
      }
      const orders = [...by.values()].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
      for (const o of orders) o.tasks.sort((a, b) => 'PICK PACK RETURN DISPATCH'.indexOf(a.taskType) - 'PICK PACK RETURN DISPATCH'.indexOf(b.taskType));
      this.history = { loading: false, error: null, orders, readAt: this.nowMs() };
    } catch (e) {
      this.history = { ...this.history, loading: false, error: errText(e) };
    }
    this.bump();
  }

  /** 주문 하나의 흐름(현장 기록) + 집품·복귀 실적(칸·시각·수량) */
  async openOrder(shipmentId: string, orderNumber: string | null = null) {
    this.detail = { shipmentId, orderNumber, names: new Map(), orderId: null, view: null, execs: new Map(), loading: true, error: null };
    this.bump();
    const d = this.detail;
    try {
      if (!d.orderId) d.orderId = (await this.obs.getShipment(shipmentId)).orderId ?? null;
      if (!d.orderId) throw new Error('출고에서 주문 ID 를 못 읽음');
      d.view = await this.obs.getOrderFulfillment(d.orderId);
      const ids = (d.view.workOrders ?? []).flatMap((w) => w.shipments.filter((s) => s.shipmentId === shipmentId || !shipmentId).flatMap((s) => s.tasks)).filter((t) => t.taskType === 'PICK' || t.taskType === 'RETURN');
      for (const t of ids) d.execs.set(t.taskId, await this.obs.listTaskExecutions(t.taskId).catch(() => []));
      // 상품 이름(작업 상세 줄)·작업자 이름(hr) — 못 읽으면 SKU·"작업자 확인 중" 그대로
      for (const t of ids.filter((x) => x.taskType === 'PICK')) {
        const td = await this.obs.getTask(t.taskId).catch(() => null);
        for (const l of td?.lines ?? []) if (l.productName) d.names.set(l.sku, l.productName);
      }
      const workers = new Set<string>();
      for (const w of d.view.workOrders ?? []) for (const s of w.shipments) for (const t of s.tasks) for (const id of [t.workerId, t.startedBy]) if (id) workers.add(id);
      for (const xs of d.execs.values()) for (const x of xs) if (x.workerId) workers.add(x.workerId);
      if (workers.size) await this.labelWorkers([...workers]).catch(() => undefined);
      d.loading = false;
    } catch (e) {
      d.loading = false;
      d.error = errText(e);
    }
    if (this.detail === d) this.bump();
  }

  closeOrder() {
    this.detail = null;
    this.bump();
  }

  async loadChecks() {
    this.checks = { ...this.checks, loading: true, error: null };
    this.bump();
    try {
      this.checks = { loading: false, error: null, items: await this.sup.listPackagesToCheck(this.mfcId), readAt: this.nowMs() };
    } catch (e) {
      this.checks = { ...this.checks, loading: false, error: errText(e) };
    }
    this.bump();
  }

  /** 같은 조치는 같은 키 — 결과 불명이면 다시 눌러 같은 키로 보낸다. 끝(done·error)난 조치를 다시 하면 새 키 */
  private keyFor(action: string): string {
    const cur = this.actions.get(action);
    if (cur && (cur.state === 'unknown' || cur.state === 'sending')) return cur.key;
    return `sim-admin:${action}:${this.nowMs().toString(36)}`;
  }

  private async run(action: string, f: (key: string) => Promise<string>) {
    const key = this.keyFor(action);
    if (this.actions.get(action)?.state === 'sending') return;
    this.actions.set(action, { state: 'sending', msg: '보내는 중…', key });
    this.bump();
    try {
      const msg = await f(key);
      this.actions.set(action, { state: 'done', msg, key });
    } catch (e) {
      if (e instanceof ResultUnknown) this.actions.set(action, { state: 'unknown', msg: '응답 없음 — 결과 모름. 다시 누르면 같은 요청으로 다시 보냅니다', key });
      else this.actions.set(action, { state: 'error', msg: errText(e), key });
    }
    this.bump();
  }

  /** 담당 바꾸기 — 지금 활성 배정 버전을 읽어 X-Expected-Version 으로(capacity, MFC_SUPERVISOR) */
  reassign(task: TaskSummary, workerId: string, reason: string) {
    return this.run(`assign:${task.taskId}`, async (key) => {
      const cur = await this.sup.listAssignments(this.mfcId, task.taskId);
      const active = cur.find((a) => a.state === 'ACTIVE');
      const a = await this.sup.assignTask(
        { mfcId: this.mfcId, taskId: task.taskId, taskType: task.taskType, workerId, reason: reason || undefined },
        active?.assignmentVersion ?? 0,
        key,
      );
      return a.warnings?.length ? `배정됨(경고 ${a.warnings.join(', ')})` : '배정됨';
    });
  }

  /** 내려놓기 — 지금 담당을 풀고 READY 로(완료량 그대로) */
  release(task: TaskSummary, reason: string) {
    const workerId = task.assignment?.workerId;
    return this.run(`release:${task.taskId}`, async (key) => {
      if (!workerId) throw new Error('지금 담당이 없음');
      const t = await this.sup.releaseTask(task.taskId, { workerId, reason: reason || `관리자 내려놓기(${this.supervisorId() ?? '관리 탭'})` }, key);
      return `대기로 돌림(${t.state})`;
    });
  }

  /**
   * 주문 전체 취소 — 관리자 판단(claim 0.8.0 OPERATOR_DECISION, ADR-0076). 인계 전이면 피킹 시작 뒤라도. 사유 메모 필수.
   * 줄 = 원래 작업 지시 PICK 줄의 미이행 수량(지시 − 취소). 서버가 "모든 행 × 미이행"과 다르면 422 로 거절한다.
   * 접수만 확정 — 실제 취소·복귀·환불은 주문 사가(S3) 뒤라 작업 화면이 바뀌는 것으로 본다.
   */
  cancelOrder(shipmentId: string, orderId: string | null, memo: string) {
    return this.run(`cancel:${shipmentId}`, async (key) => {
      if (!memo.trim()) throw new Error('취소 사유를 적어 주세요(필수)');
      const oid = orderId ?? (await this.obs.getShipment(shipmentId)).orderId ?? null;
      if (!oid) throw new Error('주문 ID 를 못 읽음');
      const view = await this.obs.getOrderFulfillment(oid);
      const qty = new Map<string, number>();
      for (const w of view.workOrders ?? []) {
        if (w.kind !== 'ORIGINAL') continue;
        for (const s of w.shipments)
          for (const t of s.tasks.filter((x) => x.taskType === 'PICK')) {
            const d = await this.obs.getTask(t.taskId);
            for (const l of d.lines) qty.set(l.orderLineId, (qty.get(l.orderLineId) ?? 0) + Math.max(0, l.plannedQty - l.cancelledQty));
          }
      }
      const lines = [...qty].filter(([, q]) => q > 0).map(([orderLineId, q]) => ({ orderLineId, qty: q }));
      if (!lines.length) throw new Error('취소할 수량이 없음(모두 취소·결품)');
      const c = await this.sup.createOperatorCancel({ orderId: oid, type: 'CANCEL', lines, reason: 'OPERATOR_DECISION', reasonDetail: memo.trim(), channel: 'OPERATOR' }, key);
      return `취소 접수됨(${c.state}) — 작업 정리·환불은 서버가 이어서 함`;
    });
  }

  /** 인계 허가가 만료된 포장 확인 — AT_STATION(아직 있음) / TAKEN_BY_RIDER(라이더가 가져감 → 재고 인계 전기) */
  check(packageId: string, result: 'AT_STATION' | 'TAKEN_BY_RIDER', note: string) {
    return this.run(`check:${packageId}`, async (key) => {
      await this.sup.checkPackageHandover(packageId, { result, note: note || undefined }, key);
      void this.loadChecks();
      return result === 'AT_STATION' ? '자리에 있음으로 확인' : '라이더가 가져감으로 확인';
    });
  }
}
