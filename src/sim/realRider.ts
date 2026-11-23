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

/** 문·트렁크(배달통 뚜껑)를 다루는 라이더 — 그림은 door·trunk 를 보고 천천히 연다(사용자 2026-11-19 "승용차는 차문 열리는 애니메이션", 트렁크·배달통 포함) */
type Hatched = Agent & { riding: boolean; vehicle: VehicleType; door: boolean; trunk: boolean; stowed: boolean; parkedAt: P | null; parkedHeading: number };
/** 내린 라이더가 비켜 서는 거리(m) — 수단 옆(운전석 문 쪽) */
const SIDE = 0.9;
/**
 * 수단 옆 자리 — 수단이 선 방향(heading)의 왼쪽(모델 +x = 운전석 문 쪽, 사용자 2026-11-19 "차 방향에 맞춰서 서줘").
 * 그림은 rotation.y = heading 이라 모델 +x 는 세상 (cos h, −sin h).
 */
function sideOf(at: P, heading: number): P {
  return { x: at.x + SIDE * Math.cos(heading), z: at.z - SIDE * Math.sin(heading) };
}
const hasDoor = (v: VehicleType) => v === 'CAR';
const hasBox = (v: VehicleType) => v === 'CAR' || v === 'MOTORCYCLE' || v === 'BICYCLE' || v === 'E_BIKE';

/** 주차 자리에서 내리기 — 승용차는 문 열고 내리고 닫는다 */
export async function getOff(a: Hatched) {
  if (a.vehicle === 'WALK') {
    a.riding = false;
    return;
  }
  // 수단은 멈춘 자리에 둔다(그림도 그 자리) — 라이더만 옆으로 비켜 선다
  a.parkedAt = { ...a.pos };
  a.parkedHeading = a.heading;
  const side = sideOf(a.pos, a.heading);
  if (hasDoor(a.vehicle)) {
    a.door = true;
    await a.wait(RIDER_VEHICLE.hatchSec);
    a.riding = false;
    await walkOn(a, side);
    a.door = false;
    await a.wait(RIDER_VEHICLE.hatchSec);
    return;
  }
  a.riding = false;
  await walkOn(a, side);
}

/** 포장 싣고 타기 — 들고 온 포장이 있으면 트렁크(배달통)를 열고 넣고 닫은 뒤, 승용차는 문 열고 타고 닫는다 */
export async function loadAndGetOn(a: Hatched & { carrying: number }) {
  const at = a.parkedAt;
  if (at && a.vehicle !== 'WALK') await walkOn(a, sideOf(at, a.parkedHeading)); // 수단 옆(운전석 문 쪽)으로
  if (a.carrying > 0 && hasBox(a.vehicle)) {
    a.trunk = true;
    await a.wait(RIDER_VEHICLE.hatchSec);
    a.stowed = true; // 들고 있던 상자는 트렁크·배달통 안
    await a.wait(0.4);
    a.trunk = false;
    await a.wait(RIDER_VEHICLE.hatchSec);
  } else if (a.carrying > 0) a.stowed = true;
  if (hasDoor(a.vehicle)) {
    a.door = true;
    await a.wait(RIDER_VEHICLE.hatchSec);
  }
  if (at && a.vehicle !== 'WALK') await walkOn(a, at); // 타는 자리 = 수단이 선 자리
  if (a.vehicle !== 'WALK') a.riding = true;
  if (hasDoor(a.vehicle)) {
    await a.wait(0.3);
    a.door = false;
    await a.wait(RIDER_VEHICLE.hatchSec);
  }
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
  /** 승용차 운전석 문을 여는 중 */
  door: boolean;
  /** 트렁크(승용차)·배달통 뚜껑(오토바이·자전거)을 여는 중 */
  trunk: boolean;
  /** 들고 온 포장을 트렁크·배달통에 넣었다(손에 든 상자를 안 그림) */
  stowed: boolean;
  /** 수단을 세운 자리(내린 뒤) — 그림은 수단을 여기 둔다 */
  parkedAt: P | null;
  /** 수단을 세운 방향(heading) — 그림도 이 방향 */
  parkedHeading: number;
  tick(dt: number): void;
}

export class RealRider extends Agent implements SiteRider {
  done = false;
  carrying = 0;
  riding = true;
  door = false;
  trunk = false;
  stowed = false;
  parkedAt: P | null = null;
  parkedHeading = 0;
  vehicle: VehicleType;
  leaving = false;
  private leave: ((n: number) => void) | null = null;
  private readonly left: Promise<number>;

  /** 이 라이더가 가게에서 픽업할 배송(알뜰 묶음이면 여러 건 — 한 사람으로 그린다, 사용자 2026-11-23 "응 맞춰") */
  readonly deliveryIds = new Set<string>();

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
    this.deliveryIds.add(deliveryId);
    this.vehicle = vehicleOf(vehicleType);
    this.left = new Promise((resolve) => (this.leave = resolve));
  }

  /**
   * 배차 상세가 늦게 와 처음엔 수단을 몰랐거나(기본 오토바이), 서버 값이 바뀌었으면 그 수단으로 바꿔 그린다.
   * 모르는 값(null)은 무시 — 지어내지 않는다
   */
  updateVehicle(vehicleType: string | null | undefined) {
    if (!vehicleType) return;
    const v = vehicleOf(vehicleType);
    if (v === this.vehicle) return;
    this.vehicle = v;
    if (v === 'WALK') {
      this.riding = false;
      this.door = false;
      this.trunk = false;
    }
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
    await getOff(this);
    if (!this.leaving) {
      await this.wait(3);
      this.activity = '출하대기 랙 앞 — 인계 대기';
      await walkOn(this, this.pickup);
    }
    const n = await this.left;
    this.carrying = n;
    this.activity = n > 0 ? `픽업 ${n}개 — 출발` : '빈손으로 떠남';
    await walkOn(this, this.parking);
    await this.wait(1);
    await loadAndGetOn(this);
    await rideTo(this, this.entry);
    await rideTo(this, offLot(this.entry));
    this.done = true;
  }
}
