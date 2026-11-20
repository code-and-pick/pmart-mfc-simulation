// 작업자 짧은 이름 — 3D 머리 위 이름표·패널 목록에 같은 이름을 쓴다.
// 사용자 2026-11-20 "작업자들 식별값이 너무 길어서 … 그 사람만 고르기도 어렵고 … 좀 줄여서 식별가능하게 해라"
// mfcw-pp-01 → 피킹1, mfcw-qc-02 → 검사2, mfcw-rcv-03 → 적치3, OP-…(uuid) → 끝 4자리, 그 밖에 긴 값은 끝 6자리.

const ROLE: Record<string, string> = { pp: '피킹', qc: '검사', rcv: '적치' };

export function workerShortName(id: string): string {
  const m = /^mfcw-([a-z]+)-?0*(\d+)$/.exec(id);
  if (m) return `${ROLE[m[1]] ?? m[1].toUpperCase()}${m[2]}`;
  if (/^OP-[0-9a-f-]{8,}$/i.test(id)) return `OP·${id.replace(/-/g, '').slice(-4)}`;
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}

/** 이름표 바탕색(역할별) — 피킹 파랑, 검사 초록, 적치 주황, 그 밖 검정 */
export function workerTagColor(id: string): string {
  if (/^mfcw-pp-/.test(id)) return 'rgba(31,99,216,0.9)';
  if (/^mfcw-qc-/.test(id)) return 'rgba(22,128,72,0.9)';
  if (/^mfcw-rcv-/.test(id)) return 'rgba(214,110,20,0.92)';
  return 'rgba(0,0,0,0.7)';
}
