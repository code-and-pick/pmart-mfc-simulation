// 장면의 바탕 동작: 시뮬레이션 진행, 카메라(OrbitControls·이동), 클릭 판정, 조명.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useApp } from '../../app/context';
import { cameraTap } from '../cameraTap';

/** 매 프레임 시뮬레이션을 진행하고, 약 4Hz 로 패널 갱신 박자를 보낸다. */
export function SimDriver() {
  const { sim, ticker } = useApp();
  const st = useRef({ advancing: false, ui: 0 });
  useFrame((_, delta) => {
    const dt = Math.min(0.1, delta);
    if (!st.current.advancing) {
      st.current.advancing = true;
      sim
        .advance(dt)
        .catch((e) => console.error(e))
        .finally(() => (st.current.advancing = false));
    }
    st.current.ui += delta;
    if (st.current.ui > 0.25) {
      st.current.ui = 0;
      ticker.bump();
    }
  });
  return null;
}

export function CameraRig() {
  const { controller, registry } = useApp();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.maxPolarAngle = Math.PI * 0.49;
    c.minDistance = 1.2;
    c.maxDistance = 130;
    return c;
  }, [camera, gl]);
  useEffect(() => {
    registry.controls = controls;
    return () => {
      controls.dispose();
      registry.controls = null;
    };
  }, [controls, registry]);

  // 오른쪽 끌기(이동)·Shift+끌기로 시점을 옮기면 따라가기를 끈다 — 회전·확대는 따라가면서 된다
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      if (controller.follow && (e.button === 2 || (e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey)))) controller.setFollow(false);
    };
    el.addEventListener('pointerdown', down);
    return () => el.removeEventListener('pointerdown', down);
  }, [gl, controller]);

  const tween = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null>(null);
  const shift = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const req = controller.takeCameraRequest();
    if (req) {
      if (!req.animate) {
        camera.position.copy(req.pos);
        controls.target.copy(req.target);
        controls.update();
        tween.current = null;
      } else {
        tween.current = { from: camera.position.clone(), to: req.pos, tFrom: controls.target.clone(), tTo: req.target, t: 0 };
      }
    }
    const tw = tween.current;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / 0.8);
      const k = 1 - Math.pow(1 - tw.t, 3);
      camera.position.lerpVectors(tw.from, tw.to, k);
      controls.target.lerpVectors(tw.tFrom, tw.tTo, k);
      if (tw.t >= 1) tween.current = null;
    } else if (controller.follow) {
      // 따라가기: 보는 점을 사람 쪽으로 부드럽게 옮기고 카메라도 같은 만큼 옮긴다(보는 각도·거리는 그대로)
      const p = controller.personPos(controller.follow);
      if (p) {
        shift.set(p.x - controls.target.x, 0.5 - controls.target.y, p.z - controls.target.z).multiplyScalar(1 - Math.exp(-dt * 6));
        controls.target.add(shift);
        camera.position.add(shift);
      }
    }
    controls.update();
    // 정면 보기에서 사용자가 크게 물러나거나 다가가면 클리핑을 푼다
    const d = camera.position.distanceTo(controls.target);
    const near = controller.nearCut > 0 && d > 2.0 && d < 4.5 ? controller.nearCut : 0.05;
    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/**
 * 클릭(누른 뒤 6px 이내에서 뗌) 판정. 우선순위: 사람 → 선반 상품 → 구역 바닥.
 * 거리 순이 아니라 이 순서로 고르므로 react-three-fiber 포인터 이벤트 대신 직접 레이캐스트한다.
 */
export function Picker() {
  const { sim, controller, registry } = useApp();
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const pick = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // 1) 사람
      const targets: THREE.Object3D[] = [];
      for (const g of registry.people.values()) targets.push(...g.children.filter((c) => c.userData.personId));
      const hp = raycaster.intersectObjects(targets, false)[0];
      if (hp) {
        const kind = hp.object.userData.personKind as 'worker' | 'inbound';
        controller.select({ kind, id: hp.object.userData.personId as string });
        return;
      }
      // 2) 선반 상품
      if (registry.goods) {
        const hg = raycaster.intersectObject(registry.goods.mesh, false)[0];
        if (hg?.instanceId !== undefined) {
          controller.select({ kind: 'location', sku: registry.goods.skuAt(hg.instanceId) });
          return;
        }
      }
      // 3) 구역 바닥 → 그 구역으로 확대
      const hz = raycaster.intersectObjects([...registry.zoneFloors.values()], false)[0];
      const zid = hz?.object.userData.zoneId as string | undefined;
      const v = controller.views.find((x) => x.zoneId === zid);
      if (v && v.key !== controller.focusedZone) controller.focusZone(v.key);
    };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved < 6) pick(e);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, sim, controller, registry]);
  return null;
}

export function Lights() {
  const scene = useThree((s) => s.scene);
  const sun = useRef<THREE.DirectionalLight>(null!);
  useLayoutEffect(() => {
    const light = sun.current;
    light.target.position.set(26, 0, 20);
    scene.add(light.target);
    return () => {
      scene.remove(light.target);
    };
  }, [scene]);
  return (
    <>
      <hemisphereLight args={[0xdfe8ff, 0x2a2622, 1.15]} />
      <directionalLight
        ref={sun}
        color={0xffffff}
        intensity={1.5}
        position={[40, 60, 30]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-near={1}
        shadow-camera-far={170}
      />
    </>
  );
}

/** 매 프레임 카메라·캔버스 크기를 cameraTap 에 적는다(스캔 말풍선 ScanBubbles 가 읽음) */
export function CameraTap() {
  useFrame(({ camera, size }) => {
    cameraTap.camera = camera;
    cameraTap.width = size.width;
    cameraTap.height = size.height;
  });
  return null;
}
