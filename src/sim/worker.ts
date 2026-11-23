// 피킹·패킹 겸업 작업자 (MFC 1장 운영 원칙: 피킹과 패킹은 같은 작업자가 수행할 수 있다).
// 모든 수량 변화는 계약 API 응답으로만 확정한다 — 화면의 진행 표시는 서버 응답을 받은 뒤 바꾼다.

import { ApiProblem, ResultUnknown, type Package, type TaskDetail, type TemperatureZone } from '../domain/contract';
import type { Location } from '../domain/layout';
import { packDropPoint } from '../domain/locationCodes';
import type { P } from '../domain/navgrid';
import { Agent } from './agent';
import type { SiteContext } from './context';

export type WorkerState = 'IDLE' | 'TO_CART' | 'PICKING' | 'WAIT_STATION' | 'PACKING' | 'TO_SHIP' | 'RETURNING' | 'ERROR';

export interface PdaView {
  taskId: string;
  /** MOCK 작업자는 PICK·PACK 만. 실서버 가상 작업자는 재고 이동·품질검사(RETURN·PUTAWAY·REPLENISH·MOVE·INSPECT)도, 실제 PDA 작업자 표시는 RETURN 도 */
  taskType: 'PICK' | 'PACK' | 'RETURN' | 'PUTAWAY' | 'REPLENISH' | 'MOVE' | 'INSPECT';
  orderId: string;
  shipmentId: string;
  step: string;
  progress: string;
  location: string | null;
  nextLocation: string | null;
  temp: string | null;
  productName: string | null;
  barcode: string | null;
  plannedQty: number | null;
  pickedQty: number | null;
  /** 이번 피킹에서 고를 상품 목록(따라가기 때 왼쪽 패널) — 집은 수량·완료는 서버 응답을 받은 뒤에만 바꾼다. 패킹 중에도 남는다 */
  basket?: BasketLine[];
}

export interface BasketLine {
  name: string;
  location: string;
  temp: string | null;
  planned: number;
  picked: number;
  /** TODO 아직 / NOW 지금 가는 중·집는 중 / DONE 집음(서버 확정) / SHORT 결품 보고 */
  state: 'TODO' | 'NOW' | 'DONE' | 'SHORT';
}

/** 화면(3D·카드·요약)이 보는 작업자 모양 — MOCK 작업자(Worker)와 실서버 가상 작업자(RealWorker) 공통 */
export interface SiteWorker {
  readonly id: string;
  pos: P;
  heading: number;
  path: P[];
  distance: number;
  activity: string;
  state: WorkerState;
  pda: PdaView | null;
  hasCart: boolean;
  carrying: TemperatureZone[];
  busySeconds: number;
  ordersDone: number;
  currentTarget: Location | null;
  readonly idle: boolean;
}

export interface Job {
  taskId: string;
  assignmentVersion: number;
}

const TEMP_KO: Record<TemperatureZone, string> = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' };
const ZONE_RANK_DOC: Record<string, number> = { B: 0, A: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7 };
const ZONE_RANK_AMBIENT: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, H: 5, B: 6, A: 7 };

export class Worker extends Agent {
  state: WorkerState = 'IDLE';
  pda: PdaView | null = null;
  hasCart = false;
  carrying: TemperatureZone[] = [];
  busySeconds = 0;
  ordersDone = 0;
  currentTarget: Location | null = null;
  private jobResolver: ((j: Job) => void) | null = null;
  private readonly home: P;

  constructor(
    id: string,
    home: P,
    private readonly ctx: SiteContext,
  ) {
    super(id, home, ctx.nav, ctx.params.walkSpeed);
    this.home = home;
  }

  get idle(): boolean {
    return this.jobResolver !== null;
  }

  /** 디스패처(배정 정본 역할)가 PICK 작업을 넘긴다. */
  give(job: Job) {
    const r = this.jobResolver;
    this.jobResolver = null;
    r?.(job);
  }

  override tick(dt: number) {
    super.tick(dt);
    if (this.state !== 'IDLE') this.busySeconds += dt;
  }

  async run() {
    while (!this.stopped) {
      this.state = 'IDLE';
      this.activity = '작업 대기';
      this.pda = null;
      const job = await new Promise<Job>((resolve) => (this.jobResolver = resolve));
      if (this.stopped) break;
      try {
        await this.doOrder(job);
        this.ordersDone += 1;
      } catch (e) {
        this.state = 'ERROR';
        this.activity = `오류: ${e instanceof ApiProblem ? e.problem.code : (e as Error).message}`;
        this.ctx.log(`${this.id} 작업 중단 — ${this.activity}`);
        this.ctx.metrics.apiErrors += 1;
        await this.wait(30);
      }
      this.hasCart = false;
      this.carrying = [];
      this.currentTarget = null;
      this.state = 'RETURNING';
      this.activity = '대기 위치로';
      await this.walkTo(this.home);
    }
  }

  private key(op: string, taskId: string, extra = ''): string {
    return `${this.ctx.runId}:${op}:${taskId}${extra}`;
  }

  /** 결과 불명(응답 없음)은 같은 키로 재전송한다. 업무 거절은 그대로 올린다. */
  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const retryable = e instanceof ResultUnknown || (e instanceof ApiProblem && e.problem.retryable === true);
        if (!retryable || attempt >= 4) throw e;
        this.activity = `응답 확인 중… (재전송 ${attempt + 1})`;
        await this.wait(2 * (attempt + 1));
      }
    }
  }

  private async doOrder(job: Job) {
    const { ctx } = this;
    const port = ctx.port;

    // ── 1. 피킹 작업 시작 점유 (WK-03) ──
    let task: TaskDetail = await port.getTask(job.taskId);
    const orderId = ctx.orderOf(task.fulfillmentId) ?? task.fulfillmentId;
    const shipmentId = task.shipmentId!;
    await this.retry(() =>
      port.startTask(job.taskId, { workerId: this.id, assignmentVersion: job.assignmentVersion, deviceId: `PDA-${this.id}` }, this.key('start', job.taskId)),
    );
    const trace = ctx.metrics.trace(orderId);
    if (trace && trace.pickStartAt === undefined) trace.pickStartAt = ctx.now();

    // ── 2. 장바구니 ──
    this.state = 'TO_CART';
    this.activity = '장바구니 가지러';
    await this.walkTo(ctx.layout.points.cartDepot);
    await this.wait(8);
    this.hasCart = true;

    // ── 3. 로케이션 순회 ──
    // 실서버(0.4.10)는 피킹 시작 뒤 상세의 picks[].visitSeq 가 방문 순서다(냉장 → 냉동 → 상온 C~H, 그룹 안 최단 — ADR-0050).
    // 받은 순서가 없으면(MOCK, 또는 순서를 못 받은 경우) 시뮬레이터 규칙(구역 순 + 가장 가까운 칸)으로 걷는다.
    this.state = 'PICKING';
    task = await port.getTask(job.taskId);
    const rank = ctx.params.pickSequence === 'DOC_B_A_C' ? ZONE_RANK_DOC : ZONE_RANK_AMBIENT;
    const lines = task.lines
      .filter((l) => l.remainingQty > 0)
      .map((l) => {
        const first = l.picks?.find((p) => p.remainingQty > 0);
        const code = first?.locations[0]?.locationCode ?? l.locationId;
        const loc = (code ? ctx.simLocation(code) : null) ?? ctx.skuMap.get(l.sku)?.location ?? null;
        return { l, loc, seq: first?.visitSeq ?? null, lotId: first?.lotId };
      })
      .filter((x): x is { l: (typeof task.lines)[number]; loc: Location; seq: number | null; lotId: string | undefined } => x.loc !== null);
    const ordered = lines.every((x) => x.seq !== null)
      ? [...lines].sort((a, b) => a.seq! - b.seq!)
      : routeOrder(lines, this.pos, (x) => rank[x.loc.code[0]] ?? 9);
    // 집은 상품을 내려놓는 포장 위치 = 패킹 대기 지점의 온도대 칸(냉동 PAK-F-01, 냉장·상온 PAK-C-01) — 피킹이 끝나면 그리로 간다
    const basket: BasketLine[] = ordered.map(({ l, loc }) => {
      const sk = ctx.skuMap.get(l.sku)!;
      return { name: sk.name, location: loc.code, temp: TEMP_KO[sk.temp], planned: l.remainingQty, picked: 0, state: 'TODO' };
    });
    for (let i = 0; i < ordered.length; i++) {
      const { l, loc, lotId } = ordered[i];
      const sku = ctx.skuMap.get(l.sku)!;
      this.currentTarget = loc;
      basket[i].state = 'NOW';
      this.pda = {
        basket,
        taskId: task.taskId,
        taskType: 'PICK',
        orderId,
        shipmentId,
        step: '로케이션 이동',
        progress: `${i + 1} / ${ordered.length}`,
        location: loc.code,
        nextLocation: ordered[i + 1]?.loc.code ?? null,
        temp: TEMP_KO[sku.temp],
        productName: sku.name,
        barcode: sku.barcode,
        plannedQty: l.remainingQty,
        pickedQty: 0,
      };
      this.activity = `피킹 ${i + 1}/${ordered.length} → ${loc.code}`;
      await this.walkTo(loc.pick);
      this.heading = Math.atan2(loc.shelf.x - this.pos.x, loc.shelf.z - this.pos.z);
      this.pda.step = '위치·상품 바코드 스캔';
      await this.wait(ctx.params.pickScanSecPerLine);
      // 피킹 칸이 모자라면 보충(MOV)을 요청하고 기다린다 — 장부 재고는 있는데 칸이 빈 경우 (IV-04)
      let waited = 0;
      while (ctx.shelfQty(l.sku) < l.remainingQty && waited < 900) {
        if (waited === 0) {
          ctx.metrics.inbound.pickWaits += 1;
          ctx.log(`${this.id} ${loc.code} 칸 부족(${ctx.shelfQty(l.sku)}/${l.remainingQty}) — 긴급 보충 요청`);
        }
        ctx.requestReplenish(l.sku);
        this.pda.step = '칸 부족 — 보충 대기';
        this.activity = `보충 대기 ${loc.code}`;
        await this.wait(5);
        waited += 5;
        ctx.metrics.inbound.pickWaitSec += 5;
      }
      await this.wait(ctx.params.pickSecPerUnit * l.remainingQty);
      const onShelf = ctx.shelfQty(l.sku);
      const stockOut = Math.max(0, l.remainingQty - onShelf);
      const randomShort =
        stockOut === 0 && ctx.rng.next() < ctx.params.shortageRate ? Math.min(l.remainingQty, 1 + Math.floor(ctx.rng.next() * l.remainingQty)) : 0;
      const short = stockOut || randomShort;
      const picked = l.remainingQty - short;
      const from = ctx.wireCode(loc.code);
      if (picked > 0) {
        await this.retry(() =>
          port.recordExecution(
            task.taskId,
            {
              executionType: 'PICK',
              workerId: this.id,
              assignmentVersion: job.assignmentVersion,
              fromLocation: from,
              toLocation: ctx.wireCode(packDropPoint(sku.temp)),
              lines: [{ orderLineId: l.orderLineId, sku: l.sku, ...(lotId ? { lotId } : {}), pickedQty: picked }],
            },
            this.key('pick', task.taskId, `:${l.orderLineId}`),
          ),
        );
      }
      this.pda.pickedQty = picked;
      basket[i].picked = picked;
      basket[i].state = short > 0 ? 'SHORT' : 'DONE';
      for (let k = 0; k < picked; k++) this.carrying.push(sku.temp);
      if (short > 0) {
        // 결품 보고는 집품과 섞지 않은 한 줄(pickedQty 0 + shortage) — 받으면 작업이 BLOCKED, 결품 사가가 풀 때까지 기다린다
        await this.retry(() =>
          port.recordExecution(
            task.taskId,
            {
              executionType: 'PICK',
              workerId: this.id,
              assignmentVersion: job.assignmentVersion,
              fromLocation: from,
              lines: [
                {
                  orderLineId: l.orderLineId,
                  sku: l.sku,
                  ...(lotId ? { lotId } : {}),
                  pickedQty: 0,
                  shortage: { qty: short, reason: 'SHORT' as const, note: '선반 실물 부족' },
                },
              ],
            },
            this.key('short', task.taskId, `:${l.orderLineId}`),
          ),
        );
        ctx.metrics.shortageUnits += short;
        ctx.log(`${this.id} 결품 보고 ${loc.code} ${sku.name} ×${short}`);
        this.pda.step = `결품 ${short} 보고 — 처리 대기`;
        this.activity = `결품 처리 대기 ${loc.code}`;
        for (let w = 0; w < 120; w++) {
          const now = await port.getTask(task.taskId);
          if (now.state !== 'BLOCKED') break;
          await this.wait(3);
        }
        this.pda.step = `결품 ${short} 취소됨`;
      } else this.pda.step = '피킹 완료';
    }
    this.currentTarget = null;
    if (trace) trace.pickDoneAt = ctx.now();

    // ── 4. 패킹 작업 배정 (같은 작업자) ──
    const pack = await ctx.awaitPackAssignment(shipmentId, this.id);
    if (!pack) {
      this.activity = '전량 결품 — 출하 취소';
      ctx.log(`${shipmentId} 전량 결품으로 출하 취소`);
      return;
    }
    this.state = 'WAIT_STATION';
    this.activity = '패킹대 대기';
    this.pda = { ...this.pda!, taskId: pack.taskId, taskType: 'PACK', step: '패킹대 대기', progress: '', location: null, nextLocation: null, productName: null, barcode: null, plannedQty: null, pickedQty: null, temp: null };
    // 빈 패킹대가 있으면 대기 지점에 들르지 않고 바로 패킹대로(사용자 2026-11-23 "장바구니 거치대로 갔다가 대기 자리로 갔다가 패킹하러 가는거지? 동선이 그게 맞는 건가?")
    if (!ctx.stations.hasFree()) await this.walkTo(ctx.layout.points.packQueue);
    if (trace) trace.packQueuedAt = ctx.now();
    const station = await ctx.stations.acquire(this.id);
    this.activity = `${station.id}로 이동`;
    await this.walkTo(station.stand);
    this.heading = Math.atan2(station.table.x - this.pos.x, station.table.z - this.pos.z);

    await this.retry(() =>
      port.startTask(pack.taskId, { workerId: this.id, assignmentVersion: pack.assignmentVersion, deviceId: station.id }, this.key('start', pack.taskId)),
    );
    // 패킹 시작 때 배차 요청(fulfillment 0.4.11·BR-51 — 서버는 READY 때 자동 요청하지 않는다, 실서버 가상 작업자와 같게)
    {
      const t0 = await port.getTask(pack.taskId);
      const units0 = t0.lines.reduce((a, l) => a + l.remainingQty, 0);
      const minutes = Math.min(180, Math.max(1, Math.ceil((ctx.params.packBaseSec + ctx.params.packPerUnitSec * units0) / 60)));
      try {
        await this.retry(() => port.requestDispatch(shipmentId, minutes, this.key('dispatch', shipmentId)));
        ctx.dispatchRequested(shipmentId);
      } catch {
        /* 배차 요청 거절은 포장을 막지 않는다 */
      }
    }
    if (trace) trace.packStartAt = ctx.now();
    this.state = 'PACKING';
    const packTask = await port.getTask(pack.taskId);
    // 포장할 양 = PACK 행 잔량(결품 취소분은 cancelledQty 로 빠져 있다)
    const toPack = packTask.lines.filter((l) => l.remainingQty > 0);
    const units = toPack.reduce((a, l) => a + l.remainingQty, 0);
    const packSec = ctx.params.packBaseSec + ctx.params.packPerUnitSec * units;
    this.pda!.step = '상품·기한 확인 → 포장';
    this.pda!.progress = `${units}개`;
    this.activity = `패킹 ${station.id} (${units}개)`;
    await this.wait(packSec);

    // 온도대별 봉투 1개씩 밀봉 → 포장 QR (문서 7-6: 상온·냉장·냉동은 주문별 통합 포장하되 온도 보호·분리).
    // 밀봉이 PACK 실적이다(0.2.0 — PACK 실행 등록 없음). 마지막 밀봉에서 PACK COMPLETED·출고 READY.
    const byTemp = new Map<TemperatureZone, typeof toPack>();
    for (const l of toPack) {
      const t = ctx.skuMap.get(l.sku)?.temp ?? 'AMBIENT';
      byTemp.set(t, [...(byTemp.get(t) ?? []), l]);
    }
    const sealed: Package[] = [];
    for (const [temp, ls] of byTemp) {
      this.pda!.step = `${TEMP_KO[temp]} 봉투 밀봉·라벨 출력`;
      await this.wait(12);
      const weightG = ls.reduce((a, l) => a + (ctx.skuMap.get(l.sku)?.weightG ?? 0) * l.remainingQty, 0);
      const pkg = await this.retry(() =>
        port.sealPackage(
          shipmentId,
          {
            contents: ls.map((l) => ({ orderLineId: l.orderLineId, sku: l.sku, qty: l.remainingQty })),
            bagCount: 1,
            temperatureZone: temp,
            weightG,
            containsAlcohol: ls.some((l) => ctx.skuMap.get(l.sku)?.containsAlcohol),
            packedBy: this.id,
            // 그 온도대 상품을 내려놓은 칸에서 꺼내 밀봉한다(재고 PACK 의 출발 위치)
            packingLocation: ctx.wireCode(packDropPoint(temp)),
          },
          this.key('seal', shipmentId, `:${temp}`),
        ),
      );
      sealed.push(pkg);
    }
    ctx.stations.release(station);
    this.carrying = sealed.map((p) => p.temperatureZone);
    // 빈 장바구니를 거치대에 두고 나서 포장을 출하대기 랙으로(사용자 2026-11-23 "패킹하러 갈 때 장바구니가 어느순간 사라져 … 장바구니 거치대에 두고 나서 인계랙에 포장 갖다두던가")
    this.state = 'RETURNING';
    this.activity = '빈 장바구니 거치대에';
    await this.walkTo(ctx.layout.points.cartDepot);
    await this.wait(3);
    this.hasCart = false;

    // ── 5. 외부 출하대기 랙 적재 ──
    this.state = 'TO_SHIP';
    this.activity = '출하대기 랙으로';
    this.pda!.step = '출하대기 랙 적재';
    await this.walkTo(ctx.layout.points.shipDrop);
    await this.wait(4 * sealed.length);
    ctx.stagePackages(shipmentId, sealed);
    this.carrying = [];
  }
}

/** 구역 순서를 지키면서 구역 안에서는 가까운 순서(최근접 이웃). */
function routeOrder<T extends { loc: Location }>(items: T[], start: P, zoneRank: (x: T) => number): T[] {
  const groups = new Map<number, T[]>();
  for (const it of items) {
    const r = zoneRank(it);
    groups.set(r, [...(groups.get(r) ?? []), it]);
  }
  const out: T[] = [];
  let cur = start;
  for (const r of [...groups.keys()].sort((a, b) => a - b)) {
    const rest = [...groups.get(r)!];
    while (rest.length) {
      let bi = 0;
      let bd = Infinity;
      rest.forEach((it, i) => {
        const d = Math.hypot(it.loc.pick.x - cur.x, it.loc.pick.z - cur.z);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      const [it] = rest.splice(bi, 1);
      out.push(it);
      cur = it.loc.pick;
    }
  }
  return out;
}
