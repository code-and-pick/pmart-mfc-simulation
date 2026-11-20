import { describe, expect, it } from 'vitest';
import { matchFields, normalize, type SearchField } from '../src/ui/orderSearch';

const fields: SearchField[] = [
  { kind: '주문번호', text: '74939255' },
  { kind: '배송번호', text: '74939255-1' },
  { kind: '점원', text: '김하나 · E-1023', extra: ['OP-9f3a'] },
  { kind: '라이더', text: 'RD-0007' },
  { kind: '시스템 ID', text: 'SHP-01JABCDEF', extra: ['FUL-01JXYZ'] },
];

describe('주문 검색', () => {
  it('빈 입력은 거르지 않는다', () => {
    expect(matchFields(fields, '   ')).toBeUndefined();
  });
  it('주문번호 일부', () => {
    expect(matchFields(fields, '9392')?.kind).toBe('주문번호');
  });
  it('점원 이름·사번(하이픈·대소문자 무시)·운영자 ID', () => {
    expect(matchFields(fields, '김하나')?.kind).toBe('점원');
    expect(matchFields(fields, 'e1023')?.kind).toBe('점원');
    expect(matchFields(fields, 'op-9F3A')?.kind).toBe('점원');
  });
  it('라이더 ID', () => {
    expect(matchFields(fields, 'rd 0007')?.kind).toBe('라이더');
  });
  it('안 맞으면 null', () => {
    expect(matchFields(fields, '박둘')).toBeNull();
  });
  it('normalize', () => {
    expect(normalize(' A-b_c·d ')).toBe('abcd');
  });
});
