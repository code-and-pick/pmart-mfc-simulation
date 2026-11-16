// 바코드에서 고른 자리를 잠깐 보인다(노란 기둥 + 바닥 고리, 깜빡임).
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';

export function ScanMarker() {
  const { controller } = useApp();
  const g = useRef<THREE.Group>(null!);
  useFrame(() => {
    const m = controller.marker;
    const on = !!m && performance.now() < m.until;
    g.current.visible = on && Math.floor(performance.now() / 350) % 2 === 0;
    if (on) g.current.position.set(m!.x, 0, m!.z);
  });
  return (
    <group ref={g} visible={false}>
      <mesh position-y={1.6}>
        <cylinderGeometry args={[0.06, 0.06, 3.2, 12]} />
        <meshBasicMaterial color={0xffd400} transparent opacity={0.85} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
        <ringGeometry args={[0.3, 0.45, 32]} />
        <meshBasicMaterial color={0xffd400} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
