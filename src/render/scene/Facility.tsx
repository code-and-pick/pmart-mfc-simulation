// 고정 시설: 바닥·구역·벽·랙·장애물·패킹대·거치대.
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { BACKEND_FACTS } from '../../config';
import { RACK_DEPTH, RACK_HEIGHT, RACK_LEN, type Layout } from '../../domain/layout';
import { ZONE_COLOR } from '../colors';
import { makeLabel } from '../sprites';

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
        <meshStandardMaterial color={0x1b1d21} roughness={1} />
      </mesh>
      <mesh rotation={flat} position={[L.width / 2, -0.01, L.buildingDepth / 2]} receiveShadow>
        <planeGeometry args={[L.width, L.buildingDepth]} />
        <meshStandardMaterial color={0x3a3c40} roughness={0.95} />
      </mesh>
      {/* 남쪽 앞마당(라이더), 동쪽 입고 차량 진입로 */}
      <mesh rotation={flat} position={[30, -0.015, 36]} receiveShadow>
        <planeGeometry args={[19.7, 8]} />
        <meshStandardMaterial color={0x2a2c30} roughness={1} />
      </mesh>
      <mesh rotation={flat} position={[68, -0.015, L.points.truckDock.z]} receiveShadow>
        <planeGeometry args={[40, 5]} />
        <meshStandardMaterial color={0x26282c} roughness={1} />
      </mesh>
    </>
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
              <meshStandardMaterial color={ZONE_COLOR[z.kind]} roughness={0.9} transparent opacity={0.85} />
            </mesh>
            <Label
              text={z.docPyeong ? `${z.label} · ${z.docPyeong}평` : z.label}
              position={[r.x0 + w / 2, tall ? 2.4 : 3.6, z.kind === 'SHIPPING' ? r.z1 + 0.3 : r.z0 + Math.min(1.5, d / 2)]}
              opts={{ size: 40, bg: 'rgba(0,0,0,0.55)', screenPx: 17 }}
            />
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
              color={w.glass ? 0x9fd3ff : 0xc9ccd1}
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
  const shelfCount = L.racks.reduce((a, r) => a + r.levels, 0);
  const dividerCount = L.racks.reduce((a, r) => a + r.levels * (r.slotsPerLevel - 1), 0);
  useLayoutEffect(() => {
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let pi = 0;
    let si = 0;
    let di = 0;
    for (const r of L.racks) {
      const lx = r.along === 'x' ? RACK_LEN : RACK_DEPTH;
      const lz = r.along === 'x' ? RACK_DEPTH : RACK_LEN;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          mtx.compose(new THREE.Vector3(r.cx + (sx * (lx - 0.05)) / 2, RACK_HEIGHT / 2, r.cz + (sz * (lz - 0.05)) / 2), q, new THREE.Vector3(0.05, RACK_HEIGHT, 0.05));
          posts.current.setMatrixAt(pi++, mtx);
        }
      const levelH = (RACK_HEIGHT - 0.25) / r.levels;
      const slotW = (RACK_LEN * 0.9) / r.slotsPerLevel;
      const dh = Math.min(0.12, levelH * 0.4); // 칸막이 높이 — 상품을 가리지 않게 낮게
      for (let lv = 0; lv < r.levels; lv++) {
        const y = 0.1 + (lv * (RACK_HEIGHT - 0.25)) / r.levels;
        mtx.compose(new THREE.Vector3(r.cx, y, r.cz), q, new THREE.Vector3(lx, 0.03, lz));
        shelves.current.setMatrixAt(si++, mtx);
        for (let s = 1; s < r.slotsPerLevel; s++) {
          const a = (s - r.slotsPerLevel / 2) * slotW; // 칸 경계(랙 중심 기준)
          const p = new THREE.Vector3(r.along === 'x' ? r.cx + a : r.cx, y + 0.015 + dh / 2, r.along === 'x' ? r.cz : r.cz + a);
          mtx.compose(p, q, r.along === 'x' ? new THREE.Vector3(0.008, dh, RACK_DEPTH * 0.96) : new THREE.Vector3(RACK_DEPTH * 0.96, dh, 0.008));
          dividers.current.setMatrixAt(di++, mtx);
        }
      }
    }
    dividers.current.instanceMatrix.needsUpdate = true;
    dividers.current.computeBoundingSphere();
    posts.current.instanceMatrix.needsUpdate = true;
    shelves.current.instanceMatrix.needsUpdate = true;
    posts.current.computeBoundingSphere();
    shelves.current.computeBoundingSphere();
  }, [L]);
  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, L.racks.length * 4]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={0x8a8f98} metalness={0.4} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={shelves} args={[undefined, undefined, shelfCount]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={0xb8bcc4} roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={dividers} args={[undefined, undefined, dividerCount]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={0x6f7580} roughness={0.6} />
      </instancedMesh>
    </>
  );
}

/** 장애물: 포장재·출하 랙 (보충재고 팔레트는 Reserves). */
function Obstacles({ L }: { L: Layout }) {
  return (
    <>
      {L.obstacles.map((o, i) => {
        if (o.kind === 'TABLE' || o.kind === 'RESERVE') return null;
        const r = o.rect;
        const color = o.kind === 'PALLET' ? 0x8d6e4a : o.kind === 'SHIP_RACK' ? 0xb0a060 : 0x7d6a8a;
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

/** 회수(반품) 반입 자리 RTN-A-01 — 평면에 회수 구역이 없어 백엔드가 입고·검수 구역 안에 정한 자리. */
function ReturnIntake() {
  const p = BACKEND_FACTS.returnIntake;
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.012, p.z]} receiveShadow>
        <planeGeometry args={[1.2, 1.2]} />
        <meshStandardMaterial color={0x2e7d32} roughness={0.9} transparent opacity={0.9} />
      </mesh>
      <Label text={`회수 반입 ${p.code}`} position={[p.x, 1.6, p.z]} opts={{ size: 28, bg: 'rgba(20,90,30,0.75)', screenPx: 14 }} />
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
      mats.current[i]?.color.setHex(!active ? 0x3a3a3a : busy ? 0xff7043 : 0x43a047);
      tags[i].visible = active;
    });
  });
  return (
    <>
      {L.stations.map((st, i) => (
        <group key={st.id}>
          <mesh position={[st.table.x, 0.45, st.table.z]} castShadow receiveShadow>
            <boxGeometry args={[1.6, 0.9, 0.8]} />
            <meshStandardMaterial
              ref={(m: THREE.MeshStandardMaterial | null) => {
                if (m) mats.current[i] = m;
              }}
              color={0x555555}
              roughness={0.6}
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
      <Racks L={L} />
      <HighTurnover L={L} />
      <ReturnIntake />
      <Obstacles L={L} />
      <Stations L={L} />
      <Box size={[1.6, 0.9, 0.7]} color={0x4a90d9} position={[L.points.cartDepot.x, 0.45, L.points.cartDepot.z - 0.6]} />
      <Label text="장바구니 거치대" position={[L.points.cartDepot.x, 1.4, L.points.cartDepot.z - 0.6]} opts={{ size: 28, bg: 'rgba(0,0,0,0.6)', screenPx: 15 }} />
      <Label text="입고 차량문" position={[L.width + 0.4, 3.4, L.points.truckDoor.z]} opts={{ size: 28, bg: 'rgba(0,0,0,0.6)', screenPx: 15 }} />
    </>
  );
}
