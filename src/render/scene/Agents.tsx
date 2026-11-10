// 움직이는 것들: 피킹·패킹 작업자, 입고 작업자, 라이더, 입고 차량.
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import type { P as Point } from '../../domain/navgrid';
import type { InboundWorker } from '../../sim/inbound';
import type { Worker } from '../../sim/worker';
import { INBOUND_COLOR, STATE_COLOR, TEMP_COLOR, VEST_INBOUND, VEST_PICKER } from '../colors';
import { makeLabel } from '../sprites';
import { Box } from './Facility';

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
  const bodyMat = useRef<THREE.MeshStandardMaterial>(null!);
  const cart = useRef<THREE.Mesh>(null!);
  const bags = useRef<THREE.Mesh[]>([]);
  const tag = useMemo(() => makeLabel(id, { size: 30, bg: kind === 'worker' ? 'rgba(0,0,0,0.65)' : 'rgba(120,60,0,0.75)', screenPx: 15 }), [id, kind]);
  const ud = useMemo(() => ({ personId: id, personKind: kind }), [id, kind]);

  useEffect(() => {
    registry.people.set(id, group.current);
    return () => {
      registry.people.delete(id);
    };
  }, [id, registry]);

  useFrame(() => {
    const a: Worker | InboundWorker | undefined =
      kind === 'worker' ? sim.workers.find((x) => x.id === id) : sim.inboundWorkers.find((x) => x.id === id);
    if (!a) return;
    group.current.position.set(a.pos.x, 0, a.pos.z);
    group.current.rotation.y = a.heading;
    bodyMat.current.color.setHex(kind === 'worker' ? STATE_COLOR[(a as Worker).state] : INBOUND_COLOR[(a as InboundWorker).state]);
    const s = controller.selection;
    const sel = s && s.kind !== 'location' && s.id === id;
    bodyMat.current.emissive.setHex(sel ? 0x444444 : 0x000000);
    cart.current.visible = a.hasCart || a.carrying.length > 0;
    bags.current.forEach((b, i) => {
      const t = a.carrying[i];
      b.visible = t !== undefined;
      if (t) (b.material as THREE.MeshStandardMaterial).color.setHex(kind === 'inbound' ? (t === 'AMBIENT' ? 0xb98c5a : 0xe3e8ee) : TEMP_COLOR[t]);
    });
  });

  const isWorker = kind === 'worker';
  const bagSize = isWorker ? 0.16 : 0.26;
  const per = isWorker ? 3 : 2;
  return (
    <group ref={group}>
      <mesh position-y={0.66} castShadow userData={ud}>
        <capsuleGeometry args={[0.22, 0.85, 4, 12]} />
        <meshStandardMaterial ref={bodyMat} color={0x9aa0a6} roughness={0.5} />
      </mesh>
      <mesh position-y={1.42} castShadow userData={ud}>
        <sphereGeometry args={[0.17, 16, 12]} />
        <meshStandardMaterial color={0xf1d3b3} />
      </mesh>
      <mesh position-y={0.95} castShadow userData={ud}>
        <boxGeometry args={[0.46, 0.3, 0.3]} />
        <meshStandardMaterial color={isWorker ? VEST_PICKER : VEST_INBOUND} />
      </mesh>
      <mesh ref={cart} position={[0, isWorker ? 0.45 : 0.12, isWorker ? 0.55 : 0.75]} castShadow>
        {isWorker ? <boxGeometry args={[0.45, 0.5, 0.65]} /> : <boxGeometry args={[0.6, 0.14, 0.95]} />}
        {isWorker ? <meshStandardMaterial color={0x4a90d9} transparent opacity={0.85} /> : <meshStandardMaterial color={0x546e7a} metalness={0.3} />}
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
    () => [...sim.workers.map((a) => ({ id: a.id, kind: 'worker' as Kind })), ...sim.inboundWorkers.map((a) => ({ id: a.id, kind: 'inbound' as Kind }))],
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

function RiderMesh({ id, parking }: { id: string; parking: Point }) {
  const { sim } = useApp();
  const group = useRef<THREE.Group>(null!);
  const box = useRef<THREE.Mesh>(null!);
  const tag = useMemo(() => makeLabel(id, { size: 28, bg: 'rgba(0,80,90,0.75)', screenPx: 15 }), [id]);
  useFrame(() => {
    const r = sim.riders.find((x) => x.id === id);
    if (!r) return;
    group.current.position.set(r.pos.x, 0, r.pos.z);
    group.current.rotation.y = r.heading;
    box.current.visible = r.carrying > 0;
  });
  return (
    <>
      <group ref={group}>
        <mesh position-y={0.66} castShadow>
          <capsuleGeometry args={[0.22, 0.85, 4, 12]} />
          <meshStandardMaterial color={0x26c6da} />
        </mesh>
        <mesh position-y={1.44}>
          <sphereGeometry args={[0.2, 16, 12]} />
          <meshStandardMaterial color={0xffffff} />
        </mesh>
        <mesh ref={box} position={[0, 1.0, -0.3]} visible={false}>
          <boxGeometry args={[0.42, 0.36, 0.3]} />
          <meshStandardMaterial color={0x00897b} />
        </mesh>
        <primitive object={tag} position-y={1.95} />
      </group>
      {/* 오토바이는 주차 자리에 서 있다 */}
      <group position={[parking.x, 0, parking.z + 0.9]}>
        <mesh position-y={0.55} castShadow>
          <boxGeometry args={[0.35, 0.5, 1.6]} />
          <meshStandardMaterial color={0xd32f2f} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.95, -0.55]} castShadow>
          <boxGeometry args={[0.5, 0.45, 0.5]} />
          <meshStandardMaterial color={0xeeeeee} />
        </mesh>
        {[-0.6, 0.6].map((z) => (
          <mesh key={z} rotation-y={Math.PI / 2} position={[0, 0.27, z]} castShadow>
            <torusGeometry args={[0.25, 0.08, 8, 16]} />
            <meshStandardMaterial color={0x111111} />
          </mesh>
        ))}
      </group>
    </>
  );
}

export function Riders() {
  const { sim } = useApp();
  const riders = useIdList(
    () => sim.riders.map((r) => ({ id: r.id, parking: r.parking })),
    (r) => r.id,
  );
  return (
    <>
      {riders.map((r) => (
        <RiderMesh key={r.id} id={r.id} parking={r.parking} />
      ))}
    </>
  );
}

/** 입고 차량(5톤 탑차 가정): 뒷문이 입고 차량문을 향한다. */
function Truck({ trfId }: { trfId: string }) {
  const { sim } = useApp();
  const group = useRef<THREE.Group>(null!);
  const tag = useMemo(() => makeLabel(trfId, { size: 30, bg: 'rgba(30,60,120,0.85)', screenPx: 15 }), [trfId]);
  useFrame(() => {
    const t = sim.trucks.find((x) => x.trfId === trfId);
    // 뒷문(로컬 x=-3.2)이 truck.x - 3.2 에 오도록
    if (t) group.current.position.set(t.x, 0, sim.layout.points.truckDock.z);
  });
  return (
    <group ref={group}>
      <Box size={[5.0, 2.5, 2.3]} color={0xe8eaed} position={[-0.7, 1.55, 0]} />
      <Box size={[5.02, 0.35, 2.32]} color={0x1e88e5} position={[-0.7, 1.0, 0]} />
      <Box size={[1.7, 2.0, 2.2]} color={0x37474f} position={[2.75, 1.3, 0]} />
      <Box size={[0.05, 0.7, 1.9]} color={0x90caf9} position={[3.61, 1.75, 0]} material={{ metalness: 0.6, roughness: 0.1 }} />
      {[-2.4, -1.2, 2.6].flatMap((x) =>
        [-1.0, 1.0].map((z) => (
          <mesh key={`${x}:${z}`} rotation-x={Math.PI / 2} position={[x, 0.42, z]}>
            <cylinderGeometry args={[0.42, 0.42, 0.3, 18]} />
            <meshStandardMaterial color={0x111111} />
          </mesh>
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
