// 상태 표시: 하차 롤테이너·출하대기 포장·피킹 목표 표시·선택 경로·로케이션 강조·로케이션 번호.
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { RACK_DEPTH } from '../../domain/layout';
import { STATE_COLOR, TEMP_COLOR } from '../colors';
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
      col.setHex(it.temp === 'AMBIENT' ? 0xb98c5a : TEMP_COLOR[it.temp]);
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
      <meshStandardMaterial roughness={0.6} transparent opacity={0.88} />
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
      mtx.makeTranslation(s.slot.pos.x, s.slot.pos.y + 0.16, s.slot.pos.z);
      m.setMatrixAt(n, mtx);
      m.setColorAt(n, col.setHex(TEMP_COLOR[s.pkg.temperatureZone]));
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 96]} count={0} frustumCulled={false}>
      <boxGeometry args={[0.26, 0.32, 0.26]} />
      <meshStandardMaterial roughness={0.5} />
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
