// 2호점 목포 MFC(MFC-MOKPO-01) 평면 — 1호점 평면(buildLayout)에서 시작해 목포만 다르게 고친 것(2026-11-24).
// 사용자 "목포점에도 상온F랙을 제일 남쪽으로 빼고 나머지를 뒤로 밀어 그리고 목포랑 세종에 인계랙 입구 가리니까 옆으로 각각 밀자".
// 칸 코드·피킹 순서(locations 순서)는 1호점과 그대로 두고 자리만 바꾼다(서버 목포 칸은 1호점 코드 그대로, 재고가 있음).
//  - 상온 피킹 랙: 고회전 F(패킹 쪽)를 가장 남쪽 줄들로, 나머지(C·D·E·G·H)는 원래 남→북 순서 그대로 그 뒤(북쪽)로 민다.
//  - 인계 랙 2: 출하문 앞을 비우게 돌출부 서·동 벽 쪽으로.

import { RACK_LEN, SHIP_BUMP, rackLocations, type Layout, type Location } from './layout';

export function applyMokpo(L: Layout): Layout {
  // ── 상온 F 를 가장 남쪽으로 ─────────────────────────────
  const amb = L.racks.filter((r) => !r.reserve && r.temp === 'AMBIENT');
  const slotKey = (r: { cx: number; cz: number }) => `${r.cx.toFixed(3)},${r.cz.toFixed(3)}`;
  // 자리(남쪽 줄부터, 줄 안 서쪽부터) — 각 자리는 원래 그 자리의 피킹 면을 가진다
  const slots = amb.map((r) => ({ cx: r.cx, cz: r.cz, face: r.face })).sort((a, b) => b.cz - a.cz || a.cx - b.cx);
  const bySlot = new Map(amb.map((r) => [slotKey(r), r]));
  const ordered = slots.map((s) => bySlot.get(slotKey(s))!); // 원래 자리 순서(남 → 북)
  const moving = [...ordered.filter((r) => r.group[0] === 'F'), ...ordered.filter((r) => r.group[0] !== 'F')];
  moving.forEach((r, k) => Object.assign(r, { cx: slots[k].cx, cz: slots[k].cz, face: slots[k].face }));
  // 칸 다시(같은 식 — 코드·치수 그대로), 순서는 그대로 바꿔 끼움
  const fresh = new Map<string, Location>();
  for (const r of amb) for (const l of rackLocations(r)) fresh.set(l.code, l);
  const swap = (arr: Location[]) => arr.forEach((l, i) => fresh.has(l.code) && (arr[i] = fresh.get(l.code)!));
  swap(L.locations);
  swap(L.locationsByTemp.AMBIENT);

  // ── 인계 랙 2 를 돌출부 서·동 벽 쪽으로 ───────────────────
  const xs = [SHIP_BUMP.x0 + 0.15 + RACK_LEN / 2, SHIP_BUMP.x1 - 0.15 - RACK_LEN / 2];
  const ship = L.obstacles.filter((o) => o.kind === 'SHIP_RACK').sort((a, b) => a.rect.x0 - b.rect.x0);
  ship.forEach((o, i) => {
    const dx = xs[i] - (o.rect.x0 + o.rect.x1) / 2;
    o.rect = { ...o.rect, x0: o.rect.x0 + dx, x1: o.rect.x1 + dx };
    for (const s of L.shippingSlots) if (s.rackIndex === i) s.pos = { ...s.pos, x: s.pos.x + dx };
  });
  return L;
}
