// 시뮬레이션 본체: 시계, 주문 유입(mock), 작업 배정, 작업자·라이더, 지표.
//
// 역할 구분 (실서버에서 누가 하는 일인가)
//  - 주문 유입·재고 예약·ConfirmOrder  → order-service / order-orchestration / mfc-inventory  (mock 모드에서만 시뮬이 대신)
//  - 작업 배정(AssignmentPublished)    → mfc-capacity                                       (mock 모드에서만 시뮬이 대신)
//  - 배차·라이더                      → delivery-dispatch / delivery-execution            (Delivery 미구현 — 가상 라이더)
//  - 피킹·패킹·밀봉·QR 인계            → 현장(점원 PDA·라이더 앱) = 이 시뮬레이터가 가상 현장으로서 계약 API 를 부른다

import { DEFAULT_PARAMS, type SimParams } from '../config';
import { buildCatalog, type Sku } from '../domain/catalog';
import type { ConfirmOrderRequest, Package, PackageContentLine, TemperatureZone } from '../domain/contract';
import { buildLayout, type Layout } from '../domain/layout';
import { NavGrid } from '../domain/navgrid';
import { MockBackend } from '../backend/mock/MockBackend';
import { HttpBackend } from '../backend/http/HttpBackend';
import type { ApiCallRecord, DomainEventRecord, FulfillmentPort } from '../backend/port';
import { Rng } from '../util/rng';
import type { SiteContext } from './context';
import { Metrics } from './metrics';
import { Rider } from './rider';
import { ShippingRack, StationPool } from './site';
import { Worker } from './worker';

const BASE_DATE = '2026-11-02';
const SUBSTEP = 0.25;
const RING = 300;

export type Mode = 'mock' | 'http';

export interface HttpSettings {
  baseUrl: string;
  token: string;
  workerIds: string[];
}

export class Simulation {
  readonly layout: Layout;
  readonly nav: NavGrid;
  readonly catalog: Sku[];
  readonly skuMap: Map<string, Sku>;
  readonly metrics = new Metrics();
  readonly stations: StationPool;
  readonly shipRack: ShippingRack;
  readonly workers: Worker[] = [];
  riders: Rider[] = [];
  readonly apiLog: ApiCallRecord[] = [];
  readonly events: DomainEventRecord[] = [];
  readonly logs: { at: number; msg: string }[] = [];
  readonly mock: MockBackend | null;
  readonly port: FulfillmentPort;
  readonly runId = Math.random().toString(36).slice(2, 8);

  time: number;
  speed = 15;
  /** 주문 흐름 전용 난수 — 인원·설비를 바꿔도 같은 주문이 들어와 비교할 수 있다 */
  private rng: Rng;
  /** 현장 작업(결품·라이더 도착) 난수 */
  private opsRng: Rng;
  private nextOrderAt: number;
  private orderSeq = 0;
  private riderSeq = 0;
  private readonly fulfillmentOrder = new Map<string, string>();
  private readonly shipmentOrder = new Map<string, string>();
  private readonly orderShipments = new Map<string, Set<string>>();
  private readonly stagedShipments = new Set<string>();
  private readonly handedShipments = new Set<string>();
  private readonly pendingRiders: { at: number; shipmentId: string }[] = [];
  private readonly packOwner = new Map<string, string>(); // shipmentId → PICK 작업자
  private readonly ctx: SiteContext;
  private readonly cumulativeByTemp: Record<TemperatureZone, { skus: Sku[]; cum: number[] }>;
  private lastPoll = -Infinity;

  constructor(
    readonly params: SimParams = { ...DEFAULT_PARAMS },
    readonly mode: Mode = 'mock',
    http?: HttpSettings,
  ) {
    this.rng = new Rng(params.seed);
    this.opsRng = new Rng(params.seed ^ 0x5f3759df);
    this.time = params.startHour * 3600;
    this.nextOrderAt = this.time + this.rng.exp(3600 / Math.max(1, params.ordersPerHour));
    this.layout = buildLayout();
    this.nav = new NavGrid(this.layout);
    this.catalog = buildCatalog(this.layout, params.skuCount, params.tempMix, params.seed);
    this.skuMap = new Map(this.catalog.map((s) => [s.sku, s]));
    this.stations = new StationPool(this.layout.stations, params.packingStations);
    this.shipRack = new ShippingRack(this.layout.shippingSlots);

    this.cumulativeByTemp = { AMBIENT: { skus: [], cum: [] }, CHILLED: { skus: [], cum: [] }, FROZEN: { skus: [], cum: [] } };
    for (const s of this.catalog) {
      const b = this.cumulativeByTemp[s.temp];
      b.skus.push(s);
      b.cum.push((b.cum[b.cum.length - 1] ?? 0) + s.weight);
    }

    if (mode === 'mock') {
      const mock = new MockBackend({ mfcId: params.mfcId, now: () => this.time, baseDate: BASE_DATE, fenceTtlSec: params.fenceTtlSec });
      for (const s of this.catalog) mock.inventory.seed(s.sku, params.initialStockPerSku);
      mock.onApi((r) => this.push(this.apiLog, r));
      mock.onEvent((e) => this.onEvent(e));
      this.mock = mock;
      this.port = mock;
    } else {
      const h = new HttpBackend({
        baseUrl: http?.baseUrl ?? '/api/v1',
        token: () => http?.token || null,
        sourceSystem: 'mfc-simulator',
        now: () => this.time,
        timeoutMs: 8000,
      });
      h.onApi((r) => this.push(this.apiLog, r));
      this.mock = null;
      this.port = h;
    }

    this.ctx = {
      runId: this.runId,
      port: this.port,
      params: this.params,
      layout: this.layout,
      nav: this.nav,
      skuMap: this.skuMap,
      rng: this.opsRng,
      metrics: this.metrics,
      stations: this.stations,
      shipRack: this.shipRack,
      now: () => this.time,
      log: (m) => this.log(m),
      orderOf: (f) => this.fulfillmentOrder.get(f),
      awaitPackAssignment: (s, w) => this.assignPack(s, w),
      stagePackages: (s, p) => this.onStaged(s, p),
    };

    const ids = mode === 'http' && http?.workerIds.length ? http.workerIds : null;
    this.setWorkers(ids ? ids.length : params.workers, ids ?? undefined);
  }

  // ── 설정 변경 ───────────────────────────────────────
  setWorkers(n: number, ids?: string[]) {
    const target = Math.max(1, Math.min(this.layout.points.idle.length, n));
    while (this.workers.length < target) {
      const i = this.workers.length;
      const id = ids?.[i] ?? `W${String(i + 1).padStart(2, '0')}`;
      const w = new Worker(id, this.layout.points.idle[i], this.ctx);
      this.workers.push(w);
      void w.run();
    }
    // 줄일 때는 대기 중인 작업자만 퇴근
    for (let i = this.workers.length - 1; i >= 0 && this.workers.length > target; i--) {
      const w = this.workers[i];
      if (w.idle) {
        w.stop();
        w.give({ taskId: '', assignmentVersion: 0 });
        this.workers.splice(i, 1);
      }
    }
    this.params.workers = this.workers.length;
  }

  setStations(n: number) {
    this.stations.setActive(n);
    this.params.packingStations = this.stations.activeCount;
  }

  // ── 진행 ───────────────────────────────────────────
  /** 실제 경과 dtReal(초)에 배속을 곱해 진행한다. */
  async advance(dtReal: number) {
    let remain = Math.min(dtReal, 0.1) * this.speed;
    while (remain > 1e-6) {
      const dt = Math.min(SUBSTEP, remain);
      remain -= dt;
      this.time += dt;
      if (this.mode === 'mock') {
        this.generateOrders();
        this.dispatch();
      } else {
        await this.pollHttp();
      }
      for (const w of this.workers) w.tick(dt);
      for (const r of this.riders) r.tick(dt);
      this.stations.tick(dt);
      this.spawnRiders();
      // 풀린 Promise 의 후속 코드(다음 walkTo/wait 등록)가 같은 시각에 이어지도록 마이크로태스크를 비운다
      for (let i = 0; i < 40; i++) await Promise.resolve();
    }
    this.riders = this.riders.filter((r) => !r.done);
  }

  // ── 주문 유입 (mock) ────────────────────────────────
  private generateOrders() {
    const hour = (this.time / 3600) % 24;
    if (hour < 8) {
      // 00~08 실제 배송 없음 [확정 정책] — 시뮬은 즉시배달만 다루므로 주문 유입도 멈춘다
      this.nextOrderAt = 8 * 3600;
      return;
    }
    while (this.time >= this.nextOrderAt) {
      this.createOrder();
      this.nextOrderAt += this.rng.exp(3600 / Math.max(0.1, this.params.ordersPerHour));
    }
  }

  private pickSku(temp: TemperatureZone): Sku {
    const b = this.cumulativeByTemp[temp];
    return b.skus[this.rng.weighted(b.cum)];
  }

  private createOrder() {
    const mock = this.mock!;
    this.orderSeq += 1;
    const orderId = `ORD-${String(this.orderSeq).padStart(5, '0')}`;
    const units = Math.max(1, Math.min(30, Math.round(this.rng.exp(this.params.unitsPerOrder - 1)) + 1));
    const mix = this.params.tempMix;
    const cum = [mix.AMBIENT, mix.AMBIENT + mix.CHILLED, mix.AMBIENT + mix.CHILLED + mix.FROZEN];
    const qty = new Map<string, number>();
    for (let i = 0; i < units; i++) {
      const temp = (['AMBIENT', 'CHILLED', 'FROZEN'] as const)[this.rng.weighted(cum)];
      const s = this.pickSku(temp);
      qty.set(s.sku, (qty.get(s.sku) ?? 0) + 1);
    }
    const lines: PackageContentLine[] = [...qty].map(([sku, q], i) => ({ orderLineId: `${orderId}-L${i + 1}`, sku, qty: q }));
    this.metrics.ordersCreated += 1;

    // S1-b 재고 예약 (전부 또는 전무). 부족하면 결제 진입 차단 — 주문이 MFC 로 오지 않는다
    const reservationId = `RSV-${orderId}`;
    if (!mock.inventory.reserve(reservationId, orderId, lines)) {
      this.metrics.ordersBlockedStock += 1;
      this.log(`${orderId} 재고 부족 — 결제 진입 차단 (INSUFFICIENT_STOCK)`);
      return;
    }

    // 총 상품중량 10,000g 초과 시 분할 [확정 정책] — 분할은 order-service 이행 계획이 정한다(여기선 흉내)
    const shipments = this.splitByWeight(orderId, lines);
    const req: ConfirmOrderRequest = {
      orderId,
      orderVersion: 1,
      mfcId: this.params.mfcId,
      reservationId,
      deliveryMode: 'SINGLE',
      shipments,
    };
    const temps = new Map<string, TemperatureZone>();
    const meta = new Map<string, { code: string; name: string; barcode: string }>();
    for (const l of lines) {
      const s = this.skuMap.get(l.sku)!;
      temps.set(l.sku, s.temp);
      meta.set(l.sku, { code: s.location.code, name: s.name, barcode: s.barcode });
    }
    const fulfillmentId = mock.orchestrationConfirmOrder(req, temps, meta);
    this.fulfillmentOrder.set(fulfillmentId, orderId);
    this.orderShipments.set(orderId, new Set(shipments.map((s) => s.shipmentId)));
    for (const s of shipments) this.shipmentOrder.set(s.shipmentId, orderId);
    this.metrics.traces.set(orderId, { orderId, confirmedAt: this.time, units, shipments: shipments.length });
  }

  private splitByWeight(orderId: string, lines: PackageContentLine[]): ConfirmOrderRequest['shipments'] {
    const limit = this.params.splitOverWeightG;
    const units: { line: PackageContentLine; w: number }[] = [];
    for (const l of lines) {
      const w = this.skuMap.get(l.sku)!.weightG;
      for (let i = 0; i < l.qty; i++) units.push({ line: l, w });
    }
    units.sort((a, b) => b.w - a.w);
    const bins: { w: number; qty: Map<string, number> }[] = [];
    for (const u of units) {
      let bin = bins.find((b) => b.w + u.w <= limit);
      if (!bin) {
        bin = { w: 0, qty: new Map() };
        bins.push(bin);
      }
      bin.w += u.w;
      bin.qty.set(u.line.orderLineId, (bin.qty.get(u.line.orderLineId) ?? 0) + 1);
    }
    return bins.map((b, i) => ({
      shipmentId: `SHP-${orderId.slice(4)}-${i + 1}`,
      weightG: Math.round(b.w),
      lines: [...b.qty].map(([orderLineId, qty]) => ({ orderLineId, sku: lines.find((l) => l.orderLineId === orderLineId)!.sku, qty })),
    }));
  }

  // ── 작업 배정 (mock: mfc-capacity 역할) ───────────────
  private dispatch() {
    const mock = this.mock!;
    const idle = this.workers.filter((w) => w.idle);
    if (idle.length === 0) return;
    const ready = mock
      .allTasks()
      .filter((t) => t.taskType === 'PICK' && t.state === 'READY')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const t of ready) {
      const w = idle.shift();
      if (!w) break;
      const v = mock.capacityAssign(t.taskId, w.id);
      this.packOwner.set(t.shipmentId!, w.id);
      w.give({ taskId: t.taskId, assignmentVersion: v });
    }
  }

  private async assignPack(shipmentId: string, workerId: string) {
    if (this.mode === 'mock') {
      const pack = this.mock!.allTasks().find((t) => t.taskType === 'PACK' && t.shipmentId === shipmentId);
      if (!pack || pack.state === 'CANCELLED') return null;
      const v = this.mock!.capacityAssign(pack.taskId, workerId);
      return { taskId: pack.taskId, assignmentVersion: v };
    }
    // 실서버: mfc-capacity 가 같은 작업자에게 PACK 을 배정할 때까지 작업 목록을 본다
    for (let i = 0; i < 120; i++) {
      const items = await this.port.listTasks(this.params.mfcId, ['ASSIGNED']);
      const t = items.find((x) => x.taskType === 'PACK' && x.shipmentId === shipmentId && x.assignment.workerId === workerId);
      if (t) return { taskId: t.taskId, assignmentVersion: t.assignment.assignmentVersion };
      await this.workers.find((w) => w.id === workerId)!.wait(5);
    }
    return null;
  }

  // ── 실서버 모드: 배정된 작업 받아오기 ──────────────────
  private polling = false;
  private async pollHttp() {
    if (this.polling || this.time - this.lastPoll < 5) return;
    this.polling = true;
    this.lastPoll = this.time;
    try {
      const items = await this.port.listTasks(this.params.mfcId, ['ASSIGNED']);
      for (const t of items) {
        if (t.taskType !== 'PICK') continue;
        const w = this.workers.find((x) => x.id === t.assignment.workerId && x.idle);
        if (w) {
          this.fulfillmentOrder.set(t.fulfillmentId, t.fulfillmentId);
          w.give({ taskId: t.taskId, assignmentVersion: t.assignment.assignmentVersion });
        }
      }
    } catch {
      // API 로그에 남는다. 다음 주기에 다시 본다
    } finally {
      this.polling = false;
    }
  }

  // ── 출하대기·라이더 ─────────────────────────────────
  private onStaged(shipmentId: string, pkgs: Package[]) {
    this.shipRack.place(shipmentId, pkgs);
    this.stagedShipments.add(shipmentId);
    const orderId = this.shipmentOrder.get(shipmentId);
    if (orderId) {
      const all = this.orderShipments.get(orderId);
      if (all && [...all].every((s) => this.stagedShipments.has(s) || this.isCancelled(s))) this.metrics.markReady(orderId, this.time);
    }
    if (this.mode === 'mock') {
      const delay = this.opsRng.range(this.params.riderArrivalMinSec, this.params.riderArrivalMaxSec);
      this.pendingRiders.push({ at: this.time + delay, shipmentId });
    }
  }

  private isCancelled(shipmentId: string): boolean {
    return this.mock?.allShipments().find((s) => s.shipmentId === shipmentId)?.state === 'CANCELLED';
  }

  private spawnRiders() {
    for (let i = this.pendingRiders.length - 1; i >= 0; i--) {
      const p = this.pendingRiders[i];
      if (this.time < p.at) continue;
      this.pendingRiders.splice(i, 1);
      this.riderSeq += 1;
      const riderId = `R${String(this.riderSeq).padStart(3, '0')}`;
      const deliveryId = this.mock!.deliveryAssign(p.shipmentId, riderId);
      const orderId = this.shipmentOrder.get(p.shipmentId) ?? '';
      const parking = this.layout.points.riderParking[this.riderSeq % this.layout.points.riderParking.length];
      const rider = new Rider(riderId, p.shipmentId, deliveryId, orderId, parking, this.ctx, () => {
        this.handedShipments.add(p.shipmentId);
        const all = this.orderShipments.get(orderId);
        if (all && [...all].every((s) => this.handedShipments.has(s) || this.isCancelled(s))) this.metrics.markHandedOver(orderId, this.time);
      });
      this.riders.push(rider);
      void rider.run();
    }
  }

  // ── 기록 ───────────────────────────────────────────
  private onEvent(e: DomainEventRecord) {
    this.push(this.events, e);
  }
  log(msg: string) {
    this.push(this.logs, { at: this.time, msg });
  }
  private push<T>(arr: T[], v: T) {
    arr.push(v);
    if (arr.length > RING) arr.splice(0, arr.length - RING);
  }

  /** 작업 상태별 개수 (mock: 원장 투영) */
  taskBoard(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of this.mock?.allTasks() ?? []) {
      const k = `${t.taskType}:${t.state}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  shipmentsWaitingRider(): number {
    return this.pendingRiders.length;
  }
}
