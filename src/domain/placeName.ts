// 선반 밖 자리 코드 → 짧은 우리말 이름, 재고 작업 상태 → 짧은 말. 3D 이름표·패널이 같은 말을 쓴다.
// 사용자 2026-11-20 "CRT-A-01 복귀 대기 10 이런 어렵고 긴 식별값 관리자 사이트엔 직관적으로 볼 수 있게 줄이라고 했지"

const PLACE: Record<string, string> = {
  CRT: '장바구니',
  RCV: '입고칸',
  PAK: '포장대',
  DSP: '인계 랙',
  RTN: '회수칸',
  QRT: '격리칸',
};
const TEMP: Record<string, string> = { A: '', C: '냉장 ', F: '냉동 ' };

/** CRT-A-01 → 장바구니1, PAK-C-01 → 냉장 포장대1, RCV-DOCK → 하차장. 모르는 코드는 그대로 */
export function placeShortName(code: string): string {
  if (code === 'RCV-DOCK') return '하차장';
  const m = /^([A-Z]{3})-([ACF])(?:-0*(\d+))?$/.exec(code);
  if (!m || !PLACE[m[1]]) return code;
  return `${TEMP[m[2]]}${PLACE[m[1]]}${m[3] ?? ''}`;
}

/** 재고 작업 상태 짧은 말 — 복귀 대기(취소 주문 상품, 선반으로 되돌릴 것) → 되돌릴 것, 미적치 → 적치 전 */
export const WORK_SHORT: Record<string, string> = {
  STORED: '보관',
  PICKED: '집품',
  PACKED: '포장',
  CANCEL_RETURN_PENDING: '되돌릴 것',
  UNSTOWED: '적치 전',
};
