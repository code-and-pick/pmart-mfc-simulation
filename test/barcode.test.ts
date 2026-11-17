// 바코드 막대 계산 — Code128 은 백엔드 카트 라벨(있으면)과 막대 위치를 대조한다.
import { describe, expect, it } from 'vitest';
import { BACKEND_FACTS } from '../src/config';
import { code128, ean13, ean13CheckDigit, gs1_128, gtin14, lotGs1, type Bars } from '../src/domain/barcode';

// node 형 선언 없이 쓴다(이 저장소 typecheck 는 브라우저 형만) — 백엔드 저장소가 형제 폴더에 있을 때만 대조
const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as { existsSync(p: URL): boolean; readFileSync(p: URL, enc: 'utf-8'): string };
const CART_LABELS = new URL('../../pmart-backend/deploy/lan/seed/labels/cart-labels-MFC-SEED-01.html', import.meta.url);

describe('바코드', () => {
  it('Code128 B: 폭 = 11×(글자+3)+2 모듈, 막대로 시작하고 끝난다', () => {
    const b = code128('CRT-A-01')!;
    expect(b.modules).toBe(11 * (8 + 3) + 2);
    expect(b.bars[0][0]).toBe(0);
    const last = b.bars[b.bars.length - 1];
    expect(last[0] + last[1]).toBe(b.modules);
    expect(code128('한글')).toBeNull();
  });

  it.runIf(fs.existsSync(CART_LABELS))('Code128: 백엔드 카트 라벨(CRT-A-01 등)과 막대가 같다', () => {
    const html = fs.readFileSync(CART_LABELS, 'utf-8');
    const svgs = [...html.matchAll(/<svg[^>]*>(.*?)<\/svg>[\s\S]*?class="code">([^<]+)</g)];
    // 백엔드 카트 40대(mfc_carts.py, 149e15e1) — 시뮬레이터 카트 목록과 같은 코드
    expect(svgs.map((m) => m[2]).sort()).toEqual(BACKEND_FACTS.cartLocations.map((c) => c.code).sort());
    for (const [, svg, code] of svgs) {
      // 여백·배율은 라벨 판마다 다르다(11-16 판: 여백 30px·1 모듈 3px, 11-17 판: 여백 10·1 모듈 1) — 첫 막대 = 0 모듈, 가장 가는 막대 = 1 모듈
      const raw = [...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const x0 = raw[0][0];
      const unit = Math.min(...raw.map((r) => r[1]));
      expect(code128(code)!.bars).toEqual(raw.map(([x, w]) => [(x - x0) / unit, w / unit]));
    }
  });

  it('LOT 라벨 GS1 괄호 꼴·GTIN-14 — 백엔드 Gs1Test 와 같은 값(inventory 0.21.0)', () => {
    expect(lotGs1(['2990000012345'], 'L261117000001', '2026-12-31')).toBe('(01)02990000012345(17)261231(10)L261117000001');
    expect(lotGs1(['2990000012345'], 'L261117000001', null)).toBe('(01)02990000012345(10)L261117000001');
    expect(lotGs1(['ABC123', '12345678'], 'L1', null)).toBe('(01)00000012345678(10)L1'); // 숫자 바코드 중 첫 값
    expect(lotGs1(['ABC123'], 'L1', null)).toBeNull();
    // LAN 실측(11-17, GET /mfcs/MFC-SEED-01/lot-labels?sku=B-00000463 의 gs1)과 같은 값
    expect(lotGs1(['2991000004632'], 'L261107001548', '2027-06-11')).toBe('(01)02991000004632(17)270611(10)L261107001548');
    expect(gtin14('08801155720019')).toBe('08801155720019');
    expect(gtin14('12345')).toBeNull();
  });

  it('GS1-128 막대를 다시 읽으면 시작 C + FNC1, 검사 값이 맞고 스캐너 원문이 나온다', () => {
    for (const hri of ['(01)02990000012345(17)261231(10)L261117000001', '(01)02990000012345(10)L261117000001', '(01)08801155720019(10)AB12']) {
      const read = decode128(gs1_128(hri)!);
      expect(read.fnc1First).toBe(true);
      expect(read.text).toBe(hri.replace(/[()]/g, '')); // ]C1 뒤 원문 — 가변 (10) 이 끝이라 GS 없음
    }
    expect(gs1_128('0102990000012345')).toBeNull(); // 괄호 꼴만
  });

  it('EAN-13: 검사 숫자, 95 모듈, 틀린 검사 숫자는 그리지 않는다', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931 (표준 예)
    expect(ean13CheckDigit('299100000019')).toBe(1); // 백엔드 CSV B-00000019 → 2991000000191
    const b = ean13('4006381333931')!;
    expect(b.modules).toBe(95);
    expect(b.bars[0]).toEqual([0, 1]); // 시작 가드 101
    expect(ean13('4006381333932')).toBeNull();
    expect(ean13('2990000000011')).toBeNull(); // 백엔드가 말한 예전 17개(검사 숫자가 표준과 다름)
  });
});

// 시험용 Code128 읽기 — 막대 폭을 값으로 되돌려 검사 값을 확인하고 집합 B·C 를 풀어 글자로
const C128_READ = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
function decode128(b: Bars): { text: string; fnc1First: boolean } {
  const w: number[] = [];
  let x = 0;
  for (const [s, len] of b.bars) {
    if (s > x) w.push(s - x);
    w.push(len);
    x = s + len;
  }
  const vals: number[] = [];
  for (let i = 0; i + 6 <= w.length - 7; i += 6) vals.push(C128_READ.indexOf(w.slice(i, i + 6).join('')));
  expect(w.slice(-7).join('')).toBe('2331112'); // STOP
  const check = vals.pop()!;
  expect(vals.reduce((s, v, k) => s + v * (k === 0 ? 1 : k), 0) % 103).toBe(check);
  let set = vals[0] === 105 ? 'C' : 'B';
  let text = '';
  const fnc1First = vals[1] === 102;
  for (const v of vals.slice(2)) {
    if (set === 'C' && v === 100) set = 'B';
    else if (set === 'B' && v === 99) set = 'C';
    else text += set === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
  }
  return { text, fnc1First };
}
