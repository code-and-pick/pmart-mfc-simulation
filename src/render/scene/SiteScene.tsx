// 3D 가상 현장 (react-three-fiber). useFrame 은 등록 순서대로 돈다: 시뮬 진행 → 장면 갱신 → 카메라 → 번호 라벨.
import { Canvas, useThree } from '@react-three/fiber';
import { lazy, Suspense, useEffect } from 'react';
import * as THREE from 'three';
import { useView } from '../../app/context';
import { AppContext, type AppCtx } from '../../app/context';
import { People, Riders, Trucks } from './Agents';
import { CameraRig, CameraTap, Lights, Picker, SimDriver } from './Core';
import { Facility } from './Facility';
import { SCENE } from '../colors';
import { Declutter, Dock, Highlight, Returns, LocationLabelsLayer, PathLine, Staged, TargetMarkers } from './Overlays';
import { RealMarkers, RealShipLabels, RealStock } from './Real';
import { ScanMarker } from './Marker';
import { Goods, Reserves, ReserveFloors } from './Stock';

// 개발용 성능 측정기(Canvas 안) — npm run dev 에서만, 운영 빌드에서는 빠진다(src/dev/perf.tsx)
const PerfProbe = import.meta.env.DEV ? lazy(() => import('../../dev/perf').then((m) => ({ default: m.PerfProbe }))) : null;

export function SiteScene({ app }: { app: AppCtx }) {
  return (
    <Canvas shadows flat dpr={[1, 2]} gl={{ antialias: true }} camera={{ fov: 45, near: 0.05, far: 400 }}>
      {/* Canvas 는 따로 그리는 트리라 문맥을 다시 넣어 준다 */}
      <AppContext.Provider value={app}>
        <SimDriver />
        <Backdrop />
        <Lights />
        <Facility />
        <Goods />
        <Reserves />
        <ReserveFloors />
        <Dock />
        <Returns />
        <Staged />
        <TargetMarkers />
        {app.sim.real && <RealMarkers />}
        {app.sim.real && <RealStock />}
        {app.sim.real && <RealShipLabels />}
        <ScanMarker />
        <People />
        <Riders />
        {/* 입고 차량: 북쪽 길로 와서 화물 승강기 별동 동쪽 하역 문에 댄다(2026-11-22). 차량이 대면 승강기 문이 열린다(Facility FreightLifts) */}
        <Trucks />
        <PathLine />
        <Highlight />
        <CameraRig />
        <CameraTap />
        <LocationLabelsLayer />
        <Declutter />
        <Picker />
        <Precompile />
        {PerfProbe && (
          <Suspense fallback={null}>
            <PerfProbe />
          </Suspense>
        )}
      </AppContext.Provider>
    </Canvas>
  );
}

/**
 * 셰이더 미리 만들기 — 처음 화면에 들어온 재질의 셰이더를 이동 중에 만들면 그 장이 멈췄다(사용자 2026-11-26 "이동할 때 가끔씩 느려지는데",
 * headless 프로파일에서 이동 중 셰이더 만들기 확인). 연 뒤 1초·6초(늦게 붙는 것)에 장면 전체를 숨은 것까지 잠깐 보이게 해 compileAsync 로 미리 만든다.
 * 보이기는 같은 순간 되돌려서 그려지는 화면은 그대로
 */
const PRECOMPILE_AT_MS = [1000, 6000];
function Precompile() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const run = () => {
      const hidden: THREE.Object3D[] = [];
      scene.traverse((o) => {
        // 인스턴스 색(instanceColor)은 처음 setColorAt 때 생겨 셰이더 종류가 바뀐다(피킹 목표 고리 등 — 첫 작업 때 새로 만들며 멈춤).
        // 미리 흰색(곱해도 원래 색)으로 만들어 두어 같은 셰이더를 처음부터 쓴다
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh && !im.instanceColor) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(im.instanceMatrix.count * 3).fill(1), 3);
        if (!o.visible) {
          hidden.push(o);
          o.visible = true;
        }
      });
      gl.compileAsync(scene, camera).catch(() => {});
      for (const o of hidden) o.visible = false;
    };
    const ts = PRECOMPILE_AT_MS.map((ms) => setTimeout(run, ms));
    return () => ts.forEach(clearTimeout);
  }, [gl, scene, camera]);
  return null;
}

/** 3D 배경·안개 — 화면 테마(어둡게/밝게)를 따른다 */
// 밝은 도면풍 장면(SCENE) — 화면 테마와 상관없이 밝게(사용자 2026-11-20 그림 참고)
const BACKDROP = { dark: SCENE.backdrop, light: SCENE.backdrop } as const;
function Backdrop() {
  const view = useView();
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const c = new THREE.Color(BACKDROP[view.theme]);
    scene.background = c;
    scene.fog = new THREE.Fog(c, 110, 220);
  }, [scene, view.theme]);
  return null;
}
