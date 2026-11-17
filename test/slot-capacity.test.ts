// 칸 용량 — 백엔드 mfc-inventory UnitSize.capacity 와 같은 식(2026-11-16 6423db75)
import { describe, expect, it } from 'vitest';
import { slotCapacity } from '../src/domain/catalog';
import { buildLayout } from '../src/domain/layout';

describe('칸 용량(백엔드 UnitSize 식)', () => {
  it('floor(칸 부피 × 0.8 ÷ 상품 부피), 어느 방향으로도 안 들어가면 0', () => {
    const cell = { w: 125, d: 450, h: 350 }; // 상온 C 칸
    expect(slotCapacity(cell, { w: 60, d: 60, h: 110 }, 0.8)).toBe(Math.floor((125 * 450 * 350 * 0.8) / (60 * 60 * 110)));
    expect(slotCapacity(cell, { w: 300, d: 100, h: 100 }, 0.8)).toBeGreaterThan(0); // 돌려 놓으면 들어감
    expect(slotCapacity(cell, { w: 810, d: 420, h: 118 }, 0.8)).toBe(0); // 화장지 30롤 — 안 들어감
  });

  it('칸 치수는 백엔드 LAN 등록값(실서버 표본)과 같다', () => {
    const L = buildLayout();
    const by = (g: string) => L.locations.find((l) => l.code.startsWith(g))!.dimMm;
    expect(by('A01')).toEqual({ w: 188, d: 450, h: 420 });
    expect(by('B01')).toEqual({ w: 161, d: 450, h: 420 });
    expect(by('C01')).toEqual({ w: 125, d: 450, h: 350 });
    expect(by('D01')).toEqual({ w: 112, d: 450, h: 350 });
    expect(by('E01')).toEqual({ w: 141, d: 450, h: 350 });
    expect(by('H01')).toEqual({ w: 225, d: 450, h: 420 });
  });
});
