// 넓은 칸을 시뮬레이터 칸에 적용(백엔드 알림 2026-11-18 부탁 1·2 — 합친 칸은 넓게·세로 합친 칸은 높게, 닫힌 칸은 닫힘).
// 칸 치수(dimMm)는 백엔드 값 그대로, 그림 크기(slotW·levelH)와 칸 중심(shelf)은 합친 칸 수만큼 넓힌다. 닫힌 칸은 closed — 재고·안내·라벨에서 뺀다.
import type { Layout, Location } from './layout';
import type { LocationCodeMap } from './locationCodes';
import { WIDE_CLOSED, WIDE_MERGED } from './wideCellsData';

/** 합친 칸 한 개의 자리(랙·단·칸 범위) — 칸막이·선반을 그 안에서 빼는 데 쓴다 */
export interface WideSpan {
  rackId: string;
  /** 맨 아래 단(1부터) */
  level: number;
  /** 맨 왼쪽 칸(1부터) */
  slot: number;
  slots: number;
  levels: number;
}

/** 레이아웃에 넓은 칸을 적용한다(한 번만). 돌려주는 값 = 합친 칸 자리 목록 */
export function applyWideCells(layout: Layout, codes: Pick<LocationCodeMap, 'toSim'>): WideSpan[] {
  if (layout.wideSpans) return layout.wideSpans;
  const bySim = new Map(layout.locations.map((l) => [l.code, l]));
  const at = (backend: string): Location | null => {
    const s = codes.toSim(backend);
    return s ? (bySim.get(s) ?? null) : null;
  };
  const spans: WideSpan[] = [];
  for (const [code, w, d, h] of WIDE_MERGED) {
    const loc = at(code);
    if (!loc) continue;
    const slots = Math.max(1, Math.round(w / loc.dimMm.w));
    const levels = Math.max(1, Math.round(h / loc.dimMm.h));
    const oneW = loc.slotW;
    const along = ((slots - 1) / 2) * oneW;
    loc.shelf = loc.along === 'z' ? { ...loc.shelf, z: loc.shelf.z + along } : { ...loc.shelf, x: loc.shelf.x + along };
    loc.slotW = oneW * slots;
    loc.levelH = loc.levelH * levels;
    loc.dimMm = { w, d, h };
    loc.span = { slots, levels };
    spans.push({ rackId: loc.rackId, level: loc.level, slot: loc.slot, slots, levels });
  }
  for (const code of WIDE_CLOSED) {
    const loc = at(code);
    if (loc) loc.closed = true;
  }
  layout.wideSpans = spans;
  return spans;
}

/** 이 칸막이(랙 r, 단 lv, 칸 s 와 s+1 사이)가 합친 칸 안인가 */
export function dividerInside(spans: readonly WideSpan[], rackId: string, lv: number, s: number): boolean {
  return spans.some((x) => x.rackId === rackId && lv >= x.level && lv < x.level + x.levels && s >= x.slot && s + 1 <= x.slot + x.slots - 1);
}

/** 이 선반(랙 r, 단 lv 의 바닥 판)이 세로로 합친 칸 안인가 — 랙 폭 전체를 세로로 합친 칸만 판을 뺀다 */
export function shelfInside(spans: readonly WideSpan[], rackId: string, lv: number, slotsPerLevel: number): boolean {
  return spans.some((x) => x.rackId === rackId && x.levels > 1 && x.slots === slotsPerLevel && lv > x.level && lv < x.level + x.levels);
}
