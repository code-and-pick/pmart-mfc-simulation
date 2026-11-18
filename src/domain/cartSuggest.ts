// 피킹 시작 때 찍을 장바구니 안내 — 주문(출고)마다 다른 빈 카트(사용자 2026-11-18, 두 주문이 같은 CRT-A-01 에 집품된 것을 보고).
// 서버 규칙: 한 출고 = 한 장바구니(fulfillment 0.8.0). 서버는 첫 집품 전에는 어느 카트인지 모르고, PDA 는 CRT- 면 어느 카트든 받는다.
// 다른 PC 에서 연 화면도 같은 서버 값으로 같은 답을 내도록 결정적으로 고른다: 쓰는 카트를 빼고, 카트가 아직 없는 출고를
// 만든 순(같으면 출고 번호 순)으로 줄 세워 빈 카트를 앞에서부터 하나씩. 서버 실적이 생기면 서버 카트를 쓴다(이 안내는 버림).

/** carts = 카트 코드 목록(순서대로 안내), used = 서버가 아는 쓰는 카트, needing = 카트가 아직 없는 열린 피킹의 출고 */
export function suggestCarts(carts: readonly string[], used: Iterable<string>, needing: readonly { shipmentId: string; createdAt: string }[]): Map<string, string> {
  const busy = new Set(used);
  const free = carts.filter((c) => !busy.has(c));
  const order = [...needing].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.shipmentId.localeCompare(b.shipmentId));
  const out = new Map<string, string>();
  order.forEach((n, i) => {
    // 빈 카트가 모자라면 처음부터 다시(같이 쓰게 됨 — 40대를 넘는 동시 주문은 없다고 본다)
    const c = free.length ? free[i % free.length] : carts[i % carts.length];
    if (c) out.set(n.shipmentId, c);
  });
  return out;
}
