// 상태 표시: 하차 롤테이너·출하대기 포장·피킹 목표 표시·선택 경로·로케이션 강조·로케이션 번호.
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { RACK_DEPTH } from '../../domain/layout';
import { SCENE, STATE_COLOR } from '../colors';
import { BAG_COLOR, bagGeometry, boxTexture } from '../sprites';
import type { TemperatureZone } from '../../domain/contract';

/** 상자 빛깔(사용자 2026-11-20 "입고구역 UI도 똑같이") — 골판지 무늬(boxTexture)와 곱해진다 */
const BOX_TINT: Record<TemperatureZone, number> = { AMBIENT: SCENE.box, CHILLED: 0xe3f1dc, FROZEN: 0xdce9fb };
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
    for (const it of sim.dockItems) {
      if (it.state === 'TAKEN' || n >= 96) continue;
      const p = it.slot?.pos ?? it.floorPos;
      mtx.makeTranslation(p.x, 0.53, p.z);
      m.setMatrixAt(n, mtx);
      // 그림처럼 불투명 골판지 상자 — 온도대는 옅은 빛깔로만(상온 갈색·냉장 연두빛 흰색·냉동 하늘빛 흰색)
      col.setHex(BOX_TINT[it.temp]);
      if (it.state === 'ON_DOCK') col.offsetHSL(0, -0.3, 0.1);
      m.setColorAt(n, col);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 96]} count={0} castShadow frustumCulled={false}>
      <boxGeometry args={[0.62, 1.05, 0.6]} />
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
    <instancedMesh ref={mesh} args={[bagGeometry(), undefined, 96]} count={0} frustumCulled={false}>
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
 * 자리를 잡는다. 이미 잡힌 것과 겹치면 숨긴다(투명). 멀리서는 낮은 것부터 숨긴다 — 40 m 넘으면 1(참고), 65 m 넘으면 2(패킹대·랙·차량).
 * 보이고 숨기는 것만 바꾸고(투명도), 다른 코드가 정한 visible 은 건드리지 않는다.
 */
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
    const shown = (o: THREE.Object3D | null): boolean => {
      for (let x = o; x; x = x.parent) if (!x.visible) return false;
      return true;
    };
    scene.traverse((o) => {
      const s = o as THREE.Sprite;
      if (!s.isSprite || !(s.material instanceof THREE.SpriteMaterial) || s.material.sizeAttenuation) return;
      if (!shown(s)) return;
      s.getWorldPosition(v);
      const d = camera.position.distanceTo(v);
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
    const placed: [number, number, number, number][] = [];
    const M = 3;
    for (const it of items) {
      const mat = it.s.material as THREE.SpriteMaterial;
      if (it.s.userData.baseOpacity === undefined) it.s.userData.baseOpacity = mat.opacity;
      const far = (it.prio <= 1 && it.d > 40) || (it.prio <= 2 && it.d > 65);
      const hit = placed.some((p) => it.r[0] < p[2] + M && it.r[2] > p[0] - M && it.r[1] < p[3] + M && it.r[3] > p[1] - M);
      const hide = far || hit;
      mat.opacity = hide ? 0 : (it.s.userData.baseOpacity as number);
      if (!hide) placed.push(it.r);
    }
  });
  return null;
}
