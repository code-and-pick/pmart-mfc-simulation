// 가상 라이더. Delivery 도메인(배차·픽업)은 백엔드 미구현이라 시뮬레이터가 대신한다.
// 인계는 계약 그대로: 포장 QR 스캔 → AuthorizePackageHandover(fence) → CommitPackageHandover(재고 H·E·R −q).
// 라이더는 내부(보관·패킹 구역)에 들어오지 않는다 (MFC 5-3).

import { ApiProblem, ResultUnknown } from '../domain/contract';
import type { P } from '../domain/navgrid';
import { Agent } from './agent';
import { RIDER_VEHICLE } from '../config';
import type { VehicleType } from '../domain/contract';
import { offLot, rideTo, walkOn } from './realRider';
import type { SiteContext } from './context';

export class Rider extends Agent {
  done = false;
  carrying = 0;
  /** MOCK 라이더는 오토바이 [시뮬] */
  readonly vehicle: VehicleType = RIDER_VEHICLE.fallback;
  riding = true;
  readonly parking: P;

  constructor(
    id: string,
    readonly shipmentId: string,
    readonly deliveryId: string,
    readonly orderId: string,
    parking: P,
    private readonly ctx: SiteContext,
    private readonly onHandedOver: (orderId: string) => void,
  ) {
    super(id, offLot(ctx.layout.points.riderEntry), ctx.nav, 1.4);
    this.parking = parking;
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const retryable = e instanceof ResultUnknown || (e instanceof ApiProblem && e.problem.retryable === true);
        if (!retryable || attempt >= 4) throw e;
        await this.wait(2 * (attempt + 1));
      }
    }
  }

  async run() {
    const { ctx } = this;
    try {
      this.activity = 'MFC 도착';
      await rideTo(this, ctx.layout.points.riderEntry);
      await rideTo(this, this.parking);
      this.riding = false;
      await this.wait(8);
      this.activity = '출하대기 랙으로';
      await walkOn(this, ctx.layout.points.riderPickup);
      const staged = ctx.shipRack.ofShipment(this.shipmentId);
      for (const s of staged) {
        this.activity = `QR 스캔 ${s.pkg.packageId}`;
        await this.wait(4);
        const auth = await this.retry(() =>
          ctx.port.authorizeHandover(
            s.pkg.packageId,
            { riderId: this.id, deliveryId: this.deliveryId, scannedCode: s.pkg.qrCode },
            `${ctx.runId}:auth:${s.pkg.packageId}:${this.id}`,
          ),
        );
        await this.wait(2);
        await this.retry(() =>
          ctx.port.commitHandover(
            s.pkg.packageId,
            { handoverAuthorizationId: auth.handoverAuthorizationId, fenceVersion: auth.fenceVersion, riderId: this.id },
            `${ctx.runId}:commit:${s.pkg.packageId}:${auth.handoverAuthorizationId}`,
          ),
        );
        ctx.shipRack.remove(s.pkg.packageId);
        this.carrying += 1;
      }
      this.onHandedOver(this.orderId);
      this.activity = '출발';
      await walkOn(this, this.parking);
      await this.wait(5);
      await rideTo(this, ctx.layout.points.riderEntry);
      await rideTo(this, offLot(ctx.layout.points.riderEntry));
    } catch (e) {
      this.activity = `인계 실패: ${e instanceof ApiProblem ? e.problem.code : (e as Error).message}`;
      ctx.log(`${this.id} ${this.activity}`);
      ctx.metrics.apiErrors += 1;
      await this.wait(20);
    }
    this.done = true;
  }
}
