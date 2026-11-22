// 실서버 선반 칸에 상품 크기(서버 SKU dimensions) 상자를 낱개로 놓는 자리 — 화면 없이 계산(시험 가능).
// MOCK 선반 상품(Stock.tsx Goods)과 같은 배치: 가로 cols × 앞뒤 rows × 단 layers(최대 2), 앞(통로 쪽) 줄부터.
// 긴 쪽을 칸 가로에 두고, 칸보다 크면 칸 안에 들어가게 줄인다(칸을 넘쳐 보이지 않게). (사용자 2026-11-22 "쌀 같이 무거운 건 상품 박스 크기도 커?")
import { RACK_DEPTH, type Location } from '../domain/layout';

/** 치수를 아는 상품을 칸 하나에 낱개로 놓는 최대 개수 — 실서버 상자 인스턴스 상한(16,000) 안에 들게 [시뮬] */
export const UNIT_CELL_CAP = 24;

export interface UnitBox {
  x: number;
  y: number;
  z: number;
  /** 월드 축 크기(m) */
  sx: number;
  sy: number;
  sz: number;
}

export function unitBoxes(
  loc: Pick<Location, 'slotW' | 'levelH' | 'shelf' | 'along' | 'face'>,
  dims: { w: number; d: number; h: number },
  qty: number,
): UnitBox[] {
  const slotW = loc.slotW * 0.95;
  const depth = RACK_DEPTH * 0.9;
  const maxH = loc.levelH - 0.06;
  let uw = Math.max(dims.w, dims.d);
  let ud = Math.min(dims.w, dims.d);
  if (uw > slotW && ud <= slotW) [uw, ud] = [ud, uw];
  uw = Math.min(uw, slotW);
  ud = Math.min(ud, depth);
  const uh = Math.min(dims.h, maxH);
  const cols = Math.max(1, Math.floor(slotW / (uw + 0.012)));
  const rows = Math.max(1, Math.floor(depth / (ud + 0.012)));
  const layers = Math.max(1, Math.min(2, Math.floor((maxH + 0.01) / (uh + 0.01))));
  const want = Math.max(0, Math.min(qty, cols * rows * layers, UNIT_CELL_CAP));
  const rackCross = (loc.along === 'z' ? loc.shelf.x : loc.shelf.z) - (loc.face * RACK_DEPTH) / 4;
  const alongC = loc.along === 'z' ? loc.shelf.z : loc.shelf.x;
  const baseY = loc.shelf.y - 0.035;
  const out: UnitBox[] = [];
  for (let r = 0; r < rows && out.length < want; r++) {
    for (let l = 0; l < layers && out.length < want; l++) {
      for (let c = 0; c < cols && out.length < want; c++) {
        const a = alongC + (c - (cols - 1) / 2) * (uw + 0.012);
        const cross = rackCross + loc.face * (depth / 2 - ud / 2 - r * (ud + 0.012));
        const y = baseY + uh / 2 + l * (uh + 0.01);
        out.push(
          loc.along === 'z'
            ? { x: cross, y, z: a, sx: ud, sy: uh, sz: uw }
            : { x: a, y, z: cross, sx: uw, sy: uh, sz: ud },
        );
      }
    }
  }
  return out;
}
