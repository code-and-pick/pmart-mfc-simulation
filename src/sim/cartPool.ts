// 장바구니(이동 카트) 나눠 쓰기 — 실서버 가상 작업자용.
// 백엔드 fulfillment 0.8.0(2026-11-17, d5386b2f): 피킹 실적 toLocation = 찍은 장바구니, 한 출고 = 한 장바구니(다르면 409 CART_MISMATCH).
// 한 장바구니를 여러 출고가 같이 쓰는 것은 서버가 막지 않는다 — 여기서는 현장처럼 한 출고에 빈 카트 하나를 주고, 다 쓰면 같이 쓴다.
// 카트는 포장(밀봉)으로 집품분이 패킹대로 옮겨지면 빈다.

import type { TemperatureZone } from '../domain/contract';

const LETTER: Record<TemperatureZone, string> = { AMBIENT: 'A', CHILLED: 'C', FROZEN: 'F' };

export class CartPool {
  private readonly byShipment = new Map<string, string>();

  constructor(private readonly codes: readonly string[]) {}

  /** 그 출고의 장바구니 — 정해 둔 것, 없으면 첫 칸 온도대의 빈 카트 → 아무 빈 카트 → 온도대 첫 카트(같이 쓰기) */
  take(shipmentId: string, temp: TemperatureZone | null): string {
    const had = this.byShipment.get(shipmentId);
    if (had) return had;
    const used = new Set(this.byShipment.values());
    const pre = `CRT-${LETTER[temp ?? 'AMBIENT']}-`;
    const free = this.codes.filter((c) => !used.has(c));
    const c = free.find((x) => x.startsWith(pre)) ?? free[0] ?? this.codes.find((x) => x.startsWith(pre)) ?? this.codes[0];
    this.byShipment.set(shipmentId, c);
    return c;
  }

  /** 서버가 알려 준 장바구니(409 CART_MISMATCH 의 detail, 이어 하기)로 고친다 */
  bind(shipmentId: string, cart: string) {
    this.byShipment.set(shipmentId, cart);
  }

  release(shipmentId: string) {
    this.byShipment.delete(shipmentId);
  }

  get inUse(): number {
    return this.byShipment.size;
  }
}

/** 409 CART_MISMATCH 본문 detail 에서 그 출고가 쓰는 장바구니 코드 */
export function cartInDetail(detail: string | null | undefined): string | null {
  return /CRT-[A-Z]-\d+/.exec(detail ?? '')?.[0] ?? null;
}
