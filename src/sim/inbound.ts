// 입고·적치·보충 (MFC 1장 입고 흐름, 3장 IV-02/03/04).
//   입고 차량 도착 → 도착 등록 → 하차(롤테이너·박스를 하차 칸에) → 수량·바코드·기한 검수 → 수령 등록(TIN, H+q, 미적치)
//   → 적치: 피킹 칸을 칸 한도까지 채우고 남는 수량은 보충재고 팔레트로
//   → 자동 보충(MOV): 피킹 칸 C ≤ min 이면 보충재고에서 칸 한도까지
// 입고 작업자는 피킹·패킹 작업자와 별도 인원이다(MFC 10장 기준 3명).

import type { MockBackend } from '../backend/mock/MockBackend';
import type { Sku } from '../domain/catalog';
import { ApiProblem, type TemperatureZone } from '../domain/contract';
import type { DockSlot, Layout, ReserveSpot } from '../domain/layout';
import type { NavGrid, P } from '../domain/navgrid';
import { Agent } from './agent';
import type { Metrics } from './metrics';
import { INBOUND_UNLOAD, RETURN_FLOW } from '../config';
import { QUARANTINE_OF, type ReturnItem } from './returns';

/** 내려놓은 자리에 다가설 점 — 하차 칸은 통로 쪽(z 19.75 기준), 입고재고 팔레트는 그 팔레트 앞 */
function approach(spot: { x: number; z: number }, it: { slot: unknown; stand?: { x: number; z: number } }): { x: number; z: number } {
  if (!it.slot && it.stand) return it.stand;
  return { x: spot.x, z: spot.z < 3.05 ? spot.z + 0.55 : spot.z - 0.55 }; // 하차 칸 두 블록 사이 통로 z 3.05(2026-11-21 재배치, 전 19.75)
}

export type InboundState = 'IDLE' | 'RECEIVING' | 'PUTAWAY' | 'REPLENISH' | 'RETURN_ITEM' | 'RETURNING' | 'ERROR';

export interface Truck {
  trfId: string;
  lines: { sku: string; qty: number }[];
  state: 'APPROACHING' | 'DOCKED' | 'UNLOADING' | 'DONE' | 'LEAVING' | 'GONE';
  x: number;
  unloaded: number;
  scheduledAt: number;
  /** 실서버 그림 차량 — 하차(승강기 → 입고칸)가 끝날 때까지 서 있는다 */
  hold?: boolean;
}

export interface DockItem {
  id: string;
  trfId: string;
  sku: string;
  qty: number;
  temp: TemperatureZone;
  slot: DockSlot | null;
  floorPos: P;
  /** 입고재고 팔레트 위에 둔 것이면 다가설 점(그 팔레트의 꺼내는 쪽) */
  stand?: P;
  state: 'ON_DOCK' | 'RECEIVED' | 'TAKEN';
}

export type InboundJob =
  | { kind: 'RECEIVE'; truck: Truck }
  | { kind: 'PUTAWAY'; items: DockItem[] }
  | { kind: 'REPLENISH'; sku: string; urgent: boolean }
  /** 회수품 반입(반납 도착 대기 한 건) */
  | { kind: 'RETURN_RECEIVE'; items: ReturnItem[] }
  /** 회수품 검수(반입한 사람 말고) */
  | { kind: 'RETURN_INSPECT'; items: ReturnItem[] }
  /** 재판매분 적치(회수반입 자리 → 선반) */
  | { kind: 'RETURN_PUTAWAY'; item: ReturnItem }
  /** 폐기분 격리 이동(반입한 사람만, 온도대 격리 구역) */
  | { kind: 'QUARANTINE_MOVE'; item: ReturnItem };

export interface InboundContext {
  runId: string;
  mock: MockBackend;
  layout: Layout;
  nav: NavGrid;
  skuMap: Map<string, Sku>;
  reserveMap: Map<string, ReserveSpot>;
  metrics: Metrics;
  now(): number;
  log(msg: string): void;
  placeOnDock(item: DockItem): void;
  releaseDock(item: DockItem): void;
  onReceived(truck: Truck): void;
  onReplenishDone(sku: string): void;
  mfcId: string;
  rng(): number;
  /** 격리 구역 안에 놓을 자리(온도대별, 놓을 때마다 다음 자리) */
  quarantineSpot(temp: TemperatureZone): { stand: P; slot: P };
}

export interface InboundPda {
  title: string;
  rows: [string, string][];
  step: string;
}

const TEMP_KO: Record<TemperatureZone, string> = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' };

export class InboundWorker extends Agent {
  state: InboundState = 'IDLE';
  pda: InboundPda | null = null;
  carrying: TemperatureZone[] = [];
  /** 롤테이너를 밀고 있음(하차·적치) */
  hasCart = false;
  busySeconds = 0;
  jobsDone = 0;
  private jobResolver: ((j: InboundJob | null) => void) | null = null;
  private seq = 0;

  constructor(
    id: string,
    readonly home: P,
    private readonly ctx: InboundContext,
  ) {
    super(id, home, ctx.nav, 1.0);
    this.pushesCart = true;
  }

  get idle(): boolean {
    return this.jobResolver !== null;
  }

  give(job: InboundJob | null) {
    const r = this.jobResolver;
    this.jobResolver = null;
    r?.(job);
  }

  override tick(dt: number) {
    super.tick(dt);
    if (this.state !== 'IDLE') this.busySeconds += dt;
  }

  private key(op: string): string {
    this.seq += 1;
    return `${this.ctx.runId}:${this.id}:${op}:${this.seq}`;
  }

  async run() {
    while (!this.stopped) {
      this.state = 'IDLE';
      this.activity = '입고 작업 대기';
      this.pda = null;
      const job = await new Promise<InboundJob | null>((resolve) => (this.jobResolver = resolve));
      if (!job || this.stopped) break;
      try {
        if (job.kind === 'RECEIVE') await this.receive(job.truck);
        else if (job.kind === 'PUTAWAY') await this.putaway(job.items);
        else if (job.kind === 'REPLENISH') await this.replenish(job.sku, job.urgent);
        else if (job.kind === 'RETURN_RECEIVE') await this.returnReceive(job.items);
        else if (job.kind === 'RETURN_INSPECT') await this.returnInspect(job.items);
        else if (job.kind === 'RETURN_PUTAWAY') await this.returnPutaway(job.item);
        else await this.quarantineMove(job.item);
        this.jobsDone += 1;
      } catch (e) {
        this.state = 'ERROR';
        this.activity = `오류: ${e instanceof ApiProblem ? e.problem.code : (e as Error).message}`;
        this.ctx.log(`${this.id} 입고 작업 중단 — ${this.activity}`);
        this.ctx.metrics.apiErrors += 1;
        // 회수품 일이 중간에 멈추면 다른 사람(또는 다시)이 맡을 수 있게 잡은 것을 푼다
        if (job.kind === 'RETURN_RECEIVE' || job.kind === 'RETURN_INSPECT') for (const it of job.items) it.claimed = false;
        else if (job.kind === 'RETURN_PUTAWAY' || job.kind === 'QUARANTINE_MOVE') job.item.claimed = false;
        await this.wait(20);
      }
      this.carrying = [];
      // 빈 롤테이너는 밀고 입고·검수(대기 자리)로 돌아와서 둔다 — 창고에 두고 오지 않음(사용자 2026-11-22 "롤테이너 창고에 버려두고 가는거니?")
      this.state = 'RETURNING';
      this.activity = this.hasCart ? '빈 롤테이너 밀고 입고·검수로' : '대기 위치로';
      await this.walkTo(this.home);
      this.hasCart = false;
    }
  }

  // ── 하차·검수·수령 등록 ────────────────────────────────
  private async receive(truck: Truck) {
    const { ctx } = this;
    this.state = 'RECEIVING';
    this.activity = `입고 차량 ${truck.trfId} 하차`;
    this.pda = { title: `입고 ${truck.trfId}`, rows: [['품목', `${truck.lines.length}`], ['수량', `${truck.lines.reduce((a, l) => a + l.qty, 0)}개`]], step: '도착 등록' };
    await this.walkTo(ctx.layout.points.truckDoor);
    await ctx.mock.recordArrival(truck.trfId, { recordedBy: this.id }, `${ctx.runId}:arr:${truck.trfId}`);
    truck.state = 'UNLOADING';
    this.hasCart = true; // 하차도 롤테이너로(차량문 ↔ 하차 칸)

    // 롤테이너 단위 하차: 온도대별로 묶어 롤테이너 하나에 linesPerRoll 줄, 승강기 한 번에 rollsPerLift 대
    const items: DockItem[] = [];
    const U = INBOUND_UNLOAD;
    const byTemp = new Map<TemperatureZone, { l: { sku: string; qty: number }; i: number }[]>();
    truck.lines.forEach((l, i) => {
      const t = ctx.skuMap.get(l.sku)!.temp;
      byTemp.set(t, [...(byTemp.get(t) ?? []), { l, i }]);
    });
    const rolls: { l: { sku: string; qty: number }; i: number }[][] = [];
    for (const ls of byTemp.values()) for (let k = 0; k < ls.length; k += U.linesPerRoll) rolls.push(ls.slice(k, k + U.linesPerRoll));
    const floorPos = ctx.layout.dockSlots[0]?.pos ?? ctx.layout.points.truckDoor;
    for (let r = 0; r < rolls.length; r++) {
      const roll = rolls[r];
      if (r > 0 && r % U.rollsPerLift === 0) {
        this.activity = `승강기 — 다음 롤테이너 ${Math.min(U.rollsPerLift, rolls.length - r)}대 올라오는 중`;
        this.pda.step = `승강기 ${Math.floor(r / U.rollsPerLift) + 1}/${Math.ceil(rolls.length / U.rollsPerLift)}회`;
        await this.walkTo(ctx.layout.points.truckDoor);
        await this.wait(U.liftCycleSec);
      }
      const temp = ctx.skuMap.get(roll[0].l.sku)!.temp;
      this.activity = `입고 차량 ${truck.trfId} 하차 — 롤테이너 ${r + 1}/${rolls.length}(${TEMP_KO[temp]} ${roll.length}품목)`;
      this.pda.step = `롤테이너 ${r + 1}/${rolls.length} · ${TEMP_KO[temp]} ${roll.length}품목`;
      await this.walkTo(ctx.layout.points.truckDoor);
      await this.wait(U.takeRollSec);
      this.carrying = roll.map(() => temp);
      for (const { l, i } of roll) {
        const item: DockItem = { id: `${truck.trfId}-${i + 1}`, trfId: truck.trfId, sku: l.sku, qty: l.qty, temp, slot: null, floorPos: { ...floorPos }, state: 'ON_DOCK' };
        ctx.placeOnDock(item);
        const spot = item.slot?.pos ?? item.floorPos;
        await this.walkTo(approach(spot, item));
        await this.wait(U.dropLineSec);
        this.carrying.pop();
        truck.unloaded += 1;
        items.push(item);
      }
    }
    this.carrying = [];
    await this.walkTo(ctx.layout.points.truckDoor);

    this.activity = '수량·바코드·유통기한 검수';
    this.pda.step = '검수';
    await this.walkTo({ x: ctx.layout.points.truckDoor.x, z: ctx.layout.points.truckDoor.z + 1.5 }); // 승강기 앞 입고·검수(전엔 1호점 좌표 고정이라 다른 지점에선 엉뚱한 곳)
    await this.wait(2 * truck.lines.length);
    this.pda.step = '수령 등록 (TIN)';
    await ctx.mock.recordReceipt(
      truck.trfId,
      {
        receivedBy: this.id,
        lines: truck.lines.map((l) => ({ sku: l.sku, normalQty: l.qty, quarantinedQty: 0, pendingQty: 0, toLocationCode: 'RCV-DOCK' })),
      },
      `${ctx.runId}:rcp:${truck.trfId}`,
    );
    for (const it of items) it.state = 'RECEIVED';
    ctx.metrics.inbound.receivedUnits += truck.lines.reduce((a, l) => a + l.qty, 0);
    ctx.onReceived(truck);
  }

  // ── 적치 ───────────────────────────────────────────
  private async putaway(items: DockItem[], from = 'RCV-DOCK', onTaken?: () => void) {
    const { ctx } = this;
    const inv = ctx.mock.inventory;
    this.state = 'PUTAWAY';
    this.hasCart = true;
    const temp = items[0].temp;
    this.pda = { title: `적치 ${TEMP_KO[temp]} ${items.length}품목`, rows: [], step: '하차 칸에서 집기' };
    for (const it of items) {
      const spot = it.slot?.pos ?? it.floorPos;
      this.activity = it.slot ? `적치 — 하차 칸 ${it.slot.id}` : it.stand ? `적치 — ${TEMP_KO[it.temp]} 입고재고 자리` : '적치 — 하차 칸 바닥';
      await this.walkTo(approach(spot, it));
      await this.wait(3);
      it.state = 'TAKEN';
      ctx.releaseDock(it);
      onTaken?.();
      this.carrying.push(it.temp);
    }

    // 피킹 칸 먼저 (가까운 순), 남는 수량은 보충재고로
    const toReserve: { it: DockItem; qty: number }[] = [];
    const order = nearestOrder(items, this.pos, (it) => ctx.skuMap.get(it.sku)!.location.pick);
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      const sku = ctx.skuMap.get(it.sku)!;
      const loc = sku.location;
      this.pda = {
        title: `적치 ${TEMP_KO[temp]} ${i + 1}/${order.length}`,
        rows: [
          ['로케이션', loc.code],
          ['상품', sku.name],
          ['바코드', sku.barcode],
          ['입고 수량', `${it.qty}`],
          ['칸 한도', `${sku.shelfCap}`],
        ],
        step: '로케이션 이동',
      };
      this.activity = `적치 ${i + 1}/${order.length} → ${loc.code}`;
      await this.walkTo(loc.pick);
      this.heading = Math.atan2(loc.shelf.x - this.pos.x, loc.shelf.z - this.pos.z);
      const space = Math.max(0, sku.shelfCap - (inv.get(it.sku)?.shelf ?? 0));
      const toShelf = Math.min(it.qty, space);
      this.pda.step = `칸 스캔 → ${toShelf}개 진열`;
      await this.wait(6 + 1.2 * toShelf);
      if (toShelf > 0) {
        // 진열 직전에 칸 여유를 다시 본다(그사이 보충이 들어왔을 수 있다)
        const nowSpace = Math.max(0, sku.shelfCap - (inv.get(it.sku)?.shelf ?? 0));
        const q = Math.min(toShelf, nowSpace);
        if (q > 0) {
          await ctx.mock.commitStock(
            `PUT-${it.id}`,
            { executionType: 'PUTAWAY', sku: it.sku, qty: q, to: 'shelf', fromLocation: from, toLocation: loc.code },
            this.key('put'),
          );
          ctx.metrics.inbound.putawayShelfUnits += q;
        }
        if (it.qty - q > 0) toReserve.push({ it, qty: it.qty - q });
      } else {
        toReserve.push({ it, qty: it.qty });
      }
      this.carrying.shift();
    }

    // 보충재고 팔레트
    const byReserve = new Map<string, { it: DockItem; qty: number }[]>();
    for (const r of toReserve) {
      const id = ctx.skuMap.get(r.it.sku)!.reserveId;
      byReserve.set(id, [...(byReserve.get(id) ?? []), r]);
      this.carrying.push(r.it.temp);
    }
    for (const [rid, list] of byReserve) {
      const spot = ctx.reserveMap.get(rid)!;
      this.activity = `보충재고 ${rid}에 적재`;
      this.pda = { title: `보충재고 적재 ${rid}`, rows: list.map((r) => [r.it.sku, `${r.qty}개`]), step: '팔레트 적재' };
      await this.walkTo(spot.stand);
      await this.wait(5 + 0.4 * list.reduce((a, r) => a + r.qty, 0));
      for (const r of list) {
        await ctx.mock.commitStock(
          `PUT-${r.it.id}-R`,
          { executionType: 'PUTAWAY', sku: r.it.sku, qty: r.qty, to: 'reserve', fromLocation: from, toLocation: rid },
          this.key('putR'),
        );
        ctx.metrics.inbound.putawayReserveUnits += r.qty;
        this.carrying.shift();
      }
    }
  }

  // ── 회수품 (사용자 2026-11-22 "넣어") ─────────────────────
  /** 반입: 인계 창 안쪽에서 회수품을 받아 반품 위치 RTN-A-01 에 격리로 등록(POST /return-receipts, arrivalId) */
  private async returnReceive(items: ReturnItem[]) {
    const { ctx } = this;
    this.state = 'RETURN_ITEM';
    const a = items[0];
    this.activity = `회수품 반입 ${a.arrivalId}`;
    this.pda = { title: `회수품 반입 ${a.arrivalId}`, rows: items.map((it) => [ctx.skuMap.get(it.sku)?.name ?? it.sku, `${it.qty}개`]), step: '인계 창으로 이동' };
    await this.walkTo(RETURN_FLOW.windowInside);
    this.pda.step = '회수품 확인 → 반입 등록 RTN-A-01';
    await this.wait(RETURN_FLOW.receiveSec);
    const r = await ctx.mock.recordReturnReceipt(
      { mfcId: ctx.mfcId, toLocationCode: 'RTN-A-01', arrivalId: a.arrivalId, receivedBy: this.id },
      `${ctx.runId}:rtnrcp:${a.arrivalId}`,
    );
    for (const it of items) {
      it.stage = 'RECEIVED';
      it.receivedBy = this.id;
      it.receiptId = r.resultId;
      it.claimed = false;
    }
    ctx.metrics.inbound.returnsReceived += items.reduce((x, it) => x + it.qty, 0);
    this.pda.step = '반입됨 — 격리(검수 대기)';
    ctx.log(`${this.id} 회수품 반입 ${a.arrivalId} → ${r.resultId} RTN-A-01 격리 ${items.length}품목`);
  }

  /** 검수: 상온·미개봉 = 재판매, 냉장·냉동(온도대) · 개봉·파손 = 폐기(mfc-quality POST /return-inspections) */
  private async returnInspect(items: ReturnItem[]) {
    const { ctx } = this;
    this.state = 'RETURN_ITEM';
    const rid = items[0].receiptId!;
    this.activity = `회수품 검수 ${rid}`;
    this.pda = { title: `회수품 검수 ${rid}`, rows: [], step: '인계 창으로 이동' };
    await this.walkTo(RETURN_FLOW.windowInside);
    this.pda.step = '상품 상태·온도대 확인';
    await this.wait(RETURN_FLOW.inspectBaseSec + RETURN_FLOW.inspectSecPerUnit * items.reduce((x, it) => x + it.qty, 0));
    const lines = items.map((it) => {
      const chilled = it.temp !== 'AMBIENT';
      const bad = !chilled && ctx.rng() < RETURN_FLOW.ambientDisposeRate;
      const opened = bad && ctx.rng() < 0.5;
      it.disposeReason = chilled ? 'TEMPERATURE_ZONE' : bad ? (opened ? 'OPENED' : 'DAMAGED') : undefined;
      return {
        sku: it.sku,
        qty: it.qty,
        verdict: (chilled || bad ? 'DISPOSE' : 'RESALE') as 'RESALE' | 'DISPOSE',
        temperatureZone: it.temp,
        opened,
        fresh: chilled,
        ...(it.disposeReason ? { disposeReason: it.disposeReason } : {}),
      };
    });
    this.pda.rows = items.map((it, i) => [ctx.skuMap.get(it.sku)?.name ?? it.sku, lines[i].verdict === 'RESALE' ? '재판매 → 선반' : `폐기 → ${TEMP_KO[it.temp]} 격리`]);
    this.pda.step = '검수 등록';
    const r = await ctx.mock.createReturnInspection(
      { mfcId: ctx.mfcId, returnReceiptId: rid, inspectedBy: this.id, lines },
      `${ctx.runId}:rtninsp:${rid}`,
    );
    items.forEach((it, i) => {
      it.taskId = r.createdTaskIds[i];
      it.stage = lines[i].verdict === 'RESALE' ? 'RESALE' : 'DISPOSE';
      it.claimed = false;
    });
    this.pda.step = '검수 반영됨';
    ctx.log(`${this.id} 회수품 검수 ${rid}: ${items.map((it) => `${it.sku} ${it.stage === 'RESALE' ? '재판매' : '폐기'}`).join(', ')}`);
  }

  /** 재판매분 적치 — 회수반입 자리에서 집어 선반(넘치면 보충재고)으로. 보통 적치와 같다 */
  private async returnPutaway(item: ReturnItem) {
    const d: DockItem = {
      id: `RTN-${item.id}`,
      trfId: item.arrivalId,
      sku: item.sku,
      qty: item.qty,
      temp: item.temp,
      slot: null,
      floorPos: item.pos,
      stand: RETURN_FLOW.windowInside,
      state: 'RECEIVED',
    };
    const before = { ...item.pos };
    await this.putaway([d], 'RTN-A-01', () => (item.stage = 'CARRIED'));
    item.pos = before;
    item.stage = 'DONE';
    this.ctx.mock.completeReturnPutaway(item.taskId!, item.qty);
  }

  /** 폐기분 격리 이동 — 반입한 사람이 회수반입 자리 → 온도대 격리 구역 칸(POST /inbound-tasks/{taskId}/quarantine-moves) */
  private async quarantineMove(item: ReturnItem) {
    const { ctx } = this;
    const q = QUARANTINE_OF[item.temp];
    this.state = 'RETURN_ITEM';
    this.hasCart = false;
    this.activity = `격리 이동 → ${TEMP_KO[item.temp]} 격리 ${q.code}`;
    this.pda = { title: `격리 이동 ${item.taskId}`, rows: [['상품', ctx.skuMap.get(item.sku)?.name ?? item.sku], ['수량', `${item.qty}개`], ['도착', q.code]], step: '회수반입 자리에서 집기' };
    await this.walkTo(RETURN_FLOW.windowInside);
    await this.wait(3);
    item.stage = 'CARRIED';
    this.carrying = [item.temp];
    const spot = ctx.quarantineSpot(item.temp);
    this.pda.step = `${q.code} 로 이동`;
    await this.walkTo(spot.stand);
    await this.wait(4);
    this.pda.step = `${q.code} 스캔 → 내려놓기`;
    await ctx.mock.quarantineMove(item.taskId!, { toLocationCode: q.code, qty: item.qty }, `${ctx.runId}:qrt:${item.taskId}`, this.id);
    this.carrying = [];
    item.pos = spot.slot;
    item.quarantineCode = q.code;
    item.stage = 'QUARANTINED';
    ctx.log(`${this.id} 격리 이동 ${item.sku} ×${item.qty} RTN-A-01 → ${q.code}`);
  }

  // ── 자동 보충 (MOV) ─────────────────────────────────
  private async replenish(skuCode: string, urgent: boolean) {
    const { ctx } = this;
    const inv = ctx.mock.inventory;
    const sku = ctx.skuMap.get(skuCode)!;
    const spot = ctx.reserveMap.get(sku.reserveId)!;
    this.state = 'REPLENISH';
    this.hasCart = true;
    this.pda = {
      title: `${urgent ? '긴급 ' : ''}보충 MOV`,
      rows: [
        ['상품', sku.name],
        ['보충재고', sku.reserveId],
        ['피킹 칸', sku.location.code],
        ['칸 한도 / 최소', `${sku.shelfCap} / ${sku.minQty}`],
      ],
      step: '보충재고에서 꺼내기',
    };
    this.activity = `${urgent ? '긴급 ' : ''}보충 — ${sku.reserveId}에서 꺼내기`;
    try {
      await this.walkTo(spot.stand);
      await this.wait(6);
      const b = inv.get(skuCode)!;
      const qty = Math.min(b.reserve, Math.max(0, sku.shelfCap - b.shelf));
      if (qty <= 0) return;
      this.carrying = [sku.temp, sku.temp];
      this.activity = `보충 → ${sku.location.code} (${qty}개)`;
      this.pda.step = `${qty}개 → ${sku.location.code}`;
      await this.walkTo(sku.location.pick);
      this.heading = Math.atan2(sku.location.shelf.x - this.pos.x, sku.location.shelf.z - this.pos.z);
      await this.wait(5 + qty);
      const b2 = inv.get(skuCode)!;
      const q = Math.min(qty, b2.reserve, Math.max(0, sku.shelfCap - b2.shelf));
      if (q > 0) {
        await ctx.mock.commitStock(
          `MOV-${skuCode}-${this.key('m')}`,
          { executionType: 'MOVE', sku: skuCode, qty: q, to: 'shelf', fromLocation: sku.reserveId, toLocation: sku.location.code },
          this.key('mov'),
        );
        ctx.metrics.inbound.replenishMoves += 1;
        ctx.metrics.inbound.replenishUnits += q;
      }
    } finally {
      ctx.onReplenishDone(skuCode);
    }
  }
}

function nearestOrder<T>(items: T[], start: P, posOf: (t: T) => P): T[] {
  const rest = [...items];
  const out: T[] = [];
  let cur = start;
  while (rest.length) {
    let bi = 0;
    let bd = Infinity;
    rest.forEach((it, i) => {
      const p = posOf(it);
      const d = Math.hypot(p.x - cur.x, p.z - cur.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const [it] = rest.splice(bi, 1);
    out.push(it);
    cur = posOf(it);
  }
  return out;
}
