// 3D 가상 현장 (react-three-fiber). useFrame 은 등록 순서대로 돈다: 시뮬 진행 → 장면 갱신 → 카메라 → 번호 라벨.
import { Canvas } from '@react-three/fiber';
import { AppContext, type AppCtx } from '../../app/context';
import { People, Riders, Trucks } from './Agents';
import { CameraRig, Lights, Picker, SimDriver } from './Core';
import { Facility } from './Facility';
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
        <color attach="background" args={[0x14161a]} />
        <fog attach="fog" args={[0x14161a, 80, 160]} />
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
        <LocationLabelsLayer />
        <Picker />
      </AppContext.Provider>
    </Canvas>
  );
}
