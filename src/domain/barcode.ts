// 바코드 막대 계산(그리기는 화면이 한다). 외부 라이브러리 없이 표준대로.
// - Code128(코드 집합 B): 위치·카트 라벨 — 값 = 백엔드 위치 코드 그대로(백엔드 deploy/lan/seed/labels 와 같은 값·같은 집합).
// - EAN-13: 상품 바코드(LAN 시험 바코드 299 대역 — 백엔드 22e57579). 검사 숫자가 맞지 않으면 그리지 않는다.
// - GS1-128: LOT 라벨 — (01) GTIN-14 + (17) 소비기한 + (10) LOT 번호(백엔드 mfc-inventory 0.21.0 Gs1.java, 45ad5671).
// 결과는 모듈(가장 가는 막대 폭) 단위의 [검정 시작, 폭] 목록과 전체 모듈 수. 조용한 여백은 넣지 않는다(화면이 둔다).

/**
 * 상품 바코드(EAN-8·UPC-12·EAN-13·GTIN-14, 선행 0 보존) → GTIN-14(앞에 0). 숫자가 아니거나 길이가 다르면 null.
 * 백엔드 Gs1.gtin14 그대로(mfc-inventory 0.21.0, 45ad5671).
 */
export function gtin14(barcode: string): string | null {
  const b = barcode.trim();
  return /^(\d{8}|\d{12,14})$/.test(b) ? '0'.repeat(14 - b.length) + b : null;
}

/**
 * LOT 라벨 GS1-128 사람이 읽는 꼴 `(01)GTIN-14(17)YYMMDD(10)lotNo` — 소비기한 없으면 (17) 생략, GTIN 이 없으면 null(라벨 불가).
 * 백엔드 Gs1.humanReadable·LotLabelService.gtin 그대로: GTIN 은 상품 바코드 중 숫자 8·12·13·14자리 첫 값.
 * 피킹 지시(fulfillment 0.11.0)의 picks[].lotNo·expiresOn 과 작업 지시 줄 barcodes 로 서버 조회 없이 만든다.
 */
export function lotGs1(barcodes: readonly string[], lotNo: string, expiresOn: string | null): string | null {
  const g = barcodes.map(gtin14).find((x): x is string => !!x);
  if (!g || !lotNo) return null;
  const exp = expiresOn && /^\d{4}-\d{2}-\d{2}/.test(expiresOn) ? `(17)${expiresOn.slice(2, 4)}${expiresOn.slice(5, 7)}${expiresOn.slice(8, 10)}` : '';
  return `(01)${g}${exp}(10)${lotNo}`;
}

export interface Bars {
  /** [시작 모듈, 폭 모듈] — 검정 막대만 */
  bars: [number, number][];
  /** 전체 폭(모듈) */
  modules: number;
}

// Code128 막대·공백 폭 패턴(값 0~106). 106 = STOP(13 모듈)
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100; // 집합 C 에서 B 로
const CODE_C = 99; // 집합 B 에서 C 로
const FNC1 = 102;
const STOP = 106;

function fromWidths(patterns: string[]): Bars {
  const bars: [number, number][] = [];
  let x = 0;
  for (const p of patterns) {
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      if (i % 2 === 0) bars.push([x, w]); // 패턴은 막대부터 시작해 막대·공백이 번갈아 온다
      x += w;
    }
  }
  return { bars, modules: x };
}

/** Code128 B. ASCII 32~126 만 받는다(위치 코드는 대문자·숫자·'-'). 그 밖이면 null */
export function code128(value: string): Bars | null {
  if (!value || [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) return null;
  const vals = [START_B, ...[...value].map((c) => c.charCodeAt(0) - 32)];
  const check = vals.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  return fromWidths([...vals, check, STOP].map((v) => C128[v]));
}

/**
 * GS1-128: 괄호 꼴 `(01)…(17)…(10)…` → Code128(시작 C + FNC1, 숫자 둘씩은 집합 C, 그 밖은 집합 B).
 * 가변 길이 (10) 이 끝이라 중간 FNC1(구분자)은 필요 없다(백엔드 Gs1 — 고정 길이 앞, 가변 끝). 틀린 꼴이면 null.
 */
export function gs1_128(hri: string): Bars | null {
  if (!/^(\(\d{2}\)[^()]+)+$/.test(hri)) return null;
  const s = hri.replace(/[()]/g, '');
  if ([...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) return null;
  const isD = (i: number) => i < s.length && s[i] >= '0' && s[i] <= '9';
  const digitRun = (i: number) => {
    let n = 0;
    while (isD(i + n)) n++;
    return n;
  };
  const vals: number[] = [];
  let set: 'B' | 'C';
  if (digitRun(0) >= 2) {
    vals.push(START_C, FNC1);
    set = 'C';
  } else {
    vals.push(START_B, FNC1);
    set = 'B';
  }
  let i = 0;
  while (i < s.length) {
    if (set === 'C') {
      if (isD(i) && isD(i + 1)) {
        vals.push(Number(s.slice(i, i + 2)));
        i += 2;
      } else {
        vals.push(CODE_B);
        set = 'B';
      }
    } else {
      const run = digitRun(i);
      // 숫자 4개 이상(끝까지면 2개 이상)이 짝수로 이어지면 C 로 — 홀수면 한 자리를 B 로 먼저
      if (run >= 4 || (run >= 2 && i + run === s.length)) {
        if (run % 2 === 1) {
          vals.push(s.charCodeAt(i) - 32);
          i++;
        }
        vals.push(CODE_C);
        set = 'C';
      } else {
        vals.push(s.charCodeAt(i) - 32);
        i++;
      }
    }
  }
  const check = vals.reduce((sum, v, k) => sum + v * (k === 0 ? 1 : k), 0) % 103;
  return fromWidths([...vals, check, STOP].map((v) => C128[v]));
}

/** EAN-13 검사 숫자(앞 12자리로) */
export function ean13CheckDigit(first12: string): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (s % 10)) % 10;
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** EAN-13 — 13자리 숫자, 검사 숫자가 맞아야 한다. 아니면 null(틀린 바코드를 그려 찍히게 하지 않는다) */
export function ean13(value: string): Bars | null {
  if (!/^\d{13}$/.test(value) || ean13CheckDigit(value.slice(0, 12)) !== Number(value[12])) return null;
  const d = [...value].map(Number);
  const par = PARITY[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  const bars: [number, number][] = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    const last = bars[bars.length - 1];
    if (last && last[0] + last[1] === i) last[1]++;
    else bars.push([i, 1]);
  }
  return { bars, modules: bits.length };
}
