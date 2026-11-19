// 라이더 번호 인계 — QR 이 안 찍힐 때 포장 라벨의 짧은 번호(2~4자리)를 입력해 픽업(사용자 2026-11-20, 백엔드 요청 R-26).
// 번호는 센터에서 지금 인계를 기다리는(SEALED) 포장끼리 겹치지 않게, 가장 짧은 자리로. 그 자리의 번호가 maxFill 만큼 차면 한 자리 늘린다.
// 서버(F-8)는 아직 6자리 — 이 규칙은 MOCK 이 흉내 내는 제안 값이다(config HANDOVER_CODE [시뮬]).

export interface HandoverCodeRule {
  minLen: number;
  maxLen: number;
  /** 한 자리 수에서 이만큼(0~1) 넘게 쓰이면 다음 자리로 */
  maxFill: number;
}

/** 입력 형식(minLen~maxLen 자리 숫자) */
export function handoverCodeValid(code: string, rule: HandoverCodeRule): boolean {
  return new RegExp(`^[0-9]{${rule.minLen},${rule.maxLen}}$`).test(code);
}

/** 겹치지 않는 가장 짧은 번호. 다 찼으면 null(QR 만) */
export function shortHandoverCode(taken: ReadonlySet<string>, rand: () => number, rule: HandoverCodeRule): string | null {
  for (let len = rule.minLen; len <= rule.maxLen; len++) {
    const space = 10 ** len;
    let used = 0;
    for (const c of taken) if (c.length === len) used++;
    if (used >= space * rule.maxFill && len < rule.maxLen) continue;
    // 무작위로 몇 번, 안 되면 처음부터 빈 번호
    for (let i = 0; i < 40; i++) {
      const c = String(Math.floor(rand() * space)).padStart(len, '0');
      if (!taken.has(c)) return c;
    }
    for (let n = 0; n < space; n++) {
      const c = String(n).padStart(len, '0');
      if (!taken.has(c)) return c;
    }
  }
  return null;
}
