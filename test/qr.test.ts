// QR 계산 — 표준 문서·공개 예제의 값으로 대조(이 PC 에 QR 판독기가 없어 실제 읽기는 휴대폰으로 확인).
import { describe, expect, it } from 'vitest';
import { formatBits, qrEncode, rsDivisor, rsRemainder } from '../src/domain/qr';

describe('QR', () => {
  it('리드-솔로몬: "HELLO WORLD" 1-M 데이터 16바이트 → 오류 정정 10바이트(공개 예제 값)', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('형식 정보: 오류 정정 M 의 마스크별 15비트(표준 표)', () => {
    const table = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
    table.forEach((s, m) => expect(formatBits(m)).toBe(parseInt(s, 2)));
  });

  it('위치 코드(14자)는 버전 1(21×21), 찾기 무늬·타이밍·어두운 모듈 자리가 표준대로', () => {
    const q = qrEncode('A-C1-05-1-04')!;
    expect(q.version).toBe(1);
    expect(q.size).toBe(21);
    // 찾기 무늬 테두리·가운데
    for (const [x, y] of [[0, 0], [6, 0], [0, 6], [3, 3], [14, 0], [20, 6], [0, 14], [6, 20]]) expect(q.dark[y][x]).toBe(true);
    for (const [x, y] of [[1, 1], [7, 7], [13, 7], [7, 13], [5, 1]]) expect(q.dark[y][x]).toBe(false);
    // 타이밍(6행·6열 짝수 칸 검정)
    for (let i = 8; i <= 12; i++) expect(q.dark[6][i]).toBe(i % 2 === 0);
    expect(q.dark[q.size - 8][8]).toBe(true); // 어두운 모듈
  });

  it('긴 값은 버전이 올라가고(정렬 무늬), 너무 길면 null', () => {
    const q = qrEncode('ORD-ac1fb73b-812a-352f-9aed-09a516b1c70e-S1')!;
    expect(q.version).toBeGreaterThanOrEqual(3);
    const c = q.size - 7; // 정렬 무늬 가운데
    expect(q.dark[c][c]).toBe(true);
    expect(q.dark[c][c + 1]).toBe(false);
    expect(qrEncode('x'.repeat(200))).toBeNull();
  });
});
