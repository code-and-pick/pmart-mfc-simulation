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
  // 보충재고 랙 칸 {A|C|F}-R1-NN-단-칸 → "냉장 보충재고 랙 01 · 1단 1칸"(상온은 "입고창고 보충재고 랙 …")
  const rr = /^([ACF])-R1-(\d{2})-(\d)-0*(\d+)$/.exec(code);
  if (rr) return `${rr[1] === 'A' ? '입고창고 ' : TEMP[rr[1]]}보충재고 랙 ${rr[2]} · ${rr[3]}단 ${rr[4]}칸`;
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

/** 대형 묶음 바닥 팔레트 칸(`A-R2-NN-1-01`, 상온 입고창고 문 쪽, R-33 정정) — 보충재고 랙 칸(`{T}-R1-NN-단-칸`)은 선반처럼 따로 다룬다 */
export const RESERVE_CODE = /^A-R2-(\d+)-1-01$/;

/** 대형 묶음 팔레트 칸 → 팔레트 번호(평면·번호판과 같은 이름): A-R2-03-1-01 → WB-03. 아니면 null
 *  (사용자 2026-11-21 "팔레트에는 렉처럼 식별값WR-16이 붙어있어야") */
export function reserveName(code: string): string | null {
  const m = RESERVE_CODE.exec(code);
  return m ? `WB-${String(Number(m[1])).padStart(2, '0')}` : null;
}

/** 대형 묶음 팔레트 칸이 있는 곳 */
export function reservePlace(code: string): string | null {
  return RESERVE_CODE.test(code) ? '입고창고 대형 묶음' : null;
}
