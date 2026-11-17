// 실서버의 실제 PDA 작업자(사용자 2026-11-16 "작업자가 실서버에서 보이진않는데", "그 위치도 찍었을때 보였으면").
// 서버는 작업자 위치를 주지 않는다(R-17). 그래서 서버가 확정한 마지막 실적으로만 세운다(SIM-2a "마지막 버튼 기준"):
// - PICK: 작업 상세에서 남은 수량이 0 이 된(집품 등록된) 칸 중 방문 순서가 가장 늦은 칸 앞. 아직 없으면 카트 자리(시작 = 카트를 찍음)
// - PACK: 패킹 대기 지점
// - RETURN(취소품 복귀): 지금 옮길 조각의 출발 위치(장바구니·패킹대), "실었어요" 뒤에는 돌려놓을 선반 칸 앞
// 다음 지시 칸은 바닥 고리(RealMarkers)와 PDA 카드로 보인다. 그리기만 한다 — API 를 부르지 않는다.
// 스캔 안내(사용자 2026-11-17 "카트, 상품이 있는 칸까지 움직였을때 바코드를 찍을수있게"): 진행 중 PICK 이면 PDA 와 같은 순서로
// 카트 → 지금 갈 칸으로 걸어가 서고, 도착하면 그 자리에 찍을 바코드(cue)를 띄운다. 이때 서 있는 자리는 "찍을 곳"이지 실제 위치가 아니다(R-17).

import type { TaskLine, TemperatureZone } from '../domain/contract';
import type { Location } from '../domain/layout';
import type { NavGrid, P } from '../domain/navgrid';
import type { PickStop } from '../domain/pickStop';
import type { ReturnPiece } from '../domain/returnPiece';
import { Agent } from './agent';
import type { PdaView, SiteWorker, WorkerState } from './worker';

/** 3D 에서 이 작업자 위에 띄울 "지금 찍을 것" */
export type PackStep = 'STATION' | 'CART' | 'DISPATCH' | 'BAG' | 'RACK';
export type ScanCue =
  | { kind: 'CART'; taskId: string; cart: string; next: PickStop }
  | { kind: 'PICK'; taskId: string; stop: PickStop; index: number; total: number }
  /** 포장 — PDA 포장 화면 단계(패킹대 → 카트 → 배차 요청 → 담기·밀봉 → 출하대기 랙) */
  | { kind: 'PACK'; taskId: string; shipmentId: string; step: PackStep; station: string; cart: string; rack: string; bag: { line: TaskLine; left: number }[] }
  /** 취소품 복귀 — PDA 복귀 화면 단계(① 출발 위치 → ② 상품 싣기 → "실었어요" → ③ 선반 칸) */
  | { kind: 'RETURN'; taskId: string; step: 'FROM' | 'TO'; piece: ReturnPiece; index: number; total: number };

export class ObservedWorker extends Agent implements SiteWorker {
  state: WorkerState = 'IDLE';
  pda: PdaView | null = null;
  hasCart = false;
  carrying: TemperatureZone[] = [];
  busySeconds = 0;
  ordersDone = 0;
  currentTarget: Location | null = null;
  readonly idle = false;
  /** 서버에서 마지막으로 이 작업자의 열린 작업을 본 시각(ms) */
  lastSeenMs = 0;
  /** 지금 찍을 것 — 도착(멈춤)했을 때만 화면에 띄운다 */
  cue: ScanCue | null = null;
  /**
   * 서버가 모르는 스캔(피킹 카트, 포장의 패킹대·카트)을 화면에서 "찍음"으로 넘긴 것 — `${taskId}:${단계}`.
   * 서버에 다음 단계 흔적(집품·배차 요청·밀봉)이 오면 누르지 않아도 넘어간다.
   */
  readonly passed = new Set<string>();
  private aimKey = '';

  constructor(
    id: string,
    readonly workerId: string,
    start: P,
    nav: NavGrid,
    walkSpeed: number,
  ) {
    super(id, start, nav, walkSpeed);
  }

  /** 서버 상태가 정한 자리 — 바뀌었을 때만 그리로 걷는다 */
  aim(p: P, key: string) {
    if (key === this.aimKey) return;
    this.aimKey = key;
    void this.walkTo(p);
  }

  override tick(dt: number) {
    super.tick(dt);
    if (this.state !== 'IDLE') this.busySeconds += dt;
  }
}
