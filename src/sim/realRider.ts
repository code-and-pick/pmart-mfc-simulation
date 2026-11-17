// 실서버 모드 앞마당 라이더(rider 시뮬레이터 요청 M-02) — 그리기만 한다. 라이더 API(도착·인계)는 rider 시뮬레이터가 부른다.
// 배송 수행 상태가 ARRIVED_AT_STORE 가 되면 입구 → 주차 자리 → 출하대기 랙 앞에 서고, 출고가 인계됨(HANDED_OVER)이거나
// 배송이 픽업 뒤 상태가 되면 포장을 들고 떠난다. 서버가 확정한 상태만 따른다 — 도착을 못 본 배송은 지어내 그리지 않는다.

import type { NavGrid, P } from '../domain/navgrid';
import { Agent } from './agent';

/** 화면(3D·요약)이 보는 라이더 모양 — MOCK 라이더(Rider)와 실서버 관찰 라이더(RealRider) 공통 */
export interface SiteRider {
  readonly id: string;
  pos: P;
  heading: number;
  activity: string;
  carrying: number;
  readonly parking: P;
  done: boolean;
  tick(dt: number): void;
}

export class RealRider extends Agent implements SiteRider {
  done = false;
  carrying = 0;
  leaving = false;
  private leave: ((n: number) => void) | null = null;
  private readonly left: Promise<number>;

  constructor(
    id: string,
    readonly deliveryId: string,
    readonly parking: P,
    private readonly entry: P,
    private readonly pickup: P,
    nav: NavGrid,
  ) {
    super(id, entry, nav, 1.4);
    this.left = new Promise((resolve) => (this.leave = resolve));
  }

  /** 서버가 인계·픽업을 확정했다 — 포장 n 개를 들고 떠난다(0 이면 빈손: 배정 해제 등) */
  depart(packages: number) {
    if (this.leaving) return;
    this.leaving = true;
    this.leave?.(packages);
  }

  async run() {
    this.activity = 'MFC 도착';
    await this.walkTo(this.parking);
    if (!this.leaving) {
      await this.wait(3);
      this.activity = '출하대기 랙 앞 — 인계 대기';
      await this.walkTo(this.pickup);
    }
    const n = await this.left;
    this.carrying = n;
    this.activity = n > 0 ? `픽업 ${n}개 — 출발` : '빈손으로 떠남';
    await this.walkTo(this.parking);
    await this.wait(2);
    await this.walkTo(this.entry);
    this.done = true;
  }
}
