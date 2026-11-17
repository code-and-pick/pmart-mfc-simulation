// 실제 PDA 앱이 "지금 갈 칸"을 고르는 방법을 그대로 따른다(사용자 2026-11-17 "직원이 카트, 상품이 있는 칸까지 움직였을때 바코드를 찍을수있게").
// 근거: pmart-clients apps/mfc_app/lib/features/tasks/presentation/task_controllers.dart nextPickStop (클라이언트 3f2048f, 11-17 #77)
// - 남은 조각 중 서버 방문 순서(visitSeq — 냉장 → 냉동 → 상온, 걷는 거리 최단)가 가장 앞인 것. 줄 사이에 끼어 있어도 서버 순서
// - 방문 순서가 없으면 서버가 준 줄·조각 순서(줄 안에서는 첫 남은 조각만)
// - 칸: 이 주문 몫 배정(allocatedQty > 0) 칸 → 재고 있는 칸 → 첫 칸
// - 앞 줄까지 고른 칸이 없고 이 줄 지시가 비었으면(재고 조회 실패) 줄의 지시 칸
// PDA 의 "접수만 된 양(pendingQty)" 빼기는 서버 값 pendingQty 로 한다(앱은 자기 큐 값).
import type { TaskLine, TaskPick } from './contract';

export interface PickStop {
  line: TaskLine;
  /** 백엔드 위치 코드 */
  location: string;
  /** 이 칸에서 집을 양 */
  qty: number;
  lotId: string | null;
  /** 그 LOT 조각(LOT 번호·소비기한 — LOT 라벨). 지시가 비었으면 null */
  pick: TaskPick | null;
  /** 같은 LOT 이 있는 다른 칸(지시 칸이 비었으면 여기서 집어도 됨) */
  otherLocations: string[];
}

export function nextPickStop(lines: TaskLine[]): PickStop | null {
  let best: PickStop | null = null;
  let bestSeq: number | null = null;
  for (const l of lines) {
    if (l.remainingQty - l.pendingQty <= 0) continue;
    let sent = l.pendingQty;
    const picks = l.picks ?? [];
    for (const p of picks) {
      if (p.pickStatus === 'DONE') continue;
      let r = p.remainingQty ?? 0;
      const used = Math.min(sent, r);
      sent -= used;
      r -= used;
      if (r <= 0) continue;
      const withStock = p.locations.filter((c) => (c.qty ?? 0) > 0);
      const allocated = p.locations.find((c) => (c.allocatedQty ?? 0) > 0);
      const c = allocated ?? withStock[0] ?? p.locations[0];
      if (!c) continue;
      const here = (c.allocatedQty ?? 0) > 0 ? c.allocatedQty! : (c.qty ?? 0) > 0 ? c.qty! : r;
      const stop: PickStop = {
        line: l,
        location: c.locationCode,
        qty: Math.min(here, r),
        lotId: p.lotId,
        pick: p,
        otherLocations: withStock.filter((o) => o.locationCode !== c.locationCode).map((o) => o.locationCode),
      };
      const seq = p.visitSeq ?? null;
      if (!best || (seq != null && (bestSeq == null || seq < bestSeq))) {
        best = stop;
        bestSeq = seq;
      }
      if (seq == null) break;
    }
    if (!best && !picks.length && l.locationId) return { line: l, location: l.locationId, qty: l.remainingQty - l.pendingQty, lotId: l.lotId, pick: null, otherLocations: [] };
  }
  return best;
}

/**
 * 화면 안내용 카트 — 카트는 온도 구분이 없고(백엔드 0cbfecaa) PDA 는 CRT- 로 시작하면 어느 카트든 받는다. 찍은 카트가 그 출고의 장바구니가 된다.
 */
export const SUGGESTED_CART = 'CRT-A-01';
