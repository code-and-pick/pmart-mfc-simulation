// 밝은 도면풍 장식(사용자 2026-11-20 참고 그림 — "바닥 통로 화살표·점선", "라이더 대기 주차 칸·볼라드·스쿠터", "작업 중 칸 보라 빛 + 작은 카드").
// 업무 규칙·통행(navgrid)에는 관여하지 않는다 — 그림만. 통로 선은 배치(layout.ts) 의 빈 띠를 따라 손으로 둔 것.
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import type { Layout, Location } from '../../domain/layout';
import { SCENE } from '../colors';

/** 통로 가운데 선(점선 + 화살표). [x0, z0, x1, z1] — 배치의 빈 띠(벽 사이)에서 */
function walkways(L: Layout): [number, number, number, number][] {
  const W = L.width;
  return [
    [1.2, 31.05, W - 1.2, 31.05], // 남쪽 큰 통로(냉동·냉장 문 → 패킹·출하)
    [24.05, 16.2, 24.05, 30.2], // 냉장 벽 ↔ 패킹실
    [36.05, 16.2, 36.05, 30.2], // 패킹실 ↔ 입고 쪽 벽
  ];
}

export function Walkways() {
  const { sim } = useApp();
  const L = sim.layout;
  const dashes = useRef<THREE.InstancedMesh>(null!);
  const arrows = useRef<THREE.InstancedMesh>(null!);
  const { segs, heads } = useMemo(() => {
    const segs: { x: number; z: number; len: number; alongX: boolean }[] = [];
    const heads: { x: number; z: number; rot: number }[] = [];
    for (const [x0, z0, x1, z1] of walkways(L)) {
      const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      for (let a = a0; a < a1; a += 0.9) {
        const len = Math.min(0.5, a1 - a);
        segs.push(alongX ? { x: a + len / 2, z: z0, len, alongX } : { x: x0, z: a + len / 2, len, alongX });
      }
      for (let a = a0 + 2.2; a < a1 - 1; a += 5.4) heads.push(alongX ? { x: a, z: z0 + 0.45, rot: 0 } : { x: x0 + 0.45, z: a, rot: Math.PI / 2 });
    }
    return { segs, heads };
  }, [L]);
  const tri = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0.28, 0);
    s.lineTo(-0.18, 0.2);
    s.lineTo(-0.08, 0);
    s.lineTo(-0.18, -0.2);
    s.closePath();
    return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    segs.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, 0.014, s.z), q, s.alongX ? new THREE.Vector3(s.len, 0.004, 0.08) : new THREE.Vector3(0.08, 0.004, s.len));
      dashes.current.setMatrixAt(i, m);
    });
    heads.forEach((h, i) => {
      m.compose(new THREE.Vector3(h.x, 0.016, h.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -h.rot), new THREE.Vector3(1, 1, 1));
      arrows.current.setMatrixAt(i, m);
    });
    for (const x of [dashes.current, arrows.current]) {
      x.instanceMatrix.needsUpdate = true;
      x.computeBoundingSphere();
    }
  }, [segs, heads]);
  return (
    <>
      <instancedMesh ref={dashes} args={[undefined, undefined, segs.length]} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={SCENE.walkway} />
      </instancedMesh>
      <instancedMesh ref={arrows} args={[tri, undefined, heads.length]} raycast={() => null}>
        <meshBasicMaterial color={SCENE.walkway} side={THREE.DoubleSide} />
      </instancedMesh>
    </>
  );
}

/** 대기 중 스쿠터(장식) — 흰 몸통·보라 배달통 */
function Scooter() {
  return (
    <group>
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.32, 0.22, 1.05]} />
        <meshStandardMaterial color={0xf3f4f8} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.62, 0.12]} castShadow>
        <boxGeometry args={[0.28, 0.08, 0.45]} />
        <meshStandardMaterial color={0x2b2f3a} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.82, 0.38]} castShadow>
        <boxGeometry args={[0.42, 0.38, 0.4]} />
        <meshStandardMaterial color={0x7c5cf0} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.85, -0.45]} castShadow>
        <boxGeometry args={[0.5, 0.05, 0.05]} />
        <meshStandardMaterial color={0x2b2f3a} />
      </mesh>
      {[-0.42, 0.42].map((z) => (
        <mesh key={z} position={[0, 0.2, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.2, 0.2, 0.1, 16]} />
          <meshStandardMaterial color={0x1f2229} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/** 볼라드(노랑·검정 띠) */
function Bollard({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, 0.12 + i * 0.22, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.09, 0.22, 12]} />
          <meshStandardMaterial color={i % 2 ? 0x1f2229 : 0xf5c518} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 라이더 대기 — 주차 칸 흰 선(라이더가 서는 riderParking 자리마다), 앞쪽 볼라드, 비어 있는 칸에는 대기 스쿠터(장식).
 * 라이더가 그 칸에 오면 장식 스쿠터는 숨는다(라이더 자기 수단이 그려짐).
 */
export function ParkingDecor() {
  const { sim } = useApp();
  const L = sim.layout;
  const bays = L.points.riderParking;
  const park = L.zones.find((z) => z.kind === 'PARKING')?.rect;
  const ship = L.zones.find((z) => z.kind === 'SHIPPING')?.rect;
  const scooters = useRef<THREE.Group[]>([]);
  useFrame(() => {
    const taken = new Set(sim.riders.map((r) => `${r.parking.x.toFixed(2)},${r.parking.z.toFixed(2)}`));
    bays.forEach((b, i) => {
      const g = scooters.current[i];
      // 짝수 칸에만 장식(빽빽하지 않게), 라이더가 쓰는 칸은 숨김
      if (g) g.visible = i % 3 === 1 && !taken.has(`${b.x.toFixed(2)},${b.z.toFixed(2)}`);
    });
  });
  const lines = useMemo(() => {
    const out: { x: number; z: number; sx: number; sz: number }[] = [];
    const half = 0.6;
    for (const b of bays) {
      out.push({ x: b.x - half, z: b.z, sx: 0.06, sz: 2.0 });
    }
    if (bays.length) {
      const last = bays[bays.length - 1];
      out.push({ x: last.x + half, z: last.z, sx: 0.06, sz: 2.0 });
      out.push({ x: (bays[0].x + last.x) / 2, z: bays[0].z + 1.0, sx: last.x - bays[0].x + 2 * half, sz: 0.06 });
    }
    return out;
  }, [bays]);
  return (
    <>
      {lines.map((l, i) => (
        <mesh key={i} position={[l.x, 0.015, l.z]}>
          <boxGeometry args={[l.sx, 0.004, l.sz]} />
          <meshBasicMaterial color={0xffffff} />
        </mesh>
      ))}
      {bays.map((b, i) => (
        <group
          key={i}
          position={[b.x, 0, b.z]}
          ref={(g) => {
            if (g) scooters.current[i] = g;
          }}
        >
          <Scooter />
        </group>
      ))}
      {park && [park.x0 + 0.3, park.x1 - 0.3].map((x) => <Bollard key={`p${x}`} x={x} z={park.z0 + 0.3} />)}
      {ship && [ship.x0 - 0.3, ship.x1 + 0.3].map((x) => <Bollard key={`s${x}`} x={x} z={ship.z1 + 0.2} />)}
    </>
  );
}

/** 칸 카드(보라 테두리 흰 판) — 칸 코드 + 상태 줄 */
function makeCard(code: string, line: string): THREE.Sprite {
  const S = 44;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const fA = `800 ${S}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const fB = `600 ${Math.round(S * 0.72)}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.font = fA;
  const wA = ctx.measureText(code).width;
  ctx.font = fB;
  const wB = ctx.measureText(line).width;
  c.width = Math.ceil(Math.max(wA, wB) + S * 1.2);
  c.height = Math.ceil(S * 2.9);
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(3, 3, c.width - 6, c.height - 6, S * 0.35);
  ctx.fill();
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.font = fA;
  ctx.fillStyle = '#1e1b4b';
  ctx.fillText(code, S * 0.6, S * 0.95);
  ctx.font = fB;
  ctx.fillStyle = '#6d28d9';
  ctx.fillText(line, S * 0.6, S * 2.0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, sizeAttenuation: false }));
  const sh = 34 / (2.414 * 475);
  sp.scale.set((sh * c.width) / c.height, sh, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 14;
  return sp;
}

/**
 * 작업 중 칸 — 피킹 중인 작업자의 지금 칸을 보라 빛 상자로 감싸고 위에 작은 카드(칸 코드 · 피킹 중 · 작업자).
 * 정보는 화면에 이미 있는 것(작업자 지금 칸·이름)만 — 서버 값을 새로 읽지 않는다.
 */
export function WorkingCells() {
  const { sim } = useApp();
  const glow = useRef<THREE.InstancedMesh>(null!);
  const cards = useRef(new Map<string, { sprite: THREE.Sprite; key: string }>());
  const group = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    const m = glow.current;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    const live = new Set<string>();
    for (const w of sim.siteWorkers()) {
      const loc: Location | null = w.currentTarget;
      if (!loc || w.state !== 'PICKING' || n >= 32) continue;
      const [sx, sz] = loc.along === 'x' ? [loc.slotW * 0.96, 0.62] : [0.62, loc.slotW * 0.96];
      mtx.compose(new THREE.Vector3(loc.shelf.x, loc.shelf.y + loc.levelH * 0.45, loc.shelf.z), q, new THREE.Vector3(sx, loc.levelH * 0.92, sz));
      m.setMatrixAt(n++, mtx);
      // 카드
      const name = sim.board?.workerName((w as { workerId?: string }).workerId ?? '') ?? w.id;
      const who = !name || name === '작업자 확인 중' || name === '미배정' ? w.id : name.split(' · ')[0];
      const key = `${loc.code}|${who}`;
      live.add(w.id);
      let c = cards.current.get(w.id);
      if (!c || c.key !== key) {
        if (c) {
          group.current.remove(c.sprite);
          c.sprite.material.map?.dispose();
          c.sprite.material.dispose();
        }
        c = { sprite: makeCard(loc.code, `피킹 중 · ${who}`), key };
        cards.current.set(w.id, c);
        group.current.add(c.sprite);
      }
      c.sprite.position.set(loc.shelf.x, loc.shelf.y + loc.levelH + 0.15, loc.shelf.z);
    }
    for (const [id, c] of cards.current) {
      if (live.has(id)) continue;
      group.current.remove(c.sprite);
      c.sprite.material.map?.dispose();
      c.sprite.material.dispose();
      cards.current.delete(id);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    (m.material as THREE.MeshBasicMaterial).opacity = 0.32 + 0.12 * Math.sin(clock.elapsedTime * 3);
  });
  return (
    <>
      <instancedMesh ref={glow} args={[undefined, undefined, 32]} count={0} frustumCulled={false} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={SCENE.working} transparent opacity={0.35} depthWrite={false} />
      </instancedMesh>
      <group ref={group} />
    </>
  );
}
