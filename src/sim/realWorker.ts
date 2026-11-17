// 실서버 가상 작업자(mfcw-pp-01~10, 사용자 결정 2026-11-16): 실제 PDA 처럼 자기 토큰으로 계약 API 를 부른다.
// 다음 작업 받기(업무 PICK_PACK) → 시작 → 받은 방문 순서(visitSeq)대로 걸어 집품 실적 → 패킹대 → PACK 시작과 함께 배차 요청(점원 MANUAL)
// → 밀봉 → 출하대기 랙. 서버가 확정한 결과만 진행으로 본다. 응답이 없으면 같은 Idempotency-Key 로 다시 보낸다.
// 실서버에서는 결품을 지어내지 않는다(MOCK 의 무작위 결품 없음). 인계는 rider 시뮬레이터 몫(backend-requests "rider 시뮬레이터 요청").

import type { HttpBackend } from '../backend/http/HttpBackend';
import type { TokenSource } from '../backend/http/tokens';
import { ApiProblem, ResultUnknown, type CapacityAssignment, type TaskDetail, type TemperatureZone } from '../domain/contract';
import type { Layout, Location } from '../domain/layout';
import type { NavGrid, P } from '../domain/navgrid';
import { REAL_WORKERS } from '../config';
import type { SimParams } from '../config';
import { Agent } from './agent';
import type { StationPool } from './site';
import type { PdaView, WorkerState } from './worker';

export interface RealSiteContext {
  runId: string;
  mfcId: string;
  layout: Layout;
  nav: NavGrid;
  stations: StationPool;
  params: SimParams;
  now: () => number;
  log: (msg: string) => void;
  /** 백엔드 선반 칸 코드 → 평면 칸 */
  location: (backendCode: string) => Location | null;
  /** 백엔드 선반 밖 위치 코드(PAK-·DSP-·CRT- 등) → 바닥 좌표 */
  point: (backendCode: string) => P | null;
}

const TEMP_KO: Record<TemperatureZone, string> = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' };

/** 백엔드 칸 코드 첫 글자 = 온도대(`{A/C/F}-…`, SIM-6) */
export function tempOfCode(code: string): TemperatureZone | null {
  const c = code[0];
  return c === 'F' && code[1] === '-' ? 'FROZEN' : c === 'C' && code[1] === '-' ? 'CHILLED' : c === 'A' && code[1] === '-' ? 'AMBIENT' : null;
}

/** 집은 상품을 내려놓는 포장 위치(R-13): 냉동 PAK-F-01, 냉장·상온 PAK-C-01 */
export function packDropFor(temp: TemperatureZone | null): string {
  return temp === 'FROZEN' ? 'PAK-F-01' : 'PAK-C-01';
}

export class RealWorker extends Agent {
  state: WorkerState = 'IDLE';
  pda: PdaView | null = null;
  hasCart = false;
  carrying: TemperatureZone[] = [];
  busySeconds = 0;
  ordersDone = 0;
  currentTarget: Location | null = null;
  /** 들고 있는 작업이 없을 때만 true — 줄일 때 이것만 퇴근 */
  idle = true;
  /** 받은 운영자 ID(= capacity workerId) */
  workerId: string | null = null;
  /** 마지막 거절·오류(화면 표시) */
  lastProblem: string | null = null;
  /** 퇴근 요청 — 들고 있는 작업을 마치면 멈춘다 */
  leaving = false;
  /** 멈춤(퇴근 끝) */
  left = false;
  /**
   * 계정 멈춤 — 토큰을 새로 받은 뒤에도 401(R-14 회신 조건: "다시 받은 뒤에도 401 이면 그 계정은 멈춘다").
   * 다시 켜지 않는다(새로 고침 전까지). 화면에는 남겨 둔다.
   */
  halted = false;
  /** 401 을 받고 토큰을 새로 받았는데 아직 성공한 호출이 없음 */
  private reauthed = false;
  /** 이 작업자가 집어 내려놓은 SKU → 포장 위치·온도대 (밀봉 때 씀) */
  private readonly dropped = new Map<string, { loc: string; temp: TemperatureZone | null }>();
  private pulls = 0;

  private readonly home: P;

  constructor(
    readonly account: string,
    home: P,
    private readonly ctx: RealSiteContext,
    readonly be: HttpBackend,
    private readonly tokens: TokenSource,
  ) {
    super(account, home, ctx.nav, ctx.params.walkSpeed);
    this.home = home;
  }

  override tick(dt: number) {
    super.tick(dt);
    if (this.state !== 'IDLE') this.busySeconds += dt;
  }

  private key(op: string, id: string, extra = ''): string {
    return `${this.ctx.runId}:${this.account}:${op}:${id}${extra}`;
  }

  /**
   * 결과 불명·재시도 가능 거절은 같은 키로 다시 보낸다. 업무 거절은 그대로 올린다.
   * 401: 토큰을 버리고 새로 받아 한 번만 같은 키로 다시 보낸다. 그래도 401 이면 AccountHalted(R-14).
   */
  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fn();
        this.reauthed = false;
        return r;
      } catch (e) {
        if (e instanceof ApiProblem && e.problem.status === 401) {
          if (this.reauthed) throw new AccountHalted();
          this.reauthed = true;
          this.tokens.invalidate();
          this.activity = '401 — 토큰 다시 받는 중';
          this.ctx.log(`${this.account} 401 — 토큰을 새로 받아 한 번 다시 보냄`);
          attempt--;
          continue;
        }
        const retryable = e instanceof ResultUnknown || (e instanceof ApiProblem && e.problem.retryable === true);
        if (!retryable || attempt >= 4) throw e;
        this.activity = `응답 확인 중… (재전송 ${attempt + 1})`;
        await this.wait(2 * (attempt + 1));
      }
    }
  }

  async run() {
    while (!this.stopped) {
      this.idle = true;
      this.state = 'IDLE';
      this.pda = null;
      if (this.leaving) break;
      if (!this.workerId) {
        this.activity = '로그인 중';
        await this.tokens.get();
        this.workerId = this.tokens.operatorId;
        if (!this.workerId) {
          this.lastProblem = this.tokens.lastError ?? '토큰 없음';
          this.activity = `로그인 실패 — ${this.lastProblem}`;
          await this.wait(REAL_WORKERS.errorBackoffSec);
          continue;
        }
      }
      let a: CapacityAssignment;
      try {
        this.activity = '다음 작업 받기';
        this.pulls++;
        const k = this.key('pull', String(this.pulls));
        a = await this.retry(() => this.be.pullNextTask(this.ctx.mfcId, this.workerId!, 'PICK_PACK', k));
      } catch (e) {
        if (e instanceof AccountHalted) {
          this.halt(null);
          break;
        }
        const code = e instanceof ApiProblem ? e.problem.code : (e as Error).message;
        if (code === 'NO_TASK_AVAILABLE') {
          this.lastProblem = null;
          this.activity = '작업 없음 — 대기';
          await this.wait(REAL_WORKERS.noTaskRetrySec);
        } else {
          this.lastProblem = code;
          this.activity = `작업 받기 거절 ${code}`;
          this.ctx.log(`${this.account} 다음 작업 받기 거절 ${code}`);
          await this.wait(REAL_WORKERS.errorBackoffSec);
        }
        continue;
      }
      this.idle = false;
      try {
        if (a.taskType === 'PICK') await this.doPick(a);
        else if (a.taskType === 'PACK') await this.doPack(a);
        else {
          // 업무 PICK_PACK 이면 오지 않는다 — 온다면 손대지 않고 알린다(센터 관리자가 풀어야 함)
          this.lastProblem = `처리 안 하는 작업 유형 ${a.taskType}`;
          this.ctx.log(`${this.account} ${a.taskType} ${a.taskId} 받음 — 가상 작업자는 PICK·PACK 만`);
          this.state = 'ERROR';
          this.activity = this.lastProblem;
          await this.wait(REAL_WORKERS.errorBackoffSec * 4);
        }
        this.lastProblem = null;
      } catch (e) {
        if (e instanceof AccountHalted) {
          this.halt(a);
          break;
        }
        this.state = 'ERROR';
        this.lastProblem = e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code}` : (e as Error).message;
        this.activity = `오류: ${this.lastProblem}`;
        this.ctx.log(`${this.account} ${a.taskType} ${a.taskId} 중단 — ${this.lastProblem}`);
        await this.wait(REAL_WORKERS.errorBackoffSec);
      }
      this.currentTarget = null;
      if (this.state !== 'ERROR' && !this.hasCart && this.carrying.length === 0) {
        this.state = 'RETURNING';
        this.activity = '대기 위치로';
        await this.walkTo(this.home);
      }
    }
    if (this.halted) return;
    this.idle = true;
    this.state = 'IDLE';
    this.activity = '퇴근';
    this.left = true;
  }

  /** R-14: 이 계정을 멈춘다. 들고 있던 작업은 서버에 그대로 남는다(센터 관리자가 풀거나 다시 배정) */
  private halt(a: CapacityAssignment | null) {
    this.halted = true;
    this.idle = true;
    this.state = 'ERROR';
    this.lastProblem = '401 반복 — 계정 멈춤(R-14)';
    this.activity = '계정 멈춤 — 토큰을 새로 받은 뒤에도 401';
    this.ctx.log(`${this.account} 토큰을 새로 받은 뒤에도 401 — 계정 멈춤(R-14)${a ? `, 작업 ${a.taskType} ${a.taskId} 는 서버에 그대로` : ''}`);
  }

  /** 배정이 작업에 반영(ASSIGNED, 담당 = 나)되기를 기다린다. 이미 시작했으면(IN_PROGRESS) 이어서 한다 */
  private async awaitAssigned(a: CapacityAssignment): Promise<{ task: TaskDetail; started: boolean }> {
    for (let i = 0; ; i++) {
      const t = await this.retry(() => this.be.getTask(a.taskId));
      const mine = t.assignment?.workerId === this.workerId;
      if (mine && t.state === 'IN_PROGRESS') return { task: t, started: true };
      if (mine && t.state === 'ASSIGNED') return { task: t, started: false };
      if (i >= REAL_WORKERS.assignWaitSec) throw new Error(`배정 반영 안 됨 (${t.state}, 담당 ${t.assignment?.workerId ?? '없음'})`);
      this.activity = '배정 반영 대기';
      await this.wait(1);
    }
  }

  private async doPick(a: CapacityAssignment) {
    const { ctx, be } = this;
    let { task, started } = await this.awaitAssigned(a);
    const av = task.assignment?.assignmentVersion ?? a.assignmentVersion;
    const shipmentId = task.shipmentId ?? '';
    this.pda = this.view(task, 'PICK', '작업 시작');
    if (!started) {
      await this.retry(() => be.startTask(task.taskId, { workerId: this.workerId!, assignmentVersion: av, deviceId: `SIM-${this.account}` }, this.key('start', task.taskId)));
    }
    // 장바구니(CRT-A-01) — 방문 순서의 출발점
    this.state = 'TO_CART';
    this.activity = '장바구니 가지러';
    await this.walkTo(ctx.point('CRT-A-01') ?? ctx.layout.points.cartDepot);
    await this.wait(8);
    this.hasCart = true;

    // 시작 뒤 상세의 visitSeq 가 방문 순서(fulfillment 0.4.10, ADR-0050). 없으면 줄 순서
    task = await this.retry(() => be.getTask(task.taskId));
    const stops = task.lines
      .flatMap((l) =>
        (l.picks ?? [])
          .filter((p) => p.remainingQty > 0)
          .map((p) => {
            const locs = p.locations ?? [];
            const allocated = locs.filter((x) => (x.allocatedQty ?? 0) > 0);
            const from = (allocated[0] ?? locs[0])?.locationCode ?? null;
            return { line: l, pick: p, from, seq: p.visitSeq ?? Number.MAX_SAFE_INTEGER };
          }),
      )
      .sort((x, y) => x.seq - y.seq);
    this.state = 'PICKING';
    for (let i = 0; i < stops.length; i++) {
      const { line, pick, from } = stops[i];
      if (!from) throw new Error(`${line.sku} 집을 칸 없음`);
      const loc = ctx.location(from);
      const temp = tempOfCode(from);
      this.currentTarget = loc;
      this.pda = {
        ...this.view(task, 'PICK', '로케이션 이동'),
        progress: `${i + 1} / ${stops.length}`,
        location: from,
        nextLocation: stops[i + 1]?.from ?? null,
        temp: temp ? TEMP_KO[temp] : null,
        productName: line.productName ?? null,
        plannedQty: pick.remainingQty,
        pickedQty: 0,
      };
      this.activity = `피킹 ${i + 1}/${stops.length} → ${from}`;
      if (loc) {
        await this.walkTo(loc.pick);
        this.heading = Math.atan2(loc.shelf.x - this.pos.x, loc.shelf.z - this.pos.z);
      }
      this.pda.step = '위치·상품 바코드 스캔';
      await this.wait(ctx.params.pickScanSecPerLine + ctx.params.pickSecPerUnit * pick.remainingQty);
      const to = packDropFor(temp);
      await this.retry(() =>
        be.recordExecution(
          task.taskId,
          {
            executionType: 'PICK',
            workerId: this.workerId!,
            assignmentVersion: av,
            fromLocation: from,
            toLocation: to,
            lines: [{ orderLineId: line.orderLineId, sku: line.sku, lotId: pick.lotId, pickedQty: pick.remainingQty }],
          },
          this.key('pick', task.taskId, `:${line.orderLineId}:${pick.lotId}`),
        ),
      );
      this.dropped.set(line.sku, { loc: to, temp });
      for (let k = 0; k < pick.remainingQty && this.carrying.length < 12; k++) this.carrying.push(temp ?? 'AMBIENT');
      this.pda.pickedQty = pick.remainingQty;
      this.pda.step = '집품 등록됨';
    }
    this.currentTarget = null;
    // 패킹 대기 지점(집은 상품 내려놓기) — PACK 은 다음 작업 받기가 이어서 준다(capacity: PICK 담당에게 PACK)
    this.state = 'WAIT_STATION';
    this.activity = '패킹 대기 지점으로';
    const firstDrop = [...this.dropped.values()][0]?.loc ?? 'PAK-C-01';
    await this.walkTo(ctx.point(firstDrop) ?? ctx.layout.points.packQueue);
    await this.wait(4);
    this.hasCart = false;
    this.carrying = [];
    ctx.log(`${this.account} 피킹 완료 ${shipmentId}`);
  }

  private async doPack(a: CapacityAssignment) {
    const { ctx, be } = this;
    const { task, started } = await this.awaitAssigned(a);
    const av = task.assignment?.assignmentVersion ?? a.assignmentVersion;
    const shipmentId = task.shipmentId;
    if (!shipmentId) throw new Error('PACK 작업에 출고 ID 없음');
    this.state = 'WAIT_STATION';
    this.pda = this.view(task, 'PACK', '패킹대 대기');
    this.activity = '패킹대 대기';
    await this.walkTo(ctx.layout.points.packQueue);
    const station = await ctx.stations.acquire(this.account);
    try {
      this.activity = `${station.id}로 이동`;
      await this.walkTo(station.stand);
      this.heading = Math.atan2(station.table.x - this.pos.x, station.table.z - this.pos.z);
      if (!started) {
        await this.retry(() => be.startTask(task.taskId, { workerId: this.workerId!, assignmentVersion: av, deviceId: `SIM-${this.account}` }, this.key('start', task.taskId)));
      }
      this.state = 'PACKING';
      const lines = task.lines.filter((l) => l.remainingQty > 0);
      const units = lines.reduce((s, l) => s + l.remainingQty, 0);
      const packSec = ctx.params.packBaseSec + ctx.params.packPerUnitSec * units;

      // 패킹 시작 때 배차 요청(사용자 2026-11-16, 계약 0.4.11 — 점원 요청만). 출고당 한 번, 이미 있으면 200
      const minutes = Math.min(180, Math.max(1, Math.ceil(packSec / 60)));
      this.pda = { ...this.view(task, 'PACK', `배차 요청 (예상 ${minutes}분)`), progress: `${units}개` };
      try {
        await this.retry(() => be.requestDispatch(shipmentId, minutes, this.key('dispatch', shipmentId)));
        ctx.log(`${this.account} 배차 요청 ${shipmentId} (예상 포장 ${minutes}분)`);
      } catch (e) {
        // 배차 요청 거절은 포장을 막지 않는다 — 사유만 남긴다(점원은 READY 뒤에도 요청할 수 있음)
        const code = e instanceof ApiProblem ? e.problem.code : (e as Error).message;
        this.lastProblem = `배차 요청 ${code}`;
        ctx.log(`${this.account} 배차 요청 거절 ${shipmentId} ${code}`);
      }
      this.pda.step = '상품·기한 확인 → 포장';
      this.activity = `패킹 ${station.id} (${units}개)`;
      await this.wait(packSec);

      // 밀봉: 집품분이 놓인 포장 위치·온도대별로 봉투 하나씩. 위치는 내가 내려놓은 곳 → PACK 상세 packingLocations 가 하나면 그곳 →
      // 재고 조회(PICKED) 순으로 찾고, 그래도 모르면 보내지 않는다(계약: 집품 위치가 하나면 서버가 정함)
      const groups = new Map<string, { loc: string | null; temp: TemperatureZone | null; lines: typeof lines }>();
      const onlyLoc = task.packingLocations?.length === 1 ? task.packingLocations[0] : null;
      for (const l of lines) {
        let d = this.dropped.get(l.sku) ?? (onlyLoc ? { loc: onlyLoc, temp: onlyLoc.startsWith('PAK-F') ? ('FROZEN' as const) : null } : null);
        if (!d) {
          const st = await be.getCenterStock(ctx.mfcId, l.sku).catch(() => null);
          const u = st?.units.find((x) => x.workState === 'PICKED' && x.qty >= l.remainingQty && x.locationCode.startsWith('PAK-'));
          d = u ? { loc: u.locationCode, temp: u.locationCode.startsWith('PAK-F') ? 'FROZEN' : null } : null;
        }
        const k = `${d?.loc ?? '-'}|${d?.temp ?? '-'}`;
        const g = groups.get(k) ?? { loc: d?.loc ?? null, temp: d?.temp ?? null, lines: [] };
        g.lines.push(l);
        groups.set(k, g);
      }
      let n = 0;
      for (const g of groups.values()) {
        n++;
        this.pda.step = `${g.temp ? TEMP_KO[g.temp] : ''} 봉투 밀봉·라벨 출력 (${n}/${groups.size})`;
        await this.wait(12);
        await this.retry(() =>
          be.sealPackage(
            shipmentId,
            {
              contents: g.lines.map((l) => ({ orderLineId: l.orderLineId, sku: l.sku, qty: l.remainingQty })),
              bagCount: 1,
              ...(g.temp ? { temperatureZone: g.temp } : {}),
              ...(g.loc ? { packingLocation: g.loc } : {}),
              packedBy: this.workerId!,
            },
            this.key('seal', shipmentId, `:${g.loc ?? '-'}:${g.temp ?? '-'}`),
          ),
        );
        this.carrying.push(g.temp ?? 'AMBIENT');
      }
      for (const l of lines) this.dropped.delete(l.sku);
    } finally {
      ctx.stations.release(station);
    }
    // 출하대기 랙(DSP-A-01) — 포장은 위치를 주지 않아 랙 1 앞에 두는 것으로 그린다
    this.state = 'TO_SHIP';
    this.activity = '출하대기 랙으로';
    this.pda!.step = '출하대기 랙 적재';
    await this.walkTo(ctx.point('DSP-A-01') ?? ctx.layout.points.shipDrop);
    await this.wait(4 * Math.max(1, this.carrying.length));
    this.carrying = [];
    this.ordersDone += 1;
    ctx.log(`${this.account} 포장 완료 ${shipmentId}`);
  }

  private view(t: TaskDetail, type: 'PICK' | 'PACK', step: string): PdaView {
    return {
      taskId: t.taskId,
      taskType: type,
      orderId: t.fulfillmentId,
      shipmentId: t.shipmentId ?? '',
      step,
      progress: '',
      location: null,
      nextLocation: null,
      temp: null,
      productName: null,
      barcode: null,
      plannedQty: null,
      pickedQty: null,
    };
  }
}

/** 토큰을 새로 받은 뒤에도 401 — 이 계정은 멈춘다(R-14) */
class AccountHalted extends Error {}
