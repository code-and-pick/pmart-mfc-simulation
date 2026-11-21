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
  const r = reserveName(code);
  if (r) return `${reservePlace(code)} ${r}`;
  const m = /^([A-Z]{3})-([ACF])(?:-0*(\d+))?$/.exec(code);
  if (!m || !PLACE[m[1]]) return code;
  return `${TEMP[m[2]]}${PLACE[m[1]]}${m[3] ?? ''}`;
}

/** 재고 작업 상태 짧은 말 — 복귀 대기(취소된 주문에서 이미 집은 상품 → 선반에 다시 진열할 것) → 재진열 대기(사용자 2026-11-20 "되돌릴 것 이름 바꿔"), 미적치 → 적치 전 */
export const WORK_SHORT: Record<string, string> = {
  STORED: '보관',
  PICKED: '집품',
  PACKED: '포장',
  CANCEL_RETURN_PENDING: '재진열 대기',
  UNSTOWED: '적치 전',
};

/** 보충재고 팔레트 칸(`{A|C|F}-R1-NN-1-01`, mfc-location 0.9.0 reserveStock) — 상온은 입고창고 바닥, 냉장·냉동은 저온실 안 */
export const RESERVE_CODE = /^([ACF])-R1-(\d+)-1-01$/;

/** 보충재고 칸 → 팔레트 번호(평면·번호판과 같은 이름): A-R1-16-1-01 → WR-16(입고창고), C-R1-01-1-01 → BR-1(냉장), F-R1-01-1-01 → AR-1(냉동).
 *  번호는 온도대별 평면 순서(locationCodes.ts 대응과 같음). 보충재고 칸이 아니면 null
 *  (사용자 2026-11-21 "팔레트에는 렉처럼 식별값WR-16이 붙어있어야") */
export function reserveName(code: string): string | null {
  const m = RESERVE_CODE.exec(code);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === 'A' ? `WR-${String(n).padStart(2, '0')}` : `${m[1] === 'C' ? 'BR' : 'AR'}-${n}`;
}

/** 보충재고 칸이 있는 곳 — 입고창고 팔레트·냉장 보충재고·냉동 보충재고 */
export function reservePlace(code: string): string | null {
  const m = RESERVE_CODE.exec(code);
  return !m ? null : m[1] === 'A' ? '입고창고 팔레트' : m[1] === 'C' ? '냉장 보충재고' : '냉동 보충재고';
}
