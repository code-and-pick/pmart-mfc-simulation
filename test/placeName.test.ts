import { describe, expect, it } from 'vitest';
import { placeShortName } from '../src/domain/placeName';

describe('placeShortName', () => {
  it('선반 밖 자리 코드를 짧은 이름으로', () => {
    expect(placeShortName('CRT-A-01')).toBe('장바구니1');
    expect(placeShortName('RCV-A-01')).toBe('입고칸1');
    expect(placeShortName('PAK-C-01')).toBe('냉장 포장대1');
    expect(placeShortName('RCV-DOCK')).toBe('하차장');
    expect(placeShortName('A-C1-01-1-01')).toBe('A-C1-01-1-01');
    // 보충재고 랙 칸(R1)·대형 묶음 바닥 팔레트(R2) — R-33
    expect(placeShortName('A-R1-03-1-01')).toBe('입고창고 보충재고 랙 03 · 1단 1칸');
    expect(placeShortName('C-R1-01-2-03')).toBe('냉장 보충재고 랙 01 · 2단 3칸');
    expect(placeShortName('F-R1-12-5-01')).toBe('냉동 보충재고 랙 12 · 5단 1칸');
    expect(placeShortName('A-R2-07-1-01')).toBe('입고창고 대형 묶음 WB-07');
  });
});
