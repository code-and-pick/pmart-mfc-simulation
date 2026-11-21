import { describe, expect, it } from 'vitest';
import { placeShortName } from '../src/domain/placeName';

describe('placeShortName', () => {
  it('선반 밖 자리 코드를 짧은 이름으로', () => {
    expect(placeShortName('CRT-A-01')).toBe('장바구니1');
    expect(placeShortName('RCV-A-01')).toBe('입고칸1');
    expect(placeShortName('PAK-C-01')).toBe('냉장 포장대1');
    expect(placeShortName('RCV-DOCK')).toBe('하차장');
    expect(placeShortName('A-C1-01-1-01')).toBe('A-C1-01-1-01');
    expect(placeShortName('A-R1-03-1-01')).toBe('입고창고 팔레트3');
    expect(placeShortName('C-R1-01-1-01')).toBe('냉장 보충재고1');
    expect(placeShortName('F-R1-12-1-01')).toBe('냉동 보충재고12');
  });
});
