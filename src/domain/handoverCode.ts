// 라이더 번호 인계 — QR 이 안 찍힐 때 포장 라벨 번호를 입력해 픽업(사용자 2026-11-20, 백엔드 요청 R-26).
// 백엔드 회신(PR #260, fulfillment 0.23.0): 4자리 고정, 센터에서 쓰는 포장끼리 겹치지 않음. 입력은 4자리 또는 옛 6자리.
// 자리 늘림(minLen < maxLen)은 함수에 남겨 두지만 설정은 4~4.

export interface HandoverCodeRule {
  minLen: number;
  maxLen: number;
  /** 배포 전 포장 번호 자리(입력에서 받아 줌) */
  legacyLen?: number;
  /** 한 자리 수에서 이만큼(0~1) 넘게 쓰이면 다음 자리로 */
  maxFill: number;
}

/** 입력 형식 — minLen~maxLen 자리 숫자, 또는 옛 legacyLen 자리(서버 pattern `^([0-9]{4}|[0-9]{6})$`) */
export function handoverCodeValid(code: string, rule: HandoverCodeRule): boolean {
  if (rule.legacyLen && new RegExp(`^[0-9]{${rule.legacyLen}}$`).test(code)) return true;
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
