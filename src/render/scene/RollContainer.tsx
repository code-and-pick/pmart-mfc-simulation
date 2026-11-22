// 롤테이너 모형 — 입고·검수 장식(Decor)과 입고 작업자가 미는 짐수레(Agents)가 같이 쓴다

/**
 * 롤테이너(롤 컨테이너) — 바퀴 달린 철망 짐수레 0.8×0.6×1.7 m [시뮬]. 입고 상품은 지게차가 아니라 롤테이너로 옮긴다
 * (사용자 2026-11-21 "지게차 없애. 롤테이너로 옮기니까" — 전엔 지게차 장식)
 */
export function RollContainer({ x, z, rot = 0, boxes = true }: { x: number; z: number; rot?: number; boxes?: boolean }) {
  const W = 0.8;
  const D = 0.6;
  const H = 1.7;
  const frame = 0x2f6fd6; // 파랑(사용자 2026-11-21 "롤테이너 색은 파랑이야")
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {/* 바닥판 */}
      <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, 0.04, D]} />
        <meshStandardMaterial color={0x24569f} metalness={0.3} roughness={0.5} />
      </mesh>
      {/* 바퀴 4개 */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`w${sx}${sz}`} position={[sx * (W / 2 - 0.07), 0.06, sz * (D / 2 - 0.07)]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.06, 0.06, 0.04, 12]} />
            <meshStandardMaterial color={0x1f2229} />
          </mesh>
        )),
      )}
      {/* 기둥 4개 */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`p${sx}${sz}`} position={[sx * (W / 2 - 0.015), 0.18 + (H - 0.18) / 2, sz * (D / 2 - 0.015)]} castShadow>
            <boxGeometry args={[0.03, H - 0.18, 0.03]} />
            <meshStandardMaterial color={frame} metalness={0.5} roughness={0.35} />
          </mesh>
        )),
      )}
      {/* 철망 옆판 3면(앞은 열림): 가로 살 */}
      {[0.45, 0.75, 1.05, 1.35, 1.65].flatMap((y) => [
        <mesh key={`b${y}`} position={[0, y, -D / 2 + 0.015]}>
          <boxGeometry args={[W, 0.02, 0.015]} />
          <meshStandardMaterial color={frame} metalness={0.5} roughness={0.35} />
        </mesh>,
        ...[-1, 1].map((sx) => (
          <mesh key={`s${y}${sx}`} position={[sx * (W / 2 - 0.015), y, 0]}>
            <boxGeometry args={[0.015, 0.02, D]} />
            <meshStandardMaterial color={frame} metalness={0.5} roughness={0.35} />
          </mesh>
        )),
      ])}
      {/* 세로 살(뒤판) */}
      {[-0.25, -0.08, 0.08, 0.25].map((dx) => (
        <mesh key={`v${dx}`} position={[dx, 0.18 + (H - 0.18) / 2, -D / 2 + 0.015]}>
          <boxGeometry args={[0.012, H - 0.18, 0.012]} />
          <meshStandardMaterial color={frame} metalness={0.5} roughness={0.35} />
        </mesh>
      ))}
      {/* 상자 몇 개(장식용만 — 입고 작업자가 미는 롤테이너는 실린 상자를 따로 그린다) */}
      {boxes && <>
      <mesh position={[-0.15, 0.36, 0]} castShadow>
        <boxGeometry args={[0.36, 0.36, 0.5]} />
        <meshStandardMaterial color={0xd2a679} roughness={0.85} />
      </mesh>
      <mesh position={[0.2, 0.33, 0.02]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.44]} />
        <meshStandardMaterial color={0xc99a6b} roughness={0.85} />
      </mesh>
      </>}
    </group>
  );
}
