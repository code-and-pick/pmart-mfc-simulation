// 움직이는 것들: 피킹·패킹 작업자, 입고 작업자, 라이더, 입고 차량.
import type { VehicleType } from '../../domain/contract';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import type { P as Point } from '../../domain/navgrid';
import type { InboundWorker } from '../../sim/inbound';
import type { SiteWorker } from '../../sim/worker';
import { INBOUND_COLOR, STATE_COLOR, VEST_INBOUND, VEST_PICKER } from '../colors';
import { BAG_COLOR, makeLabel } from '../sprites';
import { workerShortName, workerTagColor } from '../../domain/workerName';
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
  const ud = useMemo(() => ({ personId: id, personKind: kind }), [id, kind]);

  useEffect(() => {
    registry.people.set(id, group.current);
    return () => {
      registry.people.delete(id);
    };
  }, [id, registry]);

  useFrame((_, dt) => {
    const a: SiteWorker | InboundWorker | undefined =
      kind === 'worker' ? sim.siteWorkers().find((x) => x.id === id) : sim.inboundWorkers.find((x) => x.id === id);
    if (!a) return;
    group.current.position.set(a.pos.x, 0, a.pos.z);
    group.current.rotation.y = a.heading;
    // 상태 색 = 발밑 고리(범례 색과 같음)
    ringMat.current.color.setHex(kind === 'worker' ? STATE_COLOR[(a as SiteWorker).state] : INBOUND_COLOR[(a as InboundWorker).state]);
    const s = controller.selection;
    const sel = !!s && s.kind !== 'location' && s.id === id;
    const moved = last.current ? Math.hypot(a.pos.x - last.current.x, a.pos.z - last.current.z) : 0;
    last.current = { x: a.pos.x, z: a.pos.z };
    const pushing = a.hasCart || a.carrying.length > 0;
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

  const isWorker = kind === 'worker';
  // 실서버 입고 가상 작업자(mfcw-qc·rcv)는 상자를 크게 — 손에 작은 것을 든 것처럼 보였다(사용자 2026-11-20)
  const inboundAcc = isWorker && /-(qc|rcv)-\d+/.test(id);
  const bagSize = inboundAcc ? 0.3 : isWorker ? 0.16 : 0.26;
  const per = inboundAcc ? 2 : isWorker ? 3 : 2;
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
      <mesh ref={cart} position={[0, isWorker ? 0.5 : 0.12, isWorker ? 0.62 : 0.8]} castShadow>
        {isWorker ? <boxGeometry args={[0.45, 0.42, 0.62]} /> : <boxGeometry args={[0.6, 0.14, 0.95]} />}
        {isWorker ? <meshStandardMaterial color={0x4a90d9} transparent opacity={0.8} /> : <meshStandardMaterial color={0x546e7a} metalness={0.3} />}
        {isWorker && (
          <>
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
          </>
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
              position={[gx, (isWorker ? 0.33 : 0.07 + bagSize * 0.45) + gy, isWorker ? -0.05 : 0]}
              visible={false}
            >
              <boxGeometry args={[bagSize, bagSize * 0.9, bagSize]} />
              <meshStandardMaterial color={0xffffff} />
            </mesh>
          );
        })}
      </mesh>
      <primitive object={tag} position-y={1.95} />
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

/** 문(승용차 운전석)·뚜껑(트렁크·배달통) 회전축 — RiderMesh 가 각도를 천천히 바꾼다 */
type Hinge = React.RefObject<THREE.Group | null>;

function VehicleModel({ v, door, lid }: { v: VehicleType; door: Hinge; lid: Hinge }) {
  switch (v) {
    case 'MOTORCYCLE':
      // 배달 스쿠터(사용자 2026-11-20 "오토바이, 자동차 UI도 별로" — 참고 그림 스쿠터): 흰 몸통·발판, 검정 안장, 보라 배달통, 앞 방풍·핸들·전조등
      return (
        <>
          <mesh position={[0, 0.36, 0.05]} castShadow>
            <boxGeometry args={[0.34, 0.16, 0.95]} />
            <meshStandardMaterial color={0xf3f4f8} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.58, -0.22]} castShadow>
            <boxGeometry args={[0.36, 0.34, 0.6]} />
            <meshStandardMaterial color={0xf3f4f8} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.79, -0.12]} castShadow>
            <boxGeometry args={[0.3, 0.08, 0.5]} />
            <meshStandardMaterial color={0x23262f} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.72, 0.5]} rotation-x={-0.25} castShadow>
            <boxGeometry args={[0.34, 0.62, 0.1]} />
            <meshStandardMaterial color={0xf3f4f8} roughness={0.35} />
          </mesh>
          <mesh position={[0, 1.05, 0.46]} castShadow>
            <boxGeometry args={[0.6, 0.05, 0.05]} />
            <meshStandardMaterial color={0x23262f} />
          </mesh>
          <mesh position={[0, 0.92, 0.56]}>
            <boxGeometry args={[0.14, 0.08, 0.04]} />
            <meshStandardMaterial color={0xfff5c2} emissive={0xfff1a8} emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, 0.98, -0.55]} castShadow>
            <boxGeometry args={[0.48, 0.38, 0.44]} />
            <meshStandardMaterial color={0x7c5cf0} roughness={0.45} />
          </mesh>
          {/* 배달통 뚜껑 — 앞쪽 윗모서리가 축 */}
          <group ref={lid} position={[0, 1.18, -0.33]}>
            <mesh position={[0, 0, -0.22]} castShadow>
              <boxGeometry args={[0.5, 0.04, 0.46]} />
              <meshStandardMaterial color={0x6a4ad8} roughness={0.45} />
            </mesh>
          </group>
          {[-0.5, 0.52].map((z) => (
            <mesh key={z} position={[0, 0.2, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.2, 0.2, 0.11, 18]} />
              <meshStandardMaterial color={0x1c1f26} roughness={0.8} />
            </mesh>
          ))}
        </>
      );
    case 'BICYCLE':
    case 'E_BIKE':
      return (
        <>
          <mesh position-y={0.62} rotation-x={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.03, 0.03, 1.0, 6]} />
            <meshStandardMaterial color={v === 'E_BIKE' ? 0x43a047 : 0x1e88e5} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0.85, 0.42]} castShadow>
            <boxGeometry args={[0.5, 0.04, 0.04]} />
            <meshStandardMaterial color={0x333333} />
          </mesh>
          {v === 'E_BIKE' && (
            <mesh position={[0, 0.5, 0.05]} castShadow>
              <boxGeometry args={[0.12, 0.18, 0.35]} />
              <meshStandardMaterial color={0x222222} />
            </mesh>
          )}
          <mesh position={[0, 0.78, -0.45]} castShadow>
            <boxGeometry args={[0.42, 0.28, 0.36]} />
            <meshStandardMaterial color={0x7c5cf0} roughness={0.45} />
          </mesh>
          <group ref={lid} position={[0, 0.94, -0.27]}>
            <mesh position={[0, 0, -0.18]} castShadow>
              <boxGeometry args={[0.44, 0.04, 0.36]} />
              <meshStandardMaterial color={0x6a4ad8} roughness={0.45} />
            </mesh>
          </group>
          <Wheel z={-0.48} r={0.3} t={0.03} />
          <Wheel z={0.48} r={0.3} t={0.03} />
        </>
      );
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
      // 소형 승용(참고 그림 톤): 흰 차체 + 파란 옆줄, 짙은 유리 실내, 흰 지붕, 회색 범퍼, 전조등. 문·트렁크 축은 그대로
      return (
        <>
          <mesh position-y={0.48} castShadow>
            <boxGeometry args={[1.12, 0.5, 2.6]} />
            <meshStandardMaterial color={0xf5f7fb} roughness={0.3} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[1.14, 0.08, 2.4]} />
            <meshStandardMaterial color={0x2f6fe8} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.96, -0.05]} castShadow>
            <boxGeometry args={[1.0, 0.46, 1.45]} />
            <meshStandardMaterial color={0x23324f} roughness={0.15} metalness={0.3} transparent opacity={0.85} />
          </mesh>
          <mesh position={[0, 1.2, -0.08]} castShadow>
            <boxGeometry args={[0.98, 0.05, 1.25]} />
            <meshStandardMaterial color={0xf5f7fb} roughness={0.3} />
          </mesh>
          {[-1.31, 1.31].map((z) => (
            <mesh key={z} position={[0, 0.3, z]}>
              <boxGeometry args={[1.1, 0.16, 0.06]} />
              <meshStandardMaterial color={0x9aa3b0} roughness={0.6} />
            </mesh>
          ))}
          {[-0.38, 0.38].map((x) => (
            <mesh key={x} position={[x, 0.56, 1.31]}>
              <boxGeometry args={[0.22, 0.08, 0.03]} />
              <meshStandardMaterial color={0xfff5c2} emissive={0xfff1a8} emissiveIntensity={0.5} />
            </mesh>
          ))}
          {/* 운전석 문(+x 쪽) — 앞쪽 모서리가 축, 바깥으로(-각) 열린다 */}
          <group ref={door} position={[0.57, 0.62, 0.65]}>
            <mesh position={[0, 0, -0.5]} castShadow>
              <boxGeometry args={[0.05, 0.62, 1.0]} />
              <meshStandardMaterial color={0xf5f7fb} roughness={0.3} />
            </mesh>
          </group>
          {/* 트렁크 뚜껑(뒤 -z) — 앞쪽 윗모서리가 축, 위로 열린다 */}
          <group ref={lid} position={[0, 0.76, -0.6]}>
            <mesh position={[0, 0, -0.35]} castShadow>
              <boxGeometry args={[1.08, 0.05, 0.7]} />
              <meshStandardMaterial color={0xf5f7fb} roughness={0.3} />
            </mesh>
          </group>
          {[-0.85, 0.85].map((z) =>
            [-0.56, 0.56].map((x) => (
              <group key={`${x}${z}`} position={[x, 0.26, z]}>
                <mesh rotation-z={Math.PI / 2} castShadow>
                  <cylinderGeometry args={[0.24, 0.24, 0.16, 18]} />
                  <meshStandardMaterial color={0x1c1f26} roughness={0.8} />
                </mesh>
                <mesh rotation-z={Math.PI / 2} position={[x > 0 ? 0.085 : -0.085, 0, 0]}>
                  <cylinderGeometry args={[0.12, 0.12, 0.01, 14]} />
                  <meshStandardMaterial color={0xc8ced8} metalness={0.5} roughness={0.3} />
                </mesh>
              </group>
            )),
          )}
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
    fig.current?.animate(moved > 0.5 ? 0 : moved, dt, !riding0 ? 'walk' : r.vehicle === 'KICKBOARD' ? 'push' : 'ride');
    // 문·뚜껑은 목표 각도로 천천히(약 RIDER_VEHICLE.hatchSec) — 문 70°, 트렁크·배달통 63°
    const k = Math.min(1, dt * 6);
    ang.current.door += ((r.door ? -1.2 : 0) - ang.current.door) * k;
    ang.current.lid += ((r.trunk ? 1.1 : 0) - ang.current.lid) * k;
    if (door.current) door.current.rotation.y = ang.current.door;
    if (lid.current) lid.current.rotation.x = ang.current.lid;
    box.current.visible = r.carrying > 0 && !r.stowed;
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
          <mesh ref={box} position={[0, 1.15, -0.32]} visible={false}>
            <boxGeometry args={[0.42, 0.36, 0.3]} />
            <meshStandardMaterial color={0x00897b} />
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
  useFrame(() => {
    const t = sim.trucks.find((x) => x.trfId === trfId);
    // 뒷문(로컬 x=-3.2)이 truck.x - 3.2 에 오도록
    if (t) group.current.position.set(t.x, 0, sim.layout.points.truckDock.z);
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
