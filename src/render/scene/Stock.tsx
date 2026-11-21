// 재고 표현: 선반 위 상품(칸 수량만큼 보임)과 보충재고 팔레트(박스 더미).
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { RACK_DEPTH } from '../../domain/layout';
import { SCENE, zoneBoxColor } from '../colors';
import { boxTexture, makePillSprite, palletTexture } from '../sprites';

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

const CARTONS_PER_RESERVE = 96;

/** 팔레트 번호판 자리 — 팔레트 가운데에서 꺼내는 쪽(stand)으로 0.62 m, 높이 0.3 m */
function plateAt(r: { rect: { x0: number; z0: number; x1: number; z1: number }; stand: { x: number; z: number } }): [number, number, number] {
  const cx = (r.rect.x0 + r.rect.x1) / 2;
  const cz = (r.rect.z0 + r.rect.z1) / 2;
  const dx = r.stand.x - cx;
  const dz = r.stand.z - cz;
  const n = Math.hypot(dx, dz) || 1;
  return [cx + (dx / n) * 0.62, 0.3, cz + (dz / n) * 0.62];
}

/** 보충재고 팔레트: 나무 받침 + 박스 더미(보충재고 수량만큼 쌓임). */
export function Reserves() {
  const { sim } = useApp();
  const L = sim.layout;
  const base = useRef<THREE.InstancedMesh>(null!);
  const cartons = useRef<THREE.InstancedMesh>(null!);
  const plates = useMemo(() => L.reserves.map((r) => makePillSprite(r.id, '#1f63d8', '#3d8bff', 15)), [L]);

  useLayoutEffect(() => {
    const mtx = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color();
    L.reserves.forEach((r, i) => {
      mtx.makeTranslation((r.rect.x0 + r.rect.x1) / 2, 0.07, (r.rect.z0 + r.rect.z1) / 2);
      base.current.setMatrixAt(i, mtx);
      for (let j = 0; j < CARTONS_PER_RESERVE; j++) {
        cartons.current.setColorAt(i * CARTONS_PER_RESERVE + j, (r.temp === 'AMBIENT' ? col.setHex(0xffffff) : zoneBoxColor(r.temp, col)).offsetHSL(0, 0, ((j * 7) % 5) / 60));
        cartons.current.setMatrixAt(i * CARTONS_PER_RESERVE + j, zero);
      }
    });
    base.current.instanceMatrix.needsUpdate = true;
    base.current.computeBoundingSphere();
  }, [L]);

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
    L.reserves.forEach((r, i) => {
      const units = totals.get(r.id) ?? 0;
      const n = Math.min(CARTONS_PER_RESERVE, Math.ceil(units / 8)); // 박스 1개 ≈ 8유닛 [시뮬]
      const cx = (r.rect.x0 + r.rect.x1) / 2;
      const cz = (r.rect.z0 + r.rect.z1) / 2;
      for (let j = 0; j < CARTONS_PER_RESERVE; j++) {
        if (j < n) {
          const layer = Math.floor(j / 16);
          const gx = j % 4;
          const gz = Math.floor((j % 16) / 4);
          mtx.makeTranslation(cx + (gx - 1.5) * 0.265, 0.14 + 0.11 + layer * 0.225, cz + (gz - 1.5) * 0.265);
        } else mtx.makeScale(0, 0, 0);
        cartons.current.setMatrixAt(i * CARTONS_PER_RESERVE + j, mtx);
      }
    });
    cartons.current.instanceMatrix.needsUpdate = true;
    if (cartons.current.instanceColor) cartons.current.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={base} args={[undefined, undefined, L.reserves.length]} receiveShadow>
        <boxGeometry args={[1.1, 0.14, 1.1]} />
        {/* 그림처럼 밝은 나무 팔레트(사용자 2026-11-20 "입고구역 UI도 똑같이") */}
        <meshStandardMaterial color={0xd9b98a} roughness={0.85} map={palletTexture()} />
      </instancedMesh>
      {/* 팔레트 번호판(WR-16·BR-1·AR-1) — 랙 번호판처럼 파란 판, 꺼내는 통로 쪽 팔레트 앞(사용자 2026-11-21 "팔레트에는 렉처럼 식별값WR-16이 붙어있어야") */}
      {L.reserves.map((r, i) => (
        <primitive key={r.id} object={plates[i]} position={plateAt(r)} />
      ))}
      <instancedMesh ref={cartons} args={[undefined, undefined, L.reserves.length * CARTONS_PER_RESERVE]} castShadow frustumCulled={false}>
        <boxGeometry args={[0.255, 0.22, 0.255]} />
        <meshStandardMaterial roughness={0.8} map={boxTexture()} />
      </instancedMesh>
    </>
  );
}
