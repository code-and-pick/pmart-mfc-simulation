import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TemperatureZone } from '../domain/contract';
import { RACK_DEPTH, RACK_HEIGHT, RACK_LEN, type Layout, type ZoneKind } from '../domain/layout';
import type { Simulation } from '../sim/simulation';
import type { Worker, WorkerState } from '../sim/worker';
import type { Rider } from '../sim/rider';

const ZONE_COLOR: Record<ZoneKind, number> = {
  FROZEN: 0x2b4e7e,
  CHILLED: 0x2f6f73,
  AMBIENT: 0x6b5b3e,
  INBOUND_STORE: 0x4a4a52,
  RECEIVING: 0x55505e,
  OFFICE: 0x3d3d44,
  PACKING: 0x6a4a6e,
  QUARANTINE: 0x7a3434,
  SHIPPING: 0x7a6a2a,
  PARKING: 0x2e2e2e,
};

export const TEMP_COLOR: Record<TemperatureZone, number> = {
  FROZEN: 0x5aa9ff,
  CHILLED: 0x4fd1c5,
  AMBIENT: 0xf2b84b,
};

export const STATE_COLOR: Record<WorkerState, number> = {
  IDLE: 0x9aa0a6,
  TO_CART: 0x8ab4f8,
  PICKING: 0x34a853,
  WAIT_STATION: 0xfbbc04,
  PACKING: 0xff7043,
  TO_SHIP: 0xc58af9,
  RETURNING: 0x9aa0a6,
  ERROR: 0xea4335,
};

/** screenPx 를 주면 화면 고정 크기(px) 라벨, 아니면 월드 크기 라벨. */
function label(text: string, opts: { size?: number; color?: string; bg?: string; screenPx?: number } = {}): THREE.Sprite {
  const size = opts.size ?? 48;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `600 ${size}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  c.width = w;
  c.height = Math.ceil(size * 1.6);
  ctx.font = `600 ${size}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, size * 0.4);
    ctx.fill();
  }
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: !opts.screenPx });
  const s = new THREE.Sprite(mat);
  if (opts.screenPx) {
    // 원근 카메라(fov 45°)에서 sizeAttenuation=false 일 때 화면 높이 px ≈ scale × 2.414 × (H/2)
    const h = opts.screenPx / (2.414 * 475);
    s.scale.set((h * c.width) / c.height, h, 1);
  } else {
    const scale = 0.014 * (size / 48);
    s.scale.set(c.width * scale, c.height * scale, 1);
  }
  s.renderOrder = 10;
  return s;
}

interface WorkerMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  cart: THREE.Mesh;
  bags: THREE.Mesh[];
  tag: THREE.Sprite;
}

interface RiderMesh {
  group: THREE.Group;
  bike: THREE.Group;
  box: THREE.Mesh;
}

export const CAMERA_PRESETS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  전체: { pos: [24, 38, 52], target: [24, 0, 19] },
  냉동A: { pos: [6, 16, 34], target: [6, 0, 14] },
  냉장B: { pos: [17.5, 16, 34], target: [17.5, 0, 14] },
  상온: { pos: [30, 15, 24], target: [30, 0, 7.5] },
  패킹: { pos: [30, 11, 34], target: [30, 0, 24.5] },
  출하대기: { pos: [36, 8, 43], target: [30, 0, 33.5] },
};

export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly workerMeshes = new Map<string, WorkerMesh>();
  private readonly riderMeshes = new Map<string, RiderMesh>();
  private readonly stationMats: THREE.MeshStandardMaterial[] = [];
  private readonly stationTags: THREE.Sprite[] = [];
  private stagedMesh!: THREE.InstancedMesh;
  private targetMarkers!: THREE.InstancedMesh;
  private pathLine: THREE.Line;
  private readonly raycaster = new THREE.Raycaster();
  selectedId: string | null = null;
  onSelect: ((id: string | null) => void) | null = null;
  private wallMats: THREE.Material[] = [];
  private tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly sim: Simulation,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14161a);
    this.scene.fog = new THREE.Fog(0x14161a, 70, 140);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 120;
    this.setPreset('전체', false);

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 60, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
    sun.target.position.set(24, 0, 18);
    this.scene.add(sun, sun.target);

    this.buildFacility(sim.layout);
    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.2, transparent: true, opacity: 0.9 }),
    );
    this.scene.add(this.pathLine);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.pick(e));
  }

  resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setPreset(name: string, animate = true) {
    const p = CAMERA_PRESETS[name];
    if (!p) return;
    const to = new THREE.Vector3(...p.pos);
    const tTo = new THREE.Vector3(...p.target);
    if (!animate) {
      this.camera.position.copy(to);
      this.controls.target.copy(tTo);
      this.controls.update();
      return;
    }
    this.tween = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo, t: 0 };
  }

  setWallOpacity(o: number) {
    for (const m of this.wallMats) {
      (m as THREE.MeshStandardMaterial).opacity = o;
      m.visible = o > 0.01;
    }
  }

  focusWorker(id: string) {
    const w = this.sim.workers.find((x) => x.id === id);
    if (!w) return;
    const tTo = new THREE.Vector3(w.pos.x, 0, w.pos.z);
    const to = tTo.clone().add(new THREE.Vector3(0, 9, 9));
    this.tween = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo, t: 0 };
  }

  // ── 시설 ──────────────────────────────────────────
  private box(w: number, h: number, d: number, color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts }));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  private buildFacility(L: Layout) {
    // 바깥 바닥
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(24, -0.02, 20);
    ground.receiveShadow = true;
    this.scene.add(ground);
    // 건물 바닥 (공용 통로 색)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(L.width, L.buildingDepth),
      new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(L.width / 2, -0.01, L.buildingDepth / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);
    // 외부 앞마당
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(19.7, 8), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(30, -0.015, 36);
    apron.receiveShadow = true;
    this.scene.add(apron);

    for (const z of L.zones) {
      const r = z.rect;
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ color: ZONE_COLOR[z.kind], roughness: 0.9, transparent: true, opacity: 0.85 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(r.x0 + w / 2, 0.005, r.z0 + d / 2);
      m.receiveShadow = true;
      this.scene.add(m);
      const t = label(z.docPyeong ? `${z.label} · ${z.docPyeong}평` : z.label, { size: 40, bg: 'rgba(0,0,0,0.55)', screenPx: 17 });
      const tall = z.kind === 'QUARANTINE' || z.kind === 'SHIPPING' || z.kind === 'PARKING';
      t.position.set(r.x0 + w / 2, tall ? 2.4 : 3.6, z.kind === 'SHIPPING' ? r.z1 + 0.3 : r.z0 + Math.min(1.5, d / 2));
      this.scene.add(t);
    }

    // 벽
    for (const w of L.walls) {
      const r = w.rect;
      const mat = new THREE.MeshStandardMaterial({
        color: w.glass ? 0x9fd3ff : 0xc9ccd1,
        transparent: true,
        opacity: w.glass ? 0.18 : 0.32,
        roughness: 0.4,
        depthWrite: false,
      });
      this.wallMats.push(mat);
      const m = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0, w.height, r.z1 - r.z0), mat);
      m.position.set((r.x0 + r.x1) / 2, w.height / 2, (r.z0 + r.z1) / 2);
      this.scene.add(m);
    }

    // 랙 (InstancedMesh): 기둥 프레임 + 선반
    const rackGeo = new THREE.BoxGeometry(1, 1, 1);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.4, roughness: 0.5 });
    const shelfCount = L.racks.reduce((a, r) => a + r.levels, 0);
    const posts = new THREE.InstancedMesh(rackGeo, frameMat, L.racks.length * 4);
    const shelves = new THREE.InstancedMesh(rackGeo, new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.6 }), shelfCount);
    const mtx = new THREE.Matrix4();
    let pi = 0;
    let si = 0;
    for (const r of L.racks) {
      const lx = r.along === 'x' ? RACK_LEN : RACK_DEPTH;
      const lz = r.along === 'x' ? RACK_DEPTH : RACK_LEN;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          mtx.compose(
            new THREE.Vector3(r.cx + (sx * (lx - 0.05)) / 2, RACK_HEIGHT / 2, r.cz + (sz * (lz - 0.05)) / 2),
            new THREE.Quaternion(),
            new THREE.Vector3(0.05, RACK_HEIGHT, 0.05),
          );
          posts.setMatrixAt(pi++, mtx);
        }
      for (let lv = 0; lv < r.levels; lv++) {
        const y = 0.1 + (lv * (RACK_HEIGHT - 0.25)) / r.levels;
        mtx.compose(new THREE.Vector3(r.cx, y, r.cz), new THREE.Quaternion(), new THREE.Vector3(lx, 0.03, lz));
        shelves.setMatrixAt(si++, mtx);
      }
    }
    posts.castShadow = shelves.castShadow = true;
    shelves.receiveShadow = true;
    this.scene.add(posts, shelves);

    // 선반 위 상품 (SKU 피킹 전면)
    const goods = new THREE.InstancedMesh(rackGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), this.sim.catalog.length);
    const col = new THREE.Color();
    this.sim.catalog.forEach((s, i) => {
      const lx = 0.26;
      const h = 0.14 + ((i * 37) % 7) * 0.02;
      mtx.compose(new THREE.Vector3(s.location.shelf.x, s.location.shelf.y + h / 2 + 0.02, s.location.shelf.z), new THREE.Quaternion(), new THREE.Vector3(lx, h, lx));
      goods.setMatrixAt(i, mtx);
      col.setHex(TEMP_COLOR[s.temp]).offsetHSL(((i * 13) % 10) / 100 - 0.05, -0.15, -0.1 + ((i * 7) % 5) / 30);
      goods.setColorAt(i, col);
    });
    goods.castShadow = true;
    this.scene.add(goods);

    // 장애물: 팔레트·포장재·출하 랙
    for (const o of L.obstacles) {
      if (o.kind === 'TABLE') continue;
      const r = o.rect;
      const color = o.kind === 'PALLET' ? 0x8d6e4a : o.kind === 'SHIP_RACK' ? 0xb0a060 : 0x7d6a8a;
      const m = this.box(r.x1 - r.x0, o.height, r.z1 - r.z0, color, o.kind === 'SHIP_RACK' ? { transparent: true, opacity: 0.45 } : {});
      m.position.set((r.x0 + r.x1) / 2, o.height / 2, (r.z0 + r.z1) / 2);
      this.scene.add(m);
    }

    // 패킹대
    for (const st of L.stations) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6 });
      this.stationMats.push(mat);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.8), mat);
      top.position.set(st.table.x, 0.45, st.table.z);
      top.castShadow = top.receiveShadow = true;
      this.scene.add(top);
      const tag = label(st.id, { size: 32, bg: 'rgba(0,0,0,0.6)', screenPx: 16 });
      tag.position.set(st.table.x, 1.5, st.table.z);
      this.stationTags.push(tag);
      this.scene.add(tag);
    }

    // 장바구니 거치대
    const depot = this.box(1.6, 0.9, 0.7, 0x4a90d9);
    depot.position.set(L.points.cartDepot.x, 0.45, L.points.cartDepot.z - 0.6);
    this.scene.add(depot);
    const dl = label('장바구니 거치대', { size: 28, bg: 'rgba(0,0,0,0.6)', screenPx: 15 });
    dl.position.set(L.points.cartDepot.x, 1.4, L.points.cartDepot.z - 0.6);
    this.scene.add(dl);

    // 출하대기 랙 위 포장 봉투 / 피킹 목표 표시
    this.stagedMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.32, 0.26), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 96);
    this.stagedMesh.count = 0;
    this.stagedMesh.frustumCulled = false; // 인스턴스가 매 프레임 바뀌어 경계구를 다시 잡지 않는다
    this.scene.add(this.stagedMesh);
    this.targetMarkers = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.22, 0.32, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x34a853, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      64,
    );
    this.targetMarkers.count = 0;
    this.targetMarkers.frustumCulled = false;
    this.scene.add(this.targetMarkers);
  }

  // ── 매 프레임 ──────────────────────────────────────
  render(dt: number) {
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dt / 0.8);
      const k = 1 - Math.pow(1 - this.tween.t, 3);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, k);
      this.controls.target.lerpVectors(this.tween.tFrom, this.tween.tTo, k);
      if (this.tween.t >= 1) this.tween = null;
    }
    this.syncWorkers();
    this.syncRiders();
    this.syncStations();
    this.syncStaged();
    this.syncPath();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private makeWorker(w: Worker): WorkerMesh {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: STATE_COLOR.IDLE, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.85, 4, 12), bodyMat);
    body.position.y = 0.66;
    body.castShadow = true;
    body.userData.workerId = w.id;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf1d3b3 }));
    head.position.y = 1.42;
    head.castShadow = true;
    head.userData.workerId = w.id;
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x1e88e5 }));
    vest.position.y = 0.95;
    vest.userData.workerId = w.id;
    const cart = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.65), new THREE.MeshStandardMaterial({ color: 0x4a90d9, transparent: true, opacity: 0.85 }));
    cart.position.set(0, 0.45, 0.55);
    cart.castShadow = true;
    const bags: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      b.position.set(((i % 3) - 1) * 0.15, 0.78 + Math.floor(i / 3) * 0.17, 0.5);
      b.visible = false;
      cart.add(b);
      b.position.sub(cart.position);
      bags.push(b);
    }
    const tag = label(w.id, { size: 30, bg: 'rgba(0,0,0,0.65)', screenPx: 15 });
    tag.position.y = 1.95;
    group.add(body, head, vest, cart, tag);
    this.scene.add(group);
    return { group, body, bodyMat, cart, bags, tag };
  }

  private syncWorkers() {
    const alive = new Set<string>();
    let mi = 0;
    const mtx = new THREE.Matrix4();
    for (const w of this.sim.workers) {
      alive.add(w.id);
      let m = this.workerMeshes.get(w.id);
      if (!m) {
        m = this.makeWorker(w);
        this.workerMeshes.set(w.id, m);
      }
      m.group.position.set(w.pos.x, 0, w.pos.z);
      m.group.rotation.y = w.heading;
      m.bodyMat.color.setHex(STATE_COLOR[w.state]);
      m.bodyMat.emissive.setHex(w.id === this.selectedId ? 0x333333 : 0x000000);
      const showCart = w.hasCart || w.carrying.length > 0;
      m.cart.visible = showCart;
      m.bags.forEach((b, i) => {
        const t = w.carrying[i];
        b.visible = t !== undefined;
        if (t) ((b.material as THREE.MeshStandardMaterial).color as THREE.Color).setHex(TEMP_COLOR[t]);
      });
      if (w.currentTarget && w.state === 'PICKING' && mi < 64) {
        mtx.makeTranslation(w.currentTarget.pick.x, 0.03, w.currentTarget.pick.z);
        this.targetMarkers.setMatrixAt(mi++, mtx);
      }
    }
    this.targetMarkers.count = mi;
    this.targetMarkers.instanceMatrix.needsUpdate = true;
    for (const [id, m] of this.workerMeshes) {
      if (!alive.has(id)) {
        this.scene.remove(m.group);
        this.workerMeshes.delete(id);
      }
    }
  }

  private makeRider(r: Rider): RiderMesh {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.85, 4, 12), new THREE.MeshStandardMaterial({ color: 0x26c6da }));
    body.position.y = 0.66;
    body.castShadow = true;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    helmet.position.y = 1.44;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.3), new THREE.MeshStandardMaterial({ color: 0x00897b }));
    box.position.set(0, 1.0, -0.3);
    box.visible = false;
    const tag = label(r.id, { size: 28, bg: 'rgba(0,80,90,0.75)', screenPx: 15 });
    tag.position.y = 1.95;
    group.add(body, helmet, box, tag);
    // 오토바이 (주차 위치에 고정)
    const bike = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 1.6), new THREE.MeshStandardMaterial({ color: 0xd32f2f, metalness: 0.3 }));
    frame.position.y = 0.55;
    const delivBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    delivBox.position.set(0, 0.95, -0.55);
    for (const z of [-0.6, 0.6]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.08, 8, 16), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(0, 0.27, z);
      bike.add(wheel);
    }
    bike.add(frame, delivBox);
    bike.position.set(r.parking.x, 0, r.parking.z + 0.9);
    bike.traverse((o) => (o.castShadow = true));
    this.scene.add(group, bike);
    return { group, bike, box };
  }

  private syncRiders() {
    const alive = new Set<string>();
    for (const r of this.sim.riders) {
      alive.add(r.id);
      let m = this.riderMeshes.get(r.id);
      if (!m) {
        m = this.makeRider(r);
        this.riderMeshes.set(r.id, m);
      }
      m.group.position.set(r.pos.x, 0, r.pos.z);
      m.group.rotation.y = r.heading;
      m.box.visible = r.carrying > 0;
    }
    for (const [id, m] of this.riderMeshes) {
      if (!alive.has(id)) {
        this.scene.remove(m.group, m.bike);
        this.riderMeshes.delete(id);
      }
    }
  }

  private syncStations() {
    this.sim.layout.stations.forEach((st, i) => {
      const active = this.sim.stations.isActive(i);
      const busy = this.sim.stations.occupant(st.id);
      this.stationMats[i].color.setHex(!active ? 0x3a3a3a : busy ? 0xff7043 : 0x43a047);
      this.stationTags[i].visible = active;
    });
  }

  private syncStaged() {
    const staged = this.sim.shipRack.all();
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    for (const s of staged) {
      if (n >= 96) break;
      mtx.makeTranslation(s.slot.pos.x, s.slot.pos.y + 0.16, s.slot.pos.z);
      this.stagedMesh.setMatrixAt(n, mtx);
      this.stagedMesh.setColorAt(n, col.setHex(TEMP_COLOR[s.pkg.temperatureZone]));
      n++;
    }
    this.stagedMesh.count = n;
    this.stagedMesh.instanceMatrix.needsUpdate = true;
    if (this.stagedMesh.instanceColor) this.stagedMesh.instanceColor.needsUpdate = true;
  }

  private syncPath() {
    const w = this.sim.workers.find((x) => x.id === this.selectedId);
    if (!w || w.path.length === 0) {
      this.pathLine.visible = false;
      return;
    }
    const pts = [new THREE.Vector3(w.pos.x, 0.08, w.pos.z), ...w.path.map((p) => new THREE.Vector3(p.x, 0.08, p.z))];
    this.pathLine.geometry.dispose();
    this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.pathLine.computeLineDistances();
    this.pathLine.visible = true;
  }

  private pick(e: PointerEvent) {
    if (e.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const m of this.workerMeshes.values()) targets.push(...m.group.children.filter((c) => c.userData.workerId));
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const id = (hit?.object.userData.workerId as string | undefined) ?? null;
    if (id) {
      this.selectedId = id;
      this.onSelect?.(id);
    }
  }
}
