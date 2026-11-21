// 고정 시설: 바닥·구역·벽·랙·장애물·패킹대·거치대.
import { dividerInside, shelfInside } from '../../domain/wideCells';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useApp, useTick } from '../../app/context';
import { BACKEND_FACTS } from '../../config';
import { RACK_DEPTH, RACK_HEIGHT, RACK_LEN, type Layout } from '../../domain/layout';
import { SCENE, ZONE_FLOOR } from '../colors';
import { makeLabel, makePillSprite } from '../sprites';
import { ZoneNames } from './ZoneNames';
import { CartDepot, InboundDecor, RETURN_TABLE, ReturnTable, StartMark, ParkingDecor, Walkways, WorkingCells } from './Decor';

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
export function Label({ text, position, opts, noNudge, anchorX }: { text: string; position: Vec3; opts: Parameters<typeof makeLabel>[1]; noNudge?: boolean; anchorX?: number }) {
  const sprite = useMemo(() => {
    const s = makeLabel(text, opts);
    if (anchorX !== undefined) s.center.x = anchorX; // 0 = 왼쪽 끝이 자리, 1 = 오른쪽 끝이 자리
    if (noNudge) {
      s.userData.noNudge = true; // 겹치면 비키지 말고 숨김(Declutter)
      s.userData.shrinkFar = true; // 멀면 작게
    }
    return s;
  }, [text]);
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

/** 바닥 흰 실선 사각형(구역 경계) — 빛을 받지 않는 흰색이라 옅은 바닥 위에서 또렷하다 */
function SolidRect({ x0, z0, x1, z1, width }: { x0: number; z0: number; x1: number; z1: number; width: number }) {
  const w = x1 - x0;
  const d = z1 - z0;
  const y = 0.013;
  const sides: [number, number, number, number][] = [
    [x0 + w / 2, z0, w + width, width],
    [x0 + w / 2, z1, w + width, width],
    [x0, z0 + d / 2, width, d],
    [x1, z0 + d / 2, width, d],
  ];
  return (
    <>
      {sides.map(([x, z, sx, sz], i) => (
        <mesh key={i} position={[x, y, z]} raycast={() => null}>
          <boxGeometry args={[sx, 0.004, sz]} />
          <meshBasicMaterial color={0xffffff} />
        </mesh>
      ))}
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
              {/* 구역 바닥(사용자 2026-11-20 참고 그림 "그림처럼") — 냉동 옅은 하늘·냉장 옅은 연두, 나머지 거의 흰색. 경계는 옅은 점선. 이름은 떠 있는 둥근 이름표(ZoneNames) */}
              <meshStandardMaterial color={ZONE_FLOOR[z.kind]} roughness={0.95} />
            </mesh>
            {/* 구역 경계 — 바닥 흰 실선(사용자 2026-11-20 "구역 나눠놓은게 잘 안보여. 하얀 실선으로 바닥에 확실하게") */}
            {z.kind !== 'PARKING' && <SolidRect x0={r.x0 + 0.12} z0={r.z0 + 0.12} x1={r.x1 - 0.12} z1={r.z1 - 0.12} width={z.kind === 'QUARANTINE' ? 0.1 : 0.16} />}
          </group>
        );
      })}
    </>
  );
}

/** 벽: 높은 투명벽(사용자 2026-11-20 "벽은 아까처럼 높은 투명벽으로") — 투명도는 화면 상태(구역 확대·사용자 선택)를 따른다. 구역 이름판은 뒷벽에 붙음(ZoneNames). */
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
              color={w.glass ? 0xd2e4fa : SCENE.wall}
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
  // 양 끝 옆틀 대각 보강대(그림의 랙 옆면) — 끝마다 BRACES 개 지그재그
  const braces = useRef<THREE.InstancedMesh>(null!);
  const BRACES = 4;
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
    let ki = 0;
    for (const r of L.racks) {
      // 옆틀 대각선: 끝(길이 방향 ±) 마다, 앞뒤 기둥 사이를 지그재그로
      const segH = (RACK_HEIGHT - 0.15) / BRACES;
      const depth = RACK_DEPTH - 0.08;
      const len = Math.hypot(depth, segH);
      const ang = Math.atan2(segH, depth);
      for (const e of [-1, 1]) {
        const a = e * (RACK_LEN / 2 - 0.03);
        for (let k = 0; k < BRACES; k++) {
          const y = 0.08 + segH * (k + 0.5);
          const flip = k % 2 ? -1 : 1;
          const pos = r.along === 'x' ? new THREE.Vector3(r.cx + a, y, r.cz) : new THREE.Vector3(r.cx, y, r.cz + a);
          // 막대는 처음에 깊이 방향(along x 면 z, along z 면 x)으로 누워 있고, 그 면 안에서 기울인다
          const rot = r.along === 'x' ? new THREE.Quaternion().setFromEuler(new THREE.Euler(flip * ang, 0, 0)) : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, flip * ang));
          const sc = r.along === 'x' ? new THREE.Vector3(0.025, 0.025, len) : new THREE.Vector3(len, 0.025, 0.025);
          mtx.compose(pos, rot, sc);
          braces.current.setMatrixAt(ki++, mtx);
        }
      }
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
      const dh = Math.min(0.05, levelH * 0.2); // 칸막이 높이 — 그림처럼 거의 안 보이게 낮게(칸 수는 보이되 어지럽지 않게)
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
          // 칸 경계는 앞 가로대 위 짧은 표시만(전엔 선반 깊이 전체 칸막이 — 확대하면 지느러미처럼 어지러웠다, 사용자 2026-11-20)
          const front = (r.face * (RACK_DEPTH - 0.04)) / 2;
          if (r.along === 'x') p.z += front;
          else p.x += front;
          mtx.compose(p, q, r.along === 'x' ? new THREE.Vector3(0.012, dh, 0.05) : new THREE.Vector3(0.05, dh, 0.012));
          dividers.current.setMatrixAt(di++, mtx);
        }
      }
    }
    for (const m of [dividers, posts, shelves, beams, braces]) {
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
      <instancedMesh ref={braces} args={[undefined, undefined, L.racks.length * 2 * BRACES]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SCENE.rackPost} metalness={0.2} roughness={0.5} />
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

/** 장애물: 포장재·출하 랙 (보충재고 팔레트는 Reserves). 출하대기(인계) 랙 앞에는 파란 번호판 "인계 랙 N"(사용자 2026-11-20 "인계랙도 구별이 가능하게 번호라도") */
function Obstacles({ L }: { L: Layout }) {
  const ship = L.obstacles.filter((o) => o.kind === 'SHIP_RACK').sort((a, b) => a.rect.x0 - b.rect.x0);
  const shipTags = useMemo(() => ship.map((_, i) => makePillSprite(`인계 랙 ${i + 1}`, '#1f63d8', '#3d8bff', 18)), [ship.length]);
  return (
    <>
      {ship.map((o, i) => (
        // 랙 앞면 아래(라이더 쪽) — 위에 뜨는 랙 말풍선에 가리지 않게. 다른 랙 번호판과 같은 파란 판·흰 글자(사용자 2026-11-20 "인계랙 식별값 … 왜 지혼자 노란배경에 검정 글씨")
        <primitive key={`sr${i}`} object={shipTags[i]} position={[(o.rect.x0 + o.rect.x1) / 2, 0.55, o.rect.z1 + 0.15]} />
      ))}
      {ship.map((o, i) => (
        <ShipRack key={`srk${i}`} r={o.rect} h={o.height} />
      ))}
      {/* 냉동·냉장·상온 격리 구역마다 흰 랙 2개(인계 랙과 같은 모양) — 뒤쪽 벽을 따라(사용자 2026-11-21 "각각 격리 구역에도 하얀랙으로") */}
      {L.zones
        .filter((z) => z.kind === 'QUARANTINE')
        .flatMap((z) =>
          [0, 1].map((i) => {
            const x0 = z.rect.x0 + 0.3 + i * (RACK_LEN + 0.15);
            return <ShipRack key={`qr-${z.id}-${i}`} r={{ x0, z0: z.rect.z0 + 0.15, x1: x0 + RACK_LEN, z1: z.rect.z0 + 0.15 + RACK_DEPTH }} h={RACK_HEIGHT} />;
          }),
        )}
      {L.obstacles
        .filter((o) => o.kind === 'MATERIAL')
        .map((o, i) => (
          <ShipRack key={`mat${i}`} r={o.rect} h={o.height} grey />
        ))}
      {L.obstacles.map((o, i) => {
        if (o.kind === 'TABLE' || o.kind === 'RESERVE' || o.kind === 'SHIP_RACK' || o.kind === 'MATERIAL') return null;
        const r = o.rect;
        // 밝은 장면(SCENE): 팔레트 나무색, 포장재 연한 회청색 (인계 랙은 ShipRack)
        const color = o.kind === 'PALLET' ? 0x8d6e4a : 0xaab6c4;
        return (
          <Box
            key={i}
            size={[r.x1 - r.x0, o.height, r.z1 - r.z0]}
            color={color}
            position={[(r.x0 + r.x1) / 2, o.height / 2, (r.z0 + r.z1) / 2]}
          />
        );
      })}
    </>
  );
}

/**
 * 인계(출하대기) 랙 — 안쪽 보관 랙과 같은 생김새(기둥·앞뒤 가로대·선반 판·옆면 가새), 색만 흰색
 * (사용자 2026-11-20 "인계랙도 안에 있는 랙에리아 똑같이 생긴건데. 색은 대신 하양색"). 단 높이 = 출하 칸(layout shippingSlots y 0.25 + 0.5·단).
 */
function ShipRack({ r, h, grey = false }: { r: { x0: number; z0: number; x1: number; z1: number }; h: number; grey?: boolean }) {
  const W = r.x1 - r.x0;
  const D = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  // 패킹 구역 포장재 랙도 같은 모양·같은 흰색(사용자 2026-11-20 "패킹구역에 있는 회색도 같은 랙인데 인계랙이랑 같은 흰색으로") — grey 는 단 높이만
  const post = 0xf4f6fa;
  const beam = 0xffffff;
  const deck = 0xe9edf3;
  const levels = grey ? [0.3, 0.8, 1.3].filter((y) => y < h - 0.1) : [0.25, 0.75, 1.25, 1.75];
  const P = 0.06;
  return (
    <group position={[cx, 0, cz]}>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`p${sx}${sz}`} position={[(sx * (W - P)) / 2, h / 2, (sz * (D - P)) / 2]} castShadow>
            <boxGeometry args={[P, h, P]} />
            <meshStandardMaterial color={post} roughness={0.45} />
          </mesh>
        )),
      )}
      {levels.map((y) => (
        <group key={y}>
          <mesh position={[0, y - 0.02, 0]} receiveShadow>
            <boxGeometry args={[W - 0.04, 0.025, D - 0.04]} />
            <meshStandardMaterial color={deck} roughness={0.6} />
          </mesh>
          {[-1, 1].map((sz) => (
            <mesh key={sz} position={[0, y - 0.05, (sz * (D - 0.05)) / 2]} castShadow>
              <boxGeometry args={[W, 0.07, 0.05]} />
              <meshStandardMaterial color={beam} roughness={0.35} />
            </mesh>
          ))}
        </group>
      ))}
      {/* 포장재 랙: 단마다 접어 쌓은 비닐봉투 묶음(흰 비닐·은색 보냉) + 봉투 롤(장식, 사용자 2026-11-20 "패킹랙에는 비닐봉지 같은 부품 장식으로") */}
      {grey &&
        levels.map((y, li) => {
          const long = D > W; // 긴 쪽으로 늘어놓는다
          const L = (long ? D : W) - 0.2;
          const S = (long ? W : D) - 0.16;
          const at = (t: number): [number, number] => (long ? [0, t] : [t, 0]);
          return (
            <group key={`bag${y}`}>
              {[0, 1, 2].map((k) => {
                const [ox, oz] = at(-L / 2 + (L / 3) * (k + 0.5));
                const silver = (k + li) % 2 === 1;
                const hh = 0.06 + ((k * 3 + li) % 3) * 0.03;
                return (
                  <mesh key={k} position={[ox, y + hh / 2, oz]} castShadow>
                    <boxGeometry args={long ? [S, hh, L / 3 - 0.06] : [L / 3 - 0.06, hh, S]} />
                    <meshStandardMaterial color={silver ? 0xc9d3de : 0xf7f8fa} roughness={silver ? 0.3 : 0.4} metalness={silver ? 0.25 : 0} />
                  </mesh>
                );
              })}
              {li % 2 === 0 && (
                <mesh position={[...((): [number, number, number] => { const [ox, oz] = at(L / 2 - 0.12); return [ox, y + 0.2, oz]; })()]} rotation={long ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.07, 0.07, S * 0.9, 14]} />
                  <meshStandardMaterial color={0xeef1f6} roughness={0.35} />
                </mesh>
              )}
            </group>
          );
        })}
      {/* 옆면 가새(대각선) */}
      {[-1, 1].map((sx) =>
        [0, 1, 2].filter((k) => 0.35 + k * 0.6 + 0.3 < h).map((k) => (
          <mesh key={`b${sx}${k}`} position={[(sx * (W - P)) / 2, 0.35 + k * 0.6, 0]} rotation={[k % 2 ? 0.75 : -0.75, 0, 0]}>
            <boxGeometry args={[0.02, 0.62, 0.02]} />
            <meshStandardMaterial color={post} roughness={0.45} />
          </mesh>
        )),
      )}
    </group>
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
 * 회수(반품) 반입 자리 RTN-A-01 — 화면은 인계 구역(라이더가 들고 옴, 사용자 2026-11-21). 서버 좌표는 입고·검수 구역(config returnIntake 주석).
 * 실서버: 이 센터로 오는 회수 배송(고객 반품·오배송 회수, delivery-dispatch 0.5.0) 수 — 오는 중 / 반납됨.
 */
function ReturnIntake() {
  const p = BACKEND_FACTS.returnIntake;
  const { sim } = useApp();
  useTick();
  const rp = sim.real?.returnPickups ?? [];
  const arrived = rp.filter((d) => d.state === 'RETURNED_TO_STORE' || d.state === 'COMPLETED').length;
  const coming = rp.length - arrived;
  const text = `회수 반입${coming ? ` · 오는 중 ${coming}` : ''}${arrived ? ` · 반납 ${arrived}` : ''}`;
  return (
    <>
      {/* 바닥보다 조금 짙은 회색 판(사용자 2026-11-21 "회수반입은 그냥 바닥보다 좀 더 짙은 색으로" — 전엔 초록, 뜻 없던 색) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.012, p.z]} receiveShadow>
        <planeGeometry args={[1.2, 1.2]} />
        <meshStandardMaterial color={0xb9bdc6} roughness={0.9} />
      </mesh>
      <Label text={text} position={[p.x, 1.6, p.z]} opts={{ size: 28, bg: 'rgba(52,58,70,0.8)', screenPx: 14 }} />
      {arrived > 0 && (
        <mesh position={[p.x, 0.25, p.z]} castShadow>
          <boxGeometry args={[0.5, 0.5, 0.4]} />
          <meshStandardMaterial color={0xb98c5a} roughness={0.8} />
        </mesh>
      )}
    </>
  );
}

/**
 * 패킹대(사용자 2026-11-20 참고 그림 "패킹대 생김새도 똑같이"): 흰 긴 작업대 + 연회색 틀 + 아래 파란 바구니 2개 + 위 상자 2개·테이프 디스펜서.
 * 상태는 위 PS-n 판 색(꺼짐 회색·비어 있음 보라·사용 중 주황) — 몸통 색으로 칠하지 않는다.
 */
function Stations({ L }: { L: Layout }) {
  const { sim } = useApp();
  const tags = useMemo(
    () =>
      L.stations.map((st) => ({
        free: makePillSprite(st.id, '#5b4fd6', '#7a62ee', 17),
        busy: makePillSprite(st.id, '#e8742a', '#ff9a4d', 17),
        off: makePillSprite(st.id, '#9aa1ad', '#b6bcc6', 15),
      })),
    [L],
  );
  useFrame(() => {
    L.stations.forEach((st, i) => {
      const active = sim.stations.isActive(i);
      const busy = !!sim.stations.occupant(st.id);
      tags[i].free.visible = active && !busy;
      tags[i].busy.visible = active && busy;
      tags[i].off.visible = !active;
    });
  });
  const frame = 0xc9d0da;
  return (
    <>
      {L.stations.map((st, i) => {
        const { x, z } = st.table;
        return (
          <group key={st.id}>
            {/* 상판(흰) + 앞 모서리 띠 */}
            <mesh position={[x, 0.86, z]} castShadow receiveShadow>
              <boxGeometry args={[1.6, 0.05, 0.8]} />
              <meshStandardMaterial color={0xffffff} roughness={0.45} />
            </mesh>
            <mesh position={[x, 0.82, z]}>
              <boxGeometry args={[1.62, 0.04, 0.82]} />
              <meshStandardMaterial color={frame} roughness={0.5} />
            </mesh>
            {/* 다리·아래 선반 */}
            {[-1, 1].flatMap((sx) =>
              [-1, 1].map((sz) => (
                <mesh key={`${sx}${sz}`} position={[x + sx * 0.76, 0.41, z + sz * 0.36]} castShadow>
                  <boxGeometry args={[0.045, 0.82, 0.045]} />
                  <meshStandardMaterial color={frame} metalness={0.2} roughness={0.5} />
                </mesh>
              )),
            )}
            <mesh position={[x, 0.16, z]} receiveShadow>
              <boxGeometry args={[1.52, 0.03, 0.72]} />
              <meshStandardMaterial color={0xe9edf2} roughness={0.7} />
            </mesh>
            {/* 아래 파란 바구니 2개 */}
            {[-0.38, 0.38].map((dx) => (
              <mesh key={dx} position={[x + dx, 0.32, z]} castShadow>
                <boxGeometry args={[0.6, 0.28, 0.5]} />
                <meshStandardMaterial color={0x2f80ed} roughness={0.55} />
              </mesh>
            ))}
            {/* 위: 접어 둔 봉투 묶음(흰 비닐·은색 보냉) + 라벨 프린터(회색) — 포장은 봉투(사용자 2026-11-20 "박스가 아니라 비닐봉투") */}
            <mesh position={[x - 0.45, 0.9, z - 0.12]} castShadow>
              <boxGeometry args={[0.4, 0.06, 0.3]} />
              <meshStandardMaterial color={0xf7f8fa} roughness={0.35} />
            </mesh>
            <mesh position={[x - 0.05, 0.9, z - 0.15]} castShadow>
              <boxGeometry args={[0.36, 0.05, 0.28]} />
              <meshStandardMaterial color={0xc9d3de} roughness={0.3} metalness={0.2} />
            </mesh>
            <mesh position={[x + 0.55, 0.93, z + 0.1]} castShadow>
              <boxGeometry args={[0.18, 0.1, 0.1]} />
              <meshStandardMaterial color={0x7b8494} roughness={0.5} />
            </mesh>
            <primitive object={tags[i].free} position={[x, 1.65, z]} />
            <primitive object={tags[i].busy} position={[x, 1.65, z]} />
            <primitive object={tags[i].off} position={[x, 1.65, z]} />
          </group>
        );
      })}
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
      <Walkways />
      <ParkingDecor />
      <InboundDecor />
      <WorkingCells />
      <Obstacles L={L} />
      <Stations L={L} />
      <CartDepot x={L.points.cartDepot.x} z={L.points.cartDepot.z - 0.6} />
      <StartMark x={L.points.cartDepot.x} z={L.points.cartDepot.z - 0.6} />
      <ReturnTable x={L.points.cartDepot.x + RETURN_TABLE.dx} z={L.points.cartDepot.z + RETURN_TABLE.dz} />
      {/* 옆 "재진열 대기" 이름표와 같은 크기·높이, 오른쪽 끝을 거치대 가운데 조금 오른쪽에 — 재진열 대기는 탁자에서 오른쪽으로 펼쳐져 서로 겹치지 않는다
          (사용자 2026-11-21 "옆에 재진열대기는 가만히 있는데 장바구니 거치대 카드는 작고 계속 움직이잖아") */}
      <Label text="장바구니 거치대" position={[L.points.cartDepot.x + 0.7, 1.8, L.points.cartDepot.z - 0.6]} opts={{ size: 36, bg: 'rgba(20,22,26,0.85)', screenPx: 18, prio: 2 }} anchorX={1} />
      <Label text="입고 차량문" position={[L.width + 0.4, 3.4, L.points.truckDoor.z]} opts={{ size: 28, bg: 'rgba(0,0,0,0.6)', screenPx: 15 }} />
    </>
  );
}
