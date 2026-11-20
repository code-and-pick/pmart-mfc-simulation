// 3D 가상 현장 (react-three-fiber). useFrame 은 등록 순서대로 돈다: 시뮬 진행 → 장면 갱신 → 카메라 → 번호 라벨.
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { useView } from '../../app/context';
import { AppContext, type AppCtx } from '../../app/context';
import { People, Riders, Trucks } from './Agents';
import { CameraRig, CameraTap, Lights, Picker, SimDriver } from './Core';
import { Facility } from './Facility';
import { SCENE } from '../colors';
import { Dock, Highlight, LocationLabelsLayer, PathLine, Staged, TargetMarkers } from './Overlays';
import { RealMarkers, RealShipLabels, RealStock } from './Real';
import { ScanMarker } from './Marker';
import { Goods, Reserves } from './Stock';

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
        <Dock />
        <Staged />
        <TargetMarkers />
        {app.sim.real && <RealMarkers />}
        {app.sim.real && <RealStock />}
        {app.sim.real && <RealShipLabels />}
        <ScanMarker />
        <People />
        <Riders />
        <Trucks />
        <PathLine />
        <Highlight />
        <CameraRig />
        <CameraTap />
        <LocationLabelsLayer />
        <Picker />
      </AppContext.Provider>
    </Canvas>
  );
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
