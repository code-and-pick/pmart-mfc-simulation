// 입고 발주표 — 화면·서버 없이 돈다(테스트).
// 후보: 센터가 취급(carried)하고 판매 중지가 아닌 상품. 품절(TEMPORARILY_SOLD_OUT) 먼저.
// 추천 수량은 백엔드 발주 수량 추천(mfc-inbound 0.21.0 MI-4, R-48) 그대로 — 시뮬 임시 규칙(판매 가능이 적은 8개를 20개까지)은 11-24 지움.
import type { SupplyRecommendation } from './contract';
import { INBOUND_ORDER } from '../config';

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

// ───────── 입고 발주 편집(사용자 2026-11-24 "사용자 지정 발주·추천값 자동 채움·입고 전 수량 보기") ─────────

export type InboundTemp = 'AMBIENT' | 'CHILLED' | 'FROZEN';

/** 발주표 한 줄 — 추천으로 채웠는지 사람이 넣었는지, 온도대(발주를 온도대마다 따로 — 승인하면 입고 예정 하나 = 입고칸 하나, R-31) */
export interface OrderDraftLine extends InboundPlanLine {
  source: 'RECOMMEND' | 'MANUAL';
  temp: InboundTemp;
  /** 추천 근거 한 줄(서버 값) — 추천 줄만 */
  basis?: string;
}

/** 한 줄 수량 1~INBOUND_ORDER.maxQty 정수. 숫자가 아니면 1 */
export function clampOrderQty(v: number, max: number = INBOUND_ORDER.maxQty): number {
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

/** 발주로 나누기 — 온도대마다, 발주 한 건 줄 1~200(계약 SupplyRequest) 이라 그만큼씩 끊는다. 순서 = 상온·냉장·냉동 */
export function splitOrder(lines: readonly OrderDraftLine[], maxLines: number = INBOUND_ORDER.linesPerRequest): { temp: InboundTemp; lines: OrderDraftLine[] }[] {
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

/** 추천 안 한 사유(서버 reason) → 화면 말 */
export const RECOMMEND_REASON_KO: Record<string, string> = {
  INSUFFICIENT_HISTORY: '인계 실적 7일 미만',
  POLICY_MISSING: '공급 정책 값 없음',
  STORAGE_TYPE_UNKNOWN: '온도대 모름',
  AVAILABILITY_UNKNOWN: '판매 가능 수량 모름',
  SKU_NOT_HANDLED: '센터 취급 안 함',
};

const n1 = (v: number | null | undefined) => (v === null || v === undefined ? '?' : Number.isInteger(v) ? String(v) : v.toFixed(1));

/** 추천 근거 한 줄 — 하루 d × (R+L+SS)일 = 목표 S, 지금 A + 예정 E → 모자람 */
export function recommendBasis(r: SupplyRecommendation): string {
  const days = (r.reviewDays ?? 0) + (r.leadDays ?? 0) + (r.safetyDays ?? 0);
  const pend = r.pendingRequestedQty ? ` · 승인 전 발주 ${r.pendingRequestedQty}` : '';
  return `하루 ${n1(r.forecastDailyQty)}개(${r.historyDays}일 평균) × ${n1(days)}일 = 목표 ${n1(r.targetQty)} · 지금 ${n1(r.availableQty)} + 입고 예정 ${r.expectedQty} → 모자람 ${n1(r.shortfallQty)}${pend}`;
}

/**
 * 서버 추천 → 발주표 줄. 추천 수량 0 초과만 넣는다(0 = 지금 필요 없음). null(추천 안 함)은 0 으로 채우지 않고 사유별로 센다(계약 MI-4).
 * 온도대 = 서버 storageType, 모르면 tempOf
 */
export function recommendationLines(
  items: readonly SupplyRecommendation[],
  nameOf: (sku: string) => string,
  tempOf: (sku: string) => InboundTemp,
): { lines: OrderDraftLine[]; zero: number; skipped: Record<string, number> } {
  const lines: OrderDraftLine[] = [];
  const skipped: Record<string, number> = {};
  let zero = 0;
  for (const r of items) {
    const q = r.recommendedQty;
    if (q === null || q === undefined) {
      const k = r.reason ?? 'UNKNOWN';
      skipped[k] = (skipped[k] ?? 0) + 1;
      continue;
    }
    if (q <= 0) {
      zero++;
      continue;
    }
    const st = r.storageType;
    const temp: InboundTemp = st === 'AMBIENT' || st === 'CHILLED' || st === 'FROZEN' ? st : tempOf(r.sku);
    lines.push({ sku: r.sku, name: r.productName ?? nameOf(r.sku), available: r.availableQty ?? null, qty: clampOrderQty(q), temp, source: 'RECOMMEND', basis: recommendBasis(r) });
  }
  return { lines, zero, skipped };
}
