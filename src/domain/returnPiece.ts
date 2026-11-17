// 취소품 복귀(RETURN 작업)에서 "지금 옮길 한 조각" — 실제 PDA 앱과 같은 방법.
// 근거: pmart-clients apps/mfc_app/lib/features/tasks/presentation/return_screen.dart nextReturnPiece (클라이언트 origin/main 1dca4c2, 2026-11-17)
// - 남은 양(remaining − pending)이 있는 첫 줄
// - 그 줄의 LOT 조각 중 남은 양이 있는 첫 조각, 출발 = 그 조각에서 수량이 있는 첫 위치(장바구니 CRT- 또는 패킹대 PAK-)
// - 돌려놓을 칸 = 조각의 추천 칸(suggestedToLocations) — PDA 는 추천 칸이 아니어도 받는다(진열 규칙 판정은 서버)
// PDA 흐름: ① 출발 위치 찍기 → ② 상품을 1개씩 찍어 싣기 → "실었어요" → ③ 선반 칸 찍기 → 실적(RETURN). ①②"실었어요"는 서버가 모른다.
import type { TaskLine } from './contract';

export interface ReturnPiece {
  line: TaskLine;
  lotId: string;
  /** 복귀 대상이 놓인 위치(장바구니·패킹대) */
  from: string;
  /** 더 옮길 양(접수만 된 것 제외) */
  left: number;
  /** 돌려놓을 추천 선반 칸 */
  suggested: string[];
}

export function nextReturnPiece(lines: TaskLine[]): ReturnPiece | null {
  for (const l of lines) {
    const left = l.remainingQty - l.pendingQty;
    if (left <= 0) continue;
    const p = (l.picks ?? []).find((x) => (x.remainingQty ?? 0) > 0);
    const from = p?.locations.find((c) => (c.qty ?? 0) > 0)?.locationCode;
    const lot = p?.lotId ?? l.lotId;
    if (!from || !lot) continue;
    return { line: l, lotId: lot, from, left, suggested: p?.suggestedToLocations ?? [] };
  }
  return null;
}
