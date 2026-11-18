// 장바구니(이동 카트) 나눠 쓰기 — 실서버 가상 작업자용.
// 백엔드 fulfillment 0.8.0(2026-11-17, d5386b2f): 피킹 실적 toLocation = 찍은 장바구니, 한 출고 = 한 장바구니(다르면 409 CART_MISMATCH).
// 한 장바구니를 여러 출고가 같이 쓰는 것은 서버가 막지 않는다 — 여기서는 현장처럼 한 출고에 빈 카트 하나를 주고, 다 쓰면 같이 쓴다.
// 카트는 온도 구분이 없다(백엔드 0cbfecaa — CRT-A-01~40, 상온·냉장·냉동 상품을 한 카트에).
// 카트는 포장(밀봉)으로 집품분이 패킹대로 옮겨지면 빈다.

export class CartPool {
  private readonly byShipment = new Map<string, string>();

  constructor(private readonly codes: readonly string[]) {}

  /** 그 출고의 장바구니 — 정해 둔 것, 없으면 첫 빈 카트, 다 쓰면 가장 적게 같이 쓰는 카트 */
  take(shipmentId: string): string {
    const had = this.byShipment.get(shipmentId);
    if (had) return had;
    const n = new Map<string, number>();
    for (const x of this.byShipment.values()) n.set(x, (n.get(x) ?? 0) + 1);
    const c = [...this.codes].sort((a, b) => (n.get(a) ?? 0) - (n.get(b) ?? 0))[0];
    this.byShipment.set(shipmentId, c);
    return c;
  }

  /** 서버가 알려 준 장바구니(409 CART_MISMATCH 의 detail, 이어 하기)로 고친다 */
  bind(shipmentId: string, cart: string) {
    this.byShipment.set(shipmentId, cart);
  }

  /** 그 출고에 정해 둔 장바구니(없으면 null) */
  cartOf(shipmentId: string): string | null {
    return this.byShipment.get(shipmentId) ?? null;
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
