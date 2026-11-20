// 장면의 바탕 동작: 시뮬레이션 진행, 카메라(OrbitControls·이동), 클릭 판정, 조명.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RACK_DEPTH } from '../../domain/layout';
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
    // 지도처럼(사용자 2026-11-20 "구역 이동하고 싶으면 직직 화면 그어야 되고, 방향전환도 … 훽훽 막 바껴"):
    // 왼쪽 끌기 = 바닥을 따라 이동, 오른쪽 끌기 = 천천히 돌리기, 휠 = 마우스가 가리킨 곳으로 확대, 화살표·WASD = 이동
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    c.screenSpacePanning = false; // 바닥과 나란히 움직인다(위아래로 뜨지 않음)
    c.enableDamping = true;
    c.dampingFactor = 0.15;
    c.rotateSpeed = 0.35;
    c.panSpeed = 1.1;
    c.zoomSpeed = 0.9;
    c.zoomToCursor = true;
    c.minPolarAngle = Math.PI * 0.12; // 바로 위에서 뒤집히지 않게
    c.maxPolarAngle = Math.PI * 0.47;
    c.minDistance = 1.2;
    c.maxDistance = 130;
    c.keyPanSpeed = 24;
    c.listenToKeyEvents(window);
    c.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
    return c;
  }, [camera, gl]);
  useEffect(() => {
    registry.controls = controls;
    controller.cameraNow = () => ({ pos: camera.position.clone(), target: controls.target.clone() });
    return () => {
      controls.dispose();
      registry.controls = null;
    };
  }, [controls, registry, controller, camera]);

  // 왼쪽 끌기(이동)로 시점을 옮기면 따라가기를 끈다 — 돌리기·확대는 따라가면서 된다. 클릭(6px 안)은 그대로
  useEffect(() => {
    const el = gl.domElement;
    let start: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => (start = e.button === 0 ? { x: e.clientX, y: e.clientY } : null);
    const move = (e: PointerEvent) => {
      if (start && controller.follow && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) controller.setFollow(false);
    };
    const up = () => (start = null);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // 오른쪽 끌기가 브라우저 메뉴를 띄우지 않게
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener('contextmenu', menu);
    // WASD 이동(입력칸에 글자를 칠 때는 안 함)
    const keys = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const map: Record<string, string> = { w: 'ArrowUp', a: 'ArrowLeft', s: 'ArrowDown', d: 'ArrowRight' };
      const k = map[e.key.toLowerCase()];
      if (k) window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k }));
    };
    window.addEventListener('keydown', keys);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('contextmenu', menu);
      window.removeEventListener('keydown', keys);
    };
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
      // 2) 실서버 선반 칸 — 상자(재고 있는 칸)와 칸 상자(빈 칸 포함) 중 더 가까운 것 → 왼쪽 "구역" 칸 카드
      //    (빈 칸을 지나 뒤 랙 상자를 집지 않게 둘을 거리로 비교)
      if (sim.board) {
        let best: { code: string; d: number } | null = null;
        if (registry.realCells) {
          // 칸 정면 보기는 앞쪽(맞은편 랙)을 근접 클리핑으로 잘라 낸다 — 안 보이는 상자는 건너뛴다
          const hc = raycaster.intersectObject(registry.realCells.mesh, false).find((h) => h.distance >= camera.near);
          const code = hc?.instanceId !== undefined ? registry.realCells.codeAt(hc.instanceId) : null;
          if (hc && code) best = { code, d: hc.distance };
        }
        const box = new THREE.Box3();
        const hitP = new THREE.Vector3();
        const dir = raycaster.ray.direction;
        for (const loc of sim.layout.locations) {
          // 칸 앞면(통로 쪽)이 카메라를 볼 때만
          const facing = loc.along === 'z' ? loc.face * dir.x : loc.face * dir.z;
          if (facing > 0) continue;
          const half = loc.slotW / 2;
          const y0 = loc.shelf.y - 0.035;
          const cross = loc.along === 'z' ? loc.shelf.x : loc.shelf.z;
          const c0 = cross - loc.face * RACK_DEPTH * 0.5;
          const c1 = cross + loc.face * 0.05;
          const a = loc.along === 'z' ? loc.shelf.z : loc.shelf.x;
          const lo = Math.min(c0, c1);
          const hi = Math.max(c0, c1);
          if (loc.along === 'z') box.set(new THREE.Vector3(lo, y0, a - half), new THREE.Vector3(hi, y0 + loc.levelH, a + half));
          else box.set(new THREE.Vector3(a - half, y0, lo), new THREE.Vector3(a + half, y0 + loc.levelH, hi));
          if (!raycaster.ray.intersectBox(box, hitP)) continue;
          const d = hitP.distanceTo(raycaster.ray.origin);
          if (d < camera.near || (best && d >= best.d)) continue;
          const code = sim.codes.toBackend(loc.code);
          if (code) best = { code, d };
        }
        if (best) {
          controller.focusCell(best.code);
          return;
        }
      }
      // 2) 선반 상품
      if (registry.goods) {
        const hg = raycaster.intersectObject(registry.goods.mesh, false)[0];
        if (hg?.instanceId !== undefined) {
          controller.select({ kind: 'location', sku: registry.goods.skuAt(hg.instanceId) });
          return;
        }
      }
      // 3) 패킹대·출하대기 랙(실서버) → 그 자리 주문 팝업
      if (sim.board) {
        const hit = new THREE.Vector3();
        for (const y of [0.9, 1.2]) {
          if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit)) continue;
          const places = [
            ...sim.layout.stations.map((s) => ({ code: `PAK-A-${String(s.index + 1).padStart(2, '0')}`, p: s.table, r: 0.95 })),
            ...['DSP-A-01', 'DSP-A-02'].map((c) => ({ code: c, p: sim.backendPoint(c), r: 1.3 })),
          ];
          const near = places.find((x) => x.p && Math.hypot(hit.x - x.p.x, hit.z - x.p.z) < x.r);
          if (near) {
            controller.showPlace(near.code);
            return;
          }
        }
      }
      // 4) 구역 바닥 → 그 구역으로 확대
      const hz = raycaster.intersectObjects([...registry.zoneFloors.values()], false)[0];
      const zid = hz?.object.userData.zoneId as string | undefined;
      const v = controller.views.find((x) => x.zoneId === zid);
      // 다른 구역 바닥 → 그 구역으로. 이미 들어온 구역의 빈 바닥·구역 밖(MFC 바깥·통로) → 고른 것 풀고 확대하기 전 시야로
      // (구역 안에 들어오면 화면이 그 구역 바닥으로 꽉 차 바깥이 안 보인다 — 같은 구역 빈 곳도 "나가기")
      if (v && v.key !== controller.focusedZone && !controller.selection && !controller.cellFocus) controller.focusZone(v.key);
      else controller.backOut();
    };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved < 6) pick(e);
    };
    // Esc = 나가기(확대하기 전 시야로)
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) controller.backOut();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
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
