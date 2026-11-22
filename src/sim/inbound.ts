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

/** 내려놓은 자리에 다가설 점 — 하차 칸은 통로 쪽(z 19.75 기준), 입고재고 팔레트는 그 팔레트 앞 */
function approach(spot: { x: number; z: number }, it: { slot: unknown; stand?: { x: number; z: number } }): { x: number; z: number } {
  if (!it.slot && it.stand) return it.stand;
  return { x: spot.x, z: spot.z < 3.05 ? spot.z + 0.55 : spot.z - 0.55 }; // 하차 칸 두 블록 사이 통로 z 3.05(2026-11-21 재배치, 전 19.75)
}

export type InboundState = 'IDLE' | 'RECEIVING' | 'PUTAWAY' | 'REPLENISH' | 'RETURNING' | 'ERROR';

export interface Truck {
  trfId: string;
  lines: { sku: string; qty: number }[];
  state: 'APPROACHING' | 'DOCKED' | 'UNLOADING' | 'DONE' | 'LEAVING' | 'GONE';
  x: number;
  unloaded: number;
  scheduledAt: number;
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
  | { kind: 'REPLENISH'; sku: string; urgent: boolean };

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
        else await this.replenish(job.sku, job.urgent);
        this.jobsDone += 1;
      } catch (e) {
        this.state = 'ERROR';
        this.activity = `오류: ${e instanceof ApiProblem ? e.problem.code : (e as Error).message}`;
        this.ctx.log(`${this.id} 입고 작업 중단 — ${this.activity}`);
        this.ctx.metrics.apiErrors += 1;
        await this.wait(20);
      }
      this.carrying = [];
      this.hasCart = false;
      this.state = 'RETURNING';
      this.activity = '대기 위치로';
      await this.walkTo(this.home);
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

    const items: DockItem[] = [];
    for (let i = 0; i < truck.lines.length; i++) {
      const l = truck.lines[i];
      const sku = ctx.skuMap.get(l.sku)!;
      this.pda.step = `하차 ${i + 1}/${truck.lines.length} · ${sku.name}`;
      this.carrying = [sku.temp];
      await this.wait(4);
      const item: DockItem = {
        id: `${truck.trfId}-${i + 1}`,
        trfId: truck.trfId,
        sku: l.sku,
        qty: l.qty,
        temp: sku.temp,
        slot: null,
        floorPos: { x: 33.2, z: 3.05 },
        state: 'ON_DOCK',
      };
      ctx.placeOnDock(item);
      const spot = item.slot?.pos ?? item.floorPos;
      await this.walkTo(approach(spot, item));
      await this.wait(2);
      this.carrying = [];
      truck.unloaded = i + 1;
      items.push(item);
      await this.walkTo(ctx.layout.points.truckDoor);
    }

    this.activity = '수량·바코드·유통기한 검수';
    this.pda.step = '검수';
    await this.walkTo({ x: 30.7, z: 3.05 });
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
  private async putaway(items: DockItem[]) {
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
            { executionType: 'PUTAWAY', sku: it.sku, qty: q, to: 'shelf', fromLocation: 'RCV-DOCK', toLocation: loc.code },
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
          { executionType: 'PUTAWAY', sku: r.it.sku, qty: r.qty, to: 'reserve', fromLocation: 'RCV-DOCK', toLocation: rid },
          this.key('putR'),
        );
        ctx.metrics.inbound.putawayReserveUnits += r.qty;
        this.carrying.shift();
      }
    }
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
