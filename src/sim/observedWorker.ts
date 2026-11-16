// 실서버의 실제 PDA 작업자(사용자 2026-11-16 "작업자가 실서버에서 보이진않는데", "그 위치도 찍었을때 보였으면").
// 서버는 작업자 위치를 주지 않는다(R-17). 그래서 서버가 확정한 마지막 실적으로만 세운다(SIM-2a "마지막 버튼 기준"):
// - PICK: 작업 상세에서 남은 수량이 0 이 된(집품 등록된) 칸 중 방문 순서가 가장 늦은 칸 앞. 아직 없으면 카트 자리(시작 = 카트를 찍음)
// - PACK: 패킹 대기 지점
// 다음 지시 칸은 바닥 고리(RealMarkers)와 PDA 카드로 보인다. 그리기만 한다 — API 를 부르지 않는다.

import type { TemperatureZone } from '../domain/contract';
import type { Location } from '../domain/layout';
import type { NavGrid, P } from '../domain/navgrid';
import { Agent } from './agent';
import type { PdaView, SiteWorker, WorkerState } from './worker';

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
