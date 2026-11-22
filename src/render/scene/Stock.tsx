// 재고 표현: 선반 위 상품(칸 수량만큼 보임)과 보충재고 팔레트(박스 더미).
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { COLD_BAND, RACK_DEPTH } from '../../domain/layout';
import { SCENE, ZONE_FLOOR, zoneBoxColor } from '../colors';
import { boxTexture, palletTexture } from '../sprites';
import { Label } from './Facility';
import { makePill } from './ZoneNames';

/** 선반 위 상품: SKU 마다 칸 한도만큼 인스턴스를 만들어 두고 수량만큼 보인다 (뒤→앞 순으로 채워 앞에서부터 빠진다). */
export function Goods() {
  const { sim, registry } = useApp();
  const catalog = sim.catalog;
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const total = useMemo(() => catalog.reduce((a, s) => a + s.shelfCap, 0), [catalog]);
  const layout = useMemo(() => {
    const goodsSku = new Int32Array(total); // 인스턴스 → 카탈로그 index
    const goodsStart = new Int32Array(catalog.length); // 카탈로그 index → 첫 인스턴스
    const goodsPos = new Float32Array(total * 3); // 인스턴스별 위치(x,y,z)
    const colors: THREE.Color[] = [];
    let k = 0;
    catalog.forEach((s, ci) => {
      goodsStart[ci] = k;
      const loc = s.location;
      const u = s.unit;
      const cols = Math.max(1, Math.floor(loc.slotW / (u.w + 0.012)));
      const rows = Math.max(1, Math.floor(0.4 / (u.d + 0.012)));
      const layers = Math.max(1, Math.min(2, Math.floor((loc.levelH - 0.05) / (u.h + 0.01))));
      // 랙 중심선 = 칸 중심에서 face 반대쪽으로 DEPTH/4
      const along = loc.along;
      const face = loc.face;
      const rackCross = (along === 'z' ? loc.shelf.x : loc.shelf.z) - (face * RACK_DEPTH) / 4;
      const alongC = along === 'z' ? loc.shelf.z : loc.shelf.x;
      const baseY = loc.shelf.y - 0.035;
      // 갈색 골판지 상자(사용자 2026-11-20 "파란 랙 + 재고만큼 상자") — 상품마다 밝기·채도만 조금 다르게
      const col = zoneBoxColor(loc.temp)
        .offsetHSL(((ci * 13) % 7) / 200 - 0.015, -0.08 + ((ci * 7) % 5) / 40, -0.08 + ((ci * 11) % 6) / 30);
      let placed = 0;
      for (let r = 0; r < rows && placed < s.shelfCap; r++) {
        for (let l = 0; l < layers && placed < s.shelfCap; l++) {
          for (let c = 0; c < cols && placed < s.shelfCap; c++) {
            const a = alongC + (c - (cols - 1) / 2) * (u.w + 0.012);
            const depth = -0.2 + u.d / 2 + r * (u.d + 0.012); // 뒤(-) → 앞(+, 통로 쪽)
            const cross = rackCross + face * depth;
            const y = baseY + u.h / 2 + l * (u.h + 0.01);
            const x = along === 'z' ? cross : a;
            const z = along === 'z' ? a : cross;
            goodsPos.set([x, y, z], k * 3);
            goodsSku[k] = ci;
            colors[k] = col;
            k++;
            placed++;
          }
        }
      }
      // 칸 계산이 한도보다 적게 나오면 남는 인스턴스는 숨긴 채 둔다
      while (placed < s.shelfCap) {
        goodsSku[k] = ci;
        k++;
        placed++;
      }
    });
    return { goodsSku, goodsStart, goodsPos, colors };
  }, [catalog, total]);
  const shown = useRef(new Int16Array(catalog.length).fill(-1)); // 카탈로그 index → 보이는 개수
  const skuIndex = useMemo(() => new Map(catalog.map((s, i) => [s.sku, i])), [catalog]);

  useLayoutEffect(() => {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    // 실서버 모드: 시뮬레이터 가짜 상품은 "수량 모름" — 회색으로 흐리게(실제 재고처럼 보이지 않게)
    const unknown = sim.mock ? null : new THREE.Color(SCENE.boxUnknown);
    for (let k = 0; k < total; k++) {
      if (unknown) mesh.current.setColorAt(k, unknown);
      else if (layout.colors[k]) mesh.current.setColorAt(k, layout.colors[k]);
      mesh.current.setMatrixAt(k, zero);
    }
    shown.current.fill(-1);
  }, [layout, total, sim]);

  useEffect(() => {
    registry.goods = { mesh: mesh.current, skuAt: (i) => catalog[layout.goodsSku[i]].sku };
    return () => {
      registry.goods = null;
    };
  }, [registry, catalog, layout]);

  const first = useRef(true);
  const realVer = useRef(-1);
  /** 실서버 재고를 한 번이라도 받은 칸(시뮬레이터 코드) — 다 집혀 0 이 돼도 가짜 상품으로 되돌리지 않는다 */
  const realSlots = useRef(new Set<string>());
  useFrame(() => {
    const force = first.current;
    first.current = false;
    const inv = sim.mock?.inventory;
    const m = mesh.current;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let changed = false;
    const update = (ci: number, qty: number) => {
      const s = catalog[ci];
      const start = layout.goodsStart[ci];
      const n = Math.max(0, Math.min(s.shelfCap, qty));
      if (!force && shown.current[ci] === n) return;
      shown.current[ci] = n;
      for (let i = 0; i < s.shelfCap; i++) {
        const k = start + i;
        if (i < n) {
          v.set(layout.goodsPos[k * 3], layout.goodsPos[k * 3 + 1], layout.goodsPos[k * 3 + 2]);
          sc.set(s.location.along === 'z' ? s.unit.d : s.unit.w, s.unit.h, s.location.along === 'z' ? s.unit.w : s.unit.d);
          mtx.compose(v, q, sc);
        } else mtx.makeScale(0, 0, 0);
        m.setMatrixAt(k, mtx);
      }
      changed = true;
    };
    if (!inv) {
      // 실서버 모드: 실제 재고를 읽은 칸은 비우고(RealStock 이 실제 수량을 그림), 나머지는 수량 모름(회색 절반)
      const real = sim.real;
      const ver = real?.stockVersion ?? 0;
      if (force || ver !== realVer.current) {
        realVer.current = ver;
        for (const u of real?.stockUnits() ?? []) {
          const c = sim.codes.toSim(u.locationCode);
          if (c) realSlots.current.add(c);
        }
        // 센터 전체 재고를 읽었으면 모든 칸을 안다(빈 칸은 진짜 빈 칸) — 회색 "수량 모름" 상자를 모두 치운다
        const all = (real?.fullStockVersion ?? 0) > 0;
        catalog.forEach((s, ci) => update(ci, all || realSlots.current.has(s.location.code) ? 0 : Math.ceil(s.shelfCap / 2)));
      }
    } else if (force) {
      catalog.forEach((s, ci) => update(ci, inv.get(s.sku)?.shelf ?? 0));
      inv.dirty.clear();
    } else if (inv.dirty.size) {
      for (const sku of inv.dirty) {
        const ci = skuIndex.get(sku);
        if (ci !== undefined) update(ci, inv.get(sku)?.shelf ?? 0);
      }
      inv.dirty.clear();
    }
    if (changed) {
      m.instanceMatrix.needsUpdate = true;
      if (force) {
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.computeBoundingSphere(); // 클릭 판정용. 칸 위치는 고정이라 처음 한 번이면 된다
      }
    }
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, total]} receiveShadow frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.7} map={boxTexture()} />
    </instancedMesh>
  );
}

/** MOCK 보충재고 상자 1개 ≈ 8유닛 [시뮬] — 보충재고 랙 칸마다 상자 1개까지 */
const UNITS_PER_CARTON = 8;

/** 입고재고 팔레트(나무 받침·회색 바닥) + MOCK 보충재고(보충재고 랙 칸 위 상자, 보충재고 수량만큼). 실서버 보충재고는 Real 이 랙 칸에 그린다 */
export function Reserves() {
  const { sim } = useApp();
  const L = sim.layout;
  const base = useRef<THREE.InstancedMesh>(null!);
  const cartons = useRef<THREE.InstancedMesh>(null!);
  // MOCK 보충재고 자리(랙)마다 그 랙의 칸(아래 단부터)
  const rackCells = useMemo(
    () => L.reserveRackSpots.map((sp) => L.locations.filter((l) => l.rackId === sp.id).sort((a, b) => a.level - b.level || a.slot - b.slot)),
    [L],
  );
  const cellMax = Math.max(1, ...rackCells.map((c) => c.length));

  useLayoutEffect(() => {
    const mtx = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color();
    L.reserves.forEach((r, i) => {
      mtx.makeTranslation((r.rect.x0 + r.rect.x1) / 2, 0.07, (r.rect.z0 + r.rect.z1) / 2);
      base.current.setMatrixAt(i, mtx);
    });
    base.current.instanceMatrix.needsUpdate = true;
    base.current.computeBoundingSphere();
    L.reserveRackSpots.forEach((r, i) => {
      for (let j = 0; j < cellMax; j++) {
        cartons.current.setColorAt(i * cellMax + j, (r.temp === 'AMBIENT' ? col.setHex(0xffffff) : zoneBoxColor(r.temp, col)).offsetHSL(0, 0, ((j * 7) % 5) / 60));
        cartons.current.setMatrixAt(i * cellMax + j, zero);
      }
    });
  }, [L, cellMax]);

  const timer = useRef(0);
  useFrame((_, dt) => {
    timer.current -= dt;
    if (timer.current > 0) return;
    timer.current = 0.4;
    const inv = sim.mock?.inventory;
    if (!inv) return;
    const totals = new Map<string, number>();
    for (const s of sim.catalog) {
      const r = inv.get(s.sku)?.reserve ?? 0;
      if (r > 0) totals.set(s.reserveId, (totals.get(s.reserveId) ?? 0) + r);
    }
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    L.reserveRackSpots.forEach((r, i) => {
      const cells = rackCells[i];
      const n = Math.min(cells.length, Math.ceil((totals.get(r.id) ?? 0) / UNITS_PER_CARTON));
      for (let j = 0; j < cellMax; j++) {
        const c = cells[j];
        if (c && j < n) {
          const h = Math.min(0.3, c.levelH - 0.08);
          const w = c.slotW * 0.85;
          sc.set(c.along === 'z' ? RACK_DEPTH * 0.8 : w, h, c.along === 'z' ? w : RACK_DEPTH * 0.8);
          mtx.compose(new THREE.Vector3(c.along === 'z' ? c.shelf.x - (c.face * RACK_DEPTH) / 4 : c.shelf.x, c.shelf.y - 0.035 + h / 2, c.along === 'z' ? c.shelf.z : c.shelf.z - (c.face * RACK_DEPTH) / 4), q, sc);
        } else mtx.makeScale(0, 0, 0);
        cartons.current.setMatrixAt(i * cellMax + j, mtx);
      }
    });
    cartons.current.instanceMatrix.needsUpdate = true;
    if (cartons.current.instanceColor) cartons.current.instanceColor.needsUpdate = true;
  });

  return (
    <>
      {/* 입고재고 자리 바닥은 ReserveFloors(격리 구역과 같은 바닥·흰 실선) */}
      <instancedMesh ref={base} args={[undefined, undefined, L.reserves.length]} receiveShadow>
        <boxGeometry args={[1.1, 0.14, 1.1]} />
        {/* 그림처럼 밝은 나무 팔레트(사용자 2026-11-20 "입고구역 UI도 똑같이") */}
        <meshStandardMaterial color={0xd9b98a} roughness={0.85} map={palletTexture()} />
      </instancedMesh>
      {/* 입고재고 팔레트 이름표 — 예전 흰 이름표 그대로(사용자 2026-11-21 "저번처럼 그냥 하양으로 해주고 크기도 전처럼"), MOCK 만 — 실서버는 Real 이 상자 더미 바로 위에 번호·수량 */}
      {sim.mode !== 'http' && L.reserves.map((r) => (
        <Label key={r.id} text={r.role === 'BULK' ? `대형재고 ${r.id}` : `입고재고 ${r.id}`} position={[(r.rect.x0 + r.rect.x1) / 2, 2.0, (r.rect.z0 + r.rect.z1) / 2]} opts={{ size: 40, bg: 'rgba(255,255,255,0.96)', color: '#24304f', screenPx: 18 }} noNudge />
      ))}
      <instancedMesh ref={cartons} args={[undefined, undefined, Math.max(1, L.reserveRackSpots.length * cellMax)]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.8} map={boxTexture()} />
      </instancedMesh>
    </>
  );
}

/** 구역 이름 카드 — 격리 구역 카드와 같은 둥근 판(사용자 2026-11-21 "대형재고, 입고재고, 보충재고라는 말 너무 작아서 안 보이니까 상온 격리 카드처럼 UI 변경해") */
const CARD_H = 0.7; // 격리 카드(0.55)보다 조금 크게 [시뮬]
function floorText(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  return makePill(text, null, null, SCENE.pillDim, '#44528a');
}

// 보관 구역 판(화면 전용) — 격리 구역과 같은 바닥색·흰 실선. 한 판 안에서 실선 한 줄로 나눈다
// (사용자 2026-11-21 "이따구로 구역나눠놓는게 맞아?" → "여기 그냥 공간 합치고 실선 한 줄로 구분하게 하자").
// 저온: 격리 | 보충재고 | 입고재고 — 판 왼쪽 선이 격리 오른쪽 선과 같은 자리(격리 끝 −0.12)라 한 줄로 보인다, 위·아래 선도 격리와 같은 z.
// 상온 입고창고: 창고 전체를 한 판으로(바깥 선은 창고 구역 선), 뒤 입고재고 | 보충재고 랙 | 문 쪽 대형 묶음 을 가로 선으로.
type Seg = [x0: number, z0: number, x1: number, z1: number];
const LINE_W = 0.1;
// 냉동·냉장: 서쪽 벽 띠(COLD_BAND) 하나 — 남쪽부터 격리 | 입고재고 | 보충재고, 가로 실선으로 나눔. 띠 바깥 선은 격리 선과 같은 자리(띠 끝 ± 0.12)
// (사용자 2026-11-21 "왼쪽 벽면으로 다 옮겨 버려" → "냉장냉동에서 옮겼으면 바닥 표시도 옮겨야지")
const coldArea = (X0: number) => {
  const X1 = X0 + COLD_BAND.mark;
  // 북쪽부터 입고재고 | 보충재고 | 격리(격리 구역 선이 보충재고와의 경계) — 띠가 북쪽 끝으로(사용자 2026-11-21 "북쪽으로 밀어")
  const L0 = X0 + 0.12, L1 = X1 - 0.12, T = COLD_BAND.z0 + 0.12, B = COLD_BAND.z1 - 0.12, DIV = 5.3;
  return {
    floor: [X0, COLD_BAND.z0, X1, COLD_BAND.z1] as Seg,
    lines: [[L0, T, L1, T], [L0, B, L1, B], [L0, T, L0, B], [L1, T, L1, B], [L0, DIV, L1, DIV]] as Seg[],
    texts: [
      { t: '입고재고', x: (X0 + X1) / 2, z: 4.8 }, // 띠가 좁아져(2.2 m) 카드는 세로 팔레트 2개 바로 남쪽에
      { t: '보충재고', x: X0 + 1.35, z: 13.1 }, // 서쪽 벽 한 줄 랙(z 5.6~20.6) 앞 통로 가운데
    ],
  };
};
const STORE_AREAS = [
  coldArea(COLD_BAND.FROZEN), // 냉동 서쪽 벽 띠
  coldArea(COLD_BAND.CHILLED), // 냉장 서쪽 벽 띠
  {
    // 상온 입고창고: 안쪽 대형 묶음(+지게차 가로 통로) | 입고재고 | 문 쪽 보충재고. 서쪽 세로 지게차 통로 x 37.3~40.3
    // 2026-11-21 재배치: 입고창고 x +1.0, z +5.6
    floor: [39.4, 3.55, 49.0, 22.1] as Seg, // 2026-11-22 서쪽 벽 x 39.3, 북쪽 z 3.55 로
    lines: [[39.52, 8.75, 48.88, 8.75], [39.52, 11.53, 48.88, 11.53]] as Seg[], // 대형재고 z 3.55~8.75 | 입고재고 ~11.53 | 보충재고 (2026-11-22 대형재고 줄이고 입고재고 늘림) // 입고재고|보충재고 선도 벽 끝까지(사용자 2026-11-21 "하얀 실선 끝까지 그어서 분리해")
    texts: [
      // 세 카드 모두 서쪽 세로 통로 가운데 x 38.8 한 줄에(사용자 2026-11-21 "대형재고 입고재고 위치를 보충 재고랑 일직선 상에 되게 맞춰"),
      // z 는 각 구역 높이: 대형재고 = 앞 가로 통로, 입고재고 = 팔레트 줄, 보충재고 = 랙 가운데쯤.
      // 이름: "대형묶음이 아니라 대형재고라고 적어", 세로 통로 글 "지게차 통로라는 말을 없애고 거기에 보충재고라고 적고"
      { t: '대형재고', x: 40.5, z: 8.0 },
      { t: '입고재고', x: 40.5, z: 10.14 },
      { t: '보충재고', x: 40.5, z: 15.7 },
    ],
  },
];

/**
 * 보충재고 랙·입고재고 팔레트·대형 묶음 구역 바닥 — 격리 구역과 같은 바닥색 + 흰 실선 + 바닥 글.
 * (사용자 2026-11-21 "보충재고랑 바로 픽업하는 적재구역 랙이 구분이 안 가 바닥에 표시라도 해둬"
 *  → "냉동격리랑 보충재고랑 입고재고가 다 앞쪽 벽에 붙어있으니까 그냥 다 바닥색 냉동격리 바닥색으로 통일하고 냉동격리처럼 하얀실선으로")
 */
export function ReserveFloors() {
  const texts = useMemo(() => new Map(['보충재고', '입고재고', '대형재고'].map((t) => [t, floorText(t)])), []);
  return (
    <>
      {STORE_AREAS.map((a, k) => {
        const [fx0, fz0, fx1, fz1] = a.floor;
        return (
          <group key={k}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(fx0 + fx1) / 2, 0.0065, (fz0 + fz1) / 2]} receiveShadow raycast={() => null}>
              <planeGeometry args={[fx1 - fx0, fz1 - fz0]} />
              <meshStandardMaterial color={ZONE_FLOOR.QUARANTINE} roughness={0.95} />
            </mesh>
            {a.lines.map(([x0, z0, x1, z1], i) => (
              <mesh key={i} position={[(x0 + x1) / 2, 0.013, (z0 + z1) / 2]} raycast={() => null}>
                <boxGeometry args={[Math.abs(x1 - x0) + LINE_W, 0.004, Math.abs(z1 - z0) + LINE_W]} />
                <meshBasicMaterial color={0xffffff} />
              </mesh>
            ))}
            {a.texts.map((t) => {
              const tx = texts.get(t.t)!;
              const th = CARD_H;
              return (
                <mesh key={t.t} rotation={[-Math.PI / 2, 0, 0]} position={[t.x, 0.03, t.z]} renderOrder={5} raycast={() => null} userData={{ declutterBlock: true }}>
                  <planeGeometry args={[th * tx.aspect, th]} />
                  <meshBasicMaterial map={tx.tex} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </>
  );
}
