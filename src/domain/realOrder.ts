// 실제 주문 넣기(R-21)의 고르는 규칙 — 네트워크 없이 시험한다. 부르는 쪽은 server/realOrder.ts(개발 서버).
// 상품: 검색 결과 중 판매 중·담당 센터 취급·단가 범위 안 → 섞어서 하나씩 담는다(장바구니가 가용을 판정).
// 예약 시간대: AVAILABLE·남은 정원 ≥ 1·마감까지 여유 있는 것만, 이른 순(요청서 R-21 — 예약 PICK 준비 = 슬롯 시작 − 90분).

export type OrderMode = 'SINGLE' | 'BUNDLED' | 'SCHEDULED';
export type OrderModeChoice = OrderMode | 'RANDOM';
export const ORDER_MODES: readonly OrderMode[] = ['SINGLE', 'BUNDLED', 'SCHEDULED'];
export const MODE_KO: Record<OrderModeChoice, string> = { SINGLE: '한집', BUNDLED: '알뜰', SCHEDULED: '예약', RANDOM: '랜덤' };

/** search-service SearchHit 중 쓰는 것 */
export interface ProductHit {
  representativeSku?: string;
  name?: string;
  basePrice?: number;
  saleState?: string;
  carried?: boolean | null;
}

/** delivery-capacity Slot 중 쓰는 것 */
export interface SlotView {
  window?: { date: string; start: string; end: string };
  availability?: string;
  remaining?: number | null;
  cutoffAt?: string;
}

export type Rand = () => number;

function shuffle<T>(xs: T[], rand: Rand): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 담아 볼 상품 순서 — 판매 중·취급·단가 범위, 이미 장바구니에 있는 SKU 는 뺀다(고객 장바구니 수량을 바꾸지 않게) */
export function orderCandidates(
  hits: readonly ProductHit[],
  inCart: ReadonlySet<string>,
  range: { min: number; max: number },
  rand: Rand,
): { sku: string; name: string; price: number }[] {
  const seen = new Set<string>();
  const ok: { sku: string; name: string; price: number }[] = [];
  for (const h of hits) {
    const sku = h.representativeSku;
    if (!sku || seen.has(sku) || inCart.has(sku)) continue;
    if (h.saleState !== 'ON_SALE' || h.carried !== true) continue;
    if (typeof h.basePrice !== 'number' || h.basePrice < range.min || h.basePrice > range.max) continue;
    seen.add(sku);
    ok.push({ sku, name: h.name ?? sku, price: h.basePrice });
  }
  return shuffle(ok, rand);
}

/** 고를 수 있는 예약 시간대(이른 순) */
export function selectableSlots(slots: readonly SlotView[], nowMs: number, marginMin: number): SlotView[] {
  return slots
    .filter(
      (s) =>
        s.window &&
        s.availability === 'AVAILABLE' &&
        typeof s.remaining === 'number' &&
        s.remaining >= 1 &&
        !!s.cutoffAt &&
        Date.parse(s.cutoffAt) - nowMs > marginMin * 60_000,
    )
    .sort((a, b) => `${a.window!.date} ${a.window!.start}`.localeCompare(`${b.window!.date} ${b.window!.start}`));
}

/** 이번 주문의 예약 시간대 순서 — 첫 것을 쓰고, 결제 진입이 슬롯 문제로 막히면 다음 것으로 한 번만 다시(R-21).
 *  예약을 직접 고르면 가장 빠른 것부터, 랜덤에서 예약이 뽑히면 가장 빠른 pool 개 중 하나부터 */
export function slotOrder(selectable: readonly SlotView[], random: boolean, pool: number, rand: Rand): SlotView[] {
  if (!random || selectable.length <= 1) return [...selectable];
  const k = Math.floor(rand() * Math.min(pool, selectable.length));
  return [selectable[k], ...selectable.filter((_, i) => i !== k)];
}

/** 랜덤 배송 방식 — 지금 되는 방식 중 하나(되는 것이 없으면 null) */
export function randomMode(available: readonly OrderMode[], rand: Rand): OrderMode | null {
  if (available.length === 0) return null;
  return available[Math.floor(rand() * available.length)];
}

/** 결제 진입 실패 중 다음 시간대로 다시 해 볼 만한 것(R-21) */
export function slotRetryable(code: string | undefined): boolean {
  return code === 'SLOT_NOT_SELECTABLE' || code === 'CAPACITY_EXCEEDED';
}

/** 서울 날짜(YYYY-MM-DD) — 오늘·내일 */
export function seoulDate(ms: number, addDays = 0): string {
  return new Date(ms + 9 * 3600_000 + addDays * 86_400_000).toISOString().slice(0, 10);
}

/** 개발 서버 → 화면 결과 */
export type RealOrderResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string | null;
      mode: OrderMode;
      window: { date: string; start: string; end: string } | null;
      amount: number;
      items: { sku: string; name: string; qty: number }[];
    }
  | { ok: false; step: string; code: string; detail: string; askScheduled?: boolean };
