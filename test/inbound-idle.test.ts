// 입고 작업자 대기 자리는 그 지점 입고·검수 구역(RECEIVING) 안, 걸을 수 있는 곳, 입고재고 자리까지 걸어갈 수 있다
// (사용자 2026-11-24 "세종에 입고 작업자가 입고 검수구역에 있어야지 왜 상온 입고창고구역에 있냐")
import { describe, expect, it } from 'vitest';
import { buildLayout, type Layout } from '../src/domain/layout';
import { buildSejongLayout } from '../src/domain/layoutSejong';
import { buildChuncheonLayout } from '../src/domain/layoutChuncheon';
import { buildBusanNamguLayout } from '../src/domain/layoutBusanNamgu';
import { buildBusanjinLayout } from '../src/domain/layoutBusanjin';
import { applyMokpo } from '../src/domain/layoutMokpo';
import { NavGrid } from '../src/domain/navgrid';

const SITES: [string, () => Layout][] = [
  ['부산진구', buildBusanjinLayout],
  ['목포', () => applyMokpo(buildLayout())],
  ['세종', buildSejongLayout],
  ['춘천', buildChuncheonLayout],
  ['부산남구', buildBusanNamguLayout],
];

describe('입고 작업자 대기 자리', () => {
  for (const [name, build] of SITES) {
    it(`${name}: 입고·검수 구역 안, 걸을 수 있고 입고재고 자리로 간다`, () => {
      const L = build();
      const rcv = L.zones.filter((z) => z.kind === 'RECEIVING').map((z) => z.rect);
      const inside = (p: { x: number; z: number }) => rcv.some((r) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1);
      const nav = new NavGrid(L);
      const to = L.reserves.find((r) => r.role === 'RECEIVING')?.stand ?? L.points.truckDoor;
      const bad = L.points.inboundIdle.filter((p) => !inside(p) || !nav.isFreeAt(p) || !nav.findPath(p, to));
      expect(bad).toEqual([]);
    });
  }
});
