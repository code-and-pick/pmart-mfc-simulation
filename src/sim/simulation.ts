// 시뮬레이션 본체: 시계, 주문 유입(mock), 작업 배정, 작업자·라이더, 지표.
//
// 역할 구분 (실서버에서 누가 하는 일인가)
//  - 주문 유입·재고 예약·ConfirmOrder  → order-service / order-orchestration / mfc-inventory  (mock 모드에서만 시뮬이 대신)
//  - 작업 배정(AssignmentPublished)    → mfc-capacity                                       (mock 모드에서만 시뮬이 대신)
//  - 배차·라이더                      → delivery-dispatch / delivery-execution            (Delivery 미구현 — 가상 라이더)
//  - 입고 차량·입고 예정(TRF)         → replenishment / CDC / TMS                         (mock 모드에서만 시뮬이 대신)
//  - 피킹·패킹·밀봉·QR 인계            → 현장(점원 PDA·라이더 앱) = 이 시뮬레이터가 가상 현장으로서 계약 API 를 부른다
//  - 하차·검수·수령 등록·적치·보충      → 현장(입고 작업자 PDA) — 적치·보충 단말 API 는 계약 공백(R-10)

import { BACKEND_FACTS, DEFAULT_PARAMS, REAL_LINK, REAL_WORKERS, type SimParams } from '../config';
import { buildCatalog, type Sku } from '../domain/catalog';
import type { ConfirmOrderRequest, Package, PackageContentLine, TemperatureZone } from '../domain/contract';
import { buildLayout, type DockSlot, type Layout, type Location, type ReserveSpot } from '../domain/layout';
import { buildLocationCodeMap, SIM_POINT, type LocationCodeMap } from '../domain/locationCodes';
import { NavGrid } from '../domain/navgrid';
import { MockBackend } from '../backend/mock/MockBackend';
import { HttpBackend } from '../backend/http/HttpBackend';
import { TokenSource } from '../backend/http/tokens';
import type { ApiCallRecord, DomainEventRecord, FulfillmentPort } from '../backend/port';
import { Rng } from '../util/rng';
import type { SiteContext } from './context';
import { Metrics } from './metrics';
import { RealBoard, type RealTask } from './realBoard';
import { RealRider, type SiteRider } from './realRider';
import { CartPool } from './cartPool';
import { ObservedWorker, type PackStep, type ScanCue } from './observedWorker';
import { nextPickStop } from '../domain/pickStop';
import { suggestCarts } from '../domain/cartSuggest';
import { applyWideCells } from '../domain/wideCells';
import { nextReturnPiece } from '../domain/returnPiece';
import { RealWorker, SIM_DEVICE_PREFIX, tempOfCode, type RealSiteContext } from './realWorker';
import type { SiteWorker } from './worker';
import { Rider } from './rider';
import { ShippingRack, StationPool } from './site';
import { Worker } from './worker';
import { InboundWorker, type DockItem, type InboundContext, type InboundJob, type Truck } from './inbound';

const BASE_DATE = '2026-11-02';
const SUBSTEP = 0.25;
const RING = 300;

export type Mode = 'mock' | 'http';

export interface HttpSettings {
  baseUrl: string;
}

/** 실서버 모드의 시계: 그 PC 의 오늘 자정부터 지난 초 (SIM-1 — 실제 시각 1×) */
/** 포장 단계 표시 이름(PDA 포장 화면 단계) */
const PACK_STEP_KO: Record<PackStep, string> = { STATION: '포장 ① 패킹대', CART: '포장 ② 카트', DISPATCH: '포장 ③ 배차 요청', BAG: '포장 ④ 담기·밀봉', RACK: '포장 ⑤ 출하대기 랙' };

function wallClockSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
}

export class Simulation {
  readonly layout: Layout;
  /** 시뮬레이터 평면 코드 ↔ 백엔드 위치 코드 (SIM-6) */
  readonly codes: LocationCodeMap;
  private readonly locByCode: Map<string, Location>;
  readonly nav: NavGrid;
  readonly catalog: Sku[];
  readonly skuMap: Map<string, Sku>;
  readonly metrics = new Metrics();
  readonly stations: StationPool;
  /** 실서버 가상 작업자의 장바구니(한 출고 = 한 장바구니, fulfillment 0.8.0) */
  readonly carts = new CartPool(BACKEND_FACTS.cartLocations.map((c) => c.code));
  readonly shipRack: ShippingRack;
  readonly workers: Worker[] = [];
  readonly inboundWorkers: InboundWorker[] = [];
  readonly reserveMap: Map<string, ReserveSpot>;
  trucks: Truck[] = [];
  readonly dockItems: DockItem[] = [];
  riders: SiteRider[] = [];
  readonly apiLog: ApiCallRecord[] = [];
  readonly events: DomainEventRecord[] = [];
  readonly logs: { at: number; msg: string }[] = [];
  readonly mock: MockBackend | null;
  readonly port: FulfillmentPort;
  /** 실서버 관찰(읽기 전용). MOCK 모드에서는 null */
  readonly real: RealBoard | null = null;
  readonly realTokens: TokenSource | null = null;
  /** 실서버의 실제 PDA 작업자 — 서버가 확정한 마지막 집품 칸에 세운다(그리기만, SIM-2a) */
  readonly observedWorkers: ObservedWorker[] = [];
  private observedPoll = -1;
  /** 실서버 가상 작업자(mfcw-pp-01~10) — 기본 0명, setVirtualWorkers 로 켠다 */
  readonly virtualWorkers: RealWorker[] = [];
  private realCtx: RealSiteContext | null = null;
  private realBaseUrl = '/api/v1';
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
  private inCtx!: InboundContext;
  private nextTruckAt = Infinity;
  private truckSeq = 0;
  private lastReplenishScan = -Infinity;
  private readonly dockUsed = new Set<string>();
  private readonly replenishQueue: { sku: string; urgent: boolean }[] = [];
  private readonly replenishActive = new Set<string>();
  private readonly receiving = new Set<string>();
  private readonly claimed = new Set<string>();
  /** SKU → 이미 차량에 실려 오는 수량 (중복 발주 방지) */
  private readonly inTransit = new Map<string, number>();

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
    this.codes = buildLocationCodeMap(this.layout);
    applyWideCells(this.layout, this.codes); // 넓은 칸·닫힌 칸(백엔드 layout-v3-wide, 2026-11-18)
    this.locByCode = new Map(this.layout.locations.map((l) => [l.code, l]));
    this.nav = new NavGrid(this.layout);
    this.catalog = buildCatalog(this.layout, params.mockSkuCount, BACKEND_FACTS.slotFillRate, params.seed);
    this.reserveMap = new Map(this.layout.reserves.map((r) => [r.id, r]));
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
      // 시작 재고: 칸 한도의 일부 + 일부 SKU 는 보충재고 [시뮬] (실제는 승인된 초기 보유 반입, ADR-0014)
      const stockRng = new Rng(params.seed ^ 0x1234567);
      const [f0, f1] = params.initialShelfFill;
      for (const s of this.catalog) {
        const shelf = Math.max(1, Math.round(s.shelfCap * stockRng.range(f0, f1)));
        const reserve = stockRng.next() < params.initialReserveShare ? s.caseQty * stockRng.int(1, 3) : 0;
        mock.inventory.seed(s.sku, shelf, reserve);
      }
      mock.onApi((r) => this.push(this.apiLog, r));
      mock.onEvent((e) => this.onEvent(e));
      this.mock = mock;
      this.port = mock;
    } else {
      // 실서버 관찰: 시험 계정 토큰(개발 서버가 발급) + 주기 조회. 가상 작업자·가짜 주문 없음(SIM-4), 실제 시각(SIM-1)
      const tokens = new TokenSource(REAL_LINK.observerAccount, REAL_LINK.tokenRefreshMarginSec);
      const h = new HttpBackend({
        baseUrl: http?.baseUrl ?? '/api/v1',
        token: () => tokens.get(),
        sourceSystem: 'mfc-simulator',
        now: () => this.time,
        timeoutMs: 8000,
      });
      h.onApi((r) => this.push(this.apiLog, r));
      this.mock = null;
      this.port = h;
      this.realTokens = tokens;
      this.real = new RealBoard(h, params.mfcId, {
        pollSec: REAL_LINK.pollSec,
        workerRefreshSec: REAL_LINK.workerRefreshSec,
        recentKeepSec: REAL_LINK.recentKeepSec,
        openStates: REAL_LINK.openStates,
        stockRefreshSec: REAL_LINK.stockRefreshSec,
        maxStockPerPoll: REAL_LINK.maxStockPerPoll,
        shipmentRefreshSec: REAL_LINK.shipmentRefreshSec,
        maxShipmentPerPoll: REAL_LINK.maxShipmentPerPoll,
        handoverKeepSec: REAL_LINK.handoverKeepSec,
        returnPickupRefreshSec: REAL_LINK.returnPickupRefreshSec,
        returnShownMin: REAL_LINK.returnShownMin,
        backfillSec: REAL_LINK.backfillSec,
      });
      this.time = wallClockSec();
      this.speed = 1;
      this.realBaseUrl = http?.baseUrl ?? '/api/v1';
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
      wireCode: (c) => (this.mode === 'mock' ? c : (this.codes.toBackend(c) ?? c)),
      simLocation: (c) => this.locByCode.get(this.mode === 'mock' ? c : (this.codes.toSim(c) ?? c)) ?? null,
      awaitPackAssignment: (s, w) => this.assignPack(s, w),
      stagePackages: (s, p) => this.onStaged(s, p),
      dispatchRequested: (s) => this.onDispatchRequested(s),
      shelfQty: (sku) => this.mock?.inventory.get(sku)?.shelf ?? Infinity,
      requestReplenish: (sku) => this.requestReplenish(sku, true),
    };
    if (this.mock) {
      this.inCtx = {
        runId: this.runId,
        mock: this.mock,
        layout: this.layout,
        nav: this.nav,
        skuMap: this.skuMap,
        reserveMap: this.reserveMap,
        metrics: this.metrics,
        now: () => this.time,
        log: (m) => this.log(m),
        placeOnDock: (it) => this.placeOnDock(it),
        releaseDock: (it) => this.releaseDock(it),
        onReceived: (t) => this.onTruckReceived(t),
        onReplenishDone: (sku) => this.replenishActive.delete(sku),
      };
      this.nextTruckAt = this.time + params.firstInboundAfterSec;
      this.setInboundWorkers(params.inboundWorkers);
    }

    // 실서버 모드의 가상 작업자는 기본 0명 — 실서버 작업·재고를 바꾸므로 화면에서 켤 때만(setVirtualWorkers)
    if (mode === 'mock') this.setWorkers(params.workers);
    else {
      this.params.workers = 0;
      this.realCtx = {
        runId: this.runId,
        mfcId: params.mfcId,
        layout: this.layout,
        nav: this.nav,
        stations: this.stations,
        params: this.params,
        now: () => this.time,
        log: (m) => this.log(m),
        location: (c) => this.backendLocation(c),
        point: (c) => this.backendPoint(c),
        wire: (c) => this.codes.toBackend(c),
        carts: this.carts,
        speedFactor: (id) => (this.real?.speedFactor(id) ?? 1) * this.speedBoost,
        pickRack: () => this.pickRack(),
        pdaInUse: (id) => this.pdaInUse(id),
        ownWork: (id) => this.ownWork(id),
        onSkipped: (account) => {
          this.pdaAccounts.set(account, Date.now());
          this.setVirtualWorkers(this.virtualTarget);
        },
      };
    }
  }

  /** 화면이 그리는 작업자 — MOCK 작업자 + 실서버 가상 작업자 */
  siteWorkers(): SiteWorker[] {
    if (!this.virtualWorkers.length && !this.observedWorkers.length) return this.workers;
    return [...this.workers, ...this.virtualWorkers.filter((w) => !w.left), ...this.observedWorkers];
  }

  /** 가상 작업자 운영자 ID — 실제 작업 표시(PDA 기둥)에서 뺀다 */
  /** 화면에서 고른 가상 작업자 수 */
  private virtualTarget = 0;
  /** PDA 가 쓰는 중이라 건너뛴 계정 → 그때(ms). REAL_LINK.pdaSkipSec 동안 다시 고르지 않는다 */
  private readonly pdaAccounts = new Map<string, number>();
  /** 가상 작업자로 마지막에 쓴 운영자 ID → 그때(ms) — 그 뒤 서버 활동만 PDA 것으로 본다 */
  private readonly virtualUsed = new Map<string, number>();

  /**
   * 이 탭의 가상 작업자가 쓴 운영자 ID → 계정. 새로고침해도 남게 sessionStorage(토큰 아님 — 운영자 ID 만, 이 탭에서만).
   * 피킹만 하고 끊겨 서버에 남은 "자기가 피킹한 배정 전 PACK"(시작 기기 정보가 없음)도 이어 하기로 찾는다.
   */
  private readonly knownVirtual: Map<string, string> = loadKnownVirtual();

  private rememberVirtual() {
    let changed = false;
    for (const w of this.virtualWorkers)
      if (w.workerId && !w.skipped && this.knownVirtual.get(w.workerId) !== w.account) {
        this.knownVirtual.set(w.workerId, w.account);
        changed = true;
      }
    if (changed) saveKnownVirtual(this.knownVirtual);
  }

  /** 가상 작업자 하나를 만들어 일을 시작한다(resumeOnly = 끊긴 작업만 이어 하기) */
  private spawnVirtual(account: string, slot: number, resumeOnly: boolean): RealWorker {
    const old = this.virtualWorkers.find((w) => w.account === account);
    if (old) this.virtualWorkers.splice(this.virtualWorkers.indexOf(old), 1);
    const tokens = new TokenSource(account, REAL_LINK.tokenRefreshMarginSec);
    const be = new HttpBackend({ baseUrl: this.realBaseUrl, token: () => tokens.get(), sourceSystem: 'mfc-simulator', now: () => this.time, timeoutMs: 8000 });
    be.onApi((r) => this.push(this.apiLog, { ...r, note: account }));
    const w = new RealWorker(account, this.layout.points.idle[slot % this.layout.points.idle.length], this.realCtx!, be, tokens);
    w.resumeOnly = resumeOnly;
    this.virtualWorkers.push(w);
    void w.run();
    return w;
  }

  /**
   * 끊긴 가상 작업자 작업 — 서버에 열린 작업인데 시작한 기기가 이 시뮬레이터 가상 작업자(activeStart.deviceId `SIM-mfcw-pp-NN`)이고,
   * 이 화면에 그 계정 가상 작업자가 돌고 있지 않은 것(새로고침·오류·탭 닫힘). 화면에서 "이어 하기"로 붙인다(사용자 2026-11-19).
   */
  interruptedVirtual(): { account: string; taskId: string; taskType: string; orderNumber: string | null }[] {
    const real = this.real;
    if (!real || this.realTokens?.serverInjected) return [];
    this.rememberVirtual();
    const running = new Set(this.virtualWorkers.filter((w) => !w.left).map((w) => w.account));
    const out: { account: string; taskId: string; taskType: string; orderNumber: string | null }[] = [];
    for (const t of real.tasks.values()) {
      if (t.closed) continue;
      const s = t.summary;
      const dev = t.detail?.activeStart?.deviceId ?? '';
      // 1) 시작 기기가 가상 작업자, 2) 이 탭 가상 작업자의 운영자에게 배정됨, 3) 그가 피킹한 배정 전 PACK
      let account = dev.startsWith(SIM_DEVICE_PREFIX) ? dev.slice(SIM_DEVICE_PREFIX.length) : null;
      if (!account && s.assignment?.workerId) account = this.knownVirtual.get(s.assignment.workerId) ?? null;
      if (!account && s.taskType === 'PACK' && !s.assignment?.workerId && s.pickedBy && (s.state === 'READY' || s.state === 'WAITING'))
        account = this.knownVirtual.get(s.pickedBy) ?? null;
      if (!account || !REAL_LINK.virtualAccounts.includes(account) || running.has(account)) continue;
      if (out.some((x) => x.account === account)) continue;
      out.push({ account, taskId: s.taskId, taskType: s.taskType, orderNumber: s.orderNumber ?? null });
    }
    return out;
  }

  /** 끊긴 작업 이어 하기 — 그 계정 가상 작업자를 붙인다(들고 있던 작업·자기가 피킹한 PACK 까지 하고 퇴근) */
  resumeVirtual(account: string) {
    if (!this.realCtx || this.realTokens?.serverInjected) return;
    if (this.virtualWorkers.some((w) => w.account === account && !w.left)) return;
    this.spawnVirtual(account, Math.max(0, REAL_LINK.virtualAccounts.indexOf(account)), true);
  }

  /** 서버에 남은 이 운영자의 일 — 열린 작업의 담당, 또는 자기가 피킹한 배정 전 PACK(capacity 0.19.0: 피커에게 먼저) */
  ownWork(workerId: string): boolean {
    const real = this.real;
    if (!real) return false;
    for (const t of real.tasks.values()) {
      if (t.closed) continue;
      const s = t.summary;
      if (s.assignment?.workerId === workerId) return true;
      if (s.taskType === 'PACK' && !s.assignment?.workerId && s.pickedBy === workerId && (s.state === 'READY' || s.state === 'WAITING')) return true;
    }
    return false;
  }

  /**
   * 이 운영자 계정을 실제 PDA 가 쓰는 중인가 — 서버가 로그인 여부를 알려 주지 않아(세션 조회는 본인만) 최근 작업으로 본다:
   * 열린 작업의 담당·피킹한 사람이거나, 최근(pdaSkipSec 안) 활동한 작업. 이 화면의 가상 작업자가 그 계정으로 일한 시각 이전 활동은 뺀다.
   * 첫 조회 전이면 null(모름).
   */
  pdaInUse(workerId: string): boolean | null {
    const real = this.real;
    if (!real || real.polls === 0) return null;
    const since = Math.max(this.virtualUsed.get(workerId) ?? 0, Date.now() - REAL_LINK.pdaSkipSec * 1000);
    // 시뮬레이터 가상 작업자가 시작한 흔적(activeStart.deviceId SIM-…)이 있거나 이 탭 가상 작업자의 운영자면 PDA 가 아니라 끊긴 가상 작업자 — 이어 하기 대상
    if (this.knownVirtual.has(workerId)) return false;
    for (const t of real.tasks.values()) {
      const s = t.summary;
      if ((s.assignment?.workerId === workerId || s.pickedBy === workerId) && (t.detail?.activeStart?.deviceId ?? '').startsWith(SIM_DEVICE_PREFIX)) return false;
    }
    for (const t of real.tasks.values()) {
      const s = t.summary;
      if (s.assignment?.workerId !== workerId && s.pickedBy !== workerId) continue;
      const at = Date.parse(s.lastActivityAt ?? s.createdAt ?? '') || 0;
      if (!t.closed && at > (this.virtualUsed.get(workerId) ?? 0)) return true;
      if (at > since) return true;
    }
    return false;
  }

  virtualWorkerIds(): Set<string> {
    return new Set(this.virtualWorkers.map((w) => w.workerId).filter((x): x is string => !!x));
  }

  /**
   * 실서버 가상 작업자 수(0~10). 늘리면 REAL_LINK.virtualAccounts 앞에서부터 각자 토큰으로 일을 시작한다.
   * 줄이면 들고 있는 작업을 마친 뒤 멈춘다(작업을 버려 두지 않음). 다른 기기(조회 전용)에서는 켜지 않는다.
   */
  /** 실서버 속도 배수(화면 슬라이더) — 서버 speedFactor 위에 곱한다. 1 = 그대로 */
  speedBoost = 1;
  setSpeedBoost(v: number) {
    this.speedBoost = Math.max(1, Math.min(REAL_WORKERS.speedBoostMax, v));
    for (const w of this.observedWorkers) w.setSpeed(this.params.walkSpeed * (this.real?.speedFactor(w.workerId) ?? 1) * this.speedBoost);
  }

  setVirtualWorkers(n: number) {
    const ctx = this.realCtx;
    if (!ctx || this.realTokens?.serverInjected) return;
    this.virtualTarget = Math.max(0, Math.min(REAL_LINK.virtualAccounts.length, this.layout.points.idle.length, n));
    const target = this.virtualTarget;
    for (const w of this.virtualWorkers) if (w.workerId && !w.skipped) this.virtualUsed.set(w.workerId, Date.now());
    // 이어 하기 작업자(resumeOnly)는 인원 수에 넣지 않는다 — 슬라이더가 그 계정까지 닿으면 보통 작업자로 바꾼다
    const active = this.virtualWorkers.filter((w) => !w.leaving && !w.left && !w.resumeOnly);
    // 켜는 순서: 서버에 끊긴 작업이 남은 계정부터(그 계정이 켜지면 다음 작업 받기가 들고 있던 작업·자기 PACK 을 먼저 준다), 나머지는 번호 순
    // (사용자 2026-11-19 "이미 주문에 대해서 피킹 시작한 계정있으면 그것부터 먼저 걸리는거지?")
    const cut = new Set(this.interruptedVirtual().map((c) => c.account));
    const order = [...REAL_LINK.virtualAccounts.filter((a) => cut.has(a)), ...REAL_LINK.virtualAccounts.filter((a) => !cut.has(a))];
    for (let k = 0; k < order.length && active.length < target; k++) {
      const account = order[k];
      const i = REAL_LINK.virtualAccounts.indexOf(account);
      const existing = this.virtualWorkers.find((w) => w.account === account);
      if (existing && !existing.left) {
        if (existing.resumeOnly) {
          existing.resumeOnly = false;
          active.push(existing);
        } else if (existing.leaving) {
          existing.leaving = false;
          active.push(existing);
        }
        continue;
      }
      const skippedAt = this.pdaAccounts.get(account);
      if (skippedAt !== undefined && Date.now() - skippedAt < REAL_LINK.pdaSkipSec * 1000) continue; // PDA 가 쓰는 중이던 계정
      active.push(this.spawnVirtual(account, i, false));
    }
    // 뒤에서부터 퇴근 요청
    for (let i = active.length - 1; i >= target; i--) active[i].leaving = true;
  }

  /**
   * 실제 PDA 작업자(가상 작업자 아님)를 열린 PICK·PACK 의 서버 상태로 세운다. 조회(polls)가 바뀔 때만 맞춘다.
   * PICK: 집품 등록된 칸 중 방문 순서가 가장 늦은 칸 앞(없으면 카트 자리), PACK: 패킹 대기 지점. 열린 작업이 없어지면 2분 뒤 뺀다.
   */
  private syncObservedWorkers() {
    const real = this.real;
    if (!real || real.polls === this.observedPoll) return;
    this.observedPoll = real.polls;
    this.rememberVirtual();
    const now = Date.now();
    const virtualIds = this.virtualWorkerIds();
    const rank: Record<string, number> = { IN_PROGRESS: 0, BLOCKED: 1, ASSIGNED: 2 };
    const byWorker = new Map<string, ReturnType<typeof real.tasks.get> & object>();
    for (const t of real.tasks.values()) {
      const s = t.summary;
      const wid = s.assignment?.workerId;
      if (t.closed || !wid || virtualIds.has(wid) || !(s.state in rank) || (s.taskType !== 'PICK' && s.taskType !== 'PACK' && s.taskType !== 'RETURN')) continue;
      const cur = byWorker.get(wid);
      if (!cur || rank[s.state] < rank[cur.summary.state]) byWorker.set(wid, t);
    }
    // 밀봉 끝 뒤 ⑤ 출하대기 랙: 서버는 마지막 밀봉에서 PACK 을 COMPLETED·출고 READY 로 바꾸고 랙 스캔은 모른다(BR-52 R20).
    // 그 작업자가 다른 작업을 받기 전이고 화면에서 "랙 찍음"을 안 눌렀으면 랙 단계로 둔다(사용자 2026-11-18 "랙 스캔이 안되는데 자동으로 랙에 옮겨졌어")
    for (const t of real.tasks.values()) {
      const wid = t.summary.assignment?.workerId;
      if (!wid || virtualIds.has(wid) || byWorker.has(wid) || !this.rackPending(t)) continue;
      byWorker.set(wid, t);
    }
    // 피킹 끝 ~ PDA "다음 작업 받기" 전: 그 주문 PACK 은 배정 전(READY·WAITING)이고 서버 pickedBy 만 이 사람 → 사라지지 않게
    // 카트를 끌고 포장대 앞에서 기다리는 모습으로 둔다(사용자 2026-11-19 "패킹하러가야하는데 말풍선도 안떠", "카트도 같이 안끌고가는데")
    // 서버가 PACK 에 pickedBy 를 적기 전이면 같은 출고 PICK 의 담당으로(사용자 2026-11-19 "패킹 한번 끊기고")
    const picker = new Map<string, string>();
    for (const t of real.tasks.values()) {
      const s = t.summary;
      if (s.taskType === 'PICK' && s.shipmentId && s.assignment?.workerId) picker.set(s.shipmentId, s.assignment.workerId);
    }
    for (const t of real.tasks.values()) {
      const s = t.summary;
      const wid = s.pickedBy ?? (s.shipmentId ? picker.get(s.shipmentId) : undefined);
      if (t.closed || !wid || s.assignment?.workerId || s.taskType !== 'PACK' || (s.state !== 'READY' && s.state !== 'WAITING')) continue;
      if (virtualIds.has(wid) || byWorker.has(wid)) continue;
      byWorker.set(wid, t);
    }
    const cart = this.backendPoint('CRT-A-01') ?? this.layout.points.cartDepot;
    for (const [wid, t] of byWorker) {
      const s = t.summary;
      let w = this.observedWorkers.find((x) => x.workerId === wid);
      const name = real.workerName(wid);
      const view = {
        taskId: s.taskId,
        taskType: s.taskType as 'PICK' | 'PACK' | 'RETURN',
        orderId: s.fulfillmentId,
        shipmentId: s.shipmentId ?? '',
        step: '',
        progress: '',
        location: null as string | null,
        nextLocation: null as string | null,
        temp: null as string | null,
        productName: null as string | null,
        barcode: null as string | null,
        plannedQty: null as number | null,
        pickedQty: null as number | null,
      };
      let target = cart;
      let key = `${s.taskId}:cart`;
      if (s.taskType === 'PICK') {
        const lines = t.detail?.lines ?? [];
        const stops = lines
          .flatMap((l) =>
            (l.picks ?? []).map((p) => {
              const locs = p.locations ?? [];
              const code = (locs.find((x) => (x.allocatedQty ?? 0) > 0) ?? locs[0])?.locationCode ?? l.locationId ?? null;
              return { l, p, code, seq: p.visitSeq ?? 9999 };
            }),
          )
          .sort((a, b) => a.seq - b.seq);
        const done = stops.filter((x) => x.p.remainingQty <= 0);
        const last = done[done.length - 1];
        const next = stops.find((x) => x.p.remainingQty > 0);
        const lastLoc = last?.code ? this.backendLocation(last.code) : null;
        if (lastLoc) {
          target = lastLoc.pick;
          key = `${s.taskId}:${last.code}`;
        }
        if (!w) {
          w = new ObservedWorker(`PDA ${name}`, wid, lastLoc ? target : cart, this.nav, this.params.walkSpeed);
          this.observedWorkers.push(w);
        }
        // 스캔 안내: PDA 와 같은 순서(nextPickStop)로 카트 → 지금 갈 칸에 세우고, 도착하면 찍을 바코드를 띄운다
        w.cue = null;
        const stop = s.state === 'ASSIGNED' || s.state === 'IN_PROGRESS' ? nextPickStop(lines) : null;
        // PDA 따라가기: 서버에 집품이 새로 오면(완료+접수 수량이 늘면) PDA 는 방금 그 칸을 지났다 → 아직 못 갔으면 그 칸으로 순간이동.
        // 서버는 다 집은 조각을 상세에서 빼므로 방금 집은 칸 = 본 조각(picksOf) 중 다 집은 것의 방문 순서 마지막
        const doneQty = lines.reduce((a, l) => a + l.completedQty + l.pendingQty, 0);
        const mark = `${s.taskId}:${doneQty}`;
        if (w.progressMark && w.progressMark !== mark && w.progressMark.startsWith(`${s.taskId}:`) && s.shipmentId) {
          const justDone = real.picksOf(s.shipmentId).filter((x) => x.gone && x.loc);
          const code = justDone.length ? justDone[justDone.length - 1].loc : (last?.code ?? null);
          const at = code ? this.backendLocation(code) : null;
          if (at) w.snapTo(at.pick);
        }
        w.progressMark = mark;
        // 카트를 찍었다 = 화면에서 "카트 QR 찍음"을 눌렀거나 서버에 집품이 생김(PDA 는 카트를 찍어야 칸·상품으로 넘어간다). 서버는 카트 스캔을 모른다
        const started = lines.some((l) => l.completedQty > 0 || l.pendingQty > 0) || w.passed.has(`${s.taskId}:CART`);
        if (stop) {
          const stopLoc = this.backendLocation(stop.location);
          if (!started) {
            target = cart;
            key = `${s.taskId}:cart`;
            w.cue = { kind: 'CART', taskId: s.taskId, cart: this.cartFor(s.shipmentId), next: stop };
          } else if (stopLoc) {
            target = stopLoc.pick;
            key = `${s.taskId}:${stop.location}:${stop.line.orderLineId}`;
            const total = lines.reduce((a, l) => a + l.plannedQty - l.cancelledQty, 0);
            const left = lines.reduce((a, l) => a + l.remainingQty, 0);
            w.cue = { kind: 'PICK', taskId: s.taskId, stop, index: total - left + 1, total };
          }
        }
        w.state = s.state === 'IN_PROGRESS' ? 'PICKING' : s.state === 'BLOCKED' ? 'ERROR' : 'TO_CART';
        // 카트는 카트 QR 을 찍은 뒤에만 든다(사용자 2026-11-17 "카트 큐알찍어야지 작업자가 카트 들게")
        w.hasCart = started;
        w.carrying = started ? this.cartLoad(s.shipmentId) : [];
        w.currentTarget = stop ? this.backendLocation(stop.location) : next?.code ? this.backendLocation(next.code) : null;
        view.progress = `${done.length} / ${stops.length}`;
        view.location = last?.code ?? null;
        view.nextLocation = stop?.location ?? next?.code ?? null;
        view.productName = stop?.line.productName ?? next?.l.productName ?? null;
        view.barcode = stop?.line.barcode ?? null;
        view.plannedQty = stop?.qty ?? next?.p.remainingQty ?? null;
        view.step = s.state === 'ASSIGNED' ? '배정됨 — 시작 전' : s.state === 'BLOCKED' ? '막힘(결품 등)' : last ? `집품 등록 ${last.code}` : '시작 — 카트';
        w.activity = `${s.state === 'IN_PROGRESS' ? '피킹' : view.step} ${view.progress}${last?.code ? ` · 마지막 ${last.code}` : ''}`;
      } else if (s.taskType === 'RETURN') {
        // 취소품 복귀: PDA 복귀 화면과 같은 조각(nextReturnPiece) — 출발 위치(장바구니·패킹대)에서 싣고 추천 선반 칸으로
        const lines = t.detail?.lines ?? [];
        const piece = s.state === 'ASSIGNED' || s.state === 'IN_PROGRESS' ? nextReturnPiece(lines) : null;
        if (!w) {
          w = new ObservedWorker(`PDA ${name}`, wid, (piece && this.backendPoint(piece.from)) ?? cart, this.nav, this.params.walkSpeed);
          this.observedWorkers.push(w);
        }
        w.cue = null;
        w.hasCart = false;
        w.carrying = [];
        w.currentTarget = null;
        target = cart;
        key = `${s.taskId}:ret`;
        const total = lines.reduce((a, l) => a + l.plannedQty - l.cancelledQty, 0);
        const left = lines.reduce((a, l) => a + l.remainingQty, 0);
        if (piece) {
          // "실었어요"는 서버가 모른다 — 화면에서 넘긴 표시(passScan). 실적이 서버에 오면 다음 조각으로 넘어간다
          const loaded = w.passed.has(`${s.taskId}:${piece.line.orderLineId}:${piece.lotId}:LOADED`);
          const to = piece.suggested[0] ?? null;
          const toLoc = to ? this.backendLocation(to) : null;
          if (loaded && toLoc) {
            target = toLoc.pick;
            key = `${s.taskId}:${to}:${piece.line.orderLineId}`;
            w.currentTarget = toLoc;
            w.hasCart = true;
          } else {
            target = this.backendPoint(piece.from) ?? cart;
            key = `${s.taskId}:${piece.from}:${piece.line.orderLineId}`;
          }
          w.cue = { kind: 'RETURN', taskId: s.taskId, step: loaded && toLoc ? 'TO' : 'FROM', piece, index: total - left + 1, total };
          view.location = piece.from;
          view.nextLocation = to;
          view.productName = piece.line.productName ?? null;
          view.barcode = piece.line.barcode ?? null;
          view.plannedQty = piece.left;
        }
        w.state = s.state === 'IN_PROGRESS' ? 'PICKING' : 'TO_CART';
        view.progress = `${total - left} / ${total}`;
        view.step = !piece ? (s.state === 'ASSIGNED' ? '복귀 배정됨' : '복귀 확정 대기') : w.cue?.kind === 'RETURN' && w.cue.step === 'TO' ? '복귀 ③ 선반 칸' : '복귀 ①② 출발 위치·싣기';
        w.activity = `${view.step} ${view.progress}`;
      } else {
        target = this.layout.points.packQueue;
        key = `${s.taskId}:pack`;
        if (!w) {
          w = new ObservedWorker(`PDA ${name}`, wid, target, this.nav, this.params.walkSpeed);
          this.observedWorkers.push(w);
        }
        w.state = s.state === 'IN_PROGRESS' ? 'PACKING' : 'WAIT_STATION';
        w.cue = null;
        w.hasCart = false;
        w.carrying = [];
        w.currentTarget = null;
        view.step = s.state === 'IN_PROGRESS' ? '포장 중' : '패킹 대기';
        // 스캔 안내(포장): PDA 포장 화면 단계 그대로(clients packing_screen.dart — 패킹대 → 카트 → 배차 요청 → 담기·밀봉 → 출하대기 랙)
        const pc = s.state === 'ASSIGNED' || s.state === 'IN_PROGRESS' || this.rackPending(t) ? this.packCue(w, t) : null;
        if (pc?.kind === 'PACK') {
          w.cue = pc;
          const at = this.backendPoint(pc.step === 'RACK' ? pc.rack : pc.station);
          if (at) {
            target = at;
            key = `${s.taskId}:${pc.step === 'RACK' ? pc.rack : pc.station}`;
          }
          // 피킹한 카트를 끌고 와 포장대에서 내린다 — PDA 가 배차 요청까지 빨리 가도 아바타가 포장대에 닿기 전엔 카트를 든 채로
          const stPt = this.backendPoint(pc.station);
          const atStation = !!stPt && !w.moving && Math.hypot(w.pos.x - stPt.x, w.pos.z - stPt.z) < 1.2;
          const cartScanned = w.passed.has(`${s.taskId}:PACK-CART`);
          w.hasCart = pc.step === 'STATION' || pc.step === 'CART' || (pc.step === 'DISPATCH' && !atStation && !cartScanned);
          // PDA 따라가기: 담기(서버에 배차 요청이 옴)·랙(밀봉 끝, READY) 단계면 PDA 는 이미 패킹대를 거쳤다 → 아직 걷는 중이면 패킹대로 순간이동.
          // 단계가 바뀔 때 한 번만(랙으로 걷는 중에 되돌리지 않게)
          const st = this.backendPoint(pc.station);
          const mark = `${s.taskId}:${pc.step}`;
          if (st && (pc.step === 'BAG' || pc.step === 'RACK') && w.progressMark !== mark) w.snapTo(st);
          w.progressMark = mark;
          w.carrying = w.hasCart ? this.cartLoad(s.shipmentId) : [];
          view.step = PACK_STEP_KO[pc.step];
          // ⑤ 랙: 아바타가 랙에 서고 rackAutoSec 지나면 랙에 둔 것으로(PDA 는 이미 다음 건, 서버는 모름) → 다음 조회 때 피킹 대기 자리로
          if (pc.step === 'RACK' && !w.moving && Math.hypot(w.pos.x - target.x, w.pos.z - target.z) < 0.6) {
            const since = this.rackArrived.get(s.taskId) ?? now;
            this.rackArrived.set(s.taskId, since);
            if (now - since >= REAL_LINK.rackAutoSec * 1000) w.passed.add(`${s.taskId}:PACK-RACK`);
          }
        } else if (!s.assignment?.workerId) {
          // 배정 전 PACK(pickedBy) — 카트 끌고 포장대 앞에서 "다음 작업 받기" 기다림
          w.cue = { kind: 'NEXT', taskId: s.taskId, shipmentId: s.shipmentId ?? '', cart: this.serverCart(s.shipmentId) };
          w.hasCart = true;
          w.carrying = this.cartLoad(s.shipmentId);
          view.step = '피킹 끝 · PDA 다음 작업 받기 전';
        }
        w.activity = view.step;
      }
      w.pda = view;
      w.lastSeenMs = now;
      // 걷는 속도 = 기본 × 서버 속도 배율(capacity speedFactor) — 실제 PDA 작업자 아바타도 그 사람 속도로
      w.setSpeed(this.params.walkSpeed * real.speedFactor(wid) * this.speedBoost);
      w.aim(target, key);
    }
    for (let i = this.observedWorkers.length - 1; i >= 0; i--) {
      const w = this.observedWorkers[i];
      if (byWorker.has(w.workerId)) continue;
      // 피킹이 막 끝나 PACK 이 그 사람 것으로 보이기 전(작업이 바뀌는 사이)은 그대로 둔다 — 바로 대기 자리로 보내면 카트를 내려놓고 갔다 다시 온다.
      // 랙까지 끝난 것(PACK·복귀)은 기다리지 않는다
      const between = w.cue?.kind === 'PICK' || w.cue?.kind === 'CART' || w.cue?.kind === 'NEXT';
      if (between && now - w.lastSeenMs < REAL_LINK.observedGraceSec * 1000) continue;
      w.state = 'IDLE';
      w.currentTarget = null;
      w.cue = null;
      w.hasCart = false;
      w.carrying = [];
      w.activity = '열린 작업 없음(서버) · 피킹 대기 자리';
      // 출하대기 랙까지 끝나면 피킹 대기 자리(카트 보관 앞)로 돌아가 다음 작업을 기다린다(사용자 2026-11-19 "출하대기 끝나면 다시 피킹대로")
      const spots = this.layout.points.idle;
      w.aim(spots[i % spots.length], 'home');
      if (now - w.lastSeenMs > REAL_LINK.observedIdleKeepSec * 1000) this.observedWorkers.splice(i, 1);
    }
  }

  /**
   * 지금 작업자가 끌고 있는 장바구니 코드 — 그 카트의 집품 재고(서버 PICKED)는 카트 보관 자리 대신 작업자 카트에 그린다.
   * 카트 ↔ 출고는 서버(PICK 실적 도착지·PACK packingLocations), 출고 ↔ 작업자는 서버 배정. 가상 작업자는 자기 카트 배정.
   */
  heldCarts(): Set<string> {
    const out = new Set<string>();
    for (const w of this.observedWorkers) {
      const sid = w.pda?.shipmentId;
      if (!w.hasCart || !sid) continue;
      const c = this.serverCart(sid);
      if (c) out.add(c);
    }
    for (const w of this.virtualWorkers) {
      const sid = w.pda?.shipmentId;
      if (!w.hasCart || !sid) continue;
      const c = this.carts.cartOf(sid) ?? this.serverCart(sid);
      if (c) out.add(c);
    }
    return out;
  }

  /** 관찰 작업자 카트 위 상자 = 서버가 아는 그 카트의 집품 수량(온도대는 집은 칸 코드 첫 글자) */
  private cartLoad(shipmentId: string | null | undefined): TemperatureZone[] {
    const real = this.real;
    const cart = this.serverCart(shipmentId);
    if (!real || !cart || !shipmentId) return [];
    const temp = new Map<string, TemperatureZone>();
    for (const x of real.picksOf(shipmentId)) if (x.loc) temp.set(x.line.sku, tempOfCode(x.loc) ?? 'AMBIENT');
    const out: TemperatureZone[] = [];
    for (const u of real.stockUnits())
      if (u.locationCode === cart && u.workState === 'PICKED') for (let i = 0; i < u.qty && out.length < 12; i++) out.push(temp.get(u.sku) ?? 'AMBIENT');
    return out;
  }

  /** 스캔 안내: 실제 PDA 로 카트를 찍었다고 화면에서 넘긴다 → 그 작업자를 첫 칸으로(서버는 카트 스캔을 모름) */
  passCart(workerId: string) {
    this.passScan(workerId);
  }

  /**
   * 스캔 안내: 서버가 모르는 스캔(피킹 카트, 포장의 패킹대·카트, 복귀의 "실었어요")을 실제 PDA 로 찍었다고 화면에서 넘긴다.
   * 서버를 부르지 않는다 — 다음 단계를 그리기 위한 표시일 뿐이다.
   */
  passScan(workerId: string, rack?: string) {
    const w = this.observedWorkers.find((x) => x.workerId === workerId);
    const c = w?.cue;
    if (!w || !c) return;
    if (c.kind === 'PACK' && c.step === 'RACK' && rack) this.rackChosen.set(c.shipmentId, rack);
    if (c.kind === 'CART') w.passed.add(`${c.taskId}:CART`);
    else if (c.kind === 'PACK' && (c.step === 'STATION' || c.step === 'CART' || c.step === 'RACK')) w.passed.add(`${c.taskId}:PACK-${c.step}`);
    else if (c.kind === 'RETURN' && c.step === 'FROM') w.passed.add(`${c.taskId}:${c.piece.line.orderLineId}:${c.piece.lotId}:LOADED`);
    else return;
    this.observedPoll = -1;
    this.syncObservedWorkers();
  }

  /** ⑤ 랙 단계에서 아바타가 랙에 선 시각(작업 ID → ms) — rackAutoSec 뒤 저절로 넘김 */
  private readonly rackArrived = new Map<string, number>();

  /** 출하대기 랙 2곳(백엔드 mfc_layout.py DISPATCH_STAGING) */
  readonly racks = ['DSP-A-01', 'DSP-A-02'] as const;
  /** 화면에서 "랙 N 찍음"으로 고른 랙(출고 → 랙). 서버는 랙을 모른다(R-20) — 이 화면에서만 */
  private readonly rackChosen = new Map<string, string>();
  /** 서버가 아는 그 출고의 출하대기 랙 — 포장 `stagingLocation`(fulfillment 0.20.0, F-12). 아직 안 올렸으면 null */
  serverRack(shipmentId: string): string | null {
    const pk = this.real?.shipmentInfo.get(shipmentId)?.data.packages ?? [];
    return pk.find((p) => p.stagingLocation)?.stagingLocation ?? null;
  }

  /** 그 출고 포장을 그릴 랙 — 서버 랙(F-12), 없으면 화면에서 고른 랙, 모르면 랙 1(추정) */
  rackFor(shipmentId: string): string {
    return this.serverRack(shipmentId) ?? this.rackChosen.get(shipmentId) ?? this.racks[0];
  }

  /** 가상 작업자가 올릴 랙 — 지금 포장이 적은 쪽(같으면 랙 1) [시뮬] */
  pickRack(): string {
    const n = new Map<string, number>(this.racks.map((r) => [r, 0]));
    for (const r of this.real?.shipments() ?? []) if (r.info?.state === 'READY' && this.onRack(r.shipmentId)) n.set(this.rackFor(r.shipmentId), (n.get(this.rackFor(r.shipmentId)) ?? 0) + 1);
    return [...this.racks].sort((a, b) => (n.get(a) ?? 0) - (n.get(b) ?? 0))[0];
  }

  /** 끝난 PACK 인데 ⑤ 랙을 아직 안 찍었다고 볼 것 — 출고 출하 대기(READY·부분 인계), 화면에서 "랙 찍음" 안 누름 */
  private rackPending(t: RealTask): boolean {
    const s = t.summary;
    if (s.taskType !== 'PACK' || t.closed?.state !== 'COMPLETED' || !s.shipmentId) return false;
    const st = this.real?.shipmentInfo.get(s.shipmentId)?.data.state;
    if (st !== 'READY' && st !== 'PARTIALLY_HANDED_OVER') return false;
    if (this.serverRack(s.shipmentId)) return false; // PDA 가 랙을 찍어 서버에 올라감(F-12)
    return !this.observedWorkers.some((w) => w.passed.has(`${s.taskId}:PACK-RACK`));
  }

  /**
   * 이 출고 포장이 출하대기 랙에 올라갔다고 볼까(그리기만 — 서버는 랙을 모름, R-20). PACK 이 끝났고 다음 중 하나:
   * 화면에서 "랙 찍음"을 눌렀다 · 포장한 작업자가 다른 작업을 받았다(PDA 는 랙을 찍어야 "패킹 끝" → 다음 작업) · 가상 작업자가 포장했다
   */
  onRack(shipmentId: string): boolean {
    const real = this.real;
    if (!real) return false;
    if (this.serverRack(shipmentId)) return true; // 서버가 안다(F-12)
    const pack = [...real.tasks.values()].find((t) => t.summary.taskType === 'PACK' && t.summary.shipmentId === shipmentId);
    if (!pack || pack.closed?.state !== 'COMPLETED') return false;
    const wid = pack.summary.assignment?.workerId;
    if (!wid || this.virtualWorkerIds().has(wid)) return true;
    if (this.observedWorkers.some((w) => w.passed.has(`${pack.summary.taskId}:PACK-RACK`))) return true;
    return [...real.tasks.values()].some((t) => !t.closed && t.summary.assignment?.workerId === wid && t.summary.shipmentId !== shipmentId);
  }

  /** 포장 스캔 안내 — 서버가 아는 것(배차 요청·밀봉한 포장·출고 READY)과 화면에서 넘긴 스캔으로 지금 단계를 정한다 */
  /**
   * 서버가 아는 그 출고의 장바구니 — 같은 출고 PACK 상세의 packingLocations(PICK 실적 도착지) 중 CRT-.
   * 한 출고 = 한 장바구니(fulfillment 0.8.0). 첫 집품 전에는 서버가 모른다.
   */
  serverCart(shipmentId: string | null | undefined): string | null {
    if (!shipmentId || !this.real) return null;
    for (const x of this.real.tasks.values()) {
      if (x.summary.shipmentId !== shipmentId) continue;
      const c = (x.detail?.packingLocations ?? []).find((v) => v.startsWith('CRT-'));
      if (c) return c;
    }
    return null;
  }

  private cartHint = { polls: -1, map: new Map<string, string>() };
  /**
   * 그 출고의 장바구니 — 서버가 알면(첫 집품 뒤) 그 카트, 아니면 안내 카트(suggestCarts: 쓰는 카트를 뺀 빈 카트를 출고마다 하나씩).
   * 쓰는 카트 = 아직 안 끝난 PACK 의 packingLocations 중 CRT-(서버 PICK 실적 도착지). 조회마다 한 번 계산.
   */
  cartFor(shipmentId: string | null | undefined): string {
    const real = this.real;
    const known = this.serverCart(shipmentId);
    if (known || !real || !shipmentId) return known ?? BACKEND_FACTS.cartLocations[0].code;
    if (this.cartHint.polls !== real.polls) {
      const used = new Set<string>();
      const needing: { shipmentId: string; createdAt: string }[] = [];
      for (const t of real.tasks.values()) {
        const s = t.summary;
        if (s.taskType === 'PACK' && !t.closed && s.state !== 'COMPLETED' && s.state !== 'CANCELLED')
          for (const c of t.detail?.packingLocations ?? []) if (c.startsWith('CRT-')) used.add(c);
        if (s.taskType === 'PICK' && !t.closed && s.shipmentId && !this.serverCart(s.shipmentId)) needing.push({ shipmentId: s.shipmentId, createdAt: s.createdAt });
      }
      this.cartHint = { polls: real.polls, map: suggestCarts(BACKEND_FACTS.cartLocations.map((c) => c.code), used, needing) };
    }
    return this.cartHint.map.get(shipmentId) ?? BACKEND_FACTS.cartLocations[0].code;
  }

  private packCue(w: ObservedWorker, t: RealTask): ScanCue | null {
    const real = this.real!;
    const s = t.summary;
    const shipmentId = s.shipmentId;
    const d = t.detail;
    if (!shipmentId || !d) return null;
    const info = real.shipmentInfo.get(shipmentId)?.data ?? null;
    const live = (info?.packages ?? []).filter((p) => p.state !== 'INVALIDATED' && p.state !== 'VOIDED');
    // 패킹대: 예전 흐름(포장 위치로 집품)이면 packingLocations 의 PAK-, 아니면 패킹대 1 [시뮬] — PDA 는 PAK- 면 받는다.
    // 장바구니로 집품하면 packingLocations 는 장바구니라(fulfillment 0.8.0) 어느 패킹대인지 화면에 주는 값이 없다(Package 에 위치 없음)
    const station = (d.packingLocations ?? []).find((x) => x.startsWith('PAK-')) ?? 'PAK-A-01';
    // 카트: 서버가 아는 이 출고의 장바구니(PICK 실적 도착지) → 없으면 안내용 카트
    const cart = (d.packingLocations ?? []).find((x) => x.startsWith('CRT-')) ?? this.cartFor(shipmentId);
    const packed = new Map<string, number>();
    for (const p of live) for (const x of p.contents as { orderLineId: string; qty: number }[]) packed.set(x.orderLineId, (packed.get(x.orderLineId) ?? 0) + x.qty);
    const bag = d.lines.map((line) => ({ line, left: line.plannedQty - line.cancelledQty - (packed.get(line.orderLineId) ?? 0) })).filter((x) => x.left > 0);
    // PDA(packing_screen.dart, 클라이언트 cc4507c)는 패킹대·카트를 화면 안 상태로만 들어 배차 요청이 이미 있어도 ① 패킹대 → ② 카트부터 묻는다.
    // 서버로 넘었다고 볼 수 있는 건 밀봉한 포장뿐(밀봉 = 패킹대·카트를 찍은 뒤의 ④). 배차 요청은 피킹 전에도 올 수 있다(fulfillment 0.14.0)
    const serverPast = live.length > 0;
    const step: PackStep =
      !serverPast && !w.passed.has(`${s.taskId}:PACK-STATION`)
        ? 'STATION'
        : !serverPast && !w.passed.has(`${s.taskId}:PACK-CART`)
          ? 'CART'
          : !info?.dispatchRequest
            ? 'DISPATCH'
            : info.state !== 'READY'
              ? 'BAG'
              : 'RACK';
    return { kind: 'PACK', taskId: s.taskId, shipmentId, step, station, cart, rack: 'DSP-A-01', bag };
  }

  private realRiderVer = -1;
  /**
   * 앞마당 라이더(M-02, 그리기만): 배송 ARRIVED_AT_STORE 를 처음 보면 라이더를 세우고, 출고 인계됨·배송 픽업 뒤·배정 해제·화면에서 빠짐이면 떠나보낸다.
   * 배차·배송 상태가 바뀔 때(deliveryVersion)만 본다.
   */
  private syncRealRiders() {
    const real = this.real;
    if (!real || real.deliveryVersion === this.realRiderVer) return;
    this.realRiderVer = real.deliveryVersion;
    const live = new Map<string, { arrived: boolean; gone: boolean; riderId: string | null; handed: number; vehicle: string | null }>();
    for (const r of real.shipments()) {
      const d = r.delivery;
      if (!d) continue;
      const handed = (r.info?.packages ?? []).filter((p) => p.state === 'HANDED_OVER').length;
      const shipmentDone = r.info?.state === 'HANDED_OVER';
      live.set(d.deliveryId, {
        arrived: d.state === 'ARRIVED_AT_STORE',
        // 떠남: 출고 인계됨, 또는 배송이 도착·배정 상태를 벗어남(픽업 뒤·배정 해제 UNASSIGNED·취소)
        gone: shipmentDone || !['ASSIGNED', 'ARRIVED_AT_STORE'].includes(d.state),
        riderId: d.riderId,
        handed,
        vehicle: r.dispatch?.assignment?.vehicleType ?? null,
      });
    }
    const mine = this.riders.filter((x): x is RealRider => x instanceof RealRider);
    for (const rr of mine) {
      const s = live.get(rr.deliveryId);
      if (!s) rr.depart(0);
      else if (s.gone) rr.depart(s.handed);
      else rr.updateVehicle(s.vehicle); // 배차 상세가 늦게 오면 처음엔 기본 수단 — 오면 바꾼다
    }
    for (const [deliveryId, s] of live) {
      if (!s.arrived || s.gone || mine.some((x) => x.deliveryId === deliveryId)) continue;
      const used = new Set(mine.filter((x) => !x.done).map((x) => `${x.parking.x},${x.parking.z}`));
      const parking = this.layout.points.riderParking.find((p) => !used.has(`${p.x},${p.z}`)) ?? this.layout.points.riderParking[0];
      let id = s.riderId ?? deliveryId.slice(0, 12);
      if (this.riders.some((x) => x.id === id)) id = `${id} (${deliveryId.slice(4, 8)})`;
      const rr = new RealRider(id, deliveryId, parking, this.layout.points.riderEntry, this.layout.points.riderPickup, this.nav, s.vehicle);
      this.riders.push(rr);
      mine.push(rr);
      void rr.run();
      this.log(`라이더 ${id} 가게 도착 (배송 ${deliveryId.slice(0, 12)}…)`);
    }
  }

  get virtualWorkerCount(): number {
    return this.virtualWorkers.filter((w) => !w.leaving && !w.left).length;
  }

  // ── 설정 변경 ───────────────────────────────────────
  setWorkers(n: number) {
    if (this.mode !== 'mock') return;
    const target = Math.max(1, Math.min(this.layout.points.idle.length, n));
    while (this.workers.length < target) {
      const i = this.workers.length;
      const id = `W${String(i + 1).padStart(2, '0')}`;
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

  setInboundWorkers(n: number) {
    if (!this.mock) return;
    const target = Math.max(0, Math.min(this.layout.points.inboundIdle.length, n));
    while (this.inboundWorkers.length < target) {
      const i = this.inboundWorkers.length;
      const w = new InboundWorker(`IB${i + 1}`, this.layout.points.inboundIdle[i], this.inCtx);
      this.inboundWorkers.push(w);
      void w.run();
    }
    for (let i = this.inboundWorkers.length - 1; i >= 0 && this.inboundWorkers.length > target; i--) {
      const w = this.inboundWorkers[i];
      if (w.idle) {
        w.stop();
        w.give(null);
        this.inboundWorkers.splice(i, 1);
      }
    }
    this.params.inboundWorkers = this.inboundWorkers.length;
  }

  setStations(n: number) {
    this.stations.setActive(n);
    this.params.packingStations = this.stations.activeCount;
  }

  // ── 진행 ───────────────────────────────────────────
  /** 실제 경과 dtReal(초)에 배속을 곱해 진행한다. */
  async advance(dtReal: number) {
    if (this.real) {
      // 실서버 관찰: 시계는 실제 시각, 일시정지(0×)면 조회도 멈춘다. 조회는 기다리지 않는다(화면이 멈추지 않게)
      if (this.speed === 0) return;
      const prev = this.time;
      this.time = wallClockSec();
      void this.real.tick();
      this.syncRealRiders();
      this.syncObservedWorkers();
      if (this.virtualWorkers.length || this.riders.length || this.observedWorkers.length) {
        // 가상 작업자·앞마당 라이더는 실제 시간으로 걷고 기다린다(1×)
        const dt = Math.max(0, Math.min(this.time - prev, 0.25));
        for (const w of this.virtualWorkers) w.tick(dt);
        for (const r of this.riders) r.tick(dt);
        for (const w of this.observedWorkers) w.tick(dt);
        this.stations.tick(dt);
        for (let i = 0; i < 40; i++) await Promise.resolve();
        this.riders = this.riders.filter((r) => !r.done);
      }
      return;
    }
    let remain = Math.min(dtReal, 0.1) * this.speed;
    while (remain > 1e-6) {
      const dt = Math.min(SUBSTEP, remain);
      remain -= dt;
      this.time += dt;
      if (this.mode === 'mock') {
        this.generateOrders();
        this.dispatch();
        this.resolveShortages();
        this.inboundTick(dt);
      }
      for (const w of this.workers) w.tick(dt);
      for (const r of this.riders) r.tick(dt);
      for (const w of this.inboundWorkers) w.tick(dt);
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
    const decision = mock.orchestrationConfirmOrder(req, temps, meta);
    if (decision.decision !== 'ACCEPTED' || !decision.fulfillmentId) {
      this.log(`${orderId} 작업 거절 ${decision.rejectReason ?? ''}`);
      return;
    }
    const fulfillmentId = decision.fulfillmentId;
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

  // ── 결품 사가 (mock: order-orchestration 역할) ──────────
  /** 결품 보고로 BLOCKED 된 PICK 을 사가 지연 뒤 CANCEL_ITEM 으로 푼다(고객 사전 선택 "품절 상품만 취소"). */
  private readonly blockedSince = new Map<string, number>();
  private resolveShortages() {
    const mock = this.mock!;
    for (const taskId of mock.blockedForShortage()) {
      const since = this.blockedSince.get(taskId);
      if (since === undefined) this.blockedSince.set(taskId, this.time);
      else if (this.time - since >= this.params.shortageSagaSec) {
        this.blockedSince.delete(taskId);
        mock.orchestrationResolveShortages(taskId);
      }
    }
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

  // ── 출하대기·라이더 ─────────────────────────────────
  private onStaged(shipmentId: string, pkgs: Package[]) {
    this.shipRack.place(shipmentId, pkgs);
    this.stagedShipments.add(shipmentId);
    const orderId = this.shipmentOrder.get(shipmentId);
    if (orderId) {
      const all = this.orderShipments.get(orderId);
      if (all && [...all].every((s) => this.stagedShipments.has(s) || this.isCancelled(s))) this.metrics.markReady(orderId, this.time);
    }
  }

  /**
   * MOCK: 점원이 배차를 요청하면(패킹 시작 때 — fulfillment 0.4.11, 자동 요청 없음) 그때부터 라이더가 온다.
   * 라이더는 도착 시각이 지나고 출고가 출하대기(READY)일 때 들어와 인계한다 — 포장이 늦으면 그동안 기다린다(spawnRiders).
   */
  private onDispatchRequested(shipmentId: string) {
    if (this.mode !== 'mock' || this.pendingRiders.some((p) => p.shipmentId === shipmentId)) return;
    const delay = this.opsRng.range(this.params.riderArrivalMinSec, this.params.riderArrivalMaxSec);
    this.pendingRiders.push({ at: this.time + delay, shipmentId });
  }

  private isCancelled(shipmentId: string): boolean {
    return this.mock?.allShipments().find((s) => s.shipmentId === shipmentId)?.state === 'CANCELLED';
  }

  private spawnRiders() {
    for (let i = this.pendingRiders.length - 1; i >= 0; i--) {
      const p = this.pendingRiders[i];
      if (this.isCancelled(p.shipmentId)) {
        this.pendingRiders.splice(i, 1); // 출고 취소 — 배차도 끝(MOCK)
        continue;
      }
      if (this.time < p.at || !this.stagedShipments.has(p.shipmentId)) continue; // 배차 요청 뒤 도착 + 출하대기
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

  // ── 입고·적치·보충 (mock) ────────────────────────────
  /** 입고 차량을 지금 부른다 (화면 버튼). */
  callTruck(): string | null {
    if (!this.mock) return null;
    const lines = this.planInbound();
    if (lines.length === 0) {
      this.log('입고 차량: 보충이 필요한 SKU 가 없어 출발하지 않음');
      return null;
    }
    this.truckSeq += 1;
    const trfId = `TRF-${String(this.truckSeq).padStart(4, '0')}`;
    for (const l of lines) this.inTransit.set(l.sku, (this.inTransit.get(l.sku) ?? 0) + l.qty);
    this.mock.inboundExpect(trfId, lines);
    this.trucks.push({ trfId, lines, state: 'APPROACHING', x: 80, unloaded: 0, scheduledAt: this.time });
    this.log(`${trfId} 입고 차량 출발 — ${lines.length}품목 ${lines.reduce((a, l) => a + l.qty, 0)}개`);
    return trfId;
  }

  /**
   * 보충 필요량 (시뮬 규칙): 목표 = 칸 한도 × 2 (칸 1개분 + 보충재고 1개분), 보유 = 선반 + 보충재고 + 미적치 + 수송 중.
   * 실제 공급 계산은 SCM(replenishment) 의 S·IP·N 산식이다(flows/replenishment-transfer.md §1) — 여기서는 흉내만 낸다.
   */
  private planInbound(): { sku: string; qty: number }[] {
    const inv = this.mock!.inventory;
    const cand: { sku: string; qty: number; urgency: number }[] = [];
    for (const s of this.catalog) {
      const b = inv.get(s.sku)!;
      const have = b.shelf + b.reserve + b.unstowed + (this.inTransit.get(s.sku) ?? 0);
      const need = s.shelfCap * 2 - have;
      if (need < s.shelfCap * 0.5) continue;
      const qty = Math.ceil(need / s.caseQty) * s.caseQty;
      cand.push({ sku: s.sku, qty, urgency: need / s.shelfCap + s.weight * 5 });
    }
    cand.sort((a, b) => b.urgency - a.urgency);
    return cand.slice(0, this.params.inboundMaxLines).map(({ sku, qty }) => ({ sku, qty }));
  }

  private inboundTick(dt: number) {
    // 정기 차량
    if (this.time >= this.nextTruckAt) {
      this.callTruck();
      this.nextTruckAt = this.time + this.params.inboundIntervalHours * 3600;
    }
    // 차량 이동 (도로 → 입고 차량문)
    const dockX = this.layout.points.truckDock.x;
    for (const t of this.trucks) {
      if (t.state === 'APPROACHING') {
        t.x = Math.max(dockX, t.x - 7 * dt);
        if (t.x <= dockX) {
          t.state = 'DOCKED';
          this.metrics.inbound.trucksArrived += 1;
        }
      } else if (t.state === 'DONE') {
        t.state = 'LEAVING';
      } else if (t.state === 'LEAVING') {
        t.x += 7 * dt;
        if (t.x > 85) t.state = 'GONE';
      }
    }
    this.trucks = this.trucks.filter((t) => t.state !== 'GONE');
    // 보충 점검 (15초마다): 피킹 칸 C ≤ min 이고 보충재고가 있으면 MOV (IV-04)
    if (this.time - this.lastReplenishScan >= 15) {
      this.lastReplenishScan = this.time;
      const inv = this.mock!.inventory;
      for (const s of this.catalog) {
        const b = inv.get(s.sku)!;
        if (b.shelf <= s.minQty && b.reserve > 0) this.requestReplenish(s.sku, false);
      }
    }
    this.dispatchInbound();
  }

  private requestReplenish(sku: string, urgent: boolean) {
    if (!this.mock) return;
    const b = this.mock.inventory.get(sku);
    if (!b || b.reserve <= 0 || this.replenishActive.has(sku)) return;
    const q = this.replenishQueue.find((x) => x.sku === sku);
    if (q) {
      if (urgent && !q.urgent) {
        q.urgent = true;
        this.replenishQueue.splice(this.replenishQueue.indexOf(q), 1);
        this.replenishQueue.unshift(q);
      }
      return;
    }
    if (urgent) this.replenishQueue.unshift({ sku, urgent });
    else this.replenishQueue.push({ sku, urgent });
    const meta = this.skuMap.get(sku);
    this.onEvent({
      at: this.time,
      type: 'ReplenishmentMoveCreated',
      summary: `${urgent ? '긴급 ' : ''}MOV ${sku} ${meta?.reserveId} → ${meta?.location.code}`,
    });
  }

  /** 입고 작업 배정 우선순위: 하차·검수 → 긴급 보충 → 적치(냉동·냉장 먼저) → 일반 보충. [시뮬] */
  private dispatchInbound() {
    for (const w of this.inboundWorkers) {
      if (!w.idle) continue;
      const job = this.nextInboundJob();
      if (!job) return;
      w.give(job);
    }
  }

  private nextInboundJob(): InboundJob | null {
    const docked = this.trucks.find((t) => t.state === 'DOCKED' && !this.receiving.has(t.trfId));
    if (docked) {
      this.receiving.add(docked.trfId);
      return { kind: 'RECEIVE', truck: docked };
    }
    const takeReplenish = (urgentOnly: boolean): InboundJob | null => {
      const i = this.replenishQueue.findIndex((q) => !urgentOnly || q.urgent);
      if (i < 0) return null;
      const [q] = this.replenishQueue.splice(i, 1);
      this.replenishActive.add(q.sku);
      return { kind: 'REPLENISH', sku: q.sku, urgent: q.urgent };
    };
    const urgent = takeReplenish(true);
    if (urgent) return urgent;
    const ready = this.dockItems.filter((it) => it.state === 'RECEIVED' && !this.claimed.has(it.id));
    if (ready.length) {
      const rank = { FROZEN: 0, CHILLED: 1, AMBIENT: 2 } as const;
      ready.sort((a, b) => rank[a.temp] - rank[b.temp]);
      const temp = ready[0].temp;
      const items = ready.filter((it) => it.temp === temp).slice(0, this.params.putawayCartLines);
      for (const it of items) this.claimed.add(it.id);
      return { kind: 'PUTAWAY', items };
    }
    return takeReplenish(false);
  }

  private placeOnDock(it: DockItem) {
    const slot: DockSlot | undefined = this.layout.dockSlots.find((s) => !this.dockUsed.has(s.id));
    if (slot) {
      this.dockUsed.add(slot.id);
      it.slot = slot;
    } else {
      it.floorPos = { x: 38.4 + (this.dockItems.length % 6) * 0.5, z: 21.8 };
    }
    this.dockItems.push(it);
  }

  private releaseDock(it: DockItem) {
    if (it.slot) this.dockUsed.delete(it.slot.id);
    const i = this.dockItems.indexOf(it);
    if (i >= 0) this.dockItems.splice(i, 1);
    this.claimed.delete(it.id);
  }

  private onTruckReceived(t: Truck) {
    t.state = 'DONE';
    this.receiving.delete(t.trfId);
    this.metrics.inbound.trucksReceived += 1;
    for (const l of t.lines) this.inTransit.set(l.sku, Math.max(0, (this.inTransit.get(l.sku) ?? 0) - l.qty));
  }

  inboundBoard() {
    return {
      putawayLines: this.dockItems.filter((d) => d.state !== 'TAKEN').length,
      replenishQueued: this.replenishQueue.length,
      replenishActive: this.replenishActive.size,
      trucks: this.trucks.filter((t) => t.state !== 'LEAVING').length,
      nextTruckAt: this.nextTruckAt,
    };
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
  /**
   * 선반이 아닌 백엔드 위치(패킹대·패킹 대기·출하대기·입고·회수 자리) → 바닥 좌표. 선반 칸·평면에 없는 위치는 null.
   * 대응은 locationCodes.ts(백엔드 mfc_layout.py) 그대로.
   */
  backendPoint(code: string): { x: number; z: number } | null {
    const simCode = this.codes.toSim(code);
    if (!simCode) return null;
    const P = this.layout.points;
    const st = this.layout.stations.find((x) => x.id === simCode);
    if (st) return st.table;
    if (simCode === SIM_POINT.packQueue) return P.packQueue;
    if (simCode === SIM_POINT.packQueueFrozen) return { x: P.packQueue.x, z: P.packQueue.z + 0.9 };
    if (simCode === SIM_POINT.cartDepot) return P.cartDepot;
    if (simCode === SIM_POINT.receiving) return P.truckDoor;
    if (simCode === SIM_POINT.returnIntake) return { x: BACKEND_FACTS.returnIntake.x, z: BACKEND_FACTS.returnIntake.z };
    const rs = this.reserveMap.get(simCode);
    if (rs) return { x: (rs.rect.x0 + rs.rect.x1) / 2, z: (rs.rect.z0 + rs.rect.z1) / 2 };
    const rack = /^SHIP-RACK-(\d+)$/.exec(simCode);
    if (rack) {
      const slot = this.layout.shippingSlots.find((x) => x.rackIndex === Number(rack[1]) - 1);
      if (slot) return { x: slot.pos.x, z: slot.pos.z };
    }
    return null;
  }

  /** 백엔드 위치 코드 → 평면의 선반 칸 (실서버 관찰 표시용). 평면에 없는 위치면 null */
  backendLocation(code: string): Location | null {
    const sim = this.codes.toSim(code);
    return sim ? (this.locByCode.get(sim) ?? null) : null;
  }

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

const KNOWN_VIRTUAL_KEY = 'pmart-sim-virtual-operators';

/** sessionStorage 에서(없거나 막히면 빈 것) — 운영자 ID → 가상 작업자 계정 */
function loadKnownVirtual(): Map<string, string> {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KNOWN_VIRTUAL_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return new Map(Object.entries(obj).filter(([, v]) => typeof v === 'string'));
  } catch {
    return new Map();
  }
}

function saveKnownVirtual(m: Map<string, string>) {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(KNOWN_VIRTUAL_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* 저장 못 해도 이 화면에서는 그대로 */
  }
}
