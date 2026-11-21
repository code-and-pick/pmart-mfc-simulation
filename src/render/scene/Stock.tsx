// 재고 표현: 선반 위 상품(칸 수량만큼 보임)과 보충재고 팔레트(박스 더미).
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { RACK_DEPTH } from '../../domain/layout';
import { SCENE, ZONE_FLOOR, zoneBoxColor } from '../colors';
import { boxTexture, palletTexture } from '../sprites';
import { Label } from './Facility';

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
        <Label key={r.id} text={r.role === 'BULK' ? `대형 묶음 ${r.id}` : `입고재고 ${r.id}`} position={[(r.rect.x0 + r.rect.x1) / 2, 2.0, (r.rect.z0 + r.rect.z1) / 2]} opts={{ size: 40, bg: 'rgba(255,255,255,0.96)', color: '#24304f', screenPx: 18 }} noNudge />
      ))}
      <instancedMesh ref={cartons} args={[undefined, undefined, Math.max(1, L.reserveRackSpots.length * cellMax)]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.8} map={boxTexture()} />
      </instancedMesh>
    </>
  );
}

/** 바닥 글자 판(눕힌 글) — 보충재고·입고재고 구역 표시용, 격리 이름표와 같은 남색 글 */
function floorText(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const S = 64;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const f = `900 ${S}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  g.font = f;
  c.width = Math.ceil(g.measureText(text).width + S);
  c.height = Math.ceil(S * 1.5);
  g.font = f;
  g.fillStyle = '#44528a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}

/**
 * 보충재고 랙·입고재고 팔레트 구역 바닥 — 격리 구역과 같은 바닥색 + 흰 실선 + 바닥 글.
 * (사용자 2026-11-21 "보충재고랑 바로 픽업하는 적재구역 랙이 구분이 안 가 바닥에 표시라도 해둬"
 *  → "냉동격리랑 보충재고랑 입고재고가 다 앞쪽 벽에 붙어있으니까 그냥 다 바닥색 냉동격리 바닥색으로 통일하고 냉동격리처럼 하얀실선으로")
 */
// 보관 구역 판(화면 전용) — 격리 구역과 같은 바닥색·흰 실선. 한 판 안에서 실선 한 줄로 나눈다
// (사용자 2026-11-21 "이따구로 구역나눠놓는게 맞아?" → "여기 그냥 공간 합치고 실선 한 줄로 구분하게 하자").
// 저온: 격리 | 보충재고 | 입고재고 — 판 왼쪽 선이 격리 오른쪽 선과 같은 자리(격리 끝 −0.12)라 한 줄로 보인다, 위·아래 선도 격리와 같은 z.
// 상온 입고창고: 창고 전체를 한 판으로(바깥 선은 창고 구역 선), 뒤 입고재고 | 보충재고 랙 | 문 쪽 대형 묶음 을 가로 선으로.
type Seg = [x0: number, z0: number, x1: number, z1: number];
const LINE_W = 0.1;
const coldArea = (q0: number, rcvCx: number) => {
  // q0 = 격리 구역 x1. 판 선 = q0 − 0.12 ~ L1, z 26.72 ~ 29.68(격리 선과 같음).
  // 입고재고 칸은 팔레트 가운데(rcvCx = 서버 입고칸 x)에 맞춰 폭 1.7 m — 사용자 2026-11-21 "입고재고 팔레트가 왜 중앙에 있지않고 왼쪽으로 치우쳐져있니"
  const L0 = q0 - 0.12, div = rcvCx - 0.85, L1 = rcvCx + 0.85, T = 26.72, B = 29.68;
  return {
    floor: [L0, 26.6, L1 + 0.12, 29.8] as Seg,
    lines: [[L0, T, L1, T], [L0, B, L1, B], [L0, T, L0, B], [L1, T, L1, B], [div, T, div, B]] as Seg[],
    texts: [
      { t: '보충재고', x: (L0 + div) / 2, z: 26.1 },
      { t: '입고재고', x: (div + L1) / 2, z: 26.1 },
    ],
  };
};
const STORE_AREAS = [
  coldArea(3.8, 9.95), // 냉동: 격리 x 0.2~3.8 → 보충재고 랙(~x 8.5) → 입고재고 팔레트 AR-3·4(x 9.4~10.5, RCV-F-01)
  coldArea(16, 21.55), // 냉장: 격리 x 12.4~16 → 보충재고 랙(~x 20.5) → 입고재고 팔레트 BR-3·4(x 21.0~22.1, RCV-C-01)
  {
    floor: [37.2, 0, 48, 16.5] as Seg,
    lines: [[37.32, 2.55, 47.88, 2.55], [37.32, 9.25, 47.88, 9.25]] as Seg[],
    texts: [
      { t: '입고재고', x: 38.25, z: 1.05 },
      { t: '보충재고', x: 39.3, z: 8.62 },
      { t: '대형 묶음', x: 41.0, z: 12.4 },
    ],
  },
];

/**
 * 보충재고 랙·입고재고 팔레트·대형 묶음 구역 바닥 — 격리 구역과 같은 바닥색 + 흰 실선 + 바닥 글.
 * (사용자 2026-11-21 "보충재고랑 바로 픽업하는 적재구역 랙이 구분이 안 가 바닥에 표시라도 해둬"
 *  → "냉동격리랑 보충재고랑 입고재고가 다 앞쪽 벽에 붙어있으니까 그냥 다 바닥색 냉동격리 바닥색으로 통일하고 냉동격리처럼 하얀실선으로")
 */
export function ReserveFloors() {
  const texts = useMemo(() => new Map(['보충재고', '입고재고', '대형 묶음'].map((t) => [t, floorText(t)])), []);
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
              const th = 0.42;
              return (
                <mesh key={t.t} rotation={[-Math.PI / 2, 0, 0]} position={[t.x, 0.012, t.z]} renderOrder={4} raycast={() => null}>
                  <planeGeometry args={[th * tx.aspect, th]} />
                  <meshBasicMaterial map={tx.tex} transparent depthWrite={false} toneMapped={false} />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </>
  );
}
