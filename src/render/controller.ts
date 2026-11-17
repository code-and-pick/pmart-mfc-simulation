// 화면 상태(선택·확대 구역·벽·번호 표시)와 카메라 요청. React UI 와 3D 장면(react-three-fiber)이 함께 본다.
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Layout, Location, Rect } from '../domain/layout';
import type { Simulation } from '../sim/simulation';

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

/** useSyncExternalStore 로 구독할 수 있는 작은 변경 알림. */
export class Emitter {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  readonly getVersion = () => this.version;
  protected emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** 시뮬레이션 화면 갱신 박자(약 4Hz). 3D 는 매 프레임, 패널은 이 박자로 다시 그린다. */
export class Ticker extends Emitter {
  bump() {
    this.emit();
  }
}

export interface CameraRequest {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  animate: boolean;
}

export type LabelMode = 'all' | 'rack' | 'off';

export class ViewController extends Emitter {
  readonly views: ZoneView[];
  selection: Selection = null;
  /** 실제 주문 탭에서 고른 출고(바코드 탭·스캔 말풍선이 같이 쓴다). 없으면 null */
  scanShipment: string | null = null;
  focusedZone = 'ALL';
  /** 사용자가 벽 투명도를 고르지 않았으면(null) 구역 확대 때 벽을 옅게 한다 */
  wallUser: number | null = null;
  labelMode: LabelMode = 'all';
  /** 로케이션 정면 보기 중 근접 클리핑 거리 (맞은편 랙 숨김) */
  nearCut = 0;
  private cameraRequest: CameraRequest | null = null;

  constructor(private readonly sim: Simulation) {
    super();
    this.views = zoneViews(sim.layout);
    this.focusZone('ALL', false);
  }

  get wallOpacity(): number {
    return this.wallUser ?? (this.focusedZone === 'ALL' ? 0.32 : 0.07);
  }
  get rackLabels() {
    return this.labelMode !== 'off';
  }
  get slotLabels() {
    return this.labelMode === 'all';
  }

  /** 카메라 담당(CameraRig)이 프레임마다 꺼내 간다. */
  takeCameraRequest(): CameraRequest | null {
    const r = this.cameraRequest;
    this.cameraRequest = null;
    return r;
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
    this.cameraRequest = { pos, target, animate };
    this.emit();
  }

  /** 로케이션(랙 칸) 정면으로 붙는다. */
  focusLocation(loc: Location) {
    const n = loc.along === 'z' ? new THREE.Vector3(loc.face, 0, 0) : new THREE.Vector3(0, 0, loc.face);
    // 위 단 선반판이 가리지 않도록 그 단 높이에서 정면으로 본다
    const target = new THREE.Vector3(loc.shelf.x, loc.shelf.y - 0.035 + loc.levelH / 2, loc.shelf.z);
    // 통로 폭이 0.7m 라 정면에서 물러서면 맞은편 랙이 가린다.
    // 카메라를 맞은편 랙 뒤 정면에 두고, 그 사이(맞은편 랙)는 근접 클리핑으로 잘라 낸다.
    const pos = target.clone().add(n.multiplyScalar(2.6)).add(new THREE.Vector3(0, 0.12, 0));
    this.cameraRequest = { pos, target, animate: true };
    this.nearCut = 1.75;
  }

  /** 바코드에서 고른 자리 — 3D 에 잠깐 표시(노란 기둥·고리). until = performance.now() 기준 ms */
  marker: { x: number; y: number; z: number; until: number } | null = null;

  /** 백엔드 위치 코드로: 선반 칸이면 정면, 카트·포장대·출하대기 같은 바닥 자리면 위에서. 모르는 코드면 false */
  focusBackendCode(code: string): boolean {
    const loc = this.sim.backendLocation(code);
    if (loc) {
      this.focusLocation(loc);
      this.marker = { x: loc.pick.x, y: loc.shelf.y, z: loc.pick.z, until: performance.now() + 8000 };
      this.emit();
      return true;
    }
    const p = this.sim.backendPoint(code);
    if (!p) return false;
    this.nearCut = 0;
    const t = new THREE.Vector3(p.x, 0.5, p.z);
    this.cameraRequest = { pos: t.clone().add(new THREE.Vector3(0, 8, 8)), target: t, animate: true };
    this.marker = { x: p.x, y: 0, z: p.z, until: performance.now() + 8000 };
    this.emit();
    return true;
  }

  focusPerson(id: string) {
    this.nearCut = 0;
    const p = [...this.sim.siteWorkers(), ...this.sim.inboundWorkers].find((x) => x.id === id);
    if (!p) return;
    const tTo = new THREE.Vector3(p.pos.x, 0.5, p.pos.z);
    this.cameraRequest = { pos: tTo.clone().add(new THREE.Vector3(0, 7, 7)), target: tTo, animate: true };
  }

  select(s: Selection, fly = true) {
    this.selection = s;
    if (s?.kind === 'location') {
      const sku = this.sim.skuMap.get(s.sku);
      if (sku && fly) this.focusLocation(sku.location);
    } else if (s && fly) this.focusPerson(s.id);
    this.emit();
  }

  /** 실제 주문 줄을 고른다 — 그 출고의 PDA 작업자가 3D 에 있으면 카메라를 그리로(스캔 말풍선이 뜬다) */
  setScanShipment(id: string | null) {
    this.scanShipment = id;
    if (id) {
      const w = this.sim.observedWorkers.find((x) => x.pda?.shipmentId === id);
      if (w) this.focusPerson(w.id);
    }
    this.emit();
  }

  /** 스캔 말풍선 선택 취소 — 고른 출고와 고른 작업자를 함께 푼다(말풍선·바코드 탭 주문 고름이 사라짐) */
  clearScanSelection() {
    this.scanShipment = null;
    if (this.selection?.kind === 'worker') this.selection = null;
    this.emit();
  }

  setWallOpacity(o: number) {
    this.wallUser = o;
    this.emit();
  }

  setLabelMode(m: LabelMode) {
    this.labelMode = m;
    this.emit();
  }
}

/** 클릭 판정용으로 장면 쪽 컴포넌트가 등록하는 객체들. */
export class SceneRegistry {
  readonly people = new Map<string, THREE.Group>();
  readonly zoneFloors = new Map<string, THREE.Mesh>();
  goods: { mesh: THREE.InstancedMesh; skuAt: (instance: number) => string } | null = null;
  controls: OrbitControls | null = null;
}
