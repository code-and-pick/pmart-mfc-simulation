// 상태 표시: 하차 롤테이너·출하대기 포장·피킹 목표 표시·선택 경로·로케이션 강조·로케이션 번호.
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { RACK_DEPTH } from '../../domain/layout';
import { STATE_COLOR, zoneBoxColor } from '../colors';
import { BAG_COLOR, bagGeometry, boxTexture } from '../sprites';

import { LocationLabels } from '../locationLabels';

/** 하차 롤테이너 (검수 전은 옅게). */
export function Dock() {
  const { sim } = useApp();
  const mesh = useRef<THREE.InstancedMesh>(null!);
  useFrame(() => {
    const m = mesh.current;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    // 같은 자리 상자는 위로 쌓아 그림(사용자 2026-11-24 "다 차면 위로 쌓아올려야지")
    const height = new Map<string, number>();
    for (const it of sim.dockItems) {
      if (it.state === 'TAKEN' || n >= 256) continue;
      const p = it.slot?.pos ?? it.floorPos;
      const key = `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
      const lv = height.get(key) ?? 0;
      height.set(key, lv + 1);
      // 입고재고 팔레트(2×2) 위는 작은 상자로 — 롤테이너 크기면 서로 겹친다
      const small = !it.slot && !!it.stand;
      if (small) mtx.compose(new THREE.Vector3(p.x, 0.14 + 0.21 + lv * 0.42, p.z), new THREE.Quaternion(), new THREE.Vector3(0.7, 0.4, 0.75));
      else mtx.makeTranslation(p.x, 0.53 + lv * 1.07, p.z);
      m.setMatrixAt(n, mtx);
      // 입고 상자 색 = 선반 상자와 같은 구역 바닥색(zoneBoxColor: 냉동 하늘·냉장 연두·상온 흰색, 사용자 2026-11-22 "입고재고 상품 색들이 왜 저래 각 구역 바닥색으로 하기로 했잖아").
      // 전엔 골판지 빛깔(BOX_TINT)에 검수 전은 더 옅게 해서 구역색과 달라 보였다
      zoneBoxColor(it.temp, col);
      m.setColorAt(n, col);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh name="dock-boxes" ref={mesh} args={[undefined, undefined, 256]} count={0} castShadow frustumCulled={false}>
      <boxGeometry args={[0.62, 1.05, 0.6]} />
      <meshStandardMaterial roughness={0.7} map={boxTexture()} />
    </instancedMesh>
  );
}

/**
 * 회수품 상자(MOCK, 사용자 2026-11-22 "넣어"): 회수반입 자리(반입 전·검수 대기·적치/격리 이동 대기)와 온도대 격리 구역(폐기 판정 뒤).
 * 색 = 그 상품 구역 바닥색, 반입 전(반납 도착 대기)은 조금 낮게, 격리 구역 것은 작게
 */
export function Returns() {
  const { sim } = useApp();
  const mesh = useRef<THREE.InstancedMesh>(null!);
  useFrame(() => {
    const m = mesh.current;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    const q = new THREE.Quaternion();
    let n = 0;
    for (const it of sim.returnItems) {
      if (n >= 128) break;
      if (it.stage === 'ARRIVING' || it.stage === 'CARRIED' || it.stage === 'DONE') continue;
      const s = it.stage === 'QUARANTINED' ? 0.3 : 0.34;
      mtx.compose(new THREE.Vector3(it.pos.x, s / 2 + 0.02, it.pos.z), q, new THREE.Vector3(s, s, s));
      m.setMatrixAt(n, mtx);
      zoneBoxColor(it.temp, col);
      m.setColorAt(n, col);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh name="return-boxes" ref={mesh} args={[undefined, undefined, 128]} count={0} castShadow frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.7} map={boxTexture()} />
    </instancedMesh>
  );
}

/** 출하대기 랙 위 포장 (온도대 색). */
export function Staged() {
  const { sim } = useApp();
  const mesh = useRef<THREE.InstancedMesh>(null!);
  useFrame(() => {
    const m = mesh.current;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    for (const s of sim.shipRack.all()) {
      if (n >= 96) break;
      // 포장 = 배달 봉투(사용자 2026-11-20 "박스가 아니라 비닐봉투") — 가로 0.26 · 높이 0.31
      mtx.compose(new THREE.Vector3(s.slot.pos.x, s.slot.pos.y + 0.16, s.slot.pos.z), new THREE.Quaternion(), new THREE.Vector3(0.26, 0.26, 0.26));
      m.setMatrixAt(n, mtx);
      m.setColorAt(n, col.setHex(BAG_COLOR[s.pkg.temperatureZone]));
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh name="staged-bags" ref={mesh} args={[bagGeometry(), undefined, 96]} count={0} frustumCulled={false}>
      <meshStandardMaterial roughness={0.35} metalness={0.05} />
    </instancedMesh>
  );
}

/** 피킹 중인 작업자의 목표 칸 앞 바닥 고리. */
export function TargetMarkers() {
  const { sim } = useApp();
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const ring = useMemo(() => new THREE.RingGeometry(0.22, 0.32, 24).rotateX(-Math.PI / 2), []);
  useFrame(() => {
    const m = mesh.current;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color(STATE_COLOR.PICKING);
    let n = 0;
    for (const w of sim.siteWorkers()) {
      if (w.currentTarget && w.state === 'PICKING' && n < 64) {
        mtx.makeTranslation(w.currentTarget.pick.x, 0.03, w.currentTarget.pick.z);
        m.setMatrixAt(n, mtx);
        m.setColorAt(n, col);
        n++;
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[ring, undefined, 64]} count={0} frustumCulled={false}>
      <meshBasicMaterial color={0xffffff} transparent opacity={0.9} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

/** 선택한 작업자의 남은 이동 경로 (점선). */
export function PathLine() {
  const { sim, controller } = useApp();
  const line = useMemo(
    () => new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.2, transparent: true, opacity: 0.9 })),
    [],
  );
  useFrame(() => {
    const s = controller.selection;
    const p = s && s.kind !== 'location' ? [...sim.siteWorkers(), ...sim.inboundWorkers].find((x) => x.id === s.id) : undefined;
    if (!p || p.path.length === 0) {
      line.visible = false;
      return;
    }
    const pts = [new THREE.Vector3(p.pos.x, 0.08, p.pos.z), ...p.path.map((q) => new THREE.Vector3(q.x, 0.08, q.z))];
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    line.computeLineDistances();
    line.visible = true;
  });
  return <primitive object={line} />;
}

/** 선택한 로케이션(칸) 테두리. */
export function Highlight() {
  const { sim, controller } = useApp();
  const box = useMemo(() => {
    const h = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xfde293, depthTest: false, transparent: true }),
    );
    h.renderOrder = 20;
    h.visible = false;
    return h;
  }, []);
  useFrame(() => {
    const s = controller.selection;
    const sku = s?.kind === 'location' ? sim.skuMap.get(s.sku) : undefined;
    if (!sku) {
      box.visible = false;
      return;
    }
    const loc = sku.location;
    box.position.set(loc.shelf.x, loc.shelf.y - 0.035 + loc.levelH / 2, loc.shelf.z);
    const lx = loc.along === 'x' ? loc.slotW : RACK_DEPTH;
    const lz = loc.along === 'x' ? RACK_DEPTH : loc.slotW;
    if (loc.along === 'z') box.position.x += (-loc.face * RACK_DEPTH) / 4;
    else box.position.z += (-loc.face * RACK_DEPTH) / 4;
    box.scale.set(lx, loc.levelH, lz);
    box.visible = true;
  });
  return <primitive object={box} />;
}

/** 랙 번호판·칸 번호. 카메라 담당(CameraRig) 다음에 갱신되도록 장면 뒤쪽에 둔다. */
export function LocationLabelsLayer() {
  const { sim, controller, registry } = useApp();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const labels = useMemo(() => new LocationLabels(sim.layout), [sim]);
  useFrame((_, dt) => {
    labels.rackVisible = controller.rackLabels;
    labels.slotVisible = controller.slotLabels;
    if (registry.controls) labels.update(dt, camera, registry.controls.target);
  });
  return <primitive object={labels.root} />;
}

/**
 * 이름표 정리(사용자 2026-11-20 "팝업창 겹치고 난리났다" → "123 다해"):
 * 화면 크기 고정 이름표(sprite, sizeAttenuation=false)를 0.25초마다 화면 위 사각형으로 보고, 우선순위(userData.prio — 높을수록 먼저)·가까운 순으로
 * 자리를 잡는다. 이미 잡힌 것과 겹치면 숨긴다(투명) — 위로 비키지 않음(2026-11-21). 멀리서는 낮은 것부터 숨긴다 — 40 m 넘으면 1(참고), 65 m 넘으면 2(패킹대·랙·차량).
 * 보이고 숨기는 것만 바꾸고(투명도), 다른 코드가 정한 visible 은 건드리지 않는다.
 */
/** shrinkFar 이름표: 이 거리(m) 안은 원래 크기, 멀수록 줄여 최소 이 비율 [시뮬] */
const SHRINK_NEAR = 16;
const SHRINK_MIN = 0.45;

export function Declutter() {
  const { camera, scene, size } = useThree();
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current -= dt;
    if (t.current > 0) return;
    t.current = 0.25;
    const H = size.height;
    const W = size.width;
    const v = new THREE.Vector3();
    const items: { s: THREE.Sprite; prio: number; d: number; r: [number, number, number, number] }[] = [];
    // 구역 이름 카드(벽·바닥에 붙은 판)는 움직이지 않는 자리 — 이름표가 그 위에 겹치지 않게 먼저 잡아 둔다
    // (사용자 2026-11-20 "여기도 겹치는데 뭐가 겹치는 건지 모르겠어" — 회수 반입 이름표가 휴게·사무 카드 위)
    const blocks: [number, number, number, number][] = [];
    const box = new THREE.Box3();
    const corner = new THREE.Vector3();
    const shown = (o: THREE.Object3D | null): boolean => {
      for (let x = o; x; x = x.parent) if (!x.visible) return false;
      return true;
    };
    scene.traverse((o) => {
      if (o.userData.declutterBlock && (o as THREE.Mesh).isMesh && shown(o)) {
        const g = (o as THREE.Mesh).geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        box.copy(g.boundingBox!).applyMatrix4(o.matrixWorld);
        // 모서리가 하나라도 카메라 뒤면 화면 사각형이 뒤집혀 화면 전체를 덮는다(가까이 붙으면 이름표가 다 숨던 것, 2026-11-21) — 그 판은 빼고 본다
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, front = true;
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
          if (corner.z >= 1) front = false;
          const px = ((corner.x + 1) / 2) * W;
          const py = ((1 - corner.y) / 2) * H;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
        if (front) blocks.push([x0, y0, x1, y1]);
        return;
      }
      const s = o as THREE.Sprite;
      if (!s.isSprite || !(s.material instanceof THREE.SpriteMaterial) || s.material.sizeAttenuation) return;
      if (!shown(s)) return;
      s.getWorldPosition(v);
      const d = camera.position.distanceTo(v);
      // shrinkFar(팔레트 번호·수량 등): 화면 고정 크기라 멀리서 보면 혼자 커 보인다 — SHRINK_NEAR m 안은 그대로, 멀수록 줄여 최소 SHRINK_MIN
      // (사용자 2026-11-21 "멀리서 쳐다볼 때 입고창고에 있는 갯수가 너무 크게 보여")
      if (s.userData.shrinkFar) {
        const base = (s.userData.baseScale as THREE.Vector2 | undefined) ?? (s.userData.baseScale = new THREE.Vector2(s.scale.x, s.scale.y));
        const k = Math.max(SHRINK_MIN, Math.min(1, SHRINK_NEAR / Math.max(1, d)));
        s.scale.set(base.x * k, base.y * k, 1);
      }
      v.project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return;
      const hp = s.scale.y * 2.414 * (H / 2);
      const wp = s.scale.x * 2.414 * (H / 2);
      const cx = ((v.x + 1) / 2) * W;
      const cy = ((1 - v.y) / 2) * H;
      const x0 = cx - wp * s.center.x;
      const y0 = cy - hp * (1 - s.center.y);
      items.push({ s, prio: (s.userData.prio as number | undefined) ?? 1, d, r: [x0, y0, x0 + wp, y0 + hp] });
    });
    items.sort((a, b) => b.prio - a.prio || a.d - b.d);
    const placed: [number, number, number, number][] = [...blocks];
    const M = 3;
    const hits = (r: [number, number, number, number]) => placed.some((p) => r[0] < p[2] + M && r[2] > p[0] - M && r[1] < p[3] + M && r[3] > p[1] - M);
    for (const it of items) {
      const s = it.s;
      const mat = s.material as THREE.SpriteMaterial;
      if (s.userData.baseOpacity === undefined) s.userData.baseOpacity = mat.opacity;
      if (s.userData.baseCenterY === undefined) s.userData.baseCenterY = s.center.y;
      const baseY = s.userData.baseCenterY as number;
      // 겹치면 위로 한 칸·두 칸 비켜 본다(제 높이만큼) — 그래도 겹치면 숨김
      const h = it.r[3] - it.r[1];
      const nowShift = (baseY - s.center.y) * h; // 이미 비켜 있는 만큼(화면 px)
      const r0: [number, number, number, number] = [it.r[0], it.r[1] + nowShift, it.r[2], it.r[3] + nowShift];
      const far = (it.prio <= 1 && it.d > 40) || (it.prio <= 2 && it.d > 65);
      let k = -1;
      if (!far) {
        // 위로 비키기는 하지 않는다 — 확대·축소할 때마다 겹침이 바뀌어 이름표가 위아래로 왔다 갔다 했다(사용자 2026-11-21 "확대 축소할 때 계속 위로 왔다갔다").
        // 겹치면 우선순위 낮은·먼 것을 숨긴다(제자리 아니면 숨김)
        for (let j = 0; j <= 0; j++) {
          const dy = j * (h + M);
          const r: [number, number, number, number] = [r0[0], r0[1] - dy, r0[2], r0[3] - dy];
          if (!hits(r)) {
            k = j;
            placed.push(r);
            break;
          }
        }
      }
      s.center.y = baseY - Math.max(0, k) * (1 + M / Math.max(1, h));
      mat.opacity = k < 0 ? 0 : (s.userData.baseOpacity as number);
    }
  });
  return null;
}
