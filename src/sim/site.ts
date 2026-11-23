// 현장 설비 점유: 패킹대(FIFO 대기열)와 외부 출하대기 랙 칸.
import type { Package } from '../domain/contract';
import type { PackingStation, ShippingSlot } from '../domain/layout';

export class StationPool {
  private readonly busy = new Map<string, string>(); // stationId → workerId
  private readonly queue: { workerId: string; resolve: (s: PackingStation) => void }[] = [];
  readonly busySeconds = new Map<string, number>();

  constructor(
    private readonly all: PackingStation[],
    private active: number,
  ) {}

  setActive(n: number) {
    this.active = Math.max(1, Math.min(this.all.length, n));
    this.drain();
  }
  get activeCount() {
    return this.active;
  }
  get queueLength() {
    return this.queue.length;
  }
  isActive(index: number) {
    return index < this.active;
  }
  occupant(stationId: string): string | undefined {
    return this.busy.get(stationId);
  }

  acquire(workerId: string): Promise<PackingStation> {
    return new Promise((resolve) => {
      this.queue.push({ workerId, resolve });
      this.drain();
    });
  }

  /** 지금 기다리는 사람 없이 빈 패킹대가 있다 — 있으면 대기 지점에 들르지 않고 바로 간다 */
  hasFree(): boolean {
    return this.queue.length === 0 && this.all.some((s) => !this.busy.has(s.id));
  }

  release(station: PackingStation) {
    this.busy.delete(station.id);
    this.drain();
  }

  tick(dt: number) {
    for (const id of this.busy.keys()) this.busySeconds.set(id, (this.busySeconds.get(id) ?? 0) + dt);
  }

  private drain() {
    while (this.queue.length > 0) {
      // 가동 패킹대 먼저, 다 차면 나머지 패킹대도 언제든 쓴다(사용자 2026-11-22 "패킹대는 다 차면 다른 패킹대도 언제든 사용 가능")
      const free = this.all.slice(0, this.active).find((s) => !this.busy.has(s.id)) ?? this.all.find((s) => !this.busy.has(s.id));
      if (!free) return;
      const next = this.queue.shift()!;
      this.busy.set(free.id, next.workerId);
      next.resolve(free);
    }
  }
}

export interface StagedPackage {
  pkg: Package;
  slot: ShippingSlot;
  shipmentId: string;
}

export class ShippingRack {
  private readonly used = new Map<string, StagedPackage>(); // slotId → 포장

  constructor(private readonly slots: ShippingSlot[]) {}

  /** 칸이 없으면 바닥 임시 적치(null slot)로 둔다 — 랙 2개 용량 부족은 지표로 본다 */
  place(shipmentId: string, pkgs: Package[]): StagedPackage[] {
    const out: StagedPackage[] = [];
    for (const pkg of pkgs) {
      const slot = this.slots.find((s) => !this.used.has(s.id));
      const staged: StagedPackage = {
        pkg,
        shipmentId,
        slot: slot ?? { id: `FLOOR-${pkg.packageId}`, rackIndex: -1, pos: { x: 40.018 + (Math.random() - 0.5) * 3, y: 0.15, z: 34.6 } }, // 인계 돌출부 바닥(2026-11-22 463평 맞춤)
      };
      this.used.set(staged.slot.id, staged);
      out.push(staged);
    }
    return out;
  }

  ofShipment(shipmentId: string): StagedPackage[] {
    return [...this.used.values()].filter((s) => s.shipmentId === shipmentId);
  }

  remove(packageId: string) {
    for (const [k, v] of this.used) if (v.pkg.packageId === packageId) this.used.delete(k);
  }

  all(): StagedPackage[] {
    return [...this.used.values()];
  }

  get overflow(): number {
    return [...this.used.keys()].filter((k) => k.startsWith('FLOOR-')).length;
  }
}
