// 고정 시설: 바닥·구역·벽·랙·장애물·패킹대·거치대.
import { dividerInside, shelfInside } from '../../domain/wideCells';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useApp, useTick } from '../../app/context';
import { BACKEND_FACTS } from '../../config';
import { RACK_DEPTH, RACK_HEIGHT, RACK_LEN, type Layout } from '../../domain/layout';
import { SCENE, ZONE_COLOR } from '../colors';
import { makeLabel } from '../sprites';
import { hasWallName, ZoneNames } from './ZoneNames';

type Vec3 = [number, number, number];

/** 그림자를 주고받는 상자 (기본 거칠기 0.8). */
export function Box({
  size,
  color,
  position,
  material,
  children,
}: {
  size: Vec3;
  color: number;
  position?: Vec3;
  material?: Partial<THREE.MeshStandardMaterialParameters>;
  children?: ReactNode;
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.8} {...material} />
      {children}
    </mesh>
  );
}

/** 라벨 스프라이트. 내용이 바뀌지 않는 라벨만 쓴다. */
export function Label({ text, position, opts }: { text: string; position: Vec3; opts: Parameters<typeof makeLabel>[1] }) {
  const sprite = useMemo(() => makeLabel(text, opts), [text]);
  return <primitive object={sprite} position={position} />;
}


function Ground({ L }: { L: Layout }) {
  const flat: Vec3 = [-Math.PI / 2, 0, 0];
  return (
    <>
      <mesh rotation={flat} position={[30, -0.02, 20]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={SCENE.outside} roughness={1} />
      </mesh>
      <mesh rotation={flat} position={[L.width / 2, -0.01, L.buildingDepth / 2]} receiveShadow>
        <planeGeometry args={[L.width, L.buildingDepth]} />
        <meshStandardMaterial color={SCENE.floor} roughness={0.95} />
      </mesh>
      {/* 남쪽 앞마당(라이더), 동쪽 입고 차량 진입로 — 그림의 회색 도크처럼 */}
      <mesh rotation={flat} position={[30, -0.015, 36]} receiveShadow>
        <planeGeometry args={[19.7, 8]} />
        <meshStandardMaterial color={SCENE.yard} roughness={1} />
      </mesh>
      <mesh rotation={flat} position={[68, -0.015, L.points.truckDock.z]} receiveShadow>
        <planeGeometry args={[40, 5]} />
        <meshStandardMaterial color={SCENE.yard} roughness={1} />
      </mesh>
    </>
  );
}

/** 바닥 점선 사각형(그림의 구역 테두리) — 얇은 점 띠는 선(line)보다 화면에서 굵기가 일정하게 보이도록 짧은 판을 늘어놓는다 */
function DashedRect({ x0, z0, x1, z1, color }: { x0: number; z0: number; x1: number; z1: number; color: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const dash = 0.35;
  const gap = 0.25;
  const thick = 0.07;
  const segs = useMemo(() => {
    const out: { x: number; z: number; len: number; alongX: boolean }[] = [];
    const run = (a0: number, a1: number, fixed: number, alongX: boolean) => {
      for (let a = a0; a < a1; a += dash + gap) {
        const len = Math.min(dash, a1 - a);
        out.push(alongX ? { x: a + len / 2, z: fixed, len, alongX } : { x: fixed, z: a + len / 2, len, alongX });
      }
    };
    run(x0, x1, z0, true);
    run(x0, x1, z1, true);
    run(z0, z1, x0, false);
    run(z0, z1, x1, false);
    return out;
  }, [x0, z0, x1, z1]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    segs.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, 0.012, s.z), q, s.alongX ? new THREE.Vector3(s.len, 0.004, thick) : new THREE.Vector3(thick, 0.004, s.len));
      mesh.current.setMatrixAt(i, m);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [segs]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, segs.length]} raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={color} />
    </instancedMesh>
  );
}

function Zones({ L }: { L: Layout }) {
  const { registry } = useApp();
  return (
    <>
      {L.zones.map((z) => {
        const r = z.rect;
        const w = r.x1 - r.x0;
        const d = r.z1 - r.z0;
        const tall = z.kind === 'QUARANTINE' || z.kind === 'SHIPPING' || z.kind === 'PARKING';
        return (
          <group key={z.id}>
            <mesh
              ref={(m) => {
                if (m) registry.zoneFloors.set(z.id, m);
                else registry.zoneFloors.delete(z.id);
              }}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[r.x0 + w / 2, z.kind === 'QUARANTINE' ? 0.008 : 0.005, r.z0 + d / 2]}
              receiveShadow
              userData={{ zoneId: z.id }}
            >
              <planeGeometry args={[w, d]} />
              {/* 흰 바닥 위 구역색 아주 옅게 + 구역색 점선 테두리(사용자 2026-11-20 "흰 바닥 + 구역색 점선") — 격리는 회색 물빛·검정 점선 */}
              <meshStandardMaterial color={ZONE_COLOR[z.kind]} roughness={0.9} transparent opacity={z.kind === 'QUARANTINE' ? 0.1 : SCENE.zoneTint} depthWrite={false} />
            </mesh>
            <DashedRect x0={r.x0 + 0.15} z0={r.z0 + 0.15} x1={r.x1 - 0.15} z1={r.z1 - 0.15} color={ZONE_COLOR[z.kind]} />
            {/* 외부 출하대기·라이더 대기는 같은 곳 — 떠 있는 이름표 없이 바닥 흰 글씨 "라이더 대기" 하나(ZoneNames, 사용자 2026-11-20) */}
            {z.kind === 'SHIPPING' || z.kind === 'PARKING' || hasWallName(L, z) ? null : (
            <Label
              text={z.docPyeong ? `${z.label} · ${z.docPyeong}평` : z.label}
              position={[r.x0 + w / 2, tall ? 2.4 : 3.6, r.z0 + Math.min(1.5, d / 2)]}
              opts={{ size: 40, bg: 'rgba(0,0,0,0.55)', screenPx: 17 }}
            />
            )}
          </group>
        );
      })}
    </>
  );
}

/** 벽: 투명도는 화면 상태(구역 확대·사용자 선택)를 따른다. */
function Walls({ L }: { L: Layout }) {
  const { controller } = useApp();
  const mats = useRef<THREE.MeshStandardMaterial[]>([]);
  useFrame(() => {
    const o = controller.wallOpacity;
    for (const m of mats.current) {
      if (!m) continue;
      m.opacity = o;
      m.visible = o > 0.01;
    }
  });
  return (
    <>
      {L.walls.map((w, i) => {
        const r = w.rect;
        return (
          <mesh key={i} position={[(r.x0 + r.x1) / 2, w.height / 2, (r.z0 + r.z1) / 2]}>
            <boxGeometry args={[r.x1 - r.x0, w.height, r.z1 - r.z0]} />
            <meshStandardMaterial
              ref={(m: THREE.MeshStandardMaterial | null) => {
                if (m) mats.current[i] = m;
              }}
              color={w.glass ? 0x9fd3ff : SCENE.wall}
              transparent
              opacity={w.glass ? 0.18 : 0.32}
              roughness={0.4}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </>
  );
}

/** 랙: 기둥 + 선반 + 칸막이 (인스턴스 3개). 칸막이 = 단마다 칸 사이 얇은 판 — 칸 수(MFC 문서 1장 설계)가 보이게 */
function Racks({ L }: { L: Layout }) {
  const posts = useRef<THREE.InstancedMesh>(null!);
  const shelves = useRef<THREE.InstancedMesh>(null!);
  const dividers = useRef<THREE.InstancedMesh>(null!);
  const beams = useRef<THREE.InstancedMesh>(null!);
  // 기둥: 그림처럼 칸 사이(약 1.25 m)마다 앞뒤 한 쌍 — 파란색. 가로대: 단마다 앞·뒤 주황 띠
  const bays = Math.max(1, Math.round(RACK_LEN / 1.25));
  const postCount = L.racks.length * (bays + 1) * 2;
  const shelfCount = L.racks.reduce((a, r) => a + r.levels, 0);
  const dividerCount = L.racks.reduce((a, r) => a + r.levels * (r.slotsPerLevel - 1), 0);
  useLayoutEffect(() => {
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let pi = 0;
    let si = 0;
    let di = 0;
    let bi = 0;
    for (const r of L.racks) {
      const lx = r.along === 'x' ? RACK_LEN : RACK_DEPTH;
      const lz = r.along === 'x' ? RACK_DEPTH : RACK_LEN;
      for (let b = 0; b <= bays; b++) {
        const a = -RACK_LEN / 2 + 0.03 + (b * (RACK_LEN - 0.06)) / bays; // 랙 길이 방향 위치
        for (const s of [-1, 1]) {
          const c = (s * (RACK_DEPTH - 0.06)) / 2; // 앞·뒤
          const p = r.along === 'x' ? new THREE.Vector3(r.cx + a, RACK_HEIGHT / 2, r.cz + c) : new THREE.Vector3(r.cx + c, RACK_HEIGHT / 2, r.cz + a);
          mtx.compose(p, q, new THREE.Vector3(0.06, RACK_HEIGHT, 0.06));
          posts.current.setMatrixAt(pi++, mtx);
        }
      }
      const levelH = (RACK_HEIGHT - 0.25) / r.levels;
      const slotW = (RACK_LEN * 0.9) / r.slotsPerLevel;
      const dh = Math.min(0.12, levelH * 0.4); // 칸막이 높이 — 상품을 가리지 않게 낮게
      const spans = L.wideSpans ?? [];
      for (let lv = 0; lv < r.levels; lv++) {
        const y = 0.1 + (lv * (RACK_HEIGHT - 0.25)) / r.levels;
        // 세로로 합친 칸(넓은 칸) 안의 선반 판은 뺀다 — 숨김(크기 0)
        const hidden = shelfInside(spans, r.id, lv + 1, r.slotsPerLevel);
        mtx.compose(new THREE.Vector3(r.cx, y, r.cz), q, hidden ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(lx, 0.03, lz));
        shelves.current.setMatrixAt(si++, mtx);
        for (const s of [-1, 1]) {
          const c = (s * (RACK_DEPTH - 0.02)) / 2;
          const p = r.along === 'x' ? new THREE.Vector3(r.cx, y - 0.02, r.cz + c) : new THREE.Vector3(r.cx + c, y - 0.02, r.cz);
          mtx.compose(p, q, hidden ? new THREE.Vector3(0, 0, 0) : r.along === 'x' ? new THREE.Vector3(RACK_LEN, 0.07, 0.035) : new THREE.Vector3(0.035, 0.07, RACK_LEN));
          beams.current.setMatrixAt(bi++, mtx);
        }
        for (let s = 1; s < r.slotsPerLevel; s++) {
          if (dividerInside(spans, r.id, lv + 1, s)) {
            // 합친 칸 안의 칸막이는 뺀다(크기 0)
            mtx.compose(new THREE.Vector3(r.cx, y, r.cz), q, new THREE.Vector3(0, 0, 0));
            dividers.current.setMatrixAt(di++, mtx);
            continue;
          }
          const a = (s - r.slotsPerLevel / 2) * slotW; // 칸 경계(랙 중심 기준)
          const p = new THREE.Vector3(r.along === 'x' ? r.cx + a : r.cx, y + 0.015 + dh / 2, r.along === 'x' ? r.cz : r.cz + a);
          mtx.compose(p, q, r.along === 'x' ? new THREE.Vector3(0.008, dh, RACK_DEPTH * 0.96) : new THREE.Vector3(RACK_DEPTH * 0.96, dh, 0.008));
          dividers.current.setMatrixAt(di++, mtx);
        }
      }
    }
    for (const m of [dividers, posts, shelves, beams]) {
      m.current.instanceMatrix.needsUpdate = true;
      m.current.computeBoundingSphere();
    }
  }, [L, bays]);
  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, postCount]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SCENE.rackPost} metalness={0.2} roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={beams} args={[undefined, undefined, shelfCount * 2]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SCENE.rackBeam} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={shelves} args={[undefined, undefined, shelfCount]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SCENE.rackDeck} roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={dividers} args={[undefined, undefined, dividerCount]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SCENE.rackDivider} roughness={0.6} />
      </instancedMesh>
    </>
  );
}

/** 장애물: 포장재·출하 랙 (보충재고 팔레트는 Reserves). 출하대기(인계) 랙 위에는 노란 번호판 "인계 랙 N"(사용자 2026-11-20 "인계랙도 구별이 가능하게 번호라도") */
function Obstacles({ L }: { L: Layout }) {
  const ship = L.obstacles.filter((o) => o.kind === 'SHIP_RACK').sort((a, b) => a.rect.x0 - b.rect.x0);
  return (
    <>
      {ship.map((o, i) => (
        <Label
          key={`sr${i}`}
          text={`인계 랙 ${i + 1}`}
          // 랙 앞면 아래(라이더 쪽) — 위에 뜨는 랙 말풍선에 가리지 않게
          position={[(o.rect.x0 + o.rect.x1) / 2, 0.55, o.rect.z1 + 0.15]}
          opts={{ size: 44, bg: 'rgba(253,216,53,0.95)', color: '#1a1a1a', screenPx: 18 }}
        />
      ))}
      {L.obstacles.map((o, i) => {
        if (o.kind === 'TABLE' || o.kind === 'RESERVE') return null;
        const r = o.rect;
        // 밝은 장면(SCENE): 팔레트 나무색, 인계 랙 노랑, 포장재 연한 회청색(전엔 보라)
        const color = o.kind === 'PALLET' ? 0x8d6e4a : o.kind === 'SHIP_RACK' ? 0xd4b43a : 0xaab6c4;
        return (
          <Box
            key={i}
            size={[r.x1 - r.x0, o.height, r.z1 - r.z0]}
            color={color}
            position={[(r.x0 + r.x1) / 2, o.height / 2, (r.z0 + r.z1) / 2]}
            material={o.kind === 'SHIP_RACK' ? { transparent: true, opacity: 0.45 } : {}}
          />
        );
      })}
    </>
  );
}

/**
 * 고회전 칸: 백엔드 시험 센터의 E2E 시험용 고회전 5칸(H01-01 랙)을 빨간 띠로 표시한다.
 * 그 밖의 선반은 일반 선반(임시) — 근거 BACKEND_FACTS.highTurnoverBins.
 */
function HighTurnover({ L }: { L: Layout }) {
  const bins = useMemo(() => L.locations.filter((l) => (BACKEND_FACTS.highTurnoverBins as readonly string[]).includes(l.code)), [L]);
  const rack = useMemo(() => L.racks.find((r) => r.id === bins[0]?.rackId), [L, bins]);
  if (!rack) return null;
  return (
    <>
      {bins.map((loc) => {
        const w = loc.slotW * 0.92;
        const [sx, sz] = loc.along === 'x' ? [w, RACK_DEPTH + 0.04] : [RACK_DEPTH + 0.04, w];
        return (
          <mesh key={loc.code} position={[loc.shelf.x, loc.shelf.y - 0.02, loc.shelf.z]}>
            <boxGeometry args={[sx, 0.035, sz]} />
            <meshStandardMaterial color={0xe53935} emissive={0x7f1010} roughness={0.5} />
          </mesh>
        );
      })}
      <Label
        text="고회전(시험) H01-01"
        position={[rack.cx, RACK_HEIGHT + 0.5, rack.cz]}
        opts={{ size: 28, bg: 'rgba(160,20,20,0.75)', screenPx: 14 }}
      />
    </>
  );
}

/**
 * 회수(반품) 반입 자리 RTN-A-01 — 평면에 회수 구역이 없어 백엔드가 입고·검수 구역 안에 정한 자리.
 * 실서버: 이 센터로 오는 회수 배송(고객 반품·오배송 회수, delivery-dispatch 0.5.0) 수 — 오는 중 / 반납됨.
 */
function ReturnIntake() {
  const p = BACKEND_FACTS.returnIntake;
  const { sim } = useApp();
  useTick();
  const rp = sim.real?.returnPickups ?? [];
  const arrived = rp.filter((d) => d.state === 'RETURNED_TO_STORE' || d.state === 'COMPLETED').length;
  const coming = rp.length - arrived;
  const text = `회수 반입 ${p.code}${coming ? ` · 오는 중 ${coming}` : ''}${arrived ? ` · 반납 ${arrived}` : ''}`;
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.012, p.z]} receiveShadow>
        <planeGeometry args={[1.2, 1.2]} />
        <meshStandardMaterial color={0x2e7d32} roughness={0.9} transparent opacity={0.9} />
      </mesh>
      <Label text={text} position={[p.x, 1.6, p.z]} opts={{ size: 28, bg: 'rgba(20,90,30,0.75)', screenPx: 14 }} />
      {arrived > 0 && (
        <mesh position={[p.x, 0.25, p.z]} castShadow>
          <boxGeometry args={[0.5, 0.5, 0.4]} />
          <meshStandardMaterial color={0xb98c5a} roughness={0.8} />
        </mesh>
      )}
    </>
  );
}

/** 패킹대: 꺼짐 회색 · 비어 있음 초록 · 사용 중 주황. */
function Stations({ L }: { L: Layout }) {
  const { sim } = useApp();
  const mats = useRef<THREE.MeshStandardMaterial[]>([]);
  const tags = useMemo(() => L.stations.map((st) => makeLabel(st.id, { size: 32, bg: 'rgba(0,0,0,0.6)', screenPx: 16 })), [L]);
  useFrame(() => {
    L.stations.forEach((st, i) => {
      const active = sim.stations.isActive(i);
      const busy = sim.stations.occupant(st.id);
      mats.current[i]?.color.setHex(!active ? SCENE.stationOff : busy ? 0xff8a50 : 0x5cb860);
      tags[i].visible = active;
    });
  });
  return (
    <>
      {L.stations.map((st, i) => (
        <group key={st.id}>
          {/* 작업대(그림처럼): 흰 상판 + 회색 다리 + 아래 선반, 앞 띠 색 = 상태(꺼짐 회색·비어 있음 초록·사용 중 주황) */}
          <mesh position={[st.table.x, 0.87, st.table.z]} castShadow receiveShadow>
            <boxGeometry args={[1.6, 0.05, 0.8]} />
            <meshStandardMaterial color={SCENE.station} roughness={0.5} />
          </mesh>
          <mesh position={[st.table.x, 0.25, st.table.z]} receiveShadow>
            <boxGeometry args={[1.5, 0.03, 0.7]} />
            <meshStandardMaterial color={SCENE.rackDeck} roughness={0.7} />
          </mesh>
          {[-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => (
              <mesh key={`${sx}${sz}`} position={[st.table.x + sx * 0.75, 0.43, st.table.z + sz * 0.35]} castShadow>
                <boxGeometry args={[0.05, 0.86, 0.05]} />
                <meshStandardMaterial color={0x8a929c} metalness={0.3} roughness={0.5} />
              </mesh>
            )),
          )}
          {/* 상태 띠 — 상판 네 둘레 */}
          <mesh position={[st.table.x, 0.82, st.table.z]}>
            <boxGeometry args={[1.64, 0.09, 0.84]} />
            <meshStandardMaterial
              ref={(m: THREE.MeshStandardMaterial | null) => {
                if (m) mats.current[i] = m;
              }}
              color={SCENE.stationOff}
              roughness={0.5}
            />
          </mesh>
          <primitive object={tags[i]} position={[st.table.x, 1.5, st.table.z]} />
        </group>
      ))}
    </>
  );
}

export function Facility() {
  const { sim } = useApp();
  const L = sim.layout;
  return (
    <>
      <Ground L={L} />
      <Zones L={L} />
      <Walls L={L} />
      <ZoneNames L={L} />
      <Racks L={L} />
      <HighTurnover L={L} />
      <ReturnIntake />
      <Obstacles L={L} />
      <Stations L={L} />
      <Box size={[1.6, 0.9, 0.7]} color={SCENE.rackPost} position={[L.points.cartDepot.x, 0.45, L.points.cartDepot.z - 0.6]} />
      <Label text="장바구니 거치대" position={[L.points.cartDepot.x, 1.4, L.points.cartDepot.z - 0.6]} opts={{ size: 28, bg: 'rgba(0,0,0,0.6)', screenPx: 15 }} />
      <Label text="입고 차량문" position={[L.width + 0.4, 3.4, L.points.truckDoor.z]} opts={{ size: 28, bg: 'rgba(0,0,0,0.6)', screenPx: 15 }} />
    </>
  );
}
