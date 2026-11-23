// 2호점 목포 MFC(MFC-MOKPO-01) 평면 — 1호점 평면(buildLayout)에서 시작해 목포만 다르게 고친 것(2026-11-24).
// 사용자 "목포점에도 상온F랙을 제일 남쪽으로 빼고 나머지를 뒤로 밀어 그리고 목포랑 세종에 인계랙 입구 가리니까 옆으로 각각 밀자".
// 칸 코드·피킹 순서(locations 순서)는 1호점과 그대로 두고 자리만 바꾼다(서버 목포 칸은 1호점 코드 그대로, 재고가 있음).
//  - 상온 피킹 랙: 고회전 F(패킹 쪽)를 가장 남쪽 줄들로, 나머지(C·D·E·G·H)는 원래 남→북 순서 그대로 그 뒤(북쪽)로 민다.
//  - 인계 랙 2: 출하문 앞을 비우게 돌출부 서·동 벽 쪽으로.

import { RACK_LEN, SHIP_BUMP, rackLocations, type Layout, type Location } from './layout';

export function applyMokpo(L: Layout): Layout {
  // ── 상온 F 를 가장 남쪽으로 ─────────────────────────────
  const amb = L.racks.filter((r) => !r.reserve && r.temp === 'AMBIENT');
  // 자리(남쪽 줄부터, 줄 안 서쪽부터) — 각 자리는 원래 그 자리의 피킹 면을 가진다
  let slots = amb.map((r) => ({ cx: r.cx, cz: r.cz, face: r.face })).sort((a, b) => b.cz - a.cz || a.cx - b.cx);
  // 1호점 맨 남쪽 등 맞댄 쌍은 남쪽 줄이 2랙뿐이고 8랙 줄은 북쪽을 본다 → 8랙 줄을 남쪽(패킹 쪽을 봄)으로, 2랙을 북쪽 줄로 바꿔
  // 맨 앞 F 줄 번호판이 패킹 쪽에서 보이게(사용자 2026-11-24 "맨앞줄 F랙 식별값이 북쪽에 붙어있어서 바로 앞에서 안 보여")
  {
    const zs = [...new Set(slots.map((s) => s.cz))].sort((a, b) => b - a);
    const [south, north] = zs;
    const sRow = slots.filter((s) => s.cz === south);
    const nRow = slots.filter((s) => s.cz === north);
    if (sRow.length < nRow.length) {
      const sFace = sRow[0].face;
      const nFace = nRow[0].face;
      const swapped = [...nRow.map((s) => ({ cx: s.cx, cz: south, face: sFace })), ...sRow.map((s) => ({ cx: s.cx, cz: north, face: nFace }))];
      slots = [...swapped, ...slots.filter((s) => s.cz !== south && s.cz !== north)].sort((a, b) => b.cz - a.cz || a.cx - b.cx);
    }
  }
  const ordered = [...amb].sort((a, b) => b.cz - a.cz || a.cx - b.cx); // 원래 자리 순서(남 → 북)
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
