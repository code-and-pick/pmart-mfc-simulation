import { TRUCK_PASS_LANE } from '../../config';
// 움직이는 것들: 피킹·패킹 작업자, 입고 작업자, 라이더, 입고 차량.
import type { VehicleType } from '../../domain/contract';
import { RollContainer } from './RollContainer';
import { StaticMerge } from './StaticMerge';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useApp } from '../../app/context';
import type { P as Point } from '../../domain/navgrid';
import type { InboundWorker } from '../../sim/inbound';
import type { SiteWorker } from '../../sim/worker';
import { INBOUND_COLOR, STATE_COLOR, VEST_INBOUND, VEST_PICKER } from '../colors';
import { BAG_COLOR, makeLabel } from '../sprites';
import { workerRoleName, workerShortName, workerTagColor } from '../../domain/workerName';
import { Box } from './Facility';
import { Humanoid, type HumanoidHandle, type HumanoidLook } from './Humanoid';

/** 작업자 겉모습 — 파란 조끼(피킹·패킹)·주황 조끼(입고), 머리카락 몇 가지(사람 구분) */
const HAIR = [0x2b1d14, 0x1a1a1a, 0x4a3426, 0x3b2f2a, 0x6b4f3a];
function workerLook(id: string, kind: Kind): HumanoidLook {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return {
    shirt: [0xe8eaed, 0x9aa5b1, 0x37474f][h % 3],
    pants: [0x263238, 0x3e4a59, 0x1f2933][(h >> 3) % 3],
    vest: kind === 'worker' ? VEST_PICKER : VEST_INBOUND,
    head: kind === 'inbound' && h % 2 === 0 ? 'cap' : 'hair',
    headColor: kind === 'inbound' && h % 2 === 0 ? 0xff9800 : HAIR[(h >> 5) % HAIR.length],
    pda: kind === 'worker',
  };
}
/** 수단에 올라탔을 때 사람을 올리는 높이(m) — 좌석·발판 높이 − 엉덩이 높이 0.86 [시뮬, 그림만] */
const RIDE_LIFT: Partial<Record<VehicleType, number>> = { MOTORCYCLE: -0.04, BICYCLE: 0.04, E_BIKE: 0.04, KICKBOARD: 0.15, CAR: -0.4 };
/** 라이더 — 배달 재킷(청록)·흰 헬멧 */
const RIDER_LOOK: HumanoidLook = { shirt: 0x263238, pants: 0x37474f, vest: 0x26c6da, head: 'helmet', headColor: 0xf5f5f5 };

type Kind = 'worker' | 'inbound';

/**
 * 목록이 바뀔 때만 다시 그린다(사람 수 조절·라이더 도착 등). 위치·색은 각 컴포넌트가 매 프레임 직접 바꾼다.
 */
function useIdList<T>(list: () => T[], key: (x: T) => string): T[] {
  const [items, setItems] = useState<T[]>(() => list());
  const last = useRef(items.map(key).join(','));
  useFrame(() => {
    const next = list();
    const k = next.map(key).join(',');
    if (k !== last.current) {
      last.current = k;
      setItems(next);
    }
  });
  return items;
}

function Person({ id, kind }: { id: string; kind: Kind }) {
  const { sim, controller, registry } = useApp();
  const group = useRef<THREE.Group>(null!);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null!);
  const fig = useRef<HumanoidHandle>(null);
  const last = useRef<{ x: number; z: number } | null>(null);
  const look = useMemo(() => workerLook(id, kind), [id, kind]);
  const cart = useRef<THREE.Mesh>(null!);
  const bags = useRef<THREE.Mesh[]>([]);
  // 짧은 이름·역할 색(사용자 2026-11-20 "작업자들 식별값이 너무 길어서") — 전체 계정은 누르면 오른쪽 카드에
  const tag = useMemo(() => makeLabel(workerShortName(id), { size: 34, bg: kind === 'worker' ? workerTagColor(id) : 'rgba(120,60,0,0.75)', screenPx: 17, prio: 3 }), [id, kind]);
  // 패킹 중 이름표(피킹N → 패킹N) — 피킹 점원만, 상태에 따라 둘 중 하나만 보인다(사용자 2026-11-22)
  const packName = kind === 'worker' ? workerRoleName(id, 'PACKING') : null;
  const tagPack = useMemo(
    () => (packName && packName !== workerShortName(id) ? makeLabel(packName, { size: 34, bg: workerTagColor(id), screenPx: 17, prio: 3 }) : null),
    [id, packName],
  );
  const ud = useMemo(() => ({ personId: id, personKind: kind }), [id, kind]);

  useEffect(() => {
    registry.people.set(id, group.current);
    return () => {
      registry.people.delete(id);
    };
  }, [id, registry]);

  const isWorker = kind === 'worker';
  // 실서버 입고 가상 작업자(mfcw-qc·rcv)는 상자를 크게 — 손에 작은 것을 든 것처럼 보였다(사용자 2026-11-20)
  const inboundAcc = isWorker && /-(qc|rcv)-\d+/.test(id);
  const bagSize = inboundAcc ? 0.3 : isWorker ? 0.16 : 0.26;
  const per = inboundAcc ? 2 : isWorker ? 3 : 2;
  const roll = !isWorker || inboundAcc; // 입고 작업자(시뮬 입고·실서버 입고 가상 작업자)는 롤테이너

  useFrame((_, dt) => {
    const a: SiteWorker | InboundWorker | undefined =
      kind === 'worker' ? sim.siteWorkers().find((x) => x.id === id) : sim.inboundWorkers.find((x) => x.id === id);
    if (!a) return;
    group.current.position.set(a.pos.x, 0, a.pos.z);
    group.current.rotation.y = a.heading;
    // 상태 색 = 발밑 고리(범례 색과 같음)
    ringMat.current.color.setHex(kind === 'worker' ? STATE_COLOR[(a as SiteWorker).state] : INBOUND_COLOR[(a as InboundWorker).state]);
    if (tagPack) {
      const packing = workerRoleName(id, a.state) !== workerShortName(id);
      tag.visible = !packing;
      tagPack.visible = packing;
    }
    const s = controller.selection;
    const sel = !!s && s.kind !== 'location' && s.id === id;
    const moved = last.current ? Math.hypot(a.pos.x - last.current.x, a.pos.z - last.current.z) : 0;
    last.current = { x: a.pos.x, z: a.pos.z };
    // 입고 작업자는 롤테이너를 늘 밀고 다닌다 — 빈 롤테이너로 입고칸에 가서 싣고, 내려놓은 뒤에도 끌고 돌아온다
    // (사용자 2026-11-24 "입고 작업자들 롤테이너는 어디다 갖다 버리고 맨손으로 다니는 거야?" — 전엔 작업 사이·빈 걸음에 숨김)
    const pushing = roll || a.hasCart || a.carrying.length > 0;
    fig.current?.animate(moved > 0.5 ? 0 : moved, dt, pushing ? 'push' : 'walk'); // 순간이동(0.5 m 넘게)은 걸음으로 치지 않음
    fig.current?.highlight(sel);
    ringMat.current.opacity = sel ? 1 : 0.85;
    cart.current.visible = pushing;
    bags.current.forEach((b, i) => {
      const t = a.carrying[i];
      b.visible = t !== undefined;
      // 입고 = 골판지 상자 색, 피킹·포장 작업자가 들고 가는 것 = 포장 봉투 색(흰 비닐·은색 보냉)
      if (t) (b.material as THREE.MeshStandardMaterial).color.setHex(kind === 'inbound' || inboundAcc ? (t === 'AMBIENT' ? 0xc8955a : 0xe3e8ee) : BAG_COLOR[t]);
    });
  });

  return (
    <group ref={group}>
      {/* 클릭 판정(보이지 않음) — 고르기는 이 상자 하나로(Core Picker: 직계 자식 중 personId) */}
      <mesh position-y={0.9} userData={ud}>
        <boxGeometry args={[0.6, 1.8, 0.5]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* 상태 색 고리 */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[0.32, 0.42, 28]} />
        <meshBasicMaterial ref={ringMat} color={0x9aa0a6} transparent opacity={0.85} />
      </mesh>
      <Humanoid ref={fig} look={look} />
      <mesh ref={cart} position={[0, roll ? 0 : 0.5, roll ? 0.78 : 0.62]} castShadow={!roll}>
        {/* 입고(하차·적치)는 파란 롤테이너를 민다(사용자 2026-11-22 "트럭에서 내린 입고제품 운반할때는 롤테이너 쓰는데") — 전엔 회색 납작 카트 */}
        <boxGeometry args={roll ? [0.01, 0.01, 0.01] : [0.45, 0.42, 0.62]} />
        {roll ? <meshBasicMaterial visible={false} /> : <meshStandardMaterial color={0x4a90d9} transparent opacity={0.8} />}
        {roll && <RollContainer x={0} z={0} boxes={false} />}
        {!roll && (
          // 손잡이·다리·바퀴는 카트 안에서 움직이지 않음 → 같은 재질끼리 합쳐 그림(성능 2026-11-22, 7 → 2). 카트 보임/숨김·이동은 부모(cart)가 그대로
          <StaticMerge>
            {/* 손잡이·다리·바퀴 */}
            <mesh position={[0, 0.36, -0.36]}>
              <boxGeometry args={[0.5, 0.03, 0.03]} />
              <meshStandardMaterial color={0x90a4ae} metalness={0.6} roughness={0.3} />
            </mesh>
            {[-0.2, 0.2].map((x) => (
              <mesh key={'h' + x} position={[x, 0.2, -0.34]}>
                <boxGeometry args={[0.025, 0.34, 0.025]} />
                <meshStandardMaterial color={0x90a4ae} metalness={0.6} roughness={0.3} />
              </mesh>
            ))}
            {[
              [-0.19, -0.27],
              [0.19, -0.27],
              [-0.19, 0.27],
              [0.19, 0.27],
            ].map(([x, z]) => (
              <mesh key={'w' + x + ':' + z} position={[x, -0.43, z]} rotation-z={Math.PI / 2}>
                <cylinderGeometry args={[0.06, 0.06, 0.04, 10]} />
                <meshStandardMaterial color={0x263238} />
              </mesh>
            ))}
          </StaticMerge>
        )}
        {Array.from({ length: 8 }, (_, i) => {
          const gx = ((i % per) - (per - 1) / 2) * (bagSize + 0.01);
          const gy = Math.floor(i / per) * (bagSize * 0.9 + 0.01);
          return (
            <mesh
              key={i}
              ref={(m) => {
                if (m) bags.current[i] = m;
              }}
              position={[gx, (roll ? 0.18 + bagSize * 0.45 : 0.33) + gy, roll ? 0.02 : -0.05]}
              visible={false}
            >
              <boxGeometry args={[bagSize, bagSize * 0.9, bagSize]} />
              <meshStandardMaterial color={0xffffff} />
            </mesh>
          );
        })}
      </mesh>
      <primitive object={tag} position-y={1.95} />
      {tagPack && <primitive object={tagPack} position-y={1.95} />}
    </group>
  );
}

export function People() {
  const { sim } = useApp();
  const people = useIdList(
    () => [...sim.siteWorkers().map((a) => ({ id: a.id, kind: 'worker' as Kind })), ...sim.inboundWorkers.map((a) => ({ id: a.id, kind: 'inbound' as Kind }))],
    (p) => `${p.kind}:${p.id}`,
  );
  return (
    <>
      {people.map((p) => (
        <Person key={`${p.kind}:${p.id}`} id={p.id} kind={p.kind} />
      ))}
    </>
  );
}

/**
 * 라이더 수단 모델(사용자 2026-11-18 "수단에 따라 모델링") — rider VehicleType. 간단한 상자·바퀴로만.
 * 수단 앞쪽 = +z(Agent heading = atan2(dx, dz) — 움직이는 쪽이 +z). 배달통은 뒤(-z).
 */
function Wheel({ z, r = 0.25, t = 0.08 }: { z: number; r?: number; t?: number }) {
  return (
    <mesh rotation-y={Math.PI / 2} position={[0, r + 0.02, z]} castShadow>
      <torusGeometry args={[r, t, 8, 16]} />
      <meshStandardMaterial color={0x111111} />
    </mesh>
  );
}

/** 둥근 모서리 상자(RoundedBoxGeometry) — 크기·둥글기가 같으면 모양을 나눠 쓴다 */
const rbCache = new Map<string, THREE.BufferGeometry>();
function rbGeo(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const k = `${w}|${h}|${d}|${r}`;
  let g = rbCache.get(k);
  if (!g) rbCache.set(k, (g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2))));
  return g;
}
function RB({ s, r, color, p, rot, rough = 0.35, metal = 0.05, emissive }: { s: [number, number, number]; r: number; color: number; p: [number, number, number]; rot?: [number, number, number]; rough?: number; metal?: number; emissive?: number }) {
  return (
    <mesh geometry={rbGeo(s[0], s[1], s[2], r)} position={p} rotation={rot} castShadow>
      <meshStandardMaterial color={color} roughness={rough} metalness={metal} emissive={emissive ?? 0x000000} emissiveIntensity={emissive ? 0.6 : 0} />
    </mesh>
  );
}
/** 바퀴 — 타이어(검정) + 은색 휠, 축은 x */
function Tire({ p, r, w }: { p: [number, number, number]; r: number; w: number }) {
  return (
    <group position={p}>
      <mesh rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[r, r, w, 22]} />
        <meshStandardMaterial color={0x16181d} roughness={0.85} />
      </mesh>
      {[-1, 1].map((sd) => (
        <mesh key={sd} rotation-z={Math.PI / 2} position={[(sd * w) / 2 + sd * 0.003, 0, 0]}>
          <cylinderGeometry args={[r * 0.55, r * 0.55, 0.01, 18]} />
          <meshStandardMaterial color={0xd3d8e0} metalness={0.6} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

/** 두 점을 잇는 가는 관(자전거 틀) */
function Tube({ a, b, r = 0.022, color }: { a: [number, number, number]; b: [number, number, number]; r?: number; color: number }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    return { pos: va.clone().add(vb).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()), len: dir.length() };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <cylinderGeometry args={[r, r, len, 10]} />
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.35} />
    </mesh>
  );
}
/** 자전거 바퀴 — 얇은 타이어 + 은색 테 + 바큇살 판(반투명) */
function BikeWheel({ z, r = 0.32 }: { z: number; r?: number }) {
  return (
    <group position={[0, r + 0.02, z]} rotation-y={Math.PI / 2}>
      <mesh castShadow>
        <torusGeometry args={[r, 0.035, 10, 28]} />
        <meshStandardMaterial color={0x16181d} roughness={0.85} />
      </mesh>
      <mesh>
        <torusGeometry args={[r - 0.04, 0.012, 6, 28]} />
        <meshStandardMaterial color={0xd3d8e0} metalness={0.6} roughness={0.25} />
      </mesh>
      <mesh>
        <circleGeometry args={[r - 0.05, 24]} />
        <meshStandardMaterial color={0xc8ced8} transparent opacity={0.18} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.04, 0.04, 0.1, 12]} />
        <meshStandardMaterial color={0x9aa3b0} metalness={0.5} />
      </mesh>
    </group>
  );
}

/** 문(승용차 운전석)·뚜껑(트렁크·배달통) 회전축 — RiderMesh 가 각도를 천천히 바꾼다 */
type Hinge = React.RefObject<THREE.Group | null>;

export function VehicleModel({ v, door, lid }: { v: VehicleType; door: Hinge; lid: Hinge }) {
  switch (v) {
    case 'MOTORCYCLE':
      // 배달 스쿠터 — 둥근 흰 몸통·앞 가림판, 짙은 발판·안장, 둥근 전조등, 은색 휠, 보라 배달통(사용자 2026-11-20 "오토바이 자동차가 못생겼어")
      return (
        <>
          <RB s={[0.4, 0.38, 0.72]} r={0.14} color={0xf6f7fb} p={[0, 0.5, -0.16]} />
          <RB s={[0.3, 0.06, 0.5]} r={0.03} color={0x2a2e38} p={[0, 0.3, 0.24]} rough={0.7} />
          <RB s={[0.42, 0.66, 0.12]} r={0.06} color={0xf6f7fb} p={[0, 0.62, 0.52]} rot={[-0.22, 0, 0]} />
          <RB s={[0.18, 0.1, 0.34]} r={0.05} color={0xf6f7fb} p={[0, 0.44, 0.66]} />
          <RB s={[0.34, 0.11, 0.56]} r={0.05} color={0x23262f} p={[0, 0.74, -0.12]} rough={0.75} />
          <RB s={[0.36, 0.15, 0.18]} r={0.07} color={0xf6f7fb} p={[0, 1.0, 0.6]} />
          <mesh position={[0, 1.0, 0.7]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.07, 0.07, 0.03, 18]} />
            <meshStandardMaterial color={0xfff6cc} emissive={0xfff1a8} emissiveIntensity={0.7} />
          </mesh>
          <mesh position={[0, 1.07, 0.56]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.016, 0.016, 0.66, 8]} />
            <meshStandardMaterial color={0x2a2e38} metalness={0.4} />
          </mesh>
          {[-0.3, 0.3].map((x) => (
            <group key={x}>
              <mesh position={[x, 1.07, 0.56]} rotation-z={Math.PI / 2}>
                <cylinderGeometry args={[0.025, 0.025, 0.1, 8]} />
                <meshStandardMaterial color={0x16181d} />
              </mesh>
              <mesh position={[x * 0.75, 1.24, 0.54]}>
                <boxGeometry args={[0.07, 0.05, 0.02]} />
                <meshStandardMaterial color={0x2a2e38} metalness={0.5} roughness={0.2} />
              </mesh>
            </group>
          ))}
          <RB s={[0.52, 0.42, 0.46]} r={0.06} color={0x7c5cf0} p={[0, 1.0, -0.56]} rough={0.4} />
          {/* 배달통 뚜껑 — 앞쪽 윗모서리가 축 */}
          <group ref={lid} position={[0, 1.22, -0.33]}>
            <RB s={[0.54, 0.05, 0.48]} r={0.02} color={0x6a4ad8} p={[0, 0, -0.23]} rough={0.4} />
          </group>
          <Tire p={[0, 0.2, -0.46]} r={0.2} w={0.13} />
          <Tire p={[0, 0.2, 0.62]} r={0.2} w={0.11} />
        </>
      );
    case 'BICYCLE':
    case 'E_BIKE': {
      // 배달 자전거 — 가는 틀(자전거 파랑·전기 초록), 얇은 바퀴, 짙은 안장·핸들, 뒤 짐받이 위 보라 배달통(사용자 2026-11-20 "자전거도 못생겼어")
      const fc = v === 'E_BIKE' ? 0x2e9a5c : 0x2f6fe8;
      const seat: [number, number, number] = [0, 0.88, -0.16];
      const bb: [number, number, number] = [0, 0.36, 0.02];
      const head: [number, number, number] = [0, 0.9, 0.36];
      const rear: [number, number, number] = [0, 0.34, -0.5];
      const front: [number, number, number] = [0, 0.34, 0.5];
      return (
        <>
          <Tube a={seat} b={bb} color={fc} r={0.026} />
          <Tube a={bb} b={head} color={fc} r={0.03} />
          <Tube a={seat} b={head} color={fc} r={0.024} />
          <Tube a={bb} b={rear} color={fc} />
          <Tube a={seat} b={rear} color={fc} r={0.018} />
          <Tube a={head} b={front} color={0x2a2e38} r={0.022} />
          <Tube a={head} b={[0, 1.04, 0.32]} color={0x2a2e38} r={0.02} />
          <mesh position={[0, 1.04, 0.32]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.016, 0.016, 0.56, 8]} />
            <meshStandardMaterial color={0x2a2e38} metalness={0.4} />
          </mesh>
          {[-0.26, 0.26].map((x) => (
            <mesh key={x} position={[x, 1.04, 0.32]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.024, 0.024, 0.09, 8]} />
              <meshStandardMaterial color={0x16181d} />
            </mesh>
          ))}
          <Tube a={seat} b={[0, 0.98, -0.2]} color={0x9aa3b0} r={0.016} />
          <RB s={[0.14, 0.06, 0.26]} r={0.03} color={0x23262f} p={[0, 1.0, -0.2]} rough={0.75} />
          {v === 'E_BIKE' && <RB s={[0.1, 0.1, 0.34]} r={0.03} color={0x2a2e38} p={[0, 0.62, 0.2]} rot={[-0.75, 0, 0]} />}
          {/* 짐받이 */}
          <RB s={[0.3, 0.025, 0.36]} r={0.01} color={0x9aa3b0} p={[0, 0.7, -0.5]} metal={0.4} />
          <RB s={[0.44, 0.32, 0.38]} r={0.05} color={0x7c5cf0} p={[0, 0.88, -0.5]} rough={0.4} />
          <group ref={lid} position={[0, 1.05, -0.31]}>
            <RB s={[0.46, 0.04, 0.4]} r={0.015} color={0x6a4ad8} p={[0, 0, -0.19]} rough={0.4} />
          </group>
          <BikeWheel z={-0.5} />
          <BikeWheel z={0.5} />
        </>
      );
    }
    case 'KICKBOARD':
      return (
        <>
          <mesh position-y={0.12} castShadow>
            <boxGeometry args={[0.18, 0.05, 0.85]} />
            <meshStandardMaterial color={0x8e24aa} />
          </mesh>
          <mesh position={[0, 0.6, 0.4]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 1.0, 6]} />
            <meshStandardMaterial color={0x555555} metalness={0.5} />
          </mesh>
          <mesh position={[0, 1.08, 0.4]} castShadow>
            <boxGeometry args={[0.45, 0.04, 0.04]} />
            <meshStandardMaterial color={0x333333} />
          </mesh>
          <Wheel z={-0.4} r={0.09} t={0.03} />
          <Wheel z={0.4} r={0.09} t={0.03} />
        </>
      );
    case 'CAR':
      // 소형 해치백 — 둥근 흰 차체, 짙은 유리 실내, 파란 옆줄, 전조등·후미등, 은색 휠(사용자 2026-11-20 "오토바이 자동차가 못생겼어"). 문·트렁크 축은 그대로
      return (
        <>
          <RB s={[1.22, 0.56, 2.7]} r={0.2} color={0xf6f7fb} p={[0, 0.56, 0]} rough={0.25} metal={0.15} />
          <RB s={[1.04, 0.52, 1.55]} r={0.18} color={0x1f2b44} p={[0, 1.02, -0.12]} rough={0.1} metal={0.4} />
          <RB s={[1.0, 0.07, 1.2]} r={0.03} color={0xf6f7fb} p={[0, 1.28, -0.2]} rough={0.25} />
          <mesh position={[0, 0.6, 0]}>
            <boxGeometry args={[1.235, 0.07, 2.2]} />
            <meshStandardMaterial color={0x2f6fe8} roughness={0.35} />
          </mesh>
          {[-1, 1].map((sz) => (
            <RB key={sz} s={[1.18, 0.16, 0.12]} r={0.05} color={0xa7b0bd} p={[0, 0.34, sz * 1.33]} rough={0.6} />
          ))}
          {[-0.4, 0.4].map((x) => (
            <group key={x}>
              <RB s={[0.26, 0.1, 0.05]} r={0.03} color={0xfff6cc} p={[x, 0.66, 1.34]} emissive={0xfff1a8} />
              <RB s={[0.24, 0.09, 0.05]} r={0.03} color={0xe5484d} p={[x, 0.68, -1.34]} emissive={0x9a1f22} />
            </group>
          ))}
          {/* 운전석 문(+x 쪽) — 앞쪽 모서리가 축, 바깥으로(-각) 열린다 */}
          <group ref={door} position={[0.6, 0.66, 0.6]}>
            <RB s={[0.05, 0.6, 1.0]} r={0.02} color={0xf6f7fb} p={[0, 0, -0.5]} rough={0.25} />
          </group>
          {/* 트렁크 뚜껑(뒤 -z) — 앞쪽 윗모서리가 축, 위로 열린다 */}
          <group ref={lid} position={[0, 0.86, -0.62]}>
            <RB s={[1.1, 0.06, 0.7]} r={0.03} color={0xf6f7fb} p={[0, 0, -0.35]} rough={0.25} />
          </group>
          {[-0.86, 0.86].map((z) => [-0.58, 0.58].map((x) => <Tire key={`${x}${z}`} p={[x, 0.3, z]} r={0.3} w={0.2} />))}
        </>
      );
    case 'WALK':
      return null;
  }
}

function RiderMesh({ id, label, parking }: { id: string; label: string; parking: Point }) {
  const { sim } = useApp();
  const group = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const box = useRef<THREE.Mesh>(null!);
  const ride = useRef<THREE.Group>(null!);
  const door = useRef<THREE.Group>(null);
  const lid = useRef<THREE.Group>(null);
  const ang = useRef({ door: 0, lid: 0 });
  const fig = useRef<HumanoidHandle>(null);
  const last = useRef<{ x: number; z: number } | null>(null);
  const tag = useMemo(() => makeLabel(label, { size: 28, bg: 'rgba(0,80,90,0.75)', screenPx: 15, prio: 4 }), [label]);
  const vehicle = sim.riders.find((x) => x.id === id)?.vehicle ?? 'MOTORCYCLE';
  useFrame((_, dt) => {
    const r = sim.riders.find((x) => x.id === id);
    if (!r) return;
    group.current.position.set(r.pos.x, 0, r.pos.z);
    group.current.rotation.y = r.heading;
    const moved = last.current ? Math.hypot(r.pos.x - last.current.x, r.pos.z - last.current.z) : 0;
    last.current = { x: r.pos.x, z: r.pos.z };
    // 킥보드는 서서 손잡이를 잡고(push 자세), 두 바퀴 수단은 앉아서(ride)
    const riding0 = r.riding && r.vehicle !== 'WALK';
    // 킥보드는 발판 위에 서서 미끄러져 간다 — 다리는 걷지 않는다(사용자 2026-11-20 "킥보드 끌고 걸어감")
    fig.current?.animate(moved > 0.5 || (riding0 && r.vehicle === 'KICKBOARD') ? 0 : moved, dt, !riding0 ? 'walk' : r.vehicle === 'KICKBOARD' ? 'push' : 'ride');
    // 문·뚜껑은 목표 각도로 천천히(약 RIDER_VEHICLE.hatchSec) — 문 70°, 트렁크·배달통 63°
    const k = Math.min(1, dt * 6);
    ang.current.door += ((r.door ? -1.2 : 0) - ang.current.door) * k;
    ang.current.lid += ((r.trunk ? 1.1 : 0) - ang.current.lid) * k;
    if (door.current) door.current.rotation.y = ang.current.door;
    if (lid.current) lid.current.rotation.x = ang.current.lid;
    // 배달통이 없는 수단(킥보드·도보)은 상품을 등에 멘 배달 가방에 — 실은 뒤에도 보인다(사용자 2026-11-20 "킥보드 라이더 가방도 없어지고")
    const noTrunk = r.vehicle === 'KICKBOARD' || r.vehicle === 'WALK';
    box.current.visible = r.carrying > 0 && (!r.stowed || noTrunk);
    // 타는 중이면 수단이 라이더와 같이 움직이고(라이더는 올라탄 높이, 승용차면 안에 앉아 보이지 않게), 아니면 주차 자리에 서 있다
    const riding = r.riding && r.vehicle !== 'WALK';
    // 올라탄 높이 = 좌석(또는 발판) 높이 − 사람 엉덩이 높이(Humanoid 0.86 m). 오토바이 좌석 0.82·자전거 0.9·킥보드 발판 0.15
    body.current.position.y = riding ? (RIDE_LIFT[r.vehicle] ?? 0) : 0;
    body.current.visible = !(riding && r.vehicle === 'CAR');
    if (riding) {
      ride.current.position.set(r.pos.x, 0, r.pos.z);
      ride.current.rotation.y = r.heading;
    } else if (r.parkedAt) {
      // 내린 뒤: 멈춘 자리·멈춘 방향 그대로(라이더는 운전석 문 쪽 — 모델 +x — 으로 비켜 섬)
      ride.current.position.set(r.parkedAt.x, 0, r.parkedAt.z);
      ride.current.rotation.y = r.parkedHeading;
    } else {
      ride.current.position.set(parking.x, 0, parking.z);
    }
  });
  return (
    <>
      <group ref={group}>
        <group ref={body}>
          <Humanoid ref={fig} look={RIDER_LOOK} />
          <mesh ref={box} geometry={rbGeo(0.42, 0.4, 0.3, 0.06)} position={[0, 1.15, -0.32]} visible={false}>
            <meshStandardMaterial color={0x7c5cf0} roughness={0.4} />
          </mesh>
        </group>
        <primitive object={tag} position-y={1.95} />
      </group>
      {/* 수단(rider VehicleType): 타면 라이더와 같이, 내리면 주차 자리. 도보는 없음 */}
      <group ref={ride}>
        <VehicleModel v={vehicle} door={door} lid={lid} />
      </group>
    </>
  );
}

export function Riders() {
  const { sim } = useApp();
  const riders = useIdList(
    () => sim.riders.map((r) => ({ id: r.id, parking: r.parking, vehicle: r.vehicle, label: sim.riderLabel(r.id) })),
    // 수단이 바뀌면(배차 상세가 늦게 옴)·라이더 번호가 오면 다시 만든다
    (r) => r.id + ':' + r.vehicle + ':' + r.label,
  );
  return (
    <>
      {riders.map((r) => (
        <RiderMesh key={r.id + ':' + r.vehicle + ':' + r.label} id={r.id} label={r.label} parking={r.parking} />
      ))}
    </>
  );
}

/** 입고 차량(5톤 탑차 가정): 뒷문이 입고 차량문을 향한다. */
function Truck({ trfId }: { trfId: string }) {
  const { sim } = useApp();
  const group = useRef<THREE.Group>(null!);
  const tag = useMemo(() => makeLabel(trfId, { size: 30, bg: 'rgba(30,60,120,0.85)', screenPx: 15, prio: 2 }), [trfId]);
  useFrame((_, dt) => {
    const t = sim.trucks.find((x) => x.trfId === trfId);
    // 뒷문(로컬 x=-3.2)이 truck.x - 3.2 에 오도록. 떠나는 차는 북쪽 바깥 차로로 비켜 줄 선 차 옆을 지나감(TRUCK_PASS_LANE)
    if (!t) return;
    const g = group.current;
    const west = sim.layout.geo.truckFromWest;
    const dock = sim.layout.points.truckDock;
    if (west) {
      // 서쪽에서 오는 동서 길(부산진구): 운전칸이 서쪽, 뒷문을 건물 서쪽 벽에 댐. 줄 선 차는 서쪽으로, 떠나는 차는 북쪽 바깥 차로로 비켜 서쪽으로
      const zTo = west.z - (t.state === 'LEAVING' ? TRUCK_PASS_LANE : 0);
      const z = g.userData.placed ? g.position.z + (zTo - g.position.z) * Math.min(1, dt * 2.5) : zTo;
      g.userData.placed = true;
      g.rotation.y = Math.PI;
      g.position.set(west.rearX - 3.2 - (t.x - dock.x), 0, z);
      return;
    }
    const zTo = dock.z - (t.state === 'LEAVING' ? TRUCK_PASS_LANE : 0);
    const z = g.userData.placed ? g.position.z + (zTo - g.position.z) * Math.min(1, dt * 2.5) : zTo;
    g.userData.placed = true;
    g.position.set(t.x, 0, z);
  });
  return (
    <group ref={group}>
      {/* 참고 그림 트럭: 흰 탑 + 파란 띠 두 줄, 파란 운전칸·짙은 앞유리, 회색 차대·범퍼 */}
      <Box size={[5.0, 2.5, 2.3]} color={0xf7f8fb} position={[-0.7, 1.55, 0]} />
      <Box size={[5.02, 0.22, 2.32]} color={0x1f5fd6} position={[-0.7, 1.05, 0]} />
      <Box size={[5.02, 0.08, 2.32]} color={0x5b9bff} position={[-0.7, 1.28, 0]} />
      <Box size={[6.4, 0.25, 2.0]} color={0x5b6472} position={[0, 0.42, 0]} />
      <Box size={[1.8, 1.9, 2.25]} color={0x1f5fd6} position={[2.75, 1.4, 0]} />
      <Box size={[1.2, 0.5, 2.27]} color={0x1849ad} position={[2.95, 2.25, 0]} />
      <Box size={[0.05, 0.75, 1.95]} color={0x1c2a44} position={[3.66, 1.75, 0]} material={{ metalness: 0.5, roughness: 0.1 }} />
      <Box size={[0.12, 0.25, 2.2]} color={0xb8c0cc} position={[3.7, 0.6, 0]} />
      {[-0.75, 0.75].map((z) => (
        <Box key={z} size={[0.04, 0.14, 0.32]} color={0xfff5c2} position={[3.71, 0.95, z]} />
      ))}
      {[-2.4, -1.2, 2.6].flatMap((x) =>
        [-1.0, 1.0].map((z) => (
          <group key={`${x}:${z}`} position={[x, 0.42, z]}>
            <mesh rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.42, 0.42, 0.3, 18]} />
              <meshStandardMaterial color={0x1c1f26} roughness={0.8} />
            </mesh>
            <mesh rotation-x={Math.PI / 2} position={[0, 0, z > 0 ? 0.16 : -0.16]}>
              <cylinderGeometry args={[0.2, 0.2, 0.02, 14]} />
              <meshStandardMaterial color={0xc8ced8} metalness={0.5} roughness={0.3} />
            </mesh>
          </group>
        )),
      )}
      <primitive object={tag} position={[-0.7, 3.4, 0]} />
    </group>
  );
}

export function Trucks() {
  const { sim } = useApp();
  const trucks = useIdList(
    () => sim.trucks.map((t) => t.trfId),
    (id) => id,
  );
  return (
    <>
      {trucks.map((id) => (
        <Truck key={id} trfId={id} />
      ))}
    </>
  );
}
