// 밝은 도면풍 장식(사용자 2026-11-20 참고 그림 — "바닥 통로 화살표·점선", "라이더 대기 주차 칸·볼라드·스쿠터", "작업 중 칸 보라 빛 + 작은 카드").
// 업무 규칙·통행(navgrid)에는 관여하지 않는다 — 그림만. 통로 선은 배치(layout.ts) 의 빈 띠를 따라 손으로 둔 것.
import { VehicleModel } from './Agents';
import { workerShortName, workerTagColor } from '../../domain/workerName';
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

/** 대기 중 스쿠터(장식) — 라이더 스쿠터와 같은 모델(사용자 2026-11-20 "오토바이 자동차가 못생겼어") */
const noHinge = { current: null };
function Scooter() {
  return <VehicleModel v="MOTORCYCLE" door={noHinge} lid={noHinge} />;
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

/**
 * 피킹 중 칸 카드 — 한 줄: [작업자 짧은 이름(역할색)] 칸 코드(굵게). 작게, 글자는 굵고 크게
 * (사용자 2026-11-20 "정보는 짧고굵게 잘보이는데 팝업창은 작게"). 전엔 두 줄(칸 코드 + "피킹 중 · 이름") 34px.
 */
function makeCard(code: string, who: string): THREE.Sprite {
  const S = 44;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const f = `900 ${S}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.font = f;
  const name = workerShortName(who);
  const wN = ctx.measureText(name).width;
  const wC = ctx.measureText(code).width;
  const pad = S * 0.32;
  const chipW = wN + pad * 2;
  c.width = Math.ceil(chipW + wC + pad * 3);
  c.height = Math.ceil(S * 1.45);
  const r = c.height / 2 - 3;
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(3, 3, c.width - 6, c.height - 6, r);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = workerTagColor(who).replace(/rgba\(0,0,0,[0-9.]+\)/, '#6d28d9');
  ctx.beginPath();
  ctx.roundRect(7, 7, chipW, c.height - 14, r - 4);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.font = f;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 7 + pad, c.height / 2 + 2);
  ctx.fillStyle = '#1e1b4b';
  ctx.fillText(code, 7 + chipW + pad, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, sizeAttenuation: false }));
  // 화면 높이 18px(한 줄)
  const sh = 18 / (2.414 * 475);
  sp.scale.set((sh * c.width) / c.height, sh, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 14;
  sp.userData.prio = 4;
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
  useFrame(({ clock, camera }) => {
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
      // 가상 작업자(mfcw-…)는 짧은 이름, 실제 PDA 작업자는 현황판 이름 첫 토막
      const bn = w.id.startsWith('mfcw-') ? null : sim.board?.workerName((w as { workerId?: string }).workerId ?? '');
      const who = bn && bn !== '작업자 확인 중' && bn !== '미배정' ? bn.split(' · ')[0] : w.id;
      const key = `${loc.code}|${who}`;
      live.add(w.id);
      let c = cards.current.get(w.id);
      if (!c || c.key !== key) {
        if (c) {
          group.current.remove(c.sprite);
          c.sprite.material.map?.dispose();
          c.sprite.material.dispose();
        }
        c = { sprite: makeCard(loc.code, who), key };
        cards.current.set(w.id, c);
        group.current.add(c.sprite);
      }
      c.sprite.position.set(loc.shelf.x, loc.shelf.y + loc.levelH + 0.15, loc.shelf.z);
      // 멀어지면 작게(화면 고정 크기라 축소하면 혼자 커 보였다 — 사용자 2026-11-20 "화면 축소하니까 혼자 커져있네"). 25 m 안은 그대로, 멀수록 줄여 최소 40%
      const base = (c.sprite.userData.baseScale as THREE.Vector2 | undefined) ?? (c.sprite.userData.baseScale = new THREE.Vector2(c.sprite.scale.x, c.sprite.scale.y));
      const k = Math.max(0.4, Math.min(1, 25 / Math.max(1, camera.position.distanceTo(c.sprite.position))));
      c.sprite.scale.set(base.x * k, base.y * k, 1);
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

/** 지게차(장식, 사용자 2026-11-20 참고 그림 "입고구역 UI도 똑같이") — 노란 몸통·검정 마스트·포크. 통행·작업과 무관 */
function Forklift({ x, z, rot }: { x: number; z: number; rot: number }) {
  const Y = 0xf5c518;
  const K = 0x2b2f3a;
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.9, 0.55, 1.3]} />
        <meshStandardMaterial color={Y} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.5, -0.55]} castShadow>
        <boxGeometry args={[0.92, 0.6, 0.35]} />
        <meshStandardMaterial color={K} roughness={0.6} />
      </mesh>
      {/* 지붕 틀 */}
      {[-0.38, 0.38].flatMap((sx) =>
        [-0.35, 0.3].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx, 1.2, sz]} castShadow>
            <boxGeometry args={[0.05, 0.95, 0.05]} />
            <meshStandardMaterial color={K} />
          </mesh>
        )),
      )}
      <mesh position={[0, 1.68, -0.02]} castShadow>
        <boxGeometry args={[0.85, 0.05, 0.8]} />
        <meshStandardMaterial color={K} />
      </mesh>
      {/* 마스트 + 포크 */}
      {[-0.25, 0.25].map((sx) => (
        <mesh key={sx} position={[sx, 1.0, 0.72]} castShadow>
          <boxGeometry args={[0.07, 1.9, 0.07]} />
          <meshStandardMaterial color={K} />
        </mesh>
      ))}
      {[-0.2, 0.2].map((sx) => (
        <mesh key={`f${sx}`} position={[sx, 0.08, 1.15]} castShadow>
          <boxGeometry args={[0.1, 0.04, 0.8]} />
          <meshStandardMaterial color={0x6b7280} metalness={0.4} />
        </mesh>
      ))}
      {[-0.4, 0.4].flatMap((sx) =>
        [-0.4, 0.45].map((sz) => (
          <mesh key={`w${sx}${sz}`} position={[sx * 1.05, 0.18, sz]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.18, 0.18, 0.14, 16]} />
            <meshStandardMaterial color={0x1f2229} roughness={0.8} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** 입고창고·입고/검수 지게차 자리(빈 구석) */
export function InboundDecor() {
  return (
    <>
      {/* 입고창고 안 지게차는 뺌(사용자 2026-11-20 "입고 창고 안에 있는 지게차는 없애고") — 입고·검수 하차 자리 1대만(장식, 서버 작업 없음) */}
      <Forklift x={38.4} z={22.1} rot={Math.PI / 2} />
    </>
  );
}

/** 장바구니(피킹 카트) 한 대 — 바퀴 달린 틀 + 파란 철망 바구니 2단 + 손잡이 */
function PickCart({ x, z }: { x: number; z: number }) {
  const frame = 0x9aa3b0;
  return (
    <group position={[x, 0, z]}>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx}${sz}`}>
            <mesh position={[sx * 0.24, 0.5, sz * 0.32]}>
              <boxGeometry args={[0.025, 0.9, 0.025]} />
              <meshStandardMaterial color={frame} metalness={0.4} roughness={0.4} />
            </mesh>
            <mesh position={[sx * 0.24, 0.05, sz * 0.32]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.03, 10]} />
              <meshStandardMaterial color={0x2b2f36} />
            </mesh>
          </group>
        )),
      )}
      {[0.32, 0.72].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[0.46, 0.22, 0.62]} />
          <meshStandardMaterial color={0x2f7df0} transparent opacity={0.55} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.98, -0.34]}>
        <boxGeometry args={[0.5, 0.03, 0.03]} />
        <meshStandardMaterial color={0x1f2733} />
      </mesh>
    </group>
  );
}

/**
 * 장바구니 거치대 — 카트를 한 줄로 바짝 붙여 세워 둔 모습(사용자 2026-11-20 "장바구니 적치된 것처럼 만들어봐").
 * 대수는 그림(서버 카트 40대와 무관, config DECOR.cartDepotDrawn). 카트 사이 0.28 m(앞 카트에 겹쳐 밀어 넣은 모양).
 */
export function CartDepot({ x, z, count = 6 }: { x: number; z: number; count?: number }) {
  // x = 줄의 동쪽 끝 카트 가운데(시작점·반납 탁자 쪽). 대수가 늘면 서쪽(통로 따라)으로 길어진다
  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: count }, (_, i) => (
        <PickCart key={i} x={-i * 0.28} z={0} />
      ))}
    </group>
  );
}

let startTex: THREE.CanvasTexture | null = null;
/**
 * "시작점" 표지판 — 장바구니 거치대 앞면에 세워 붙인 판(작업자가 카트를 받아 출발하는 자리, 서버 CRT-A-01)
 * (사용자 2026-11-20 "시작점을 바닥에다가 붙이라는 게 아니라 장바구니대 앞에 붙여"). x, z = 거치대 가운데, 앞 = +z.
 */
export function StartMark({ x, z }: { x: number; z: number }) {
  if (!startTex) {
    // 표지판: 짙은 남회색 판 + 위 가는 하늘색 띠 + 흰 글(사용자 2026-11-21 "보라색 배경 말고 좀 더 세련되게") — 장면 이름표(남색 카드)와 같은 계열
    const c = document.createElement('canvas');
    // 사용자 2026-11-21 "그냥 장바구니 거치대 시작점 이라고 하면 되지 않아? 글자 크기가 좀 작아서 안 보여" — 따로 있던 "장바구니 거치대" 이름표를 합치고 판을 넓게
    // → 두 줄 "장바구니 거치대 / 시작점", 시작점을 크게(사용자 2026-11-21)
    c.width = 1280;
    c.height = 448;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, 448);
    grd.addColorStop(0, '#2a3346');
    grd.addColorStop(1, '#1b2231');
    g.fillStyle = grd;
    g.beginPath();
    g.roundRect(4, 4, 1272, 440, 30);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#5ec8f2';
    g.fillRect(48, 30, 1184, 9);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = '700 104px "Noto Sans KR", "Malgun Gothic", sans-serif';
    g.fillText('장바구니 거치대', 640, 130);
    g.fillStyle = '#ffffff';
    g.font = '900 196px "Noto Sans KR", "Malgun Gothic", sans-serif';
    g.fillText('시작점', 640, 315);
    startTex = new THREE.CanvasTexture(c);
    startTex.colorSpace = THREE.SRGBColorSpace;
    startTex.anisotropy = 4;
  }
  return (
    <group position={[x, 0, z + 0.4]}>
      {[-1.45, 1.45].map((dx) => (
        <mesh key={dx} position={[dx, 0.73, -0.02]}>
          <boxGeometry args={[0.03, 1.46, 0.03]} />
          <meshStandardMaterial color={0x9aa3b0} metalness={0.3} roughness={0.5} />
        </mesh>
      ))}
      {/* 판 위끝은 예전(한 줄 판)과 같은 1.46 m, 아래로 늘림 — 사용자 2026-11-21 "아니 위치는 내려" */}
      <mesh position={[0, 0.9, 0]} raycast={() => null} userData={{ declutterBlock: true }}>
        <planeGeometry args={[3.2, 1.12]} />
        <meshBasicMaterial map={startTex} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * 되돌릴 상품 탁자 — 취소 주문에서 이미 집은 상품(서버 위치 CRT-A-01, 상태 CANCEL_RETURN_PENDING)을 장바구니 안이 아니라 거치대 옆 탁자 위에 그린다
 * (사용자 2026-11-20 "장바구니에 그걸 왜 놔둬. 장바구니 옆에 테이블 두고 거기에 올리게"). 그림 자리만 — 서버 위치는 그대로 CRT-A-01.
 * 윗면 높이 0.88 m(RealStock 탁자 자리 baseY 0.9 와 맞춤).
 */
export const RETURN_TABLE = { dx: 1.7, dz: -0.6 };
export function ReturnTable({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.86, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.04, 0.7]} />
        <meshStandardMaterial color={0xffffff} roughness={0.5} />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 0.5, 0.42, sz * 0.3]}>
            <boxGeometry args={[0.04, 0.84, 0.04]} />
            <meshStandardMaterial color={0x9aa3b0} metalness={0.3} roughness={0.5} />
          </mesh>
        )),
      )}
    </group>
  );
}
