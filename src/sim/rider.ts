// 가상 라이더. Delivery 도메인(배차·픽업)은 백엔드 미구현이라 시뮬레이터가 대신한다.
// 인계는 계약 그대로: 포장 QR 스캔 → AuthorizePackageHandover(fence) → CommitPackageHandover(재고 H·E·R −q).
// 라이더는 내부(보관·패킹 구역)에 들어오지 않는다 (MFC 5-3).

import { ApiProblem, ResultUnknown } from '../domain/contract';
import type { P } from '../domain/navgrid';
import { Agent } from './agent';
import { HANDOVER_CODE, RIDER_VEHICLE } from '../config';
import type { VehicleType } from '../domain/contract';
import { getOff, loadAndGetOn, offLot, rideTo, walkOn } from './realRider';
import type { SiteContext } from './context';

/** 0~1 값 → MOCK 수단(RIDER_VEHICLE.mockMix 누적 비율) */
export function pickVehicle(u: number): VehicleType {
  let acc = 0;
  for (const [v, w] of Object.entries(RIDER_VEHICLE.mockMix)) {
    acc += w;
    if (u < acc) return v as VehicleType;
  }
  return RIDER_VEHICLE.fallback;
}

export class Rider extends Agent {
  done = false;
  carrying = 0;
  /** MOCK 라이더 수단 — RIDER_VEHICLE.mockMix 비율로 뽑음 [시뮬] */
  readonly vehicle: VehicleType;
  riding = true;
  door = false;
  trunk = false;
  stowed = false;
  parkedAt: P | null = null;
  parkedHeading = 0;
  readonly parking: P;
  /**
   * 맡은 배송(방문 순서대로). 한집은 1건, 알뜰 묶음은 1~3건을 가게에서 한 번에 픽업하고 1번째 고객 → 2번째 고객 순으로 간다
   * (delivery-dispatch 계약 "알뜰배달 1~3건을 한 라이더에게 묶어 제안 … stopSequence(방문 순서)", 사용자 2026-11-23 "가게가 하나고 알뜰배달 2건이면 가게는 한 번에 가서 2개 동시에 픽업하고 1번째 고객 - 2번째 고객 전달" → "응 맞춰")
   */
  readonly legs: { shipmentId: string; deliveryId: string; orderId: string }[];

  constructor(
    id: string,
    legs: { shipmentId: string; deliveryId: string; orderId: string }[],
    parking: P,
    protected readonly ctx: SiteContext,
    private readonly onHandedOver: (shipmentId: string, orderId: string) => void,
  ) {
    super(id, offLot(ctx.layout.points.riderEntry), ctx.nav, 1.4);
    this.legs = legs;
    this.parking = parking;
    this.vehicle = pickVehicle(ctx.rng.next());
  }

  /** 첫 배송(한집이면 유일한 배송) */
  get shipmentId(): string {
    return this.legs[0]?.shipmentId ?? '';
  }
  get deliveryId(): string {
    return this.legs[0]?.deliveryId ?? '';
  }
  get orderId(): string {
    return this.legs[0]?.orderId ?? '';
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
      await getOff(this);
      await this.wait(8);
      this.activity = '출하대기 랙으로';
      await walkOn(this, ctx.layout.points.riderPickup);
      // 묶음이면 모든 배송의 포장을 한 번에 픽업한다
      const staged = this.legs.flatMap((l) => ctx.shipRack.ofShipment(l.shipmentId).map((s) => ({ ...s, deliveryId: l.deliveryId })));
      for (const s of staged) {
        this.activity = `QR 스캔 ${s.pkg.packageId}`;
        await this.wait(4);
        // QR 이 안 찍히면 라벨 번호(4자리, R-26·fulfillment 0.23.0)를 입력 [시뮬 비율]
        const code = s.pkg.handoverCode;
        const byCode = !!code && ctx.rng.next() < HANDOVER_CODE.qrFailRate;
        if (byCode) {
          this.activity = `QR 안 찍힘 → 번호 ${code} 입력`;
          ctx.log(`${this.id} ${s.pkg.packageId} QR 인식 불가 → 번호 ${code} 로 픽업`);
          await this.wait(6);
        }
        const auth = await this.retry(() =>
          byCode
            ? ctx.port.authorizeHandoverByCode({ riderId: this.id, deliveryId: s.deliveryId, handoverCode: code! }, `${ctx.runId}:authcode:${s.pkg.packageId}:${this.id}`)
            : ctx.port.authorizeHandover(
                s.pkg.packageId,
                { riderId: this.id, deliveryId: s.deliveryId, scannedCode: s.pkg.qrCode },
                `${ctx.runId}:auth:${s.pkg.packageId}:${this.id}`,
              ),
        );
        if (byCode) ctx.metrics.codeHandovers += 1;
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
      for (const l of this.legs) this.onHandedOver(l.shipmentId, l.orderId);
      this.activity = this.legs.length > 1 ? `알뜰 ${this.legs.length}건 픽업 — 1번째 고객 → ${this.legs.length}번째 고객 순으로 출발` : '출발';
      await walkOn(this, this.parking);
      await this.wait(3);
      await loadAndGetOn(this);
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
