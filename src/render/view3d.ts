import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Sku } from '../domain/catalog';
import type { TemperatureZone } from '../domain/contract';
import { RACK_DEPTH, RACK_HEIGHT, RACK_LEN, type Layout, type Location, type Rect, type ZoneKind } from '../domain/layout';
import type { InboundState, InboundWorker } from '../sim/inbound';
import type { Rider } from '../sim/rider';
import type { Simulation } from '../sim/simulation';
import { LocationLabels } from './locationLabels';
import type { Worker, WorkerState } from '../sim/worker';

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

export const INBOUND_COLOR: Record<InboundState, number> = {
  IDLE: 0x9aa0a6,
  RECEIVING: 0x7986cb,
  PUTAWAY: 0x9ccc65,
  REPLENISH: 0xf06292,
  RETURNING: 0x9aa0a6,
  ERROR: 0xea4335,
};

const VEST_PICKER = 0x1e88e5;
const VEST_INBOUND = 0xff9800;

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

interface PersonMesh {
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  cart: THREE.Mesh;
  bags: THREE.Mesh[];
}

interface RiderMesh {
  group: THREE.Group;
  bike: THREE.Group;
  box: THREE.Mesh;
}

export type Selection =
  | { kind: 'worker'; id: string }
  | { kind: 'inbound'; id: string }
  | { kind: 'location'; sku: string }
  | null;

/** 화면에서 고를 수 있는 구역 (상단 버튼). rect 는 확대 범위. */
export interface ZoneView {
  key: string;
  label: string;
  zoneId: string | null;
  rect: Rect;
}

export function zoneViews(L: Layout): ZoneView[] {
  const z = (id: string) => L.zones.find((x) => x.id === id)!.rect;
  return [
    { key: 'ALL', label: '전체', zoneId: null, rect: { x0: 0, z0: 0, x1: L.width, z1: L.depth } },
    { key: 'A', label: '냉동 A', zoneId: 'A', rect: z('A') },
    { key: 'B', label: '냉장 B', zoneId: 'B', rect: z('B') },
    { key: 'C-H', label: '상온 C~H', zoneId: 'C-H', rect: z('C-H') },
    { key: 'WH', label: '입고창고', zoneId: 'WH', rect: z('WH') },
    { key: 'RCV', label: '입고·검수', zoneId: 'RCV', rect: { ...z('RCV'), x1: 57 } },
    { key: 'PK', label: '패킹', zoneId: 'PK', rect: z('PK') },
    { key: 'SHIP', label: '출하대기', zoneId: 'SHIP', rect: { x0: 24, z0: 31, x1: 36, z1: 40 } },
  ];
}

export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly views: ZoneView[];
  private readonly people = new Map<string, PersonMesh>();
  private readonly riderMeshes = new Map<string, RiderMesh>();
  private readonly truckMeshes = new Map<string, THREE.Group>();
  private readonly stationMats: THREE.MeshStandardMaterial[] = [];
  private readonly stationTags: THREE.Sprite[] = [];
  private readonly zoneFloors: THREE.Mesh[] = [];
  private stagedMesh!: THREE.InstancedMesh;
  private targetMarkers!: THREE.InstancedMesh;
  private goods!: THREE.InstancedMesh;
  private goodsSku!: Int32Array; // 인스턴스 → 카탈로그 index
  private goodsStart!: Int32Array; // 카탈로그 index → 첫 인스턴스
  private goodsPos!: Float32Array; // 인스턴스별 위치(x,y,z)
  private goodsShown!: Int16Array; // 카탈로그 index → 보이는 개수
  private cartons!: THREE.InstancedMesh;
  private readonly cartonsPerReserve = 96;
  private dockMesh!: THREE.InstancedMesh;
  private highlight: THREE.LineSegments;
  private readonly pathLine: THREE.Line;
  private readonly raycaster = new THREE.Raycaster();
  private readonly wallMats: THREE.Material[] = [];
  private tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;
  private down: { x: number; y: number } | null = null;
  private reserveTimer = 0;
  readonly labels: LocationLabels;
  selection: Selection = null;
  /** 로케이션 정면 보기 중 근접 클리핑 거리 (맞은편 랙 숨김) */
  private nearCut = 0;
  /** 사용자가 벽 투명도를 고르지 않았으면 구역 확대 때 벽을 옅게 한다 */
  wallUser: number | null = null;
  focusedZone = 'ALL';
  onSelect: ((s: Selection) => void) | null = null;
  onZone: ((key: string) => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly sim: Simulation,
  ) {
    this.views = zoneViews(sim.layout);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14161a);
    this.scene.fog = new THREE.Fog(0x14161a, 80, 160);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 130;

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.15);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(40, 60, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 170 });
    sun.target.position.set(26, 0, 20);
    this.scene.add(sun, sun.target);

    this.buildFacility(sim.layout);
    this.buildGoods(sim.catalog);
    this.buildReserves(sim.layout);
    this.labels = new LocationLabels(this.scene, sim.layout);

    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.2, transparent: true, opacity: 0.9 }),
    );
    this.scene.add(this.pathLine);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xfde293, depthTest: false, transparent: true }),
    );
    this.highlight.renderOrder = 20;
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.focusZone('ALL', false);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.down) return;
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      this.down = null;
      if (moved < 6) this.pick(e);
    });
  }

  resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── 카메라 ─────────────────────────────────────────
  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, animate = true) {
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.tween = { from: this.camera.position.clone(), to: pos, tFrom: this.controls.target.clone(), tTo: target, t: 0 };
  }

  /** 구역에 맞춰 확대. 패널이 화면 좌우를 가리므로 조금 넉넉하게 잡는다. */
  focusZone(key: string, animate = true) {
    const v = this.views.find((x) => x.key === key);
    if (!v) return;
    this.nearCut = 0;
    this.focusedZone = key;
    const r = v.rect;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const size = Math.max(r.x1 - r.x0, (r.z1 - r.z0) * 1.15);
    const dist = key === 'ALL' ? 62 : size * 0.85 + 3;
    const target = new THREE.Vector3(cx, 0, cz + (key === 'ALL' ? 1 : 0));
    const pos = new THREE.Vector3(cx, dist * 0.78, cz + dist * 0.72);
    this.flyTo(pos, target, animate);
    if (this.wallUser === null) this.applyWalls(key === 'ALL' ? 0.32 : 0.07);
    this.onZone?.(key);
  }

  /** 로케이션(랙 칸) 정면으로 붙는다. */
  focusLocation(loc: Location) {
    const n = loc.along === 'z' ? new THREE.Vector3(loc.face, 0, 0) : new THREE.Vector3(0, 0, loc.face);
    // 위 단 선반판이 가리지 않도록 그 단 높이에서 정면으로 본다
    const target = new THREE.Vector3(loc.shelf.x, loc.shelf.y - 0.035 + loc.levelH / 2, loc.shelf.z);
    // 통로 폭이 0.7m 라 정면에서 물러서면 맞은편 랙이 가린다.
    // 카메라를 맞은편 랙 뒤 정면에 두고, 그 사이(맞은편 랙)는 근접 클리핑으로 잘라 낸다.
    const pos = target.clone().add(n.multiplyScalar(2.6)).add(new THREE.Vector3(0, 0.12, 0));
    this.flyTo(pos, target);
    this.nearCut = 1.75;
  }

  focusPerson(id: string) {
    this.nearCut = 0;
    const p = [...this.sim.workers, ...this.sim.inboundWorkers].find((x) => x.id === id);
    if (!p) return;
    const tTo = new THREE.Vector3(p.pos.x, 0.5, p.pos.z);
    this.flyTo(tTo.clone().add(new THREE.Vector3(0, 7, 7)), tTo);
  }

  setWallOpacity(o: number) {
    this.wallUser = o;
    this.applyWalls(o);
  }

  private applyWalls(o: number) {
    for (const m of this.wallMats) {
      (m as THREE.MeshStandardMaterial).opacity = o;
      m.visible = o > 0.01;
    }
  }

  select(s: Selection, fly = true) {
    this.selection = s;
    if (s?.kind === 'location') {
      const sku = this.sim.skuMap.get(s.sku);
      if (sku) {
        const loc = sku.location;
        this.highlight.position.set(loc.shelf.x, loc.shelf.y - 0.035 + loc.levelH / 2, loc.shelf.z);
        const depth = RACK_DEPTH;
        const lx = loc.along === 'x' ? loc.slotW : depth;
        const lz = loc.along === 'x' ? depth : loc.slotW;
        this.highlight.position.add(
          loc.along === 'z' ? new THREE.Vector3((-loc.face * RACK_DEPTH) / 4, 0, 0) : new THREE.Vector3(0, 0, (-loc.face * RACK_DEPTH) / 4),
        );
        this.highlight.scale.set(lx, loc.levelH, lz);
        this.highlight.visible = true;
        if (fly) this.focusLocation(loc);
      }
    } else {
      this.highlight.visible = false;
      if (s && fly) this.focusPerson(s.id);
    }
    this.onSelect?.(s);
  }

  // ── 시설 ──────────────────────────────────────────
  private box(w: number, h: number, d: number, color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts }));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  private buildFacility(L: Layout) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(30, -0.02, 20);
    ground.receiveShadow = true;
    this.scene.add(ground);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L.width, L.buildingDepth), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(L.width / 2, -0.01, L.buildingDepth / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);
    // 남쪽 앞마당(라이더), 동쪽 입고 차량 진입로
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(19.7, 8), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(30, -0.015, 36);
    apron.receiveShadow = true;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 5), new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 1 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(68, -0.015, L.points.truckDock.z);
    road.receiveShadow = true;
    this.scene.add(apron, road);

    for (const z of L.zones) {
      const r = z.rect;
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ color: ZONE_COLOR[z.kind], roughness: 0.9, transparent: true, opacity: 0.85 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(r.x0 + w / 2, z.kind === 'QUARANTINE' ? 0.008 : 0.005, r.z0 + d / 2);
      m.receiveShadow = true;
      m.userData.zoneId = z.id;
      this.zoneFloors.push(m);
      this.scene.add(m);
      const t = label(z.docPyeong ? `${z.label} · ${z.docPyeong}평` : z.label, { size: 40, bg: 'rgba(0,0,0,0.55)', screenPx: 17 });
      const tall = z.kind === 'QUARANTINE' || z.kind === 'SHIPPING' || z.kind === 'PARKING';
      t.position.set(r.x0 + w / 2, tall ? 2.4 : 3.6, z.kind === 'SHIPPING' ? r.z1 + 0.3 : r.z0 + Math.min(1.5, d / 2));
      this.scene.add(t);
    }

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

    // 랙: 기둥 + 선반
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const posts = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.4, roughness: 0.5 }), L.racks.length * 4);
    const shelfCount = L.racks.reduce((a, r) => a + r.levels, 0);
    const shelves = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.6 }), shelfCount);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let pi = 0;
    let si = 0;
    for (const r of L.racks) {
      const lx = r.along === 'x' ? RACK_LEN : RACK_DEPTH;
      const lz = r.along === 'x' ? RACK_DEPTH : RACK_LEN;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          mtx.compose(new THREE.Vector3(r.cx + (sx * (lx - 0.05)) / 2, RACK_HEIGHT / 2, r.cz + (sz * (lz - 0.05)) / 2), q, new THREE.Vector3(0.05, RACK_HEIGHT, 0.05));
          posts.setMatrixAt(pi++, mtx);
        }
      for (let lv = 0; lv < r.levels; lv++) {
        const y = 0.1 + (lv * (RACK_HEIGHT - 0.25)) / r.levels;
        mtx.compose(new THREE.Vector3(r.cx, y, r.cz), q, new THREE.Vector3(lx, 0.03, lz));
        shelves.setMatrixAt(si++, mtx);
      }
    }
    posts.castShadow = shelves.castShadow = true;
    shelves.receiveShadow = true;
    this.scene.add(posts, shelves);

    // 장애물: 포장재·출하 랙 (보충재고 팔레트는 buildReserves)
    for (const o of L.obstacles) {
      if (o.kind === 'TABLE' || o.kind === 'RESERVE') continue;
      const r = o.rect;
      const color = o.kind === 'PALLET' ? 0x8d6e4a : o.kind === 'SHIP_RACK' ? 0xb0a060 : 0x7d6a8a;
      const m = this.box(r.x1 - r.x0, o.height, r.z1 - r.z0, color, o.kind === 'SHIP_RACK' ? { transparent: true, opacity: 0.45 } : {});
      m.position.set((r.x0 + r.x1) / 2, o.height / 2, (r.z0 + r.z1) / 2);
      this.scene.add(m);
    }

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

    const depot = this.box(1.6, 0.9, 0.7, 0x4a90d9);
    depot.position.set(L.points.cartDepot.x, 0.45, L.points.cartDepot.z - 0.6);
    this.scene.add(depot);
    const dl = label('장바구니 거치대', { size: 28, bg: 'rgba(0,0,0,0.6)', screenPx: 15 });
    dl.position.set(L.points.cartDepot.x, 1.4, L.points.cartDepot.z - 0.6);
    this.scene.add(dl);
    const dockLbl = label('입고 차량문', { size: 28, bg: 'rgba(0,0,0,0.6)', screenPx: 15 });
    dockLbl.position.set(L.width + 0.4, 3.4, L.points.truckDoor.z);
    this.scene.add(dockLbl);

    this.stagedMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.32, 0.26), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 96);
    this.stagedMesh.count = 0;
    this.stagedMesh.frustumCulled = false;
    this.scene.add(this.stagedMesh);
    this.targetMarkers = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.22, 0.32, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      64,
    );
    this.targetMarkers.count = 0;
    this.targetMarkers.frustumCulled = false;
    this.scene.add(this.targetMarkers);
    // 하차 롤테이너
    this.dockMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.62, 1.05, 0.6),
      new THREE.MeshStandardMaterial({ roughness: 0.6, transparent: true, opacity: 0.88 }),
      96,
    );
    this.dockMesh.count = 0;
    this.dockMesh.frustumCulled = false;
    this.dockMesh.castShadow = true;
    this.scene.add(this.dockMesh);
  }

  /** 선반 위 상품: SKU 마다 칸 한도만큼 인스턴스를 만들어 두고 수량만큼 보인다 (뒤→앞 순으로 채워 앞에서부터 빠진다). */
  private buildGoods(catalog: Sku[]) {
    const total = catalog.reduce((a, s) => a + s.shelfCap, 0);
    this.goods = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.65 }), total);
    this.goodsSku = new Int32Array(total);
    this.goodsStart = new Int32Array(catalog.length);
    this.goodsPos = new Float32Array(total * 3);
    this.goodsShown = new Int16Array(catalog.length).fill(-1);
    const col = new THREE.Color();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let k = 0;
    catalog.forEach((s, ci) => {
      this.goodsStart[ci] = k;
      const loc = s.location;
      const u = s.unit;
      const cols = Math.max(1, Math.floor(loc.slotW / (u.w + 0.012)));
      const rows = Math.max(1, Math.floor(0.4 / (u.d + 0.012)));
      const layers = Math.max(1, Math.min(2, Math.floor((loc.levelH - 0.05) / (u.h + 0.01))));
      // 랙 중심선 = 칸 중심에서 face 반대쪽으로 DEPTH/4
      const along = loc.along;
      const face = loc.face;
      const rackCross = (along === 'z' ? loc.shelf.x : loc.shelf.z) - (face * RACK_DEPTH) / 4;
      const alongC = along === 'z' ? loc.shelf.z : loc.shelf.x;
      const baseY = loc.shelf.y - 0.035;
      col.setHex(TEMP_COLOR[s.temp]).offsetHSL(((ci * 13) % 10) / 100 - 0.05, -0.2 + ((ci * 7) % 5) / 25, -0.12 + ((ci * 11) % 6) / 30);
      let placed = 0;
      for (let r = 0; r < rows && placed < s.shelfCap; r++) {
        for (let l = 0; l < layers && placed < s.shelfCap; l++) {
          for (let c = 0; c < cols && placed < s.shelfCap; c++) {
            const a = alongC + (c - (cols - 1) / 2) * (u.w + 0.012);
            const depth = -0.2 + u.d / 2 + r * (u.d + 0.012); // 뒤(-) → 앞(+, 통로 쪽)
            const cross = rackCross + face * depth;
            const y = baseY + u.h / 2 + l * (u.h + 0.01);
            const x = along === 'z' ? cross : a;
            const z = along === 'z' ? a : cross;
            this.goodsPos.set([x, y, z], k * 3);
            this.goodsSku[k] = ci;
            this.goods.setColorAt(k, col);
            this.goods.setMatrixAt(k, zero);
            k++;
            placed++;
          }
        }
      }
      // 칸 계산이 한도보다 적게 나오면 남는 인스턴스는 숨긴 채 둔다
      while (placed < s.shelfCap) {
        this.goodsSku[k] = ci;
        this.goods.setMatrixAt(k, zero);
        k++;
        placed++;
      }
    });
    this.goods.castShadow = false;
    this.goods.frustumCulled = false;
    this.goods.receiveShadow = true;
    this.scene.add(this.goods);
  }

  private syncGoods(force = false) {
    const inv = this.sim.mock?.inventory;
    const cat = this.sim.catalog;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let changed = false;
    const update = (ci: number, qty: number) => {
      const s = cat[ci];
      const start = this.goodsStart[ci];
      const shown = Math.max(0, Math.min(s.shelfCap, qty));
      if (!force && this.goodsShown[ci] === shown) return;
      this.goodsShown[ci] = shown;
      for (let i = 0; i < s.shelfCap; i++) {
        const k = start + i;
        if (i < shown) {
          v.set(this.goodsPos[k * 3], this.goodsPos[k * 3 + 1], this.goodsPos[k * 3 + 2]);
          sc.set(s.location.along === 'z' ? s.unit.d : s.unit.w, s.unit.h, s.location.along === 'z' ? s.unit.w : s.unit.d);
          mtx.compose(v, q, sc);
        } else mtx.makeScale(0, 0, 0);
        this.goods.setMatrixAt(k, mtx);
      }
      changed = true;
    };
    if (!inv) {
      // 실서버 모드: 수량을 알 수 없어 칸 절반으로 그린다
      if (force) cat.forEach((s, ci) => update(ci, Math.ceil(s.shelfCap / 2)));
    } else if (force) {
      cat.forEach((s, ci) => update(ci, inv.get(s.sku)?.shelf ?? 0));
      inv.dirty.clear();
    } else if (inv.dirty.size) {
      const idx = this.skuIndex();
      for (const sku of inv.dirty) {
        const ci = idx.get(sku);
        if (ci !== undefined) update(ci, inv.get(sku)?.shelf ?? 0);
      }
      inv.dirty.clear();
    }
    if (changed) {
      this.goods.instanceMatrix.needsUpdate = true;
      if (force) {
        if (this.goods.instanceColor) this.goods.instanceColor.needsUpdate = true;
        this.goods.computeBoundingSphere(); // 클릭 판정용. 칸 위치는 고정이라 처음 한 번이면 된다
      }
    }
  }
  private _skuIndex: Map<string, number> | null = null;
  private skuIndex() {
    if (!this._skuIndex) this._skuIndex = new Map(this.sim.catalog.map((s, i) => [s.sku, i]));
    return this._skuIndex;
  }

  /** 보충재고 팔레트: 나무 받침 + 박스 더미(보충재고 수량만큼 쌓임). */
  private buildReserves(L: Layout) {
    const base = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.14, 1.1), new THREE.MeshStandardMaterial({ color: 0x8d6e4a, roughness: 0.9 }), L.reserves.length);
    const mtx = new THREE.Matrix4();
    L.reserves.forEach((r, i) => {
      mtx.makeTranslation((r.rect.x0 + r.rect.x1) / 2, 0.07, (r.rect.z0 + r.rect.z1) / 2);
      base.setMatrixAt(i, mtx);
      const t = label(r.id, { size: 26, bg: 'rgba(0,0,0,0.55)', screenPx: 12 });
      t.position.set((r.rect.x0 + r.rect.x1) / 2, 2.0, (r.rect.z0 + r.rect.z1) / 2);
      this.scene.add(t);
    });
    base.receiveShadow = true;
    this.scene.add(base);
    this.cartons = new THREE.InstancedMesh(new THREE.BoxGeometry(0.255, 0.22, 0.255), new THREE.MeshStandardMaterial({ roughness: 0.85 }), L.reserves.length * this.cartonsPerReserve);
    const col = new THREE.Color();
    L.reserves.forEach((r, i) => {
      for (let j = 0; j < this.cartonsPerReserve; j++) {
        this.cartons.setColorAt(i * this.cartonsPerReserve + j, col.setHex(r.temp === 'AMBIENT' ? 0xb98c5a : 0xe3e8ee).offsetHSL(0, 0, ((j * 7) % 5) / 60));
        this.cartons.setMatrixAt(i * this.cartonsPerReserve + j, new THREE.Matrix4().makeScale(0, 0, 0));
      }
    });
    this.cartons.castShadow = true;
    this.cartons.frustumCulled = false;
    this.scene.add(this.cartons);
  }

  private syncReserves() {
    const inv = this.sim.mock?.inventory;
    if (!inv) return;
    const totals = new Map<string, number>();
    for (const s of this.sim.catalog) {
      const r = inv.get(s.sku)?.reserve ?? 0;
      if (r > 0) totals.set(s.reserveId, (totals.get(s.reserveId) ?? 0) + r);
    }
    const mtx = new THREE.Matrix4();
    this.sim.layout.reserves.forEach((r, i) => {
      const units = totals.get(r.id) ?? 0;
      const n = Math.min(this.cartonsPerReserve, Math.ceil(units / 8)); // 박스 1개 ≈ 8유닛 [시뮬]
      const cx = (r.rect.x0 + r.rect.x1) / 2;
      const cz = (r.rect.z0 + r.rect.z1) / 2;
      for (let j = 0; j < this.cartonsPerReserve; j++) {
        if (j < n) {
          const layer = Math.floor(j / 16);
          const gx = j % 4;
          const gz = Math.floor((j % 16) / 4);
          mtx.makeTranslation(cx + (gx - 1.5) * 0.265, 0.14 + 0.11 + layer * 0.225, cz + (gz - 1.5) * 0.265);
        } else mtx.makeScale(0, 0, 0);
        this.cartons.setMatrixAt(i * this.cartonsPerReserve + j, mtx);
      }
    });
    this.cartons.instanceMatrix.needsUpdate = true;
    if (this.cartons.instanceColor) this.cartons.instanceColor.needsUpdate = true;
  }

  // ── 매 프레임 ──────────────────────────────────────
  private first = true;
  render(dt: number) {
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dt / 0.8);
      const k = 1 - Math.pow(1 - this.tween.t, 3);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, k);
      this.controls.target.lerpVectors(this.tween.tFrom, this.tween.tTo, k);
      if (this.tween.t >= 1) this.tween = null;
    }
    this.syncGoods(this.first);
    this.reserveTimer -= dt;
    if (this.first || this.reserveTimer <= 0) {
      this.reserveTimer = 0.4;
      this.syncReserves();
    }
    this.first = false;
    this.syncPeople();
    this.syncRiders();
    this.syncTrucks();
    this.syncDock();
    this.syncStations();
    this.syncStaged();
    this.syncPath();
    this.controls.update();
    // 정면 보기에서 사용자가 크게 물러나거나 다가가면 클리핑을 푼다
    const d = this.camera.position.distanceTo(this.controls.target);
    const near = this.nearCut > 0 && d > 2.0 && d < 4.5 ? this.nearCut : 0.05;
    if (this.camera.near !== near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.labels.update(dt, this.camera, this.controls.target);
    this.renderer.render(this.scene, this.camera);
  }

  private makePerson(id: string, vest: number, kind: 'worker' | 'inbound'): PersonMesh {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.85, 4, 12), bodyMat);
    body.position.y = 0.66;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf1d3b3 }));
    head.position.y = 1.42;
    const vestM = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: vest }));
    vestM.position.y = 0.95;
    for (const m of [body, head, vestM]) {
      m.castShadow = true;
      m.userData.personId = id;
      m.userData.personKind = kind;
    }
    const cart =
      kind === 'worker'
        ? new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.65), new THREE.MeshStandardMaterial({ color: 0x4a90d9, transparent: true, opacity: 0.85 }))
        : new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.95), new THREE.MeshStandardMaterial({ color: 0x546e7a, metalness: 0.3 }));
    cart.position.set(0, kind === 'worker' ? 0.45 : 0.12, kind === 'worker' ? 0.55 : 0.75);
    cart.castShadow = true;
    const bags: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const s = kind === 'worker' ? 0.16 : 0.26;
      const b = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.9, s), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      const per = kind === 'worker' ? 3 : 2;
      const gx = ((i % per) - (per - 1) / 2) * (s + 0.01);
      const gy = Math.floor(i / per) * (s * 0.9 + 0.01);
      b.position.set(gx, (kind === 'worker' ? 0.33 : 0.07 + s * 0.45) + gy, kind === 'worker' ? -0.05 : 0);
      b.visible = false;
      cart.add(b);
      bags.push(b);
    }
    const tag = label(id, { size: 30, bg: kind === 'worker' ? 'rgba(0,0,0,0.65)' : 'rgba(120,60,0,0.75)', screenPx: 15 });
    tag.position.y = 1.95;
    group.add(body, head, vestM, cart, tag);
    this.scene.add(group);
    return { group, bodyMat, cart, bags };
  }

  private syncPeople() {
    const alive = new Set<string>();
    let mi = 0;
    const mtx = new THREE.Matrix4();
    const all: { a: Worker | InboundWorker; kind: 'worker' | 'inbound' }[] = [
      ...this.sim.workers.map((a) => ({ a, kind: 'worker' as const })),
      ...this.sim.inboundWorkers.map((a) => ({ a, kind: 'inbound' as const })),
    ];
    for (const { a, kind } of all) {
      alive.add(a.id);
      let m = this.people.get(a.id);
      if (!m) {
        m = this.makePerson(a.id, kind === 'worker' ? VEST_PICKER : VEST_INBOUND, kind);
        this.people.set(a.id, m);
      }
      m.group.position.set(a.pos.x, 0, a.pos.z);
      m.group.rotation.y = a.heading;
      const color = kind === 'worker' ? STATE_COLOR[(a as Worker).state] : INBOUND_COLOR[(a as InboundWorker).state];
      m.bodyMat.color.setHex(color);
      const sel = this.selection && this.selection.kind !== 'location' && this.selection.id === a.id;
      m.bodyMat.emissive.setHex(sel ? 0x444444 : 0x000000);
      m.cart.visible = a.hasCart || a.carrying.length > 0;
      m.bags.forEach((b, i) => {
        const t = a.carrying[i];
        b.visible = t !== undefined;
        if (t) (b.material as THREE.MeshStandardMaterial).color.setHex(kind === 'inbound' ? (t === 'AMBIENT' ? 0xb98c5a : 0xe3e8ee) : TEMP_COLOR[t]);
      });
      if (kind === 'worker') {
        const w = a as Worker;
        if (w.currentTarget && w.state === 'PICKING' && mi < 64) {
          mtx.makeTranslation(w.currentTarget.pick.x, 0.03, w.currentTarget.pick.z);
          this.targetMarkers.setMatrixAt(mi, mtx);
          this.targetMarkers.setColorAt(mi, new THREE.Color(STATE_COLOR.PICKING));
          mi++;
        }
      }
    }
    this.targetMarkers.count = mi;
    this.targetMarkers.instanceMatrix.needsUpdate = true;
    if (this.targetMarkers.instanceColor) this.targetMarkers.instanceColor.needsUpdate = true;
    for (const [id, m] of this.people) {
      if (!alive.has(id)) {
        this.scene.remove(m.group);
        this.people.delete(id);
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

  /** 입고 차량(5톤 탑차 가정): 뒷문이 입고 차량문을 향한다. */
  private makeTruck(trfId: string): THREE.Group {
    const g = new THREE.Group();
    const box = this.box(5.0, 2.5, 2.3, 0xe8eaed);
    box.position.set(-0.7, 1.55, 0);
    const stripe = this.box(5.02, 0.35, 2.32, 0x1e88e5);
    stripe.position.set(-0.7, 1.0, 0);
    const cab = this.box(1.7, 2.0, 2.2, 0x37474f);
    cab.position.set(2.75, 1.3, 0);
    const glass = this.box(0.05, 0.7, 1.9, 0x90caf9, { metalness: 0.6, roughness: 0.1 });
    glass.position.set(3.61, 1.75, 0);
    g.add(box, stripe, cab, glass);
    for (const x of [-2.4, -1.2, 2.6]) {
      for (const z of [-1.0, 1.0]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 18), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        w.rotation.x = Math.PI / 2;
        w.position.set(x, 0.42, z);
        g.add(w);
      }
    }
    const t = label(trfId, { size: 30, bg: 'rgba(30,60,120,0.85)', screenPx: 15 });
    t.position.set(-0.7, 3.4, 0);
    g.add(t);
    this.scene.add(g);
    return g;
  }

  private syncTrucks() {
    const alive = new Set<string>();
    for (const t of this.sim.trucks) {
      alive.add(t.trfId);
      let g = this.truckMeshes.get(t.trfId);
      if (!g) {
        g = this.makeTruck(t.trfId);
        this.truckMeshes.set(t.trfId, g);
      }
      // 뒷문(로컬 x=-3.2)이 truck.x - 3.2 에 오도록
      g.position.set(t.x, 0, this.sim.layout.points.truckDock.z);
    }
    for (const [id, g] of this.truckMeshes) {
      if (!alive.has(id)) {
        this.scene.remove(g);
        this.truckMeshes.delete(id);
      }
    }
  }

  private syncDock() {
    const items = this.sim.dockItems;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    for (const it of items) {
      if (it.state === 'TAKEN' || n >= 96) continue;
      const p = it.slot?.pos ?? it.floorPos;
      mtx.makeTranslation(p.x, 0.53, p.z);
      this.dockMesh.setMatrixAt(n, mtx);
      col.setHex(it.temp === 'AMBIENT' ? 0xb98c5a : TEMP_COLOR[it.temp]);
      if (it.state === 'ON_DOCK') col.offsetHSL(0, -0.3, 0.1); // 검수 전은 옅게
      this.dockMesh.setColorAt(n, col);
      n++;
    }
    this.dockMesh.count = n;
    this.dockMesh.instanceMatrix.needsUpdate = true;
    if (this.dockMesh.instanceColor) this.dockMesh.instanceColor.needsUpdate = true;
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
    const s = this.selection;
    const p = s && s.kind !== 'location' ? [...this.sim.workers, ...this.sim.inboundWorkers].find((x) => x.id === s.id) : undefined;
    if (!p || p.path.length === 0) {
      this.pathLine.visible = false;
      return;
    }
    const pts = [new THREE.Vector3(p.pos.x, 0.08, p.pos.z), ...p.path.map((q) => new THREE.Vector3(q.x, 0.08, q.z))];
    this.pathLine.geometry.dispose();
    this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.pathLine.computeLineDistances();
    this.pathLine.visible = true;
  }

  private pick(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // 1) 사람
    const targets: THREE.Object3D[] = [];
    for (const m of this.people.values()) targets.push(...m.group.children.filter((c) => c.userData.personId));
    const hp = this.raycaster.intersectObjects(targets, false)[0];
    if (hp) {
      const kind = hp.object.userData.personKind as 'worker' | 'inbound';
      this.select({ kind, id: hp.object.userData.personId as string });
      return;
    }
    // 2) 선반 상품
    const hg = this.raycaster.intersectObject(this.goods, false)[0];
    if (hg?.instanceId !== undefined) {
      const ci = this.goodsSku[hg.instanceId];
      this.select({ kind: 'location', sku: this.sim.catalog[ci].sku });
      return;
    }
    // 3) 구역 바닥 → 그 구역으로 확대
    const hz = this.raycaster.intersectObjects(this.zoneFloors, false)[0];
    const zid = hz?.object.userData.zoneId as string | undefined;
    const v = this.views.find((x) => x.zoneId === zid);
    if (v && v.key !== this.focusedZone) this.focusZone(v.key);
  }
}
