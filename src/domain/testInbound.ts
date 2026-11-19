// 시험 입고(MI-3·R-23) 줄 고르기 — 화면·서버 없이 돈다(테스트).
// 후보: 센터가 취급(carried)하고 판매 중지가 아닌 상품. 품절(TEMPORARILY_SOLD_OUT) 먼저 읽고, 나머지는 섞어서.
// 줄: 판매 가능 수량이 적은 것부터, 목표까지 모자란 만큼(최소·최대 안에서).

export interface SearchHit {
  representativeSku?: string;
  name?: string;
  saleState?: string;
  carried?: boolean | null;
}

export interface InboundPlanLine {
  sku: string;
  name: string;
  /** 읽은 판매 가능 수량(LOT available 합). 못 읽었으면 null */
  available: number | null;
  qty: number;
}

type Rand = () => number;

/** 재고를 읽어 볼 후보(최대 readMax) — 품절 먼저, 그다음 무작위 */
export function inboundCandidates(hits: readonly SearchHit[], readMax: number, rand: Rand): { sku: string; name: string }[] {
  const seen = new Set<string>();
  const soldOut: { sku: string; name: string }[] = [];
  const rest: { sku: string; name: string }[] = [];
  for (const h of hits) {
    const sku = h.representativeSku;
    if (!sku || seen.has(sku) || h.carried !== true || h.saleState === 'SALE_STOPPED') continue;
    seen.add(sku);
    (h.saleState === 'TEMPORARILY_SOLD_OUT' ? soldOut : rest).push({ sku, name: h.name ?? sku });
  }
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...soldOut, ...rest].slice(0, readMax);
}

/** 넣을 줄 — 판매 가능이 적은 순(못 읽은 것은 뒤), 목표 − 가능, [minQty, maxQty] */
export function inboundLines(
  cands: readonly { sku: string; name: string; available: number | null }[],
  opt: { lines: number; targetQty: number; minQty: number; maxQty: number },
): InboundPlanLine[] {
  const rank = (a: number | null) => (a === null ? Number.POSITIVE_INFINITY : a);
  return [...cands]
    .sort((a, b) => rank(a.available) - rank(b.available))
    .slice(0, opt.lines)
    .map((c) => ({ ...c, qty: Math.min(opt.maxQty, Math.max(opt.minQty, opt.targetQty - (c.available ?? 0))) }));
}
