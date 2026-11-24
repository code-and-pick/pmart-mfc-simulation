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

// ───────── 입고 발주 편집(사용자 2026-11-24 "사용자 지정 발주·추천값 자동 채움·입고 전 수량 보기") ─────────

export type InboundTemp = 'AMBIENT' | 'CHILLED' | 'FROZEN';

/** 발주표 한 줄 — 추천으로 채웠는지 사람이 넣었는지, 온도대(입고 예정을 온도대마다 따로 만든다 — R-31) */
export interface OrderDraftLine extends InboundPlanLine {
  source: 'RECOMMEND' | 'MANUAL';
  temp: InboundTemp;
}

/** 계약 SKU 당 1~500(createDevInitialStockLoad). 숫자가 아니면 1 */
export function clampOrderQty(v: number, max = 500): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(max, Math.round(v)));
}

/**
 * 줄 더하기 — 같은 SKU 가 있으면(계약상 한 입고 예정에 같은 SKU 두 번 400) 새로 넣지 않고 수량만 바꾼다.
 * replaceQty 면 새 수량으로, 아니면 더한다(추천으로 다시 채울 때는 바꾸고, 직접 같은 상품을 또 넣으면 더함)
 */
export function upsertLine(lines: readonly OrderDraftLine[], add: OrderDraftLine, replaceQty: boolean): OrderDraftLine[] {
  const i = lines.findIndex((l) => l.sku === add.sku);
  if (i < 0) return [...lines, { ...add, qty: clampOrderQty(add.qty) }];
  const cur = lines[i];
  const qty = clampOrderQty(replaceQty ? add.qty : cur.qty + add.qty);
  return lines.map((l, j) => (j === i ? { ...cur, qty, available: add.available ?? cur.available, source: replaceQty ? add.source : cur.source } : l));
}

/** 입고 예정으로 나누기 — 온도대마다, 계약 줄 1~40 이라 40줄씩 끊는다. 순서 = 상온·냉장·냉동 */
export function splitOrder(lines: readonly OrderDraftLine[], maxLines = 40): { temp: InboundTemp; lines: OrderDraftLine[] }[] {
  const out: { temp: InboundTemp; lines: OrderDraftLine[] }[] = [];
  for (const temp of ['AMBIENT', 'CHILLED', 'FROZEN'] as const) {
    const ls = lines.filter((l) => l.temp === temp);
    for (let i = 0; i < ls.length; i += maxLines) out.push({ temp, lines: ls.slice(i, i + maxLines) });
  }
  return out;
}

/** 입고 전 수량 보기 — 온도대별 품목·개수와 합계 */
export function orderTotals(lines: readonly { temp: InboundTemp; qty: number }[]): { byTemp: Record<InboundTemp, { items: number; units: number }>; items: number; units: number } {
  const byTemp = { AMBIENT: { items: 0, units: 0 }, CHILLED: { items: 0, units: 0 }, FROZEN: { items: 0, units: 0 } };
  for (const l of lines) {
    byTemp[l.temp].items++;
    byTemp[l.temp].units += l.qty;
  }
  return { byTemp, items: lines.length, units: lines.reduce((a, l) => a + l.qty, 0) };
}

/** 받은 입고 예정 하나의 수령 칸 온도대 — 줄 온도대 중 가장 많은 것(우리가 만든 건 하나뿐), 모르면 상온 */
export function receiptTemp(skus: readonly string[], tempOf: (sku: string) => InboundTemp): InboundTemp {
  const n = { AMBIENT: 0, CHILLED: 0, FROZEN: 0 };
  for (const s of skus) n[tempOf(s)]++;
  return (['FROZEN', 'CHILLED', 'AMBIENT'] as const).reduce((best, t) => (n[t] > n[best] ? t : best), 'AMBIENT' as InboundTemp);
}
