// 이동하는 주체(작업자·라이더)의 공통부. 행동은 async 스크립트로 쓰고,
// walkTo / wait 가 돌려주는 Promise 는 시뮬레이션 tick 이 시간을 진행시켜 풀어 준다.
import type { NavGrid, P } from '../domain/navgrid';

interface Pending {
  kind: 'walk' | 'wait';
  resolve: () => void;
  remaining: number; // wait: 남은 초
}

export abstract class Agent {
  pos: P;
  heading = 0;
  path: P[] = [];
  distance = 0;
  /** 화면 표시용 현재 행동 */
  activity = '대기';
  private pending: Pending | null = null;
  protected stopped = false;

  constructor(
    readonly id: string,
    start: P,
    protected readonly nav: NavGrid,
    protected speed: number,
  ) {
    this.pos = { ...start };
  }

  get moving(): boolean {
    return this.pending?.kind === 'walk' && this.path.length > 0;
  }

  /** 롤테이너를 늘 밀고 다닌다(입고 작업자) — 롤테이너 폭만큼 넓은 길로 걷고, 멈추면 롤테이너가 벽·랙에 박히지 않는 쪽으로 선다 */
  protected pushesCart = false;

  walkTo(target: P): Promise<void> {
    const p = this.nav.findPath(this.pos, target, { cart: this.pushesCart }) ?? [target];
    this.path = p;
    return new Promise((resolve) => {
      this.pending = { kind: 'walk', resolve, remaining: 0 };
      if (this.path.length === 0) this.settle();
    });
  }

  wait(sec: number): Promise<void> {
    return new Promise((resolve) => {
      this.pending = { kind: 'wait', resolve, remaining: Math.max(0, sec) };
      if (sec <= 0) this.settle();
    });
  }

  private settle() {
    const p = this.pending;
    this.pending = null;
    p?.resolve();
  }

  /** dt 초만큼 진행. */
  tick(dt: number) {
    const p = this.pending;
    if (!p) return;
    if (p.kind === 'wait') {
      p.remaining -= dt;
      if (p.remaining <= 0) this.settle();
      return;
    }
    let budget = this.speed * dt;
    while (budget > 0 && this.path.length > 0) {
      const t = this.path[0];
      const dx = t.x - this.pos.x;
      const dz = t.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) this.heading = Math.atan2(dx, dz);
      if (d <= budget) {
        this.pos = { x: t.x, z: t.z };
        this.distance += d;
        budget -= d;
        this.path.shift();
      } else {
        this.pos = { x: this.pos.x + (dx / d) * budget, z: this.pos.z + (dz / d) * budget };
        this.distance += budget;
        budget = 0;
      }
    }
    if (this.path.length === 0) {
      if (this.pushesCart) this.heading = this.nav.cartHeading(this.pos, this.heading);
      this.settle();
    }
  }

  stop() {
    this.stopped = true;
  }
}
