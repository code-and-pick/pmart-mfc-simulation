// 실서버 모드 앞마당 라이더(rider 시뮬레이터 요청 M-02) — 그리기만 한다. 라이더 API(도착·인계)는 rider 시뮬레이터가 부른다.
// 배송 수행 상태가 ARRIVED_AT_STORE 가 되면 입구 → 주차 자리 → 출하대기 랙 앞에 서고, 출고가 인계됨(HANDED_OVER)이거나
// 배송이 픽업 뒤 상태가 되면 포장을 들고 떠난다. 서버가 확정한 상태만 따른다 — 도착을 못 본 배송은 지어내 그리지 않는다.

import { RIDER_VEHICLE } from '../config';
import type { VehicleType } from '../domain/contract';
import type { NavGrid, P } from '../domain/navgrid';
import { Agent } from './agent';

/** 배차 배정의 vehicleType → 그릴 수단(모르면 오토바이) */
export function vehicleOf(v: string | null | undefined): VehicleType {
  return v === 'MOTORCYCLE' || v === 'BICYCLE' || v === 'E_BIKE' || v === 'KICKBOARD' || v === 'CAR' || v === 'WALK' ? v : RIDER_VEHICLE.fallback;
}

/** 앞길 끝(타고 오고 가는 끝) — 입구에서 앞길(같은 z)을 따라 오른쪽으로. 평면도(길 찾기 격자) 안이어야 한다 */
export function offLot(entry: P): P {
  return { x: entry.x + RIDER_VEHICLE.offLot, z: entry.z };
}

/**
 * 수단 타고 다니기(MOCK·실서버 라이더 공통): 입구 밖 → 주차 자리는 타고, 주차 자리 ↔ 출하대기 랙은 걷고, 주차 자리 → 입구 밖은 다시 타고.
 * 도보(WALK)는 내내 걷는다(수단 그림 없음).
 */
export async function rideTo(a: Agent & { riding: boolean; vehicle: VehicleType }, p: P) {
  a.riding = a.vehicle !== 'WALK';
  (a as unknown as { speed: number }).speed = a.riding ? (RIDER_VEHICLE.rideSpeed[a.vehicle] ?? 2.5) : RIDER_VEHICLE.walkSpeed;
  await a.walkTo(p);
}

export async function walkOn(a: Agent & { riding: boolean }, p: P) {
  a.riding = false;
  (a as unknown as { speed: number }).speed = RIDER_VEHICLE.walkSpeed;
  await a.walkTo(p);
}

/** 화면(3D·요약)이 보는 라이더 모양 — MOCK 라이더(Rider)와 실서버 관찰 라이더(RealRider) 공통 */
export interface SiteRider {
  readonly id: string;
  pos: P;
  heading: number;
  activity: string;
  carrying: number;
  readonly parking: P;
  done: boolean;
  /** 배달 수단(배차 배정 vehicleType, 모르면 오토바이) */
  readonly vehicle: VehicleType;
  /** 지금 수단을 타고 움직이는 중 — 아니면 수단은 주차 자리에 서 있다(도보는 수단 없음) */
  riding: boolean;
  tick(dt: number): void;
}

export class RealRider extends Agent implements SiteRider {
  done = false;
  carrying = 0;
  riding = true;
  readonly vehicle: VehicleType;
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
    vehicleType?: string | null,
  ) {
    super(id, offLot(entry), nav, 1.4);
    this.vehicle = vehicleOf(vehicleType);
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
    await rideTo(this, this.entry);
    await rideTo(this, this.parking);
    this.riding = false;
    if (!this.leaving) {
      await this.wait(3);
      this.activity = '출하대기 랙 앞 — 인계 대기';
      await walkOn(this, this.pickup);
    }
    const n = await this.left;
    this.carrying = n;
    this.activity = n > 0 ? `픽업 ${n}개 — 출발` : '빈손으로 떠남';
    await walkOn(this, this.parking);
    await this.wait(2);
    await rideTo(this, this.entry);
    await rideTo(this, offLot(this.entry));
    this.done = true;
  }
}
