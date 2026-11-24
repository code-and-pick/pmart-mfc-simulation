// 고정 시설: 바닥·구역·벽·랙·장애물·패킹대·거치대.
import { dividerInside, shelfInside } from '../../domain/wideCells';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useApp, useTick } from '../../app/context';
import { TRUCK_PASS_LANE, DECOR, MOCK_HIGH_TURNOVER_TOP } from '../../config';
import { PACK_TABLE_W, RACK_DEPTH, RACK_HEIGHT, RACK_LEN, depotPoint, type Layout } from '../../domain/layout';
import { SCENE, ZONE_FLOOR } from '../colors';
import { makeLabel, makePillSprite } from '../sprites';
import { makePill, ZoneNames } from './ZoneNames';
import { StaticMerge } from './StaticMerge';
import { CartDepot, InboundDecor, OfficeDecor, RETURN_TABLE, ReturnTable, StartMark, ParkingDecor, Walkways, WorkingCells } from './Decor';

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
  const YARD_X = L.geo.yardX;
  const LIFT_ANNEX = L.geo.liftAnnex;
  const flat: Vec3 = [-Math.PI / 2, 0, 0];
  return (
    <>
      <mesh rotation={flat} position={[30, -0.02, 20]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={SCENE.outside} roughness={1} />
      </mesh>
      <mesh rotation={flat} position={[(L.width + (L.geo.floorX0 ?? 0)) / 2, -0.01, L.buildingDepth / 2]} receiveShadow>
        <planeGeometry args={[L.width - (L.geo.floorX0 ?? 0), L.buildingDepth]} />
        <meshStandardMaterial color={SCENE.floor} roughness={0.95} />
      </mesh>
      {/* 남쪽 앞마당(라이더), 동쪽 입고 차량 진입로 — 그림의 회색 도크처럼 */}
      <mesh rotation={flat} position={[(YARD_X[0] + YARD_X[1]) / 2, -0.015, (L.buildingDepth + L.depth) / 2]} receiveShadow>
        <planeGeometry args={[YARD_X[1] - YARD_X[0], L.depth - L.buildingDepth]} />
        <meshStandardMaterial color={SCENE.yard} roughness={1} />
      </mesh>
      {/* MFC 는 2층 — 북쪽 화물 승강기 별동(FreightLifts) 동쪽에 입고 차량이 대는 길(사용자 2026-11-22 "화물승강기 왼쪽이나 오른쪽에서 입고차량 들어오는 것도") */}
      {/* 차로 2개: 차량문 줄(줄 선 차) + 북쪽 바깥 차로(떠나는 차가 비켜 나감, 2026-11-24) */}
      {L.geo.truckFromWest ? (
        // 서쪽에서 오는 동서 길(부산진구 — 승강기 별동 서쪽 하역): 서쪽 밖에서 건물 서쪽 벽까지
        <mesh rotation={flat} position={[(-60 + L.geo.truckFromWest.rearX) / 2, -0.014, L.geo.truckFromWest.z - TRUCK_PASS_LANE / 2]} receiveShadow>
          <planeGeometry args={[L.geo.truckFromWest.rearX + 60, 3.6 + TRUCK_PASS_LANE]} />
          <meshStandardMaterial color={SCENE.yard} roughness={1} />
        </mesh>
      ) : (
        <mesh rotation={flat} position={[(LIFT_ANNEX.x1 + 90) / 2, -0.015, L.points.truckDock.z - TRUCK_PASS_LANE / 2]} receiveShadow>
          <planeGeometry args={[90 - LIFT_ANNEX.x1, 3.6 + TRUCK_PASS_LANE]} />
          <meshStandardMaterial color={SCENE.yard} roughness={1} />
        </mesh>
      )}
      {/* 건물 밖 마당(부산진구 서쪽 라이더 대기 등) */}
      {(L.geo.outsideYards ?? []).map((r, i) => (
        <mesh key={`oy-${i}`} rotation={flat} position={[(r.x0 + r.x1) / 2, -0.015, (r.z0 + r.z1) / 2]} receiveShadow>
          <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
          <meshStandardMaterial color={SCENE.yard} roughness={1} />
        </mesh>
      ))}
      {/* 승강기 별동 바닥(MFC 밖·건물 안) */}
      <mesh rotation={flat} position={[(LIFT_ANNEX.x0 + LIFT_ANNEX.x1) / 2, -0.012, LIFT_ANNEX.z0 / 2]} receiveShadow>
        <planeGeometry args={[LIFT_ANNEX.x1 - LIFT_ANNEX.x0, -LIFT_ANNEX.z0]} />
        <meshStandardMaterial color={0xdfe3ea} roughness={0.95} />
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
              userData={{ zoneId: z.id === 'WH2' ? 'WH' : z.id }} // 세종 입고창고 ㄱ자 덧붙은 바닥 = 입고창고
            >
              <planeGeometry args={[w, d]} />
              {/* 구역 바닥(사용자 2026-11-20 참고 그림 "그림처럼") — 냉동 옅은 하늘·냉장 옅은 연두, 나머지 거의 흰색. 경계는 옅은 점선. 이름은 떠 있는 둥근 이름표(ZoneNames) */}
              {/* 냉동·냉장 격리(AQ·BQ)는 그 방 바닥색(사용자 2026-11-22 "냉장냉동 바닥에 회색으로 칠해진 부분 각 구역이랑 같은 색으로") */}
              <meshStandardMaterial color={z.id === 'AQ' ? ZONE_FLOOR.FROZEN : z.id === 'BQ' ? ZONE_FLOOR.CHILLED : ZONE_FLOOR[z.kind]} roughness={0.95} />
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
      <instancedMesh name="rack-posts" ref={posts} args={[undefined, undefined, postCount]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SCENE.rackPost} metalness={0.2} roughness={0.45} />
      </instancedMesh>
      <instancedMesh name="rack-braces" ref={braces} args={[undefined, undefined, L.racks.length * 2 * BRACES]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SCENE.rackPost} metalness={0.2} roughness={0.5} />
      </instancedMesh>
      <instancedMesh name="rack-beams" ref={beams} args={[undefined, undefined, shelfCount * 2]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SCENE.rackBeam} roughness={0.5} />
      </instancedMesh>
      <instancedMesh name="rack-shelves" ref={shelves} args={[undefined, undefined, shelfCount]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={SCENE.rackDeck} roughness={0.7} />
      </instancedMesh>
      <instancedMesh name="rack-dividers" ref={dividers} args={[undefined, undefined, dividerCount]}>
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
      {/* 냉동·냉장·상온 격리 구역마다 흰 랙 2개(인계 랙과 같은 모양, 사용자 2026-11-21 "각각 격리 구역에도 하얀랙으로") — 벽 쪽에 세로로 */}
      {L.zones
        .filter((z) => z.kind === 'QUARANTINE')
        .flatMap((z) =>
          L.geo.quarantineRacks?.[z.id]
            ? L.geo.quarantineRacks[z.id].map((r, i) => <ShipRack key={`qr-${z.id}-${i}`} r={r} h={RACK_HEIGHT} />)
            : [0, 1].map((i) => {
            // 냉동·냉장 격리는 왼쪽(서쪽) 벽 쪽에 세로로 돌려(긴 쪽이 남북) 위아래로 2개 — 흰 실선(구역 끝 +0.12) 안쪽
            // (사용자 2026-11-21 "…방향을 세로로 돌려서 붙이라고 … 옆으로 돌리라고" → "격리구역 랙 오른쪽이 아니라 왼 쪽으로"). 상온은 구역 뒤쪽 그대로
            const cold = z.id === 'AQ' || z.id === 'BQ';
            if (cold) {
              const x0 = z.rect.x0 + 0.25;
              const z0 = z.rect.z0 + 0.35 + i * (RACK_LEN + 0.15);
              return <ShipRack key={`qr-${z.id}-${i}`} r={{ x0, z0, x1: x0 + RACK_DEPTH, z1: z0 + RACK_LEN }} h={RACK_HEIGHT} />;
            }
            // 상온 격리는 가로로 돌려(긴 쪽이 동서) 남쪽 벽 쪽 실선 안에 나란히 2개, 구역 가운데(사용자 2026-11-22 "상온 격리 랙을 가로로 방향을 돌리고 남쪽에 붙인 후에")
            const cx = (z.rect.x0 + z.rect.x1) / 2;
            const x0 = cx - RACK_LEN - 0.025 + i * (RACK_LEN + 0.05);
            const z1 = z.rect.z1 - 0.2;
            return <ShipRack key={`qr-${z.id}-${i}`} r={{ x0, z0: z1 - RACK_DEPTH, x1: x0 + RACK_LEN, z1 }} h={RACK_HEIGHT} />;
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
          {/* 가로대는 긴 쪽을 따라(세로로 세운 랙이면 z 방향) */}
          {[-1, 1].map((sz) => (
            <mesh key={sz} position={D > W ? [(sz * (W - 0.05)) / 2, y - 0.05, 0] : [0, y - 0.05, (sz * (D - 0.05)) / 2]} castShadow>
              <boxGeometry args={D > W ? [0.05, 0.07, D] : [W, 0.07, 0.05]} />
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
 * 상온 고회전 구역 F — 주문율 상위 20개 상온 상품을 두는 랙(MFC 2-1 "F 상온 고회전 — 카테고리 무관 인기 SKU").
 * 사용자 2026-11-23 "고회전 시험 말고 이제 진짜 고회전 상품(주문율 높은 상품 top20)은 거기에 적치" — 예전 E2E 시험 칸 5개(H01-01) 표시는 뺐다.
 * MOCK 은 MOCK_HIGH_TURNOVER_TOP 상품이 F 칸을 갖고, 실서버는 적치 칸 추천이 mfc-inventory 몫(backend-requests R-40).
 */
function HighTurnover({ L }: { L: Layout }) {
  const racks = useMemo(() => L.racks.filter((r) => r.temp === 'AMBIENT' && r.group.startsWith('F')), [L]);
  if (!racks.length) return null;
  const cx = racks.reduce((a, r) => a + r.cx, 0) / racks.length;
  const cz = racks.reduce((a, r) => a + r.cz, 0) / racks.length;
  return <Label text={`고회전 F — 주문율 상위 ${MOCK_HIGH_TURNOVER_TOP}`} position={[cx, RACK_HEIGHT + 0.7, cz]} opts={{ size: 28, bg: 'rgba(160,20,20,0.75)', screenPx: 14 }} />;
}

/**
 * 회수(반품) 반입 자리 RTN-A-01 — 화면은 인계 구역(라이더가 들고 옴, 사용자 2026-11-21). 서버 좌표는 입고·검수 구역(config returnIntake 주석).
 * 실서버: 이 센터로 오는 회수 배송(고객 반품·오배송 회수, delivery-dispatch 0.5.0) 수 — 오는 중 / 반납됨.
 */
function ReturnIntake() {
  const { sim } = useApp();
  const p = sim.layout.geo.returnIntake;
  useTick();
  const rp = sim.real?.returnPickups ?? [];
  const arrived = rp.filter((d) => d.state === 'RETURNED_TO_STORE' || d.state === 'COMPLETED').length;
  // 이름 카드: 화면 고정 크기 이름표 → 격리 카드처럼 바닥에 눕힌 둥근 판(확대·축소 때 장면과 같은 비율, 사용자 2026-11-21 "회수반입1 이라고 바꾸고 이 카드 확대축소할 떄 비율이 이상하네")
  // 카드는 이름만(사용자 2026-11-21 "회수반입1이라고만 하고 오는중을 없애라고") — 회수 배송 수는 오른쪽 패널에
  const card = useMemo(() => makePill('회수반입1', null, null, SCENE.pillDim, '#44528a'), []);
  const ch = 0.55;
  const cw = Math.min(2.2, ch * card.aspect);
  return (
    <>
      {/* 바닥보다 조금 짙은 회색 판(사용자 2026-11-21 "회수반입은 그냥 바닥보다 좀 더 짙은 색으로" — 전엔 초록, 뜻 없던 색) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.012, p.z]} receiveShadow>
        <planeGeometry args={[1.2, 1.2]} />
        <meshStandardMaterial color={0xb9bdc6} roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.03, p.z + 0.6 + (cw / card.aspect) / 2 + 0.1]} renderOrder={5} raycast={() => null} userData={{ declutterBlock: true }}>
        <planeGeometry args={[cw, cw / card.aspect]} />
        <meshBasicMaterial map={card.tex} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
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
      // 꺼진 패킹대도 넘쳐서 쓰는 중이면 사용 중 색(가동 패킹대가 다 차면 나머지도 씀)
      tags[i].free.visible = active && !busy;
      tags[i].busy.visible = busy;
      tags[i].off.visible = !active && !busy;
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
              <boxGeometry args={[PACK_TABLE_W, 0.05, 0.8]} />
              <meshStandardMaterial color={0xffffff} roughness={0.45} />
            </mesh>
            <mesh position={[x, 0.82, z]}>
              <boxGeometry args={[PACK_TABLE_W + 0.02, 0.04, 0.82]} />
              <meshStandardMaterial color={frame} roughness={0.5} />
            </mesh>
            {/* 다리·아래 선반 */}
            {[-1, 1].flatMap((sx) =>
              [-1, 1].map((sz) => (
                <mesh key={`${sx}${sz}`} position={[x + sx * (PACK_TABLE_W / 2 - 0.04), 0.41, z + sz * 0.36]} castShadow>
                  <boxGeometry args={[0.045, 0.82, 0.045]} />
                  <meshStandardMaterial color={frame} metalness={0.2} roughness={0.5} />
                </mesh>
              )),
            )}
            <mesh position={[x, 0.16, z]} receiveShadow>
              <boxGeometry args={[PACK_TABLE_W - 0.08, 0.03, 0.72]} />
              <meshStandardMaterial color={0xe9edf2} roughness={0.7} />
            </mesh>
            {/* 아래 파란 바구니 2개 */}
            {[-PACK_TABLE_W * 0.24, PACK_TABLE_W * 0.24].map((dx) => (
              <mesh key={dx} position={[x + dx, 0.32, z]} castShadow>
                <boxGeometry args={[0.6, 0.28, 0.5]} />
                <meshStandardMaterial color={0x2f80ed} roughness={0.55} />
              </mesh>
            ))}
            {/* 위: 접어 둔 봉투 묶음(흰 비닐·은색 보냉) + 라벨 프린터(회색) — 포장은 봉투(사용자 2026-11-20 "박스가 아니라 비닐봉투") */}
            <mesh position={[x - PACK_TABLE_W * 0.28, 0.9, z - 0.12]} castShadow>
              <boxGeometry args={[0.4, 0.06, 0.3]} />
              <meshStandardMaterial color={0xf7f8fa} roughness={0.35} />
            </mesh>
            <mesh position={[x - 0.05, 0.9, z - 0.15]} castShadow>
              <boxGeometry args={[0.36, 0.05, 0.28]} />
              <meshStandardMaterial color={0xc9d3de} roughness={0.3} metalness={0.2} />
            </mesh>
            <mesh position={[x + PACK_TABLE_W * 0.34, 0.93, z + 0.1]} castShadow>
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
      {/* 성능(2026-11-22): 고정 시설은 StaticMerge 로 같은 재질끼리 합쳐 그린다 — 모양·색 그대로, 클릭 대상(구역 바닥 userData)·투명 재질은 합치지 않음 */}
      <StaticMerge>
        <Zones L={L} />
      </StaticMerge>
      <Walls L={L} />
      <ZoneNames L={L} />
      <Racks L={L} />
      <HighTurnover L={L} />
      <ReturnIntake />
      <Walkways />
      <ParkingDecor />
      <InboundDecor />
      <WorkingCells />
      <StaticMerge>
        <Obstacles L={L} />
        <Stations L={L} />
      </StaticMerge>
      {/* 동쪽 끝 카트를 예전 6대 줄의 동쪽 끝(x +0.7)에 두고 서쪽으로 늘어놓는다 — 반납 탁자(x +1.7)와 겹치지 않게 */}
      <StaticMerge>
        <group position={[L.points.cartDepot.x, 0, L.points.cartDepot.z]} rotation={[0, L.geo.cartDepotVertical ? Math.PI / 2 : 0, 0]}>
          {/* 줄이 여럿이면(춘천 2줄) 같은 대수를 나눠 남쪽으로 띄워 놓는다 */}
          {Array.from({ length: L.geo.cartDepotRows ?? 1 }, (_, r) => (
            <CartDepot key={r} x={0.7} z={-0.6 + r * (L.geo.cartDepotRowGap ?? 1.5)} count={L.geo.cartDepotPerRow ?? Math.ceil(DECOR.cartDepotDrawn / (L.geo.cartDepotRows ?? 1))} />
          ))}
        </group>
      </StaticMerge>
      {/* 시작점 표지판은 카트 줄 가운데(사용자 2026-11-21 "장바구니 중앙으로") */}
      <group position={[L.points.cartDepot.x, 0, L.points.cartDepot.z]} rotation={[0, L.geo.cartDepotVertical ? Math.PI / 2 : 0, 0]}>
        <StartMark x={0.7 - ((L.geo.cartDepotPerRow ?? Math.ceil(DECOR.cartDepotDrawn / (L.geo.cartDepotRows ?? 1))) - 1) * 0.28 / 2} z={-0.6} />
      </group>
      <StaticMerge>
        <OfficeDecor />
      </StaticMerge>
      <ReturnTable {...(L.geo.returnTable ?? depotPoint(L, RETURN_TABLE.dx, RETURN_TABLE.dz))} />
      {/* "장바구니 거치대" 이름표는 시작점 표지판에 합침(사용자 2026-11-21 "그냥 장바구니 거치대 시작점 이라고 하면 되지 않아?") */}
      <FreightLifts />
    </>
  );
}

/**
 * 화물 승강기 2대(2026-11-22 사용자 "2층이었어 … 입고검수 문 달린 곳에 mfc 외부지만 건물 내부에 화물 승강기 2대" → "응") — MFC 북쪽 외벽 바깥 승강로,
 * 문은 입고·검수로 바로 열린다. 1층 입고 차량이 오면(DOCKED·UNLOADING) 카가 2층에 와 있어 문이 열린다. 승강로는 MFC 넓이에 넣지 않음. [가정 — 2~3 t 화물용]
 */
function FreightLifts() {
  // 승강기 코어(사용자 2026-11-22 "승강기 못생겼어") — 닫힌 밝은 콘크리트 박스 + 입고·검수 쪽 스테인리스 문틀·문 두 짝·층 표시등·호출 버튼·문 앞 노랑/검정 안전 띠
  const { sim } = useApp();
  const FREIGHT_LIFTS = sim.layout.geo.freightLifts;
  const LIFT_Z0 = sim.layout.geo.liftZ0;
  const doors = useRef<THREE.Group[]>([]);
  const lamps = useRef<THREE.MeshStandardMaterial[]>([]);
  const open = useRef(0);
  useFrame((_, dt) => {
    const want = sim.trucks.some((t) => t.state === 'DOCKED' || t.state === 'UNLOADING') ? 1 : 0;
    open.current += Math.sign(want - open.current) * Math.min(Math.abs(want - open.current), dt * 0.8);
    doors.current.forEach((g, i) => {
      if (g) g.position.x = (i % 2 === 0 ? -1 : 1) * open.current * 0.52;
    });
    for (const m of lamps.current) if (m) m.emissiveIntensity = 0.6 + open.current * 1.4;
  });
  const tags = useMemo(() => FREIGHT_LIFTS.map((_, i) => makeLabel(`화물 승강기 ${i + 1}`, { size: 26, bg: 'rgba(31,42,68,0.85)', screenPx: 14 })), [FREIGHT_LIFTS]);
  const stripe = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1f2229';
    ctx.fillRect(0, 0, 256, 32);
    ctx.fillStyle = '#f5c518';
    for (let x = -32; x < 256 + 32; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 32);
      ctx.lineTo(x + 16, 32);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 16, 0);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const H = 3.4; // 코어 높이
  const DH = 2.4; // 문 높이
  const steel = { color: 0xe3e7ed, metalness: 0.55, roughness: 0.3 }; // 옅은 회색(사용자 2026-11-22 "승강기 색 좀 더 옅은 회색으로")
  return (
    <group position={[0, 0, sim.layout.geo.liftDoorZ ?? 0]}>
      {FREIGHT_LIFTS.map((l, i) => {
        const w = l.x1 - l.x0;
        const d = -LIFT_Z0;
        const cx = (l.x0 + l.x1) / 2;
        const dc = (l.door[0] + l.door[1]) / 2;
        const dw = l.door[1] - l.door[0];
        return (
          <group key={i}>
            {/* 코어: 닫힌 밝은 박스(문 쪽 면 제외) + 지붕 테두리 */}
            <mesh position={[cx, H / 2, LIFT_Z0 / 2 - 0.05]} castShadow receiveShadow>
              <boxGeometry args={[w - 0.04, H, d - 0.1]} />
              <meshStandardMaterial color={0xf1f3f6} roughness={0.85} />
            </mesh>
            <mesh position={[cx, H + 0.04, LIFT_Z0 / 2 - 0.05]}>
              <boxGeometry args={[w + 0.06, 0.08, d - 0.0]} />
              <meshStandardMaterial color={0xd5dae2} roughness={0.6} />
            </mesh>
            {/* 문틀(스테인리스): 양 기둥 + 윗틀 */}
            {[l.door[0] - 0.07, l.door[1] + 0.07].map((x) => (
              <mesh key={x} position={[x, DH / 2 + 0.05, 0.04]}>
                <boxGeometry args={[0.14, DH + 0.1, 0.1]} />
                <meshStandardMaterial {...steel} />
              </mesh>
            ))}
            <mesh position={[dc, DH + 0.2, 0.04]}>
              <boxGeometry args={[dw + 0.28, 0.3, 0.1]} />
              <meshStandardMaterial {...steel} />
            </mesh>
            {/* 층 표시등(윗틀 가운데) */}
            <mesh position={[dc, DH + 0.2, 0.1]}>
              <boxGeometry args={[0.34, 0.14, 0.02]} />
              <meshStandardMaterial
                ref={(m: THREE.MeshStandardMaterial | null) => {
                  if (m) lamps.current[i] = m;
                }}
                color={0x0b1a2a}
                emissive={0x22c3ee}
                emissiveIntensity={0.6}
              />
            </mesh>
            {/* 문 두 짝(가운데에서 양옆으로 열림) — 짝마다 세로 홈 */}
            {[0, 1].map((k) => (
              <group
                key={k}
                ref={(g) => {
                  if (g) doors.current[i * 2 + k] = g;
                }}
              >
                <mesh position={[dc + (k === 0 ? -dw / 4 : dw / 4), DH / 2, 0.02]}>
                  <boxGeometry args={[dw / 2 - 0.01, DH, 0.05]} />
                  <meshStandardMaterial color={0xe0e4ea} metalness={0.55} roughness={0.25} />
                </mesh>
                <mesh position={[dc + (k === 0 ? -dw / 4 : dw / 4), DH / 2, 0.05]}>
                  <boxGeometry args={[0.02, DH * 0.9, 0.01]} />
                  <meshStandardMaterial color={0xbcc3ce} metalness={0.5} roughness={0.3} />
                </mesh>
              </group>
            ))}
            {/* 호출 버튼 판 */}
            <mesh position={[l.door[1] + 0.32, 1.15, 0.06]}>
              <boxGeometry args={[0.12, 0.26, 0.03]} />
              <meshStandardMaterial {...steel} />
            </mesh>
            <mesh position={[l.door[1] + 0.32, 1.15, 0.08]}>
              <circleGeometry args={[0.035, 16]} />
              <meshStandardMaterial color={0x16a34a} emissive={0x22c55e} emissiveIntensity={0.8} />
            </mesh>
            {/* 문 앞 바닥 안전 띠(노랑/검정) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[dc, 0.012, 0.32]} raycast={() => null}>
              <planeGeometry args={[dw + 0.4, 0.4]} />
              <meshStandardMaterial map={stripe} roughness={0.8} />
            </mesh>
            <primitive object={tags[i]} position={[cx, H + 0.6, LIFT_Z0 / 2]} />
          </group>
        );
      })}
    </group>
  );
}
