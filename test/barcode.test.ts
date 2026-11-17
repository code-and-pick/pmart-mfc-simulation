// 바코드 막대 계산 — Code128 은 백엔드 카트 라벨(있으면)과 막대 위치를 대조한다.
import { describe, expect, it } from 'vitest';
import { BACKEND_FACTS } from '../src/config';
import { code128, ean13, ean13CheckDigit } from '../src/domain/barcode';

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
