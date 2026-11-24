// 실서버 가상 작업자(mfcw-pp-01~10, 사용자 결정 2026-11-16): 실제 PDA 처럼 자기 토큰으로 계약 API 를 부른다.
// 다음 작업 받기(업무 PICK_PACK) → 시작 → 장바구니 → 받은 방문 순서(visitSeq)대로 걸어 집품 실적(도착지 = 장바구니, fulfillment 0.8.0)
// → 패킹대 → PACK 시작과 함께 배차 요청(점원 MANUAL) → 밀봉(장바구니 → 패킹대) → 출하대기 랙. 서버가 확정한 결과만 진행으로 본다. 응답이 없으면 같은 Idempotency-Key 로 다시 보낸다.
// 실서버에서는 결품을 지어내지 않는다(MOCK 의 무작위 결품 없음). 인계는 rider 시뮬레이터 몫(backend-requests "rider 시뮬레이터 요청").
// 피패킹이 없으면 재고 이동(STOCK_MOVE — 적치·보충·이동·취소품 복귀), 품질검사(INSPECTION) 순으로 묻는다(capacity 0.14.0).
// 품질검사는 PDA 와 같은 기준(inbound 0.11.0)으로 판정한다 — 기한·제조일은 서버 LOT 정보에서 읽고 지어내지 않는다(domain/inspectVerdict.ts).

import type { HttpBackend } from '../backend/http/HttpBackend';
import type { TokenSource } from '../backend/http/tokens';
import {
  ApiProblem,
  ResultUnknown,
  type CapacityAssignment,
  type CommandResponse,
  type InboundTask,
  type InboundTaskExecution,
  type ReturnInspectionLine,
  type TaskDetail,
  type TaskLine,
  type TemperatureZone,
  type WorkArea,
} from '../domain/contract';
import type { Layout, Location } from '../domain/layout';
import type { NavGrid, P } from '../domain/navgrid';
import { INBOUND_UNLOAD, REAL_WORKERS, RETURN_FLOW } from '../config';
import type { SimParams } from '../config';
import { Agent } from './agent';
import { cartInDetail, type CartPool } from './cartPool';
import { inspectVerdict, seoulToday } from '../domain/inspectVerdict';
import type { StationPool } from './site';
import type { BasketLine, PdaView, WorkerState } from './worker';

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
  /** 시뮬레이터 코드(패킹대 PS-n 등) → 백엔드 위치 코드 */
  wire: (simCode: string) => string | null;
  /** 장바구니 나눠 쓰기(한 출고 = 한 장바구니) */
  carts: CartPool;
  /** 서버 작업자 속도 배율(capacity 0.11.0 `speedFactor`, 0.5~2.0). 모르면 1 */
  speedFactor?: (workerId: string) => number;
  /** 이 운영자 계정을 실제 PDA 가 쓰는 중인가(최근 서버 작업의 담당·피킹한 사람). null = 아직 판단 못 함(첫 조회 전) */
  pdaInUse?: (workerId: string) => boolean | null;
  /** 가상 작업자가 PDA 로그인 중이라 건너뛰었다 — 시뮬레이션이 다음 계정으로 채운다 */
  onSkipped?: (account: string) => void;
  /** 이 운영자에게 서버에 남은 자기 일이 있나(열린 작업의 담당, 또는 자기가 피킹한 배정 전 PACK) — 이어 하기 작업자가 언제 멈출지 */
  ownWork?: (workerId: string) => boolean;
  /** 밀봉한 포장을 올릴 출하대기 랙(없으면 DSP-A-01) */
  pickRack?: () => string;
  /** 입고 하차 한 건 가져가기(입고 가상 작업자만) — 승강기 → 입고칸으로 롤테이너를 옮긴 뒤 서버 수령 */
  takeUnload?: () => UnloadJob | null;
}

/**
 * 입고 하차(시뮬레이터 그림 + 서버 수령) — 사용자 2026-11-24 "왜 입고재고 구역에서 상품이 갑자기 생기고 … 승강기에서 가져오고".
 * 서버에는 하차 작업이 없다(수령 = 입고칸에 놓인 뒤 한 번). 작업자가 승강기에서 롤테이너를 빼 그 온도대 입고칸으로 밀고 와 내린 다음 receive()로 수령한다
 */
export interface UnloadJob {
  receiptId: string;
  temp: TemperatureZone;
  /** 수령 위치(입고칸 RCV-…) */
  at: string;
  lines: { sku: string; qty: number; name?: string | null }[];
  /** 서버 수령(같은 Idempotency-Key 로 다시 보내는 것 포함) — 실제 받은 위치를 돌려준다 */
  receive: () => Promise<string>;
  /** 롤테이너 하나를 내렸다(그림 차량 하차 수) */
  onRoll: (lines: number) => void;
  done: (ok: boolean, why?: string) => void;
}

/** 가상 작업자가 작업 시작 때 보내는 기기 ID — 서버 작업 상세 activeStart.deviceId 로 돌아온다(끊긴 작업 찾기) */
export const SIM_DEVICE_PREFIX = 'SIM-';
export function simDeviceId(account: string): string {
  return `${SIM_DEVICE_PREFIX}${account}`;
}

const TEMP_KO: Record<TemperatureZone, string> = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' };

/** 격리 구역 칸(LAN QRT-A/C/F-01, BR-52 회신) — 작업의 추천 칸(suggestedToLocations)이 없을 때만 */
const QRT_OF: Record<TemperatureZone, string> = { AMBIENT: 'QRT-A-01', CHILLED: 'QRT-C-01', FROZEN: 'QRT-F-01' };
/** 이 화면의 가상 작업자끼리 같은 반납·반입 건을 두 번 잡지 않게(서버도 409 ARRIVAL_ALREADY_RECEIVED·INVALID_STATE 로 막음) */
const returnClaims = new Set<string>();
/** 회수품 반입 위치(RETURN 구역) [확정] BACKEND_FACTS.returnIntake */
const BACKEND_RTN = 'RTN-A-01';
/** 입고 검사 계정(qc)·적치 계정(rcv) — 회수품 검수는 qc, 반입은 rcv(1호점 mfcw-·2호점 mfcw-mk-) */
export function returnRoleOf(account: string): 'INSPECT' | 'RECEIVE' | null {
  return /-qc-\d\d$/.test(account) ? 'INSPECT' : /-rcv-\d\d$/.test(account) ? 'RECEIVE' : null;
}

/**
 * 회수품 검수 판정(계약 mfc-quality: RESALE 은 상온·미개봉·신선 아님만). 가상 작업자는 개봉·파손을 지어내지 않는다 —
 * 상온·신선 아님 = 재판매, 냉장·냉동(신선) = 폐기. 온도대를 모르면 null(손대지 않음)
 */
export function returnVerdict(line: { sku: string; qty: number; lotId?: string | null; orderLineId?: string | null; temperatureZone?: TemperatureZone | null; fresh?: boolean | null }): ReturnInspectionLine | null {
  const t = line.temperatureZone;
  if (!t) return null;
  const fresh = line.fresh ?? t !== 'AMBIENT';
  const resale = t === 'AMBIENT' && !fresh;
  return {
    ...(line.orderLineId ? { orderLineId: line.orderLineId } : {}),
    sku: line.sku,
    ...(line.lotId ? { lotId: line.lotId } : {}),
    qty: line.qty,
    verdict: resale ? 'RESALE' : 'DISPOSE',
    temperatureZone: t,
    fresh,
    opened: false,
    ...(resale ? {} : { disposeReason: t !== 'AMBIENT' ? ('TEMPERATURE_ZONE' as const) : ('FRESH' as const) }),
  };
}

/** 백엔드 칸 코드 첫 글자 = 온도대(`{A/C/F}-…`, SIM-6) */
export function tempOfCode(code: string): TemperatureZone | null {
  const c = code[0];
  return c === 'F' && code[1] === '-' ? 'FROZEN' : c === 'C' && code[1] === '-' ? 'CHILLED' : c === 'A' && code[1] === '-' ? 'AMBIENT' : null;
}

/** 예전 흐름의 집품 도착지(포장 위치, R-13): 냉동 PAK-F-01, 냉장·상온 PAK-C-01 — 지금 가상 작업자는 장바구니로 집품(fulfillment 0.8.0) */
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
  /** 선반 가득으로 남은 양을 입고칸에 둔 적치 작업 — 같은 작업을 다시 받으면 기다린다(R-30) */
  readonly overflow = new Map<string, { sku: string; rest: number; at: number }>();
  /** 마지막 거절·오류(화면 표시) */
  lastProblem: string | null = null;
  /** 퇴근 요청 — 들고 있는 작업을 마치면 멈춘다 */
  leaving = false;
  /** 멈춤(퇴근 끝) */
  left = false;
  /** PDA 가 이 계정을 쓰는 중이라 시작하지 않음 */
  skipped = false;
  /** 끊긴 작업 이어 하기 — 서버에 남은 자기 일(들고 있던 작업·자기가 피킹한 PACK)만 끝내고 퇴근 */
  resumeOnly = false;
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
  /** 422 WORK_AREA_NOT_ALLOWED 를 받은 업무 — 이 작업자에게 다시 묻지 않는다 */
  private readonly deniedAreas = new Set<WorkArea>();

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
        // 401 아닌 응답(업무 거절 등)도 인증은 통과한 것 — 다음 401 은 다시 한 번 토큰을 새로 받는다
        if (e instanceof ApiProblem) this.reauthed = false;
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
        // 같은 계정을 실제 PDA 가 쓰는 중이면 시작하지 않는다(같은 사람으로 서버에 이중 작업 — 사용자 2026-11-19 "이미 로그인된 작업자는 제외")
        let inUse = this.resumeOnly ? false : (this.ctx.pdaInUse?.(this.workerId) ?? false);
        for (let i = 0; inUse === null && i < 20 && !this.stopped; i++) {
          this.activity = 'PDA 사용 여부 확인 중';
          await this.wait(1);
          inUse = this.ctx.pdaInUse?.(this.workerId) ?? false;
        }
        if (inUse) {
          this.skipped = true;
          this.activity = 'PDA 로그인 중 — 건너뜀';
          this.ctx.log(`${this.account} 는 실제 PDA 가 쓰는 중 — 가상 작업자로 쓰지 않음`);
          this.idle = true;
          this.state = 'IDLE';
          this.left = true;
          this.ctx.onSkipped?.(this.account);
          return;
        }
      }
      // 이어 하기: 서버에 남은 자기 일이 없으면 새 작업을 받지 않고 퇴근
      if (this.resumeOnly && this.ctx.ownWork && !this.ctx.ownWork(this.workerId)) {
        this.activity = '이어 하기 끝 — 퇴근';
        this.left = true;
        return;
      }
      // 입고 하차가 기다리면 서버 작업보다 먼저(차량이 서 있다) — 입고 계정(qc·rcv)만
      const job = returnRoleOf(this.account) && !this.resumeOnly ? this.ctx.takeUnload?.() : null;
      if (job) {
        this.idle = false;
        await this.doUnload(job);
        this.currentTarget = null;
        continue;
      }
      let a: CapacityAssignment | null;
      try {
        this.activity = '다음 작업 받기';
        a = await this.pull();
      } catch (e) {
        if (e instanceof AccountHalted) {
          this.halt(null);
          break;
        }
        const code = e instanceof ApiProblem ? e.problem.code : (e as Error).message;
        this.lastProblem = code;
        this.activity = `작업 받기 거절 ${code}`;
        this.ctx.log(`${this.account} 다음 작업 받기 거절 ${code}`);
        await this.wait(REAL_WORKERS.errorBackoffSec);
        continue;
      }
      // 피킹한 장바구니를 끌고 왔는데 다음 일이 포장이 아니면(다른 사람이 포장) 장바구니를 패킹 대기 지점에 두고 간다
      if (this.hasCart && a?.taskType !== 'PACK') {
        this.activity = '장바구니 패킹 대기 지점에 두기';
        await this.walkTo(this.ctx.layout.points.packQueue);
        await this.work(3);
        this.hasCart = false;
      }
      if (!a) {
        this.lastProblem = null;
        // 받을 작업이 없으면 회수품 일(반입 rcv · 검수 qc) — capacity 작업이 아니라 PDA 처럼 대기 목록에서 고른다
        if (await this.returnWork().catch((e: unknown) => this.returnWorkFailed(e))) continue;
        this.activity = '작업 없음 — 대기';
        await this.wait(REAL_WORKERS.noTaskRetrySec);
        continue;
      }
      this.idle = false;
      try {
        if (a.taskType === 'PICK') await this.doPick(a);
        else if (a.taskType === 'PACK') await this.doPack(a);
        else if (a.taskType === 'RETURN') await this.doReturn(a);
        else if (a.taskType === 'INSPECT') await this.doInspect(a);
        else if (a.taskType === 'PUTAWAY') await this.doPutaway(a);
        else if (a.taskType === 'QUARANTINE_MOVE') await this.doQuarantineMove(a);
        else if (a.taskType === 'REPLENISH' || a.taskType === 'MOVE') await this.doMove(a);
        else {
          // 묻는 업무(PICK_PACK·STOCK_MOVE·INSPECTION)면 오지 않는다(RECEIVE 등) — 온다면 손대지 않고 알린다(센터 관리자가 풀어야 함)
          this.lastProblem = `처리 안 하는 작업 유형 ${a.taskType}`;
          this.ctx.log(`${this.account} ${a.taskType} ${a.taskId} 받음 — 가상 작업자는 PICK·PACK·RETURN·INSPECT·PUTAWAY·QUARANTINE_MOVE·REPLENISH·MOVE 만`);
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
        // 하던 작업이 그사이 취소됨(주문 취소 — 예: 배차 불가 자동 취소 DISPATCH_UNAVAILABLE, 관리자 판단 취소)이면 오류가 아니다.
        // 서버 작업 상태를 다시 읽어 끝난 작업이면 멈추고 다음 작업으로(남은 물건은 서버가 만든 복귀 작업 RETURN 이 처리). 사용자 2026-11-20 "409 INVALID_STATE — 포장 작업은 CANCELLED" 화면 오류
        if (e instanceof ApiProblem && e.problem.status === 409 && (a.taskType === 'INSPECT' || a.taskType === 'PUTAWAY' || a.taskType === 'QUARANTINE_MOVE')) {
          // 입고 작업이 그사이 끝남(다른 화면의 같은 계정·다른 작업자가 먼저) — 오류가 아니라 다음 작업으로(사용자 2026-11-20)
          const it = await this.be.getInboundTask(a.taskId).catch(() => null);
          if (it && (it.state === 'COMPLETED' || it.plannedQty - it.doneQty <= 0)) {
            this.lastProblem = null;
            this.carrying = [];
            this.hasCart = false;
            this.activity = `${a.taskType === 'INSPECT' ? '품질검사' : a.taskType === 'QUARANTINE_MOVE' ? '격리 이동' : '적치'} 이미 끝남 — 다음 작업`;
            this.ctx.log(`${this.account} ${a.taskType} ${a.taskId} 이미 끝남(409) — 다음 작업으로`);
            continue;
          }
        }
        if (e instanceof ApiProblem && e.problem.status === 409) {
          const now = await this.be.getTask(a.taskId).catch(() => null);
          if (now && (now.state === 'CANCELLED' || now.state === 'CLOSED_PARTIAL')) {
            this.lastProblem = null;
            this.activity = `주문 취소 — ${a.taskType === 'PACK' ? '포장' : '작업'} 멈춤(${now.state === 'CANCELLED' ? '취소' : '부분 종료'})`;
            this.ctx.log(`${this.account} ${a.taskType} ${a.taskId} 이 ${now.state} — 주문 취소로 멈추고 다음 작업으로(남은 물건은 복귀 작업)`);
            if (now.shipmentId) this.ctx.carts.release(now.shipmentId);
            this.hasCart = false;
            this.carrying = [];
            this.pda = null;
            this.currentTarget = null;
            continue;
          }
        }
        this.state = 'ERROR';
        this.lastProblem = e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code}${e.problem.detail ? ` — ${e.problem.detail.slice(0, 80)}` : ''}` : (e as Error).message;
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

  /**
   * 다음 작업 받기 — 업무 순서(REAL_WORKERS.workAreas)대로 묻는다. 모두 409 NO_TASK_AVAILABLE 이면 null.
   * 422 WORK_AREA_NOT_ALLOWED(그 업무 권한 없음)는 이 작업자에게 다시 묻지 않는다. 들고 있는 작업이 있으면 어느 업무든 그것(200).
   */
  private async pull(): Promise<CapacityAssignment | null> {
    this.pulls++;
    let asked = 0;
    for (const area of REAL_WORKERS.workAreas) {
      if (this.deniedAreas.has(area)) continue;
      asked++;
      const k = this.key('pull', String(this.pulls), `:${area}`);
      try {
        return await this.retry(() => this.be.pullNextTask(this.ctx.mfcId, this.workerId!, area, k));
      } catch (e) {
        const code = e instanceof ApiProblem ? e.problem.code : null;
        if (code === 'NO_TASK_AVAILABLE') continue;
        if (code === 'WORK_AREA_NOT_ALLOWED') {
          this.deniedAreas.add(area);
          this.ctx.log(`${this.account} 업무 ${area} 권한 없음(422 WORK_AREA_NOT_ALLOWED) — 이제 묻지 않음`);
          continue;
        }
        throw e;
      }
    }
    if (asked === 0) throw new Error('맡을 업무 없음(모두 WORK_AREA_NOT_ALLOWED)');
    return null;
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
      await this.retry(() => be.startTask(task.taskId, { workerId: this.workerId!, assignmentVersion: av, deviceId: simDeviceId(this.account) }, this.key('start', task.taskId)));
    }
    // 장바구니 — 방문 순서의 출발점. 한 출고 = 한 장바구니(fulfillment 0.8.0): 출고마다 빈 카트 하나(온도 구분 없음), 집품 실적 도착지가 이 카트
    let cart = ctx.carts.take(shipmentId);
    this.state = 'TO_CART';
    this.activity = `장바구니 ${cart} 가지러`;
    this.pda = this.view(task, 'PICK', `장바구니 ${cart} 스캔`);
    await this.walkTo(ctx.point(cart) ?? ctx.layout.points.cartDepot);
    await this.work(8);
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
    // 따라가기 왼쪽 패널용 고를 목록 — 집음 표시는 서버가 받은(ACCEPTED) 뒤에만
    const basket: BasketLine[] = stops.map(({ line, pick, from }) => {
      const t = from ? tempOfCode(from) : null;
      return { name: line.productName ?? line.sku, location: from ?? '-', temp: t ? TEMP_KO[t] : null, planned: pick.remainingQty, picked: 0, state: 'TODO' };
    });
    for (let i = 0; i < stops.length; i++) {
      const { line, pick, from } = stops[i];
      if (!from) throw new Error(`${line.sku} 집을 칸 없음`);
      const loc = ctx.location(from);
      const temp = tempOfCode(from);
      this.currentTarget = loc;
      basket[i].state = 'NOW';
      this.pda = {
        ...this.view(task, 'PICK', '로케이션 이동'),
        basket,
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
      await this.work(ctx.params.pickScanSecPerLine + ctx.params.pickSecPerUnit * pick.remainingQty);
      const send = (to: string) =>
        this.retry(() =>
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
            this.key('pick', task.taskId, `:${line.orderLineId}:${pick.lotId}:${to}`),
          ),
        );
      let res: CommandResponse;
      try {
        res = await send(cart);
      } catch (e) {
        // 이어 하기 등으로 이 출고가 이미 다른 장바구니를 쓰면 409 CART_MISMATCH(detail 에 그 장바구니) — 그 카트로 다시
        const used = e instanceof ApiProblem && e.problem.code === 'CART_MISMATCH' ? cartInDetail(e.problem.detail) : null;
        if (!used || used === cart) throw e;
        ctx.log(`${this.account} ${shipmentId} 는 장바구니 ${used} 를 씀(409 CART_MISMATCH) — 그 카트로 다시`);
        cart = used;
        ctx.carts.bind(shipmentId, cart);
        res = await send(cart);
      }
      if (res.status === 'REJECTED') throw new Error(`집품 거절 ${await this.rejectOf(task.taskId, res)}`);
      this.dropped.set(line.sku, { loc: cart, temp });
      for (let k = 0; k < pick.remainingQty && this.carrying.length < 12; k++) this.carrying.push(temp ?? 'AMBIENT');
      this.pda.pickedQty = pick.remainingQty;
      basket[i].picked = pick.remainingQty;
      basket[i].state = 'DONE';
      this.pda.step = '집품 등록됨';
    }
    this.currentTarget = null;
    // 패킹 대기 지점(장바구니를 끌고 가 둔다) — PACK 은 다음 작업 받기가 이어서 준다(capacity: PICK 담당에게 PACK)
    this.state = 'WAIT_STATION';
    // 빈 패킹대가 있으면 대기 지점에 들르지 않고 바로 패킹대로(사용자 2026-11-23 "장바구니 거치대로 갔다가 대기 자리로 갔다가 패킹하러 가는거지? 동선이 그게 맞는 건가?")
    if (!ctx.stations.hasFree()) {
      this.activity = `장바구니 ${cart} 패킹 대기 지점으로`;
      await this.walkTo(ctx.layout.points.packQueue);
      await this.work(4);
    }
    // 장바구니는 패킹대까지 끌고 간다 — 패킹 뒤 빈 장바구니를 거치대에 둔다(사용자 2026-11-23 "패킹하러 갈 때 장바구니가 어느순간 사라져 … 장바구니 거치대에 두고 나서 인계랙에 포장 갖다두던가")
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
    const packCart = ctx.carts.cartOf(shipmentId);
    if (packCart) this.hasCart = true; // 집품분이 실린 장바구니를 끌고 패킹대로
    this.pda = this.view(task, 'PACK', '패킹대 대기');
    this.activity = '패킹대 대기';
    if (!ctx.stations.hasFree()) await this.walkTo(ctx.layout.points.packQueue);
    /** 이번에 밀봉한 포장 — ⑤ 랙에 올릴 것 */
    const sealed: string[] = [];
    const station = await ctx.stations.acquire(this.account);
    try {
      this.activity = `${station.id}로 이동`;
      await this.walkTo(station.stand);
      this.heading = Math.atan2(station.table.x - this.pos.x, station.table.z - this.pos.z);
      if (!started) {
        await this.retry(() => be.startTask(task.taskId, { workerId: this.workerId!, assignmentVersion: av, deviceId: simDeviceId(this.account) }, this.key('start', task.taskId)));
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
      await this.work(packSec);

      // 밀봉: 집품분이 놓인 위치·온도대별로 봉투 하나씩. 위치는 내가 담은 장바구니 → PACK 상세 packingLocations 가 하나면 그곳 →
      // 재고 조회(PICKED) 순으로 찾는다. 장바구니면 packingLocation = 이 패킹대(필수 — 장바구니 → 패킹대로 옮기며 PACKED, fulfillment 0.8.0),
      // 포장 위치(예전 흐름)면 그 위치, 모르면 보내지 않는다(계약: 집품 위치가 하나면 서버가 정함)
      const stationCode = ctx.wire(station.id);
      const groups = new Map<string, { loc: string | null; temp: TemperatureZone | null; lines: typeof lines }>();
      const onlyLoc = task.packingLocations?.length === 1 ? task.packingLocations[0] : null;
      for (const l of lines) {
        let d = this.dropped.get(l.sku) ?? (onlyLoc ? { loc: onlyLoc, temp: onlyLoc.startsWith('PAK-F') ? ('FROZEN' as const) : null } : null);
        if (!d) {
          const st = await be.getCenterStock(ctx.mfcId, l.sku).catch(() => null);
          const u = st?.units.find((x) => x.workState === 'PICKED' && x.qty >= l.remainingQty && /^(PAK|CRT)-/.test(x.locationCode));
          d = u ? { loc: u.locationCode, temp: u.locationCode.startsWith('PAK-F') ? 'FROZEN' : null } : null;
        }
        // 온도대마다 봉투 하나 — 줄의 SKU 온도대(fulfillment 0.25.0)를 먼저, 모르면 위치로 짐작. PDA 처럼 섞지 않는다(사용자 2026-11-20 "포장도 제대로 하고 있는 거 맞아?" — 83072555 냉장·상온 한 봉투)
        const temp = l.temperatureZone ?? d?.temp ?? null;
        const k = `${d?.loc ?? '-'}|${temp ?? '-'}`;
        const g = groups.get(k) ?? { loc: d?.loc ?? null, temp, lines: [] };
        g.lines.push(l);
        groups.set(k, g);
      }
      let n = 0;
      for (const g of groups.values()) {
        n++;
        this.pda.step = `${g.temp ? TEMP_KO[g.temp] : ''} 봉투 밀봉·라벨 출력 (${n}/${groups.size})`;
        await this.work(12);
        const pkg = await this.retry(() =>
          be.sealPackage(
            shipmentId,
            {
              contents: g.lines.map((l) => ({ orderLineId: l.orderLineId, sku: l.sku, qty: l.remainingQty })),
              bagCount: 1,
              ...(g.temp ? { temperatureZone: g.temp } : {}),
              ...(g.loc?.startsWith('CRT-') ? (stationCode ? { packingLocation: stationCode } : {}) : g.loc ? { packingLocation: g.loc } : {}),
              packedBy: this.workerId!,
            },
            this.key('seal', shipmentId, `:${g.loc ?? '-'}:${g.temp ?? '-'}`),
          ),
        );
        if (pkg?.packageId) sealed.push(pkg.packageId);
        this.carrying.push(g.temp ?? 'AMBIENT');
      }
      for (const l of lines) this.dropped.delete(l.sku);
      ctx.carts.release(shipmentId); // 집품분이 패킹대로 옮겨져 장바구니가 빔
    } finally {
      ctx.stations.release(station);
    }
    // 빈 장바구니를 거치대에 두고 나서 포장을 인계 랙으로(사용자 2026-11-23 "패킹하러 갈 때 장바구니가 어느순간 사라져 … 장바구니 거치대에 두고 나서 인계랙에 포장 갖다두던가")
    if (this.hasCart) {
      this.state = 'RETURNING';
      this.activity = `빈 장바구니 ${packCart ?? ''} 거치대에`.replace('  ', ' ');
      await this.walkTo((packCart ? ctx.point(packCart) : null) ?? ctx.layout.points.cartDepot);
      await this.work(3);
      this.hasCart = false;
    }
    // ⑤ 출하대기 랙 — 랙에 올리고 서버에 알린다(fulfillment 0.20.0 stagePackage, F-12·R-20): 포장분 위치만 패킹대 → 랙
    const rack = ctx.pickRack?.() ?? 'DSP-A-01';
    this.state = 'TO_SHIP';
    this.activity = `출하대기 랙 ${rack} 으로`;
    this.pda!.step = '출하대기 랙 적재';
    await this.walkTo(ctx.point(rack) ?? ctx.layout.points.shipDrop);
    await this.work(4 * Math.max(1, this.carrying.length));
    for (const id of sealed) {
      try {
        await this.retry(() => be.stagePackage(id, rack, this.key('stage', id, `:${rack}`)));
      } catch (e) {
        // 랙 올리기가 거절돼도 포장·인계는 그대로(서버 위치만 패킹대) — 사유만 남긴다
        const why = e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code}` : (e as Error).message;
        this.lastProblem = `랙 올리기 ${why}`;
        ctx.log(`${this.account} 포장 ${id} 랙 ${rack} 올리기 실패 — ${why}`);
      }
    }
    this.carrying = [];
    this.ordersDone += 1;
    ctx.log(`${this.account} 포장 완료 ${shipmentId}`);
  }

  // ── 취소품 복귀(RETURN) — PDA return_screen nextReturnPiece·returnPayload 와 같은 순서: 한 번에 한 조각 ──

  private async doReturn(a: CapacityAssignment) {
    const { ctx, be } = this;
    let { task, started } = await this.awaitAssigned(a);
    const av = task.assignment?.assignmentVersion ?? a.assignmentVersion;
    this.pda = this.view(task, 'RETURN', '작업 시작');
    if (!started) {
      await this.retry(() => be.startTask(task.taskId, { workerId: this.workerId!, assignmentVersion: av, deviceId: simDeviceId(this.account) }, this.key('start', task.taskId)));
    }
    const skipped = new Set<string>();
    const sent = new Set<string>();
    let waited = 0;
    let n = 0;
    for (;;) {
      task = await this.retry(() => be.getTask(task.taskId));
      const p = nextReturnPiece(task, skipped);
      if (p && !p.to) {
        // 추천 선반이 없으면(조회 실패 등) 지어내지 않는다 — 그 조각은 건너뛰고 알린다
        skipped.add(p.id);
        this.lastProblem = `${p.line.sku} 돌려놓을 추천 선반 없음`;
        ctx.log(`${this.account} RETURN ${task.taskId} ${p.line.sku} ${p.from} — 추천 선반(suggestedToLocations) 없음, 건너뜀`);
        continue;
      }
      const k = p ? this.key('return', task.taskId, `:${p.line.orderLineId}:${p.lotId}:${p.from}:${p.to}:${p.left}`) : null;
      if (!p || sent.has(k!)) {
        if (task.lines.every((l) => l.remainingQty <= 0)) break;
        // 보낸 실적이 아직 반영(pendingQty) 전이면 잠깐 기다린다. 같은 조각을 같은 키로 두 번 보내지 않는다
        if (waited < REAL_WORKERS.returnConfirmWaitSec && (sent.size > 0 || task.lines.some((l) => l.pendingQty > 0))) {
          this.activity = '복귀 반영 대기';
          waited++;
          await this.wait(1);
          continue;
        }
        if (skipped.size > 0) throw new Error(`복귀 못 한 조각 ${skipped.size}개(추천 선반 없음) — 센터 관리자 확인`);
        break;
      }
      waited = 0;
      n++;
      const loc = ctx.location(p.to!);
      const temp = tempOfCode(p.to!);
      // ① 놓인 곳(장바구니·패킹대)
      this.state = 'TO_CART';
      this.activity = `복귀 ${n} → ${p.from}`;
      this.pda = {
        ...this.view(task, 'RETURN', `${p.from} 스캔`),
        progress: `${n}`,
        location: p.from,
        nextLocation: p.to,
        temp: temp ? TEMP_KO[temp] : null,
        productName: p.line.productName ?? null,
        plannedQty: p.qty,
        pickedQty: 0,
      };
      await this.walkTo(ctx.point(p.from) ?? ctx.layout.points.packQueue);
      this.pda.step = '상품 스캔 → 실었어요';
      await this.work(REAL_WORKERS.shelveBaseSec + REAL_WORKERS.shelveSecPerUnit * p.qty);
      this.hasCart = p.from.startsWith('CRT-');
      for (let i = 0; i < p.qty && this.carrying.length < 12; i++) this.carrying.push(temp ?? 'AMBIENT');
      // ② 돌려놓을 선반
      this.state = 'PICKING';
      this.currentTarget = loc;
      this.activity = `복귀 ${n} → ${p.to}`;
      this.pda.step = '선반 스캔 → 내려놓기';
      this.pda.location = p.to;
      this.pda.nextLocation = null;
      if (loc) {
        await this.walkTo(loc.pick);
        this.heading = Math.atan2(loc.shelf.x - this.pos.x, loc.shelf.z - this.pos.z);
      }
      await this.work(REAL_WORKERS.shelveBaseSec + REAL_WORKERS.shelveSecPerUnit * p.qty);
      const r = await this.retry(() =>
        unknownAsResend(() =>
          be.recordExecution(
            task.taskId,
            {
              executionType: 'RETURN',
              workerId: this.workerId!,
              assignmentVersion: av,
              fromLocation: p.from,
              toLocation: p.to!,
              lines: [{ orderLineId: p.line.orderLineId, sku: p.line.sku, lotId: p.lotId, pickedQty: p.qty }],
            },
            k!,
          ),
        ),
      );
      if (r.status === 'REJECTED') throw new Error(`복귀 거절 ${await this.rejectOf(task.taskId, r)}`);
      sent.add(k!);
      this.pda.pickedQty = p.qty;
      this.pda.step = '복귀 등록됨';
      this.hasCart = false;
      this.carrying = [];
      this.currentTarget = null;
    }
    ctx.log(`${this.account} 취소품 복귀 완료 ${task.taskId}`);
  }

  // ── 품질검사(INSPECT)·적치(PUTAWAY) — mfc-inbound 입고 작업. 담당이 있으면 담당만(409 NOT_ASSIGNEE) ──

  /** 받은 입고 작업 — 끝났으면 null. 담당이 남이면 손대지 않는다 */
  private async inboundTask(a: CapacityAssignment): Promise<InboundTask | null> {
    const t = await this.retry(() => this.be.getInboundTask(a.taskId));
    if (t.state === 'COMPLETED' || t.plannedQty - t.doneQty <= 0) {
      this.ctx.log(`${this.account} ${t.taskType} ${t.taskId} 이미 끝남`);
      return null;
    }
    if (t.assigneeId && t.assigneeId !== this.workerId) throw new Error(`${t.taskId} 담당 ${t.assigneeId} — 내 작업 아님`);
    return t;
  }

  /**
   * 손으로 하는 일(스캔·집기·포장·검사·적치)에 드는 시간 — 서버 속도 배율로 나눈다(capacity: 작업 시간 = 추정 ÷ speedFactor).
   * 걷기도 같은 배율(speed). 재시도·대기·반영 확인 같은 기다림은 나누지 않는다(wait 그대로).
   */
  private async work(sec: number) {
    // 남은 손일을 매 틱 지금 배율로 줄인다 — 하는 중에 속도 배수를 바꿔도 바로 반영(사용자 2026-11-19 "가상 작업자는 속도 배수가 안먹혀")
    this.working = true;
    try {
      await this.wait(sec);
    } finally {
      this.working = false;
    }
  }

  /** 손일(work) 중인가 — 이때의 기다림은 배율로 빨라진다. 그 밖의 기다림(재시도·반영 확인)은 실제 시간 */
  private working = false;

  override walkTo(target: P): Promise<void> {
    this.speed = this.ctx.params.walkSpeed * this.factor();
    return super.walkTo(target);
  }

  /** 걷기 속도·손일 시간을 매 틱 지금 배율로(서버 speedFactor × 화면 속도 배수) */
  override tick(dt: number) {
    const f = this.factor();
    this.speed = this.ctx.params.walkSpeed * f;
    super.tick(this.working ? dt * f : dt);
    if (this.state !== 'IDLE') this.busySeconds += dt;
  }

  private factor(): number {
    const f = this.workerId ? (this.ctx.speedFactor?.(this.workerId) ?? 1) : 1;
    return Number.isFinite(f) && f > 0 ? f : 1;
  }

  /**
   * 거절된 실적의 사유 — 응답에는 없어서(nextAction 은 QUERY_RESULT) resultId = executionId 로 실행을 한 번 읽는다(fulfillment 0.16.0 E1).
   * PDA task_repository.dart _rejectOf 와 같다: 읽기 실패·REJECTED 아님이면 사유만 모른다(거절은 그대로).
   */
  private async rejectOf(taskId: string, r: CommandResponse): Promise<string> {
    if (!r.resultId) return '(사유 모름)';
    try {
      const e = await this.be.getExecution(taskId, r.resultId);
      if (e.state !== 'REJECTED') return '(사유 모름)';
      return [e.rejectCode ?? 'REJECTED', e.rejectReason].filter(Boolean).join(' — ');
    } catch {
      return '(사유 조회 실패)';
    }
  }

  /** 입고 작업 실행 — APPLIED 만 확정. CAPTURED·UNKNOWN_RESULT(503 포함)는 같은 키로 다시, REJECTED 는 오류 */
  private async applied(op: string, key: string, call: (k: string) => Promise<InboundTaskExecution>): Promise<InboundTaskExecution> {
    for (let i = 0; ; i++) {
      const r = await this.retry(() => unknownAsResend(() => call(key)));
      if (r.applyStatus === 'APPLIED') return r;
      if (r.applyStatus === 'REJECTED') throw new Error(`${op} 거절 ${r.rejectReason ?? ''}`.trim());
      if (i >= REAL_WORKERS.unconfirmedResendMax) throw new ResultUnknown(`${op} 결과 불명(${r.applyStatus}) — 다음에 같은 키로 다시`);
      this.activity = `${op} 반영 확인 중 (${r.applyStatus})`;
      await this.wait(REAL_WORKERS.unconfirmedResendSec);
    }
  }

  /** 입고 하차 — 승강기 문에서 롤테이너(같은 온도대 linesPerRoll 줄)를 빼 입고칸으로 밀고 와 내린다. 다 내리면 서버 수령 */
  private async doUnload(job: UnloadJob) {
    const { ctx } = this;
    const U = INBOUND_UNLOAD;
    const lift = ctx.layout.points.truckDoor;
    const dest = ctx.point(job.at) ?? ctx.layout.points.inboundIdle[0];
    const rolls: UnloadJob['lines'][] = [];
    for (let k = 0; k < job.lines.length; k += U.linesPerRoll) rolls.push(job.lines.slice(k, k + U.linesPerRoll));
    const units = job.lines.reduce((a, l) => a + l.qty, 0);
    this.state = 'PICKING';
    this.pda = { ...this.plainView(job.receiptId, 'PUTAWAY', '승강기로'), location: job.at, temp: TEMP_KO[job.temp], plannedQty: units, pickedQty: 0, progress: `하차 ${job.lines.length}품목` };
    try {
      for (const [r, roll] of rolls.entries()) {
        if (r > 0 && r % U.rollsPerLift === 0) {
          this.activity = `승강기 — 다음 롤테이너 올라오는 중`;
          this.pda.step = `승강기 ${Math.floor(r / U.rollsPerLift) + 1}/${Math.ceil(rolls.length / U.rollsPerLift)}회`;
          await this.walkTo(lift);
          await this.wait(U.liftCycleSec);
        }
        this.activity = `하차 ${job.receiptId.slice(-6)} — 롤테이너 ${r + 1}/${rolls.length}(${TEMP_KO[job.temp]} ${roll.length}품목) 승강기에서`;
        this.pda.step = `롤테이너 ${r + 1}/${rolls.length} 빼기`;
        await this.walkTo(lift);
        await this.work(U.takeRollSec);
        this.carrying = roll.slice(0, 4).map(() => job.temp);
        this.activity = `하차 ${job.receiptId.slice(-6)} — 롤테이너 ${r + 1}/${rolls.length} → ${job.at}`;
        this.pda.step = `${job.at} 로 밀고 가기`;
        await this.walkTo(dest);
        this.pda.step = `${job.at} 에 내리기`;
        await this.work(U.dropLineSec * roll.length);
        this.carrying = [];
        this.pda.pickedQty = (this.pda.pickedQty ?? 0) + roll.reduce((a, l) => a + l.qty, 0);
        job.onRoll(roll.length);
      }
      this.pda.step = '수령 등록';
      this.activity = `수령 ${job.receiptId.slice(-6)} — ${job.at}`;
      const at = await job.receive();
      this.pda.step = '수령 반영됨 — 품질검사 작업 생김';
      ctx.log(`${this.account} 하차·수령 ${job.receiptId} ${TEMP_KO[job.temp]} ${job.lines.length}품목 ${units}개 → ${at}`);
      job.done(true);
    } catch (e) {
      const why = e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code}` : (e as Error).message;
      this.carrying = [];
      this.lastProblem = `수령 ${job.receiptId.slice(-6)} — ${why}`;
      ctx.log(`${this.account} 하차 ${job.receiptId} 수령 실패 — ${why}(입고 예정은 그대로, 다시 수령 가능)`);
      job.done(false, why);
    }
  }

  private async doInspect(a: CapacityAssignment) {
    const { ctx, be } = this;
    const t = await this.inboundTask(a);
    if (!t) return;
    const qty = t.plannedQty - t.doneQty;
    this.state = 'PICKING';
    this.activity = `품질검사 → ${t.locationCode}`;
    this.pda = this.inboundView(t, 'INSPECT', `${t.locationCode} 로 이동`, qty);
    await this.walkTo(ctx.point(t.locationCode) ?? ctx.layout.points.inboundIdle[0]);
    this.pda.step = '라벨·기한 확인';
    this.activity = `품질검사 ${t.sku} ${qty}개`;
    // 상자를 들고 라벨을 본다(사용자 2026-11-20 "한참 가만히 서있다가 한 손에 폰 같은 거 들고간다") — 그림만
    this.carrying = [t.storageType ?? 'AMBIENT'];
    // 소비기한·제조일·제조 LOT 표기 = 사람이 상품에서 읽는 값 → 서버 LOT 정보. 판정은 PDA 와 같은 기준(inspectVerdict)
    const label = await this.retry(() => be.getLotLabel(ctx.mfcId, t.lotId)).catch((e: unknown) => {
      if (e instanceof ApiProblem && e.problem.status === 404) return null;
      throw e;
    });
    await this.work(REAL_WORKERS.inspectBaseSec + REAL_WORKERS.inspectSecPerUnit * qty);
    // 라벨 값이 없으면 시뮬레이터가 지어 넣는다(사용자 2026-11-20 "소비기한이랑 로트정보 없어서 품질 검사 못한다고 뜨는데 그냥 알아서 값 넣어").
    // 가상 작업자가 상자에서 읽은 값으로 보내는 것 — 정상 판정이 나게 넉넉히. 지은 값은 기록에 남긴다
    const today = seoulToday(Date.now());
    const filled = fillInspectInputs(t, label, today);
    if (filled.made.length) ctx.log(`${this.account} INSPECT ${t.taskId} ${t.sku} — 라벨 값 없음, 시뮬레이터가 넣음: ${filled.made.join(', ')}`);
    const v = inspectVerdict(filled.task, filled.label, qty, today);
    this.carrying = [];
    if (!v.ok) {
      this.lastProblem = `${t.sku} 품질검사 못 함 — ${v.why}`;
      ctx.log(`${this.account} INSPECT ${t.taskId} ${t.sku} — ${v.why}, 손대지 않음`);
      throw new Error(`품질검사 못 함 — ${v.why}`);
    }
    const word = v.reason === 'NORMAL' ? '정상' : v.reason === 'EXPIRY' ? `격리(잔여일 < ${t.minRemainingDays}일)` : `격리(제조 후 ${t.maxDaysSinceManufacture}일 초과)`;
    this.pda.step = `판정 ${word}`;
    const r = await this.applied('품질검사', this.key('inspect', t.taskId, `:${qty}`), (k) => be.inspectInboundTask(t.taskId, [v.result], k));
    this.pda.pickedQty = qty;
    this.pda.step = '품질검사 반영됨';
    ctx.log(`${this.account} 품질검사 ${t.taskId} ${t.sku} ${word} ${qty} (기한 ${v.result.expiryDate})${r.createdTaskIds?.length ? ` → 적치 ${r.createdTaskIds.join(', ')}` : ''}`);
  }

  // ── 격리 이동(QUARANTINE_MOVE, inbound 0.17.0) — 회수 폐기분·검사 격리분·현장 예외 파손을 온도대 격리 구역 칸으로. 담당만 ──
  private async doQuarantineMove(a: CapacityAssignment) {
    const { ctx, be } = this;
    const t = await this.inboundTask(a);
    if (!t) return;
    const qty = t.plannedQty - t.doneQty - (t.exceptedQty ?? 0);
    if (qty <= 0) return;
    const temp = t.storageType ?? tempOfCode(t.locationCode) ?? 'AMBIENT';
    const dest = t.suggestedToLocations?.find((c) => c.startsWith('QRT-')) ?? QRT_OF[temp];
    this.state = 'PICKING';
    this.pda = this.inboundView(t, 'PUTAWAY', `${t.locationCode} 에서 집기`, qty);
    this.pda.progress = `격리 이동 ${t.sku}`;
    this.activity = `격리 이동 ${t.locationCode} → ${dest}`;
    // 반품 위치(RTN-)는 인계 창 밖이라 창 안쪽에서 받는다
    const from = t.locationCode.startsWith('RTN-') ? RETURN_FLOW.windowInside : (ctx.point(t.locationCode) ?? ctx.location(t.locationCode)?.pick ?? ctx.layout.points.inboundIdle[0]);
    await this.walkTo(from);
    await this.work(4);
    this.carrying = [temp];
    this.pda.step = `${dest} 로 이동`;
    await this.walkTo(ctx.point(dest) ?? from);
    this.pda.step = `${dest} 스캔 → ${qty}개 내려놓기`;
    await this.work(4);
    await this.applied(`격리 이동(${dest})`, this.key('qrtmove', t.taskId, `:${dest}:${qty}`), (k) => be.quarantineMoveInboundTask(t.taskId, { toLocationCode: dest, qty }, k));
    this.carrying = [];
    this.pda.pickedQty = qty;
    this.pda.step = '격리 이동 반영됨';
    ctx.log(`${this.account} 격리 이동 ${t.taskId} ${t.sku} ×${qty} ${t.locationCode} → ${dest}`);
  }

  // ── 회수품 반입(rcv)·검수(qc) — 사용자 2026-11-22 "넣어". 받을 capacity 작업이 없을 때만 ──
  private lastReturnLook = 0;

  /** 한 건 했으면 true */
  private async returnWork(): Promise<boolean> {
    const role = returnRoleOf(this.account);
    if (!role || !this.workerId || this.resumeOnly) return false;
    if (Date.now() - this.lastReturnLook < RETURN_FLOW.realLookSec * 1000) return false;
    this.lastReturnLook = Date.now();
    return role === 'RECEIVE' ? this.returnReceive() : this.returnInspect();
  }

  private returnWorkFailed(e: unknown): boolean {
    const code = e instanceof ApiProblem ? `${e.problem.status} ${e.problem.code}` : (e as Error).message;
    this.lastProblem = `회수품 ${code}`;
    this.ctx.log(`${this.account} 회수품 일 멈춤 — ${code}`);
    this.carrying = [];
    return false;
  }

  /** 반납 도착 대기(WAITING) 한 건을 반입 — RTN-A-01 에 격리(POST /return-receipts arrivalId) */
  private async returnReceive(): Promise<boolean> {
    const { ctx, be } = this;
    const list = await this.retry(() => be.listReturnArrivals(ctx.mfcId));
    // 상품 코드가 없는 줄이 있으면 줄을 보내야 해서(400) 가상 작업자는 손대지 않는다
    const a = list.find((x) => x.state === 'WAITING' && !returnClaims.has(`arr:${x.arrivalId}`) && x.lines.every((l) => !!l.sku));
    if (!a) return false;
    returnClaims.add(`arr:${a.arrivalId}`);
    this.idle = false;
    try {
      this.state = 'PICKING';
      this.activity = `회수품 반입 ${a.arrivalId}`;
      this.pda = this.plainView(a.arrivalId, 'PUTAWAY', '인계 창으로 이동');
      this.pda.progress = `회수품 반입 (${a.lines.length}품목)`;
      await this.walkTo(RETURN_FLOW.windowInside);
      this.pda.step = '회수품 확인 → 반입 등록 RTN-A-01';
      await this.work(RETURN_FLOW.receiveSec);
      const key = this.key('rtnrcp', a.arrivalId);
      const r = await this.commandApplied('회수품 반입', () =>
        be.recordReturnReceipt({ mfcId: ctx.mfcId, toLocationCode: BACKEND_RTN, arrivalId: a.arrivalId, receivedBy: this.workerId! }, key),
      ).catch((e: unknown) => {
        if (e instanceof ApiProblem && e.problem.code === 'ARRIVAL_ALREADY_RECEIVED') return null; // 다른 사람이 먼저
        throw e;
      });
      if (!r) {
        ctx.log(`${this.account} 회수품 ${a.arrivalId} 이미 반입됨 — 다음`);
        return true;
      }
      this.pda.step = '반입됨 — 격리(검수 대기)';
      ctx.log(`${this.account} 회수품 반입 ${a.arrivalId} → ${r.resultId ?? ''} ${BACKEND_RTN} 격리 ${a.lines.length}품목`);
      return true;
    } finally {
      this.idle = true;
    }
  }

  /** 검수 대기 반입 한 건 — 반입한 사람이 아닐 때만(SELF_APPROVAL). 상온·신선 아님 = 재판매, 냉장·냉동 = 폐기 */
  private async returnInspect(): Promise<boolean> {
    const { ctx, be } = this;
    const list = await this.retry(() => be.listPendingReturnReceipts(ctx.mfcId));
    const rc = list.find(
      (x) =>
        x.inspectionState === 'PENDING' &&
        x.inventoryApplyStatus === 'APPLIED' &&
        x.receivedBy !== this.workerId &&
        !returnClaims.has(`insp:${x.returnReceiptId}`) &&
        x.lines.every((l) => !!l.temperatureZone),
    );
    if (!rc) return false;
    returnClaims.add(`insp:${rc.returnReceiptId}`);
    const lines = rc.lines.map((l) => returnVerdict(l)!);
    this.idle = false;
    try {
      this.state = 'PICKING';
      this.activity = `회수품 검수 ${rc.returnReceiptId}`;
      this.pda = this.plainView(rc.returnReceiptId, 'INSPECT', '인계 창으로 이동');
      this.pda.progress = `회수품 검수 (${lines.length}품목)`;
      await this.walkTo(RETURN_FLOW.windowInside);
      this.pda.step = '상품 상태·온도대 확인';
      await this.work(RETURN_FLOW.inspectBaseSec + RETURN_FLOW.inspectSecPerUnit * lines.reduce((x, l) => x + l.qty, 0));
      this.pda.step = lines.map((l) => `${l.sku} ${l.verdict === 'RESALE' ? '재판매' : `폐기(${TEMP_KO[l.temperatureZone]} 격리)`}`).join(' · ');
      const key = this.key('rtninsp', rc.returnReceiptId);
      await this.commandApplied('회수품 검수', () =>
        be.createReturnInspection({ mfcId: ctx.mfcId, returnReceiptId: rc.returnReceiptId, claimId: rc.claimId ?? null, inspectedBy: this.workerId!, lines }, key),
      );
      ctx.log(`${this.account} 회수품 검수 ${rc.returnReceiptId}: ${this.pda.step} — 재판매는 적치 작업, 폐기는 반입한 사람에게 격리 이동 작업`);
      return true;
    } finally {
      this.idle = true;
    }
  }

  /** 명령 응답(CommandResponse) — APPLIED·ACCEPTED 만 확정, UNKNOWN_RESULT·503 은 같은 키로 다시, REJECTED 는 오류 */
  private async commandApplied(op: string, call: () => Promise<CommandResponse>): Promise<CommandResponse> {
    for (let i = 0; ; i++) {
      const r = await this.retry(() => unknownAsResend(call));
      if (r.status === 'APPLIED' || r.status === 'ACCEPTED') return r;
      if (r.status === 'REJECTED') throw new Error(`${op} 거절`);
      if (i >= REAL_WORKERS.unconfirmedResendMax) throw new ResultUnknown(`${op} 결과 불명 — 다음에 같은 키로 다시`);
      this.activity = `${op} 반영 확인 중 (${r.status})`;
      await this.wait(REAL_WORKERS.unconfirmedResendSec);
    }
  }

  private async doPutaway(a: CapacityAssignment) {
    const { ctx, be } = this;
    const t = await this.inboundTask(a);
    if (!t) return;
    const qty = t.plannedQty - t.doneQty;
    // 선반 가득으로 입고칸에 남긴 작업 — 선반에 자리가 날 때까지 잠깐씩 기다렸다 다시(R-30, 서버에 입고창고 보충재고 자리가 생기면 거기로)
    const ov = this.overflow.get(t.taskId);
    if (ov && Date.now() - ov.at < REAL_WORKERS.overflowRetrySec * 1000) {
      this.pda = this.inboundView(t, 'PUTAWAY', `둘 자리 없음 — ${qty}개 입고칸에 둠`, qty);
      this.activity = `${t.sku} 둘 자리 없음 — 입고칸에 둠, 자리 나면 다시`;
      await this.wait(30);
      return;
    }
    this.overflow.delete(t.taskId);
    // 서버가 나눠 넣기를 주면(inbound 0.19.0, R-30 — 선반 남은 만큼 → 기타 칸 → 입고창고 보충재고) 그대로 칸마다 적치
    if (t.suggestedPlacements?.length) return this.putawaySplit(t, qty);
    this.pda = this.inboundView(t, 'PUTAWAY', '적치 후보 조회', qty);
    // 놓을 선반(사용자 2026-11-20 "계속 적치 거절 된다고"): 재고 서버가 진열 규칙(칸 분류 = 상품 분류 CATEGORY_MISMATCH, 한 상품 한 선반
    // SKU_ALREADY_SHELVED — mfc-inventory MoveRules)으로 판정한다. 위치 후보(mfc-location)는 그 규칙을 몰라 첫 칸이 거절되곤 했다.
    // 순서: ① 작업의 서버 추천 칸(suggestedToLocations) ② 그 상품이 이미 놓인 선반 ③ 위치 후보(온도대별)
    // 거절되면 다음 칸으로(최대 REAL_WORKERS.putawayTries) — 같은 칸을 다시 보내지 않는다
    const shelfOk = (c?: string | null) => !!c && c !== t.locationCode && !/^(RCV|CRT|PAK|DSP|RTN)-/.test(c);
    const targets: string[] = [];
    const add = (c?: string | null) => {
      if (shelfOk(c) && !targets.includes(c!)) targets.push(c!);
    };
    // 서버 규칙 "한 상품 한 자리"(SKU_ALREADY_SHELVED): 그 상품이 이미 선반에 있으면 그 선반에만 놓을 수 있다 — 다른 칸은 보내지 않는다.
    // 선반에 없을 때만 서버 추천 칸 → 위치 후보(사용자 2026-11-20 "적치거절 해결 안됐네")
    const st = await be.getCenterStock(ctx.mfcId, t.sku).catch(() => null);
    const onShelf = [...new Set((st?.units ?? []).filter((u) => u.qty > 0 && shelfOk(u.locationCode)).map((u) => u.locationCode))];
    onShelf.forEach(add);
    if (onShelf.length > 1) ctx.log(`${this.account} PUTAWAY ${t.taskId} ${t.sku} — 이미 ${onShelf.join('·')} 두 곳 이상에 있음(서버가 거절할 수 있음)`);
    if (!onShelf.length) (t.suggestedToLocations ?? []).forEach(add);
    if (!onShelf.length && targets.length < REAL_WORKERS.putawayTries) {
      const zones: TemperatureZone[] = t.storageType ? [t.storageType] : ['AMBIENT', 'CHILLED', 'FROZEN'];
      for (const z of zones) {
        const cands = await this.retry(() => be.listPutawayCandidates(ctx.mfcId, t.sku, qty, z));
        cands.forEach((c) => add(c.locationCode));
        if (targets.length >= REAL_WORKERS.putawayTries) break;
      }
    }
    let to = targets[0];
    if (!to) {
      this.lastProblem = `${t.sku} 적치 후보 없음`;
      ctx.log(`${this.account} PUTAWAY ${t.taskId} ${t.sku} — 적치 후보 없음, 손대지 않음`);
      throw new Error(`${t.sku} 적치 후보 없음 — 센터 관리자 확인`);
    }
    const temp = tempOfCode(to);
    this.state = 'PICKING';
    this.activity = `적치 → ${t.locationCode}`;
    this.pda.location = t.locationCode;
    this.pda.nextLocation = to;
    this.pda.temp = temp ? TEMP_KO[temp] : null;
    this.pda.step = `${t.locationCode} 스캔 → 상품 싣기`;
    await this.walkTo(ctx.point(t.locationCode) ?? ctx.location(t.locationCode)?.pick ?? ctx.layout.points.inboundIdle[0]);
    await this.work(REAL_WORKERS.shelveBaseSec + REAL_WORKERS.shelveSecPerUnit * qty);
    // 상자를 카트에 싣고 민다(전엔 손에 작은 것 — "스마트폰 든 것 마냥", 사용자 2026-11-20)
    this.hasCart = true;
    for (let i = 0; i < Math.min(4, Math.ceil(qty / 6)); i++) this.carrying.push(temp ?? 'AMBIENT');
    const loc = ctx.location(to);
    this.currentTarget = loc;
    this.activity = `적치 ${t.sku} → ${to}`;
    this.pda.location = to;
    this.pda.nextLocation = null;
    this.pda.step = '선반 스캔 → 내려놓기';
    if (loc) {
      await this.walkTo(loc.pick);
      this.heading = Math.atan2(loc.shelf.x - this.pos.x, loc.shelf.z - this.pos.z);
    }
    await this.work(REAL_WORKERS.shelveBaseSec + REAL_WORKERS.shelveSecPerUnit * qty);
    for (let i = 0; ; i++) {
      try {
        const dest = to;
        await this.applied(`적치(${dest})`, this.key('putaway', t.taskId, `:${dest}:${qty}`), (k) => be.putawayInboundTask(t.taskId, { toLocationCode: dest, qty }, k));
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 도착 칸 가득(LOCATION_CAPACITY_EXCEEDED "…N개까지 들어갑니다(지금·예정 M개)") — 한 상품 한 자리라 다른 칸도 안 된다.
        // 들어가는 만큼(N−M)만 적치하고, 남은 양은 PDA 처럼 적치 예외 BLOCKED(도착 칸 가득)로 보고(계약 inbound 0.17.0 — 작업 잔량에서 빠짐)
        // (사용자 2026-11-20 "적치 거절 또 뜨잖아")
        const cap = /LOCATION_CAPACITY_EXCEEDED.*?(\d+)개까지 들어갑니다\(지금·예정 (\d+)개\)/.exec(msg);
        if (cap) {
          const room = Math.max(0, Number(cap[1]) - Number(cap[2]));
          const dest = to;
          if (room > 0 && room < qty) {
            await this.applied(`적치(${dest})`, this.key('putaway', t.taskId, `:${dest}:${room}`), (k) => be.putawayInboundTask(t.taskId, { toLocationCode: dest, qty: room }, k));
            ctx.log(`${this.account} 적치 ${t.taskId} ${t.sku} ${room} → ${dest} (칸에 들어가는 만큼)`);
          }
          const rest = room > 0 && room < qty ? qty - room : qty;
          // 남은 양은 입고창고 보충재고로 가야 하지만(사용자 2026-11-20 "선반칸이 가득차면 남는 건 입고 창고에 넣어놔야지") 서버에 보충재고 자리가
          // 없고 한 상품 한 자리 규칙이 막는다(R-30). 분실 조사 보류(적치 예외 BLOCKED)로 빼지 않고 입고칸에 그대로 둔다 — 이 작업은 넘침 대기로 표시
          this.overflow.set(t.taskId, { sku: t.sku, rest, at: Date.now() });
          this.activity = `${dest} 가득 — 남은 ${rest}개 입고칸에 둠(입고창고 자리 없음)`;
          this.lastProblem = null;
          ctx.log(`${this.account} PUTAWAY ${t.taskId} ${t.sku} — ${dest} 가득, 남은 ${rest}개는 입고칸에(입고창고 보충재고 자리 없음, R-30)`);
          break;
        }
        const next = targets[i + 1];
        if (!/^적치\(.*\) 거절/.test(msg) || !next || i + 1 >= REAL_WORKERS.putawayTries) throw e;
        ctx.log(`${this.account} PUTAWAY ${t.taskId} ${t.sku} ${to} ${msg} — 다음 칸 ${next}`);
        this.activity = `${to} 거절 — ${next} 로`;
        to = next;
        const nl = ctx.location(to);
        this.currentTarget = nl;
        this.pda.location = to;
        if (nl) {
          await this.walkTo(nl.pick);
          this.heading = Math.atan2(nl.shelf.x - this.pos.x, nl.shelf.z - this.pos.z);
        }
        await this.work(REAL_WORKERS.shelveBaseSec);
      }
    }
    this.carrying = [];
    this.hasCart = false;
    this.currentTarget = null;
    this.pda.pickedQty = qty;
    this.pda.step = '적치 반영됨';
    ctx.log(`${this.account} 적치 ${t.taskId} ${t.sku} ${qty} → ${to}`);
  }

  /** 서버 나눠 넣기(suggestedPlacements)대로 칸마다 한 번씩 putaways. 다 못 넣은 양(suggestedUnplacedQty)은 입고칸에 두고 작업을 열어 둔다
   *  (적치 예외 보고 안 함 — 백엔드 회신 2026-11-21 R-30). 한 칸이 거절되면 거기서 멈추고 남은 양도 입고칸에(다음 재시도 때 서버가 다시 나눔) */
  private async putawaySplit(t: InboundTask, qty: number) {
    const { ctx, be } = this;
    const plan: { code: string; qty: number }[] = [];
    let left = qty;
    for (const p of t.suggestedPlacements ?? []) {
      const n = Math.min(left, p.qty);
      if (n <= 0 || !p.locationCode || p.locationCode === t.locationCode) continue;
      plan.push({ code: p.locationCode, qty: n });
      left -= n;
    }
    const first = plan[0];
    if (!first) return;
    const temp = tempOfCode(first.code);
    this.state = 'PICKING';
    this.activity = `적치 → ${t.locationCode}`;
    this.pda = this.inboundView(t, 'PUTAWAY', `${t.locationCode} 스캔 → 상품 싣기`, qty);
    this.pda.location = t.locationCode;
    this.pda.nextLocation = first.code;
    this.pda.temp = temp ? TEMP_KO[temp] : null;
    const carry = qty - left;
    await this.walkTo(ctx.point(t.locationCode) ?? ctx.location(t.locationCode)?.pick ?? ctx.layout.points.inboundIdle[0]);
    await this.work(REAL_WORKERS.shelveBaseSec + REAL_WORKERS.shelveSecPerUnit * carry);
    this.hasCart = true;
    for (let i = 0; i < Math.min(4, Math.ceil(carry / 6)); i++) this.carrying.push(temp ?? 'AMBIENT');
    let done = 0;
    let stopped: string | null = null;
    for (const [i, p] of plan.entries()) {
      const loc = ctx.location(p.code);
      this.currentTarget = loc;
      this.activity = `적치 ${t.sku} ${p.qty} → ${p.code}${plan.length > 1 ? ` (${i + 1}/${plan.length})` : ''}`;
      this.pda.location = p.code;
      this.pda.nextLocation = plan[i + 1]?.code ?? null;
      this.pda.step = '칸 스캔 → 내려놓기';
      if (loc) {
        await this.walkTo(loc.pick);
        this.heading = Math.atan2(loc.shelf.x - this.pos.x, loc.shelf.z - this.pos.z);
      }
      await this.work(REAL_WORKERS.shelveBaseSec + REAL_WORKERS.shelveSecPerUnit * p.qty);
      try {
        await this.applied(`적치(${p.code})`, this.key('putaway', t.taskId, `:${p.code}:${p.qty}`), (k) => be.putawayInboundTask(t.taskId, { toLocationCode: p.code, qty: p.qty }, k));
        done += p.qty;
        ctx.log(`${this.account} 적치 ${t.taskId} ${t.sku} ${p.qty} → ${p.code}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/^적치\(.*\) 거절/.test(msg)) throw e;
        stopped = `${p.code} 거절`;
        ctx.log(`${this.account} PUTAWAY ${t.taskId} ${t.sku} ${p.code} ${msg} — 남은 양 입고칸에, 다음에 다시 나눠 받음`);
        break;
      }
    }
    this.carrying = [];
    this.hasCart = false;
    this.currentTarget = null;
    this.pda.pickedQty = done;
    const rest = qty - done;
    if (rest > 0) {
      this.overflow.set(t.taskId, { sku: t.sku, rest, at: Date.now() });
      this.pda.step = `${done}개 적치, ${rest}개 입고칸에 둠`;
      this.activity = `${t.sku} ${stopped ?? '들어갈 자리 없음'} — 남은 ${rest}개 입고칸에`;
      ctx.log(`${this.account} PUTAWAY ${t.taskId} ${t.sku} — ${done}개 적치, ${rest}개 입고칸에(${stopped ?? `서버 suggestedUnplacedQty ${t.suggestedUnplacedQty ?? 0}`})`);
    } else {
      this.pda.step = '적치 반영됨';
    }
    this.lastProblem = null;
  }

  // ── 보충(REPLENISH)·이동(MOVE) — mfc-inbound 이동 지시: 카트 → 출발 칸에서 싣기(pickups) → 도착 칸에 내려놓기(drops) ──

  private async doMove(a: CapacityAssignment) {
    const { ctx, be } = this;
    let m = await this.retry(() => be.getMoveOrder(a.taskId));
    if (m.state === 'COMPLETED' || m.state === 'CANCELLED') {
      ctx.log(`${this.account} ${m.kind} ${m.moveId} 이미 ${m.state}`);
      return;
    }
    if (m.assigneeId && m.assigneeId !== this.workerId && m.pickedBy !== this.workerId) throw new Error(`${m.moveId} 담당 ${m.assigneeId} — 내 작업 아님`);
    if (m.onCartQty > 0 && m.pickedBy && m.pickedBy !== this.workerId) throw new Error(`${m.moveId} 카트에 실은 사람 ${m.pickedBy} — 그 사람만 내려놓음`);
    const type = m.kind === 'REPLENISH' ? 'REPLENISH' : 'MOVE';
    const label = m.kind === 'REPLENISH' ? '보충' : '이동';
    // 카트 — 이미 실었으면 그 카트(서버 cartLocation), 아니면 빈 카트 하나(장바구니와 같은 풀, 키 MOVE:{moveId})
    const cartKey = `MOVE:${m.moveId}`;
    if (m.cartLocation) ctx.carts.bind(cartKey, m.cartLocation);
    const cart = m.cartLocation ?? ctx.carts.take(cartKey);
    const temp = tempOfCode(m.toLocation) ?? tempOfCode(m.fromLocation);
    this.pda = {
      ...this.plainView(m.moveId, type, `카트 ${cart} 스캔`),
      location: m.fromLocation,
      nextLocation: m.toLocation,
      temp: temp ? TEMP_KO[temp] : null,
      productName: m.productName ?? null,
      plannedQty: m.qty,
      pickedQty: m.pickedQty,
    };
    try {
      this.state = 'TO_CART';
      this.activity = `${label} 카트 ${cart} 가지러`;
      await this.walkTo(ctx.point(cart) ?? ctx.layout.points.cartDepot);
      await this.work(REAL_WORKERS.shelveBaseSec);
      this.hasCart = true;
      const toPick = m.state === 'ACTIVE' ? m.qty - m.pickedQty : 0;
      if (toPick > 0) {
        const from = ctx.location(m.fromLocation);
        this.state = 'PICKING';
        this.currentTarget = from;
        this.activity = `${label} ${m.sku} ← ${m.fromLocation}`;
        this.pda.step = `${m.fromLocation} 스캔 → 상품 싣기`;
        if (from) {
          await this.walkTo(from.pick);
          this.heading = Math.atan2(from.shelf.x - this.pos.x, from.shelf.z - this.pos.z);
        }
        await this.work(REAL_WORKERS.shelveBaseSec + REAL_WORKERS.shelveSecPerUnit * toPick);
        m = await this.retry(() => unknownAsResend(() => be.pickUpMoveOrder(m.moveId, { cartLocation: cart, qty: toPick }, this.key('pickup', m.moveId, `:${cart}:${toPick}`))));
        this.pda.pickedQty = m.pickedQty;
      }
      if (m.onCartQty > 0) {
        for (let i = 0; i < m.onCartQty && this.carrying.length < 12; i++) this.carrying.push(temp ?? 'AMBIENT');
        // 취소 뒤(CANCEL_PENDING)에는 출발 칸으로 되돌린다
        const to = m.state === 'CANCEL_PENDING' ? m.fromLocation : m.toLocation;
        const qty = m.onCartQty;
        const loc = ctx.location(to);
        this.state = 'PICKING';
        this.currentTarget = loc;
        this.activity = `${label} ${m.sku} → ${to}`;
        this.pda.location = to;
        this.pda.nextLocation = null;
        this.pda.step = '도착 칸 스캔 → 내려놓기';
        if (loc) {
          await this.walkTo(loc.pick);
          this.heading = Math.atan2(loc.shelf.x - this.pos.x, loc.shelf.z - this.pos.z);
        }
        await this.work(REAL_WORKERS.shelveBaseSec + REAL_WORKERS.shelveSecPerUnit * qty);
        m = await this.retry(() => unknownAsResend(() => be.dropMoveOrder(m.moveId, { toLocation: to, qty }, this.key('drop', m.moveId, `:${to}:${qty}`))));
        this.pda.step = `${label} 반영됨`;
      }
    } finally {
      this.hasCart = false;
      this.carrying = [];
      this.currentTarget = null;
      if (m.onCartQty <= 0) ctx.carts.release(cartKey); // 카트가 비었을 때만 — 남았으면 다음에 같은 카트로
    }
    ctx.log(`${this.account} ${label} ${m.moveId} ${m.sku} ${m.state}`);
  }

  private inboundView(t: InboundTask, type: 'INSPECT' | 'PUTAWAY', step: string, qty: number): PdaView {
    const temp = tempOfCode(t.locationCode);
    return {
      ...this.plainView(t.taskId, type, step),
      location: t.locationCode,
      temp: temp ? TEMP_KO[temp] : null,
      productName: t.productName ?? null,
      barcode: t.barcodes?.[0] ?? null,
      plannedQty: qty,
      pickedQty: 0,
    };
  }

  private plainView(taskId: string, type: PdaView['taskType'], step: string): PdaView {
    return {
      taskId,
      taskType: type,
      orderId: '',
      shipmentId: '',
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

  private view(t: TaskDetail, type: PdaView['taskType'], step: string): PdaView {
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

/** 503(UNKNOWN_RESULT·의존 서비스 응답 없음)은 결과 불명 — 같은 Idempotency-Key 로 다시 보낸다(retry) */
async function unknownAsResend<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiProblem && (e.problem.status === 503 || e.problem.code === 'UNKNOWN_RESULT')) throw new ResultUnknown(`${e.problem.status} ${e.problem.code}`);
    throw e;
  }
}

export interface ReturnPiece {
  /** 건너뛸 때 쓰는 조각 식별(줄·LOT·놓인 곳) */
  id: string;
  line: TaskLine;
  lotId: string;
  /** 놓인 곳(장바구니 CRT-·패킹대 PAK-) */
  from: string;
  /** 돌려놓을 선반 = 첫 추천 칸. 없으면 null(건너뜀) */
  to: string | null;
  /** 줄의 남은 양 − 확정 대기 */
  left: number;
  /** 이번에 옮길 양 = min(줄 남은 양, 조각 남은 양, 그 위치 양) */
  qty: number;
}

/**
 * 남은 첫 복귀 조각(PDA return_screen nextReturnPiece 와 같은 순서): 남은 양 − 확정 대기 > 0 인 첫 줄 → 남은 양 > 0 인 첫 LOT 조각
 * → 양 > 0 인 첫 위치. 건너뛴 조각은 빼고 다음 줄로. 없으면 null(다 옮김 또는 확정 대기).
 */
export function nextReturnPiece(t: TaskDetail, skip: ReadonlySet<string> = new Set()): ReturnPiece | null {
  for (const l of t.lines) {
    const left = l.remainingQty - l.pendingQty;
    if (left <= 0) continue;
    const p = (l.picks ?? []).find((x) => x.remainingQty > 0);
    const at = p?.locations.find((c) => c.qty > 0);
    const lot = p?.lotId ?? l.lotId;
    if (!p || !at || !lot) continue;
    const id = `${l.orderLineId}:${lot}:${at.locationCode}`;
    if (skip.has(id)) continue;
    return { id, line: l, lotId: lot, from: at.locationCode, to: p.suggestedToLocations?.[0] ?? null, left, qty: Math.min(left, p.remainingQty, at.qty) };
  }
  return null;
}

/**
 * 품질검사에 필요한데 서버 LOT 정보에 없는 값을 지어 넣는다(가상 작업자 전용 — 사용자 2026-11-20 "그냥 알아서 값 넣어").
 * 기준(minRemainingDays) 없음 → REAL_WORKERS.inspectAssume.minRemainingDays, 소비기한 없음 → 오늘 + max(기준 + 여유, 최소 일수),
 * 제조일 없음(제조 후 기준이 있을 때) → 오늘 − 1일, 제조사 LOT 없음 → SIM-<날짜>-<SKU>. 정상 판정이 나게 넉넉히 [시뮬]
 */
export function fillInspectInputs(
  t: { sku: string; minRemainingDays?: number | null; maxDaysSinceManufacture?: number | null },
  label: { expiryDate?: string | null; manufactureDate?: string | null; sourceLotRef?: string | null } | null,
  today: string,
): { task: { minRemainingDays: number; maxDaysSinceManufacture: number | null }; label: { expiryDate: string; manufactureDate: string | null; sourceLotRef: string }; made: string[] } {
  const A = REAL_WORKERS.inspectAssume;
  const made: string[] = [];
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  let min = t.minRemainingDays ?? null;
  if (min == null) {
    min = A.minRemainingDays;
    made.push(`판정 기준 ${min}일`);
  }
  const max = t.maxDaysSinceManufacture ?? null;
  let exp = label?.expiryDate ?? null;
  if (!exp) {
    exp = addDays(today, Math.max(min + A.expiryMarginDays, A.expiryMinDays));
    made.push(`소비기한 ${exp}`);
  }
  let mfg = label?.manufactureDate ?? null;
  if (!mfg && max != null) {
    mfg = addDays(today, -A.manufactureDaysAgo);
    made.push(`제조일 ${mfg}`);
  }
  let ref = label?.sourceLotRef ?? null;
  if (!ref) {
    ref = `SIM-${today.replace(/-/g, '')}-${t.sku}`;
    made.push(`LOT ${ref}`);
  }
  return { task: { minRemainingDays: min, maxDaysSinceManufacture: max }, label: { expiryDate: exp, manufactureDate: mfg, sourceLotRef: ref }, made };
}
