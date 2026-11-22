import { describe, expect, it } from 'vitest';
import { matchFields, normalize, type SearchField } from '../src/ui/orderSearch';

const fields: SearchField[] = [
  { kind: '주문번호', text: '74939255' },
  { kind: '배송번호', text: 'D74939255-2' }, // ADR-0085 모양
  { kind: '점원', text: '김하나 · E-1023', extra: ['OP-9f3a'] },
  { kind: '라이더', text: 'R4785', extra: ['RD-0007', '김*수'] },
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
  it('라이더 ID·번호(R4785, 대소문자·R 없이)·가린 이름', () => {
    expect(matchFields(fields, 'rd 0007')?.kind).toBe('라이더');
    expect(matchFields(fields, 'r4785')?.kind).toBe('라이더');
    expect(matchFields(fields, '4785')?.kind).toBe('라이더');
    expect(matchFields(fields, '김*수')?.kind).toBe('라이더');
  });
  it('배송 번호 D·순번', () => {
    expect(matchFields(fields, 'd74939255-2')?.kind).toBe('배송번호');
  });
  it('안 맞으면 null', () => {
    expect(matchFields(fields, '박둘')).toBeNull();
  });
  it('normalize', () => {
    expect(normalize(' A-b_c·d ')).toBe('abcd');
  });
});
