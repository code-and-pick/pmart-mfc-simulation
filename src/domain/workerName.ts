// 작업자 짧은 이름 — 3D 머리 위 이름표·패널 목록에 같은 이름을 쓴다.
// 사용자 2026-11-20 "작업자들 식별값이 너무 길어서 … 그 사람만 고르기도 어렵고 … 좀 줄여서 식별가능하게 해라"
// mfcw-pp-01 → 피킹1, mfcw-qc-02 → 검사2, mfcw-rcv-03 → 적치3, OP-…(uuid) → 끝 4자리, 그 밖에 긴 값은 끝 6자리.

const ROLE: Record<string, string> = { pp: '피킹', qc: '검사', rcv: '적치' };

/**
 * 입고 가상 작업자 번호 — 검사(qc)·적치(rcv) 계정을 하나로 "입고N"(사용자 2026-11-20 "입고1이라고 되어있고 그 점원 클릭하면 … 하고 있는 작업이 적치이며 …").
 * 켤 때 비어 있는 가장 작은 번호를 주고(`assignInboundNumbers`), 그 계정이 도는 동안은 바뀌지 않는다.
 */
const inboundNo = new Map<string, number>();
export function assignInboundNumbers(active: readonly string[]): void {
  for (const a of [...inboundNo.keys()]) if (!active.includes(a)) inboundNo.delete(a);
  for (const a of active) {
    if (inboundNo.has(a)) continue;
    const used = new Set(inboundNo.values());
    let n = 1;
    while (used.has(n)) n++;
    inboundNo.set(a, n);
  }
}
export const isInboundAccount = (id: string) => /^mfcw-(mk-)?(qc|rcv)-\d+$/.test(id); // mk- = 2호점 목포(2026-11-22)

export function workerShortName(id: string): string {
  const no = inboundNo.get(id);
  if (no !== undefined) return `입고${no}`;
  const m = /^mfcw-(?:mk-)?([a-z]+)-?0*(\d+)$/.exec(id); // mk- = 2호점 목포 계정(같은 이름 규칙)
  if (m) return `${ROLE[m[1]] ?? m[1].toUpperCase()}${m[2]}`;
  // MOCK 작업자: W04 → 피킹4(피킹·패킹), IB2 → 입고2 — 실서버 이름과 같은 말(사용자 2026-11-21 "목업에는 … 픽업1 이런식으로 안 뜨고 W04 이렇게 떠")
  const mw = /^W0*(\d+)$/.exec(id);
  if (mw) return `피킹${mw[1]}`;
  const mi = /^IB0*(\d+)$/.exec(id);
  if (mi) return `입고${mi[1]}`;
  if (/^OP-[0-9a-f-]{8,}$/i.test(id)) return `OP·${id.replace(/-/g, '').slice(-4)}`;
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}

/** 이름표 바탕색(역할별) — 피킹·포장 파랑, 입고 주황, 그 밖 검정 */
export function workerTagColor(id: string): string {
  if (/^mfcw-(mk-)?pp-/.test(id) || /^W\d+$/.test(id)) return 'rgba(31,99,216,0.9)';
  if (isInboundAccount(id) || /^IB\d+$/.test(id)) return 'rgba(214,110,20,0.92)'; // 입고(검사·적치 한 색)
  return 'rgba(0,0,0,0.7)';
}

/** 패킹 쪽 상태(패킹대 대기·포장·출하대기 랙으로) — 이때 피킹 점원 이름을 "패킹N" 으로 */
const PACK_STATES = new Set(['WAIT_STATION', 'PACKING', 'TO_SHIP']);

/**
 * 지금 하는 일에 맞춘 이름 — 피킹·패킹 겸업 점원(피킹N)이 패킹으로 가면 "패킹N"(사용자 2026-11-22 "피킹점원이 패킹으로 가면 피킹1 이렇게 뜨는 거 패킹1로 바뀌게 해").
 * 번호는 그대로(같은 사람), 다른 역할(입고 등)은 workerShortName 그대로.
 */
export function workerRoleName(id: string, state?: string | null): string {
  const base = workerShortName(id);
  return state && PACK_STATES.has(state) && base.startsWith('피킹') ? `패킹${base.slice(2)}` : base;
}
