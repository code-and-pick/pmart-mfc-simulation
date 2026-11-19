// 사람 모델(사용자 2026-11-19 "작업자랑 라이더 모델링 좀 바꿔줘 너무 더미인데") — 낮은 다각형 사람:
// 다리·팔(어깨·엉덩이 관절로 흔들림)·몸통·조끼/재킷·머리·머리카락 또는 헬멧. 앞 = +z(Agent heading = atan2(dx, dz)).
// 걷기: 움직인 거리로 팔다리를 흔든다. 카트를 밀면 팔을 앞으로, 수단을 타면 앉은 자세(다리 앞으로, 팔은 손잡이).
import { forwardRef, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';

export interface HumanoidLook {
  /** 셔츠·바지 */
  shirt: number;
  pants: number;
  /** 조끼(작업자)·재킷(라이더) — null 이면 없음 */
  vest: number | null;
  skin?: number;
  /** 머리: 머리카락(작업자) 또는 헬멧(라이더) */
  head: 'hair' | 'helmet' | 'cap';
  headColor: number;
  /** 손에 든 PDA */
  pda?: boolean;
}

export interface HumanoidHandle {
  /** 매 프레임: 이번 프레임에 움직인 거리(m)·dt·자세 */
  animate(moved: number, dt: number, pose: 'walk' | 'push' | 'ride'): void;
  /** 고름 표시(조끼·재킷 밝게) */
  highlight(on: boolean): void;
}

const HIP_Y = 0.86;
const SHOULDER_Y = 1.36;
const LEG = 0.82;
const ARM = 0.62;

export const Humanoid = forwardRef<HumanoidHandle, { look: HumanoidLook }>(function Humanoid({ look }, ref) {
  const legL = useRef<THREE.Group>(null!);
  const legR = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const vestMat = useRef<THREE.MeshStandardMaterial>(null);
  const st = useRef({ phase: 0, amp: 0 });
  const skin = look.skin ?? 0xf1d3b3;

  useImperativeHandle(ref, () => ({
    animate(moved, dt, pose) {
      const s = st.current;
      // 걷기 박자: 걸음 하나(약 0.7 m)에 한 번 앞뒤
      s.phase += moved * 4.5;
      const target = pose === 'ride' ? 0 : moved > 1e-4 ? 0.55 : 0;
      s.amp += (target - s.amp) * Math.min(1, dt * 8);
      const sw = Math.sin(s.phase) * s.amp;
      if (pose === 'ride') {
        // 앉은 자세: 다리 앞으로 접고 팔은 손잡이 쪽
        legL.current.rotation.x = -1.35;
        legR.current.rotation.x = -1.35;
        armL.current.rotation.x = -1.0;
        armR.current.rotation.x = -1.0;
        return;
      }
      legL.current.rotation.x = sw;
      legR.current.rotation.x = -sw;
      if (pose === 'push') {
        // 카트 손잡이를 잡고 민다 — 팔은 앞으로 고정, 조금만 흔들림
        armL.current.rotation.x = -1.15 + sw * 0.1;
        armR.current.rotation.x = -1.15 - sw * 0.1;
      } else {
        armL.current.rotation.x = -sw * 0.9;
        armR.current.rotation.x = look.pda ? -0.75 : sw * 0.9; // PDA 든 오른손은 앞으로
      }
    },
    highlight(on) {
      vestMat.current?.emissive.setHex(on ? 0x3a3a3a : 0x000000);
    },
  }));

  return (
    <group>
      {/* 다리(엉덩이 관절) */}
      {[
        [legL, -0.11],
        [legR, 0.11],
      ].map(([r, x]) => (
        <group key={x as number} ref={r as React.RefObject<THREE.Group>} position={[x as number, HIP_Y, 0]}>
          <mesh position-y={-LEG / 2} castShadow>
            <capsuleGeometry args={[0.075, LEG - 0.15, 3, 8]} />
            <meshStandardMaterial color={look.pants} roughness={0.8} />
          </mesh>
          <mesh position={[0, -LEG + 0.02, 0.05]} castShadow>
            <boxGeometry args={[0.13, 0.08, 0.26]} />
            <meshStandardMaterial color={0x2b2b2b} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* 몸통 */}
      <mesh position-y={1.12} castShadow>
        <capsuleGeometry args={[0.19, 0.36, 4, 10]} />
        <meshStandardMaterial color={look.shirt} roughness={0.7} />
      </mesh>
      {look.vest !== null && (
        <mesh position-y={1.13} castShadow>
          <cylinderGeometry args={[0.215, 0.205, 0.46, 12, 1, true]} />
          <meshStandardMaterial ref={vestMat} color={look.vest} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* 팔(어깨 관절) */}
      {[
        [armL, -0.26],
        [armR, 0.26],
      ].map(([r, x]) => (
        <group key={x as number} ref={r as React.RefObject<THREE.Group>} position={[x as number, SHOULDER_Y, 0]}>
          <mesh position-y={-ARM / 2} castShadow>
            <capsuleGeometry args={[0.06, ARM - 0.12, 3, 8]} />
            <meshStandardMaterial color={look.vest ?? look.shirt} roughness={0.7} />
          </mesh>
          <mesh position-y={-ARM + 0.02}>
            <sphereGeometry args={[0.055, 8, 6]} />
            <meshStandardMaterial color={skin} />
          </mesh>
          {look.pda && (x as number) > 0 && (
            <mesh position={[0, -ARM + 0.02, 0.06]} rotation-x={0.4}>
              <boxGeometry args={[0.08, 0.16, 0.025]} />
              <meshStandardMaterial color={0x222831} emissive={0x1d4ed8} emissiveIntensity={0.25} />
            </mesh>
          )}
        </group>
      ))}
      {/* 목·머리 */}
      <mesh position-y={1.47}>
        <cylinderGeometry args={[0.055, 0.06, 0.08, 8]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position-y={1.6} castShadow>
        <sphereGeometry args={[0.125, 14, 10]} />
        <meshStandardMaterial color={skin} roughness={0.6} />
      </mesh>
      {look.head === 'hair' && (
        <mesh position={[0, 1.64, -0.015]} scale={[1.04, 0.85, 1.06]}>
          <sphereGeometry args={[0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={look.headColor} roughness={0.9} />
        </mesh>
      )}
      {look.head === 'cap' && (
        <>
          <mesh position={[0, 1.655, 0]}>
            <sphereGeometry args={[0.132, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={look.headColor} roughness={0.7} />
          </mesh>
          <mesh position={[0, 1.66, 0.13]} rotation-x={0.15}>
            <boxGeometry args={[0.2, 0.015, 0.11]} />
            <meshStandardMaterial color={look.headColor} roughness={0.7} />
          </mesh>
        </>
      )}
      {look.head === 'helmet' && (
        <>
          <mesh position={[0, 1.63, 0]} castShadow>
            <sphereGeometry args={[0.16, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
            <meshStandardMaterial color={look.headColor} roughness={0.35} metalness={0.1} />
          </mesh>
          {/* 바이저: 구의 앞(+z) 조각 — three 구는 φ=π/2 가 +z */}
          <mesh position={[0, 1.6, 0.02]}>
            <sphereGeometry args={[0.15, 14, 8, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.35, Math.PI * 0.25]} />
            <meshStandardMaterial color={0x1f2937} roughness={0.15} metalness={0.4} transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
        </>
      )}
    </group>
  );
});
