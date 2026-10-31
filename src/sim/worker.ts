// 피킹·패킹 겸업 작업자 (MFC 1장 운영 원칙: 피킹과 패킹은 같은 작업자가 수행할 수 있다).
// 모든 수량 변화는 계약 API 응답으로만 확정한다 — 화면의 진행 표시는 서버 응답을 받은 뒤 바꾼다.

import { ApiProblem, ResultUnknown, type Package, type TaskDetail, type TemperatureZone } from '../domain/contract';
import type { Location } from '../domain/layout';
import type { P } from '../domain/navgrid';
import { Agent } from './agent';
import type { SiteContext } from './context';

export type WorkerState = 'IDLE' | 'TO_CART' | 'PICKING' | 'WAIT_STATION' | 'PACKING' | 'TO_SHIP' | 'RETURNING' | 'ERROR';

export interface PdaView {
  taskId: string;
  taskType: 'PICK' | 'PACK';
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
    this.state = 'PICKING';
    const rank = ctx.params.pickSequence === 'DOC_B_A_C' ? ZONE_RANK_DOC : ZONE_RANK_AMBIENT;
    const lines = task.lines
      .filter((l) => l.remainingQty > 0)
      .map((l) => ({ l, loc: ctx.skuMap.get(l.sku)?.location ?? null }))
      .filter((x): x is { l: (typeof task.lines)[number]; loc: Location } => x.loc !== null);
    const ordered = routeOrder(lines, this.pos, (x) => rank[x.loc.code[0]] ?? 9);
    for (let i = 0; i < ordered.length; i++) {
      const { l, loc } = ordered[i];
      const sku = ctx.skuMap.get(l.sku)!;
      this.currentTarget = loc;
      this.pda = {
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
      await this.wait(ctx.params.pickScanSecPerLine + ctx.params.pickSecPerUnit * l.remainingQty);
      const short = ctx.rng.next() < ctx.params.shortageRate ? Math.min(l.remainingQty, 1 + Math.floor(ctx.rng.next() * l.remainingQty)) : 0;
      const picked = l.remainingQty - short;
      await this.retry(() =>
        port.recordExecution(
          task.taskId,
          {
            executionType: 'PICK',
            workerId: this.id,
            assignmentVersion: job.assignmentVersion,
            fromLocation: loc.code,
            lines: [
              {
                orderLineId: l.orderLineId,
                sku: l.sku,
                pickedQty: picked,
                ...(short > 0 ? { shortage: { qty: short, reason: 'SHORT' as const, note: '선반 실물 부족' } } : {}),
              },
            ],
          },
          this.key('pick', task.taskId, `:${l.orderLineId}`),
        ),
      );
      if (short > 0) {
        ctx.metrics.shortageUnits += short;
        ctx.log(`${this.id} 결품 보고 ${loc.code} ${sku.name} ×${short}`);
      }
      this.pda.pickedQty = picked;
      this.pda.step = short > 0 ? `결품 ${short} 보고` : '피킹 완료';
      for (let k = 0; k < picked; k++) this.carrying.push(sku.temp);
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
    await this.walkTo(ctx.layout.points.packQueue);
    if (trace) trace.packQueuedAt = ctx.now();
    const station = await ctx.stations.acquire(this.id);
    this.activity = `${station.id}로 이동`;
    await this.walkTo(station.stand);
    this.heading = Math.atan2(station.table.x - this.pos.x, station.table.z - this.pos.z);

    await this.retry(() =>
      port.startTask(pack.taskId, { workerId: this.id, assignmentVersion: pack.assignmentVersion, deviceId: station.id }, this.key('start', pack.taskId)),
    );
    if (trace) trace.packStartAt = ctx.now();
    this.state = 'PACKING';
    const packTask = await port.getTask(pack.taskId);
    const units = packTask.lines.reduce((a, l) => a + l.plannedQty, 0);
    const packSec = ctx.params.packBaseSec + ctx.params.packPerUnitSec * units;
    this.pda!.step = '상품·기한 확인 → 포장';
    this.pda!.progress = `${units}개`;
    this.activity = `패킹 ${station.id} (${units}개)`;
    await this.wait(packSec);

    await this.retry(() =>
      port.recordExecution(
        pack.taskId,
        {
          executionType: 'PACK',
          workerId: this.id,
          assignmentVersion: pack.assignmentVersion,
          toLocation: station.id,
          lines: packTask.lines.map((l) => ({ orderLineId: l.orderLineId, sku: l.sku, pickedQty: l.plannedQty })),
          durationSec: Math.round(packSec),
        },
        this.key('pack', pack.taskId),
      ),
    );

    // 온도대별 봉투 1개씩 밀봉 → 포장 QR (문서 7-6: 상온·냉장·냉동은 주문별 통합 포장하되 온도 보호·분리)
    const byTemp = new Map<TemperatureZone, typeof packTask.lines>();
    for (const l of packTask.lines) {
      const t = ctx.skuMap.get(l.sku)?.temp ?? 'AMBIENT';
      byTemp.set(t, [...(byTemp.get(t) ?? []), l]);
    }
    const sealed: Package[] = [];
    for (const [temp, ls] of byTemp) {
      this.pda!.step = `${TEMP_KO[temp]} 봉투 밀봉·라벨 출력`;
      await this.wait(12);
      const weightG = ls.reduce((a, l) => a + (ctx.skuMap.get(l.sku)?.weightG ?? 0) * l.plannedQty, 0);
      const pkg = await this.retry(() =>
        port.sealPackage(
          shipmentId,
          {
            contents: ls.map((l) => ({ orderLineId: l.orderLineId, sku: l.sku, qty: l.plannedQty })),
            bagCount: 1,
            temperatureZone: temp,
            weightG,
            containsAlcohol: ls.some((l) => ctx.skuMap.get(l.sku)?.containsAlcohol),
            packedBy: this.id,
          },
          this.key('seal', shipmentId, `:${temp}`),
        ),
      );
      sealed.push(pkg);
    }
    ctx.stations.release(station);
    this.hasCart = false;
    this.carrying = sealed.map((p) => p.temperatureZone);

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
