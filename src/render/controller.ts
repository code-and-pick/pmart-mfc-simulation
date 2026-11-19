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

/** 오른쪽 패널 화면(왼쪽 아이콘 메뉴로 고름) */
export type RightView = 'orders' | 'api' | 'events' | 'logs' | 'inventory' | 'scan';
/** 왼쪽 패널 화면 */
/** 왼쪽 패널 — 설정 · 구역(구역 정보·재고, 2026-11-20 떠 있는 카드에서 옮김) · 도움말 */
export type LeftView = 'settings' | 'zone' | 'help';
export type Theme = 'dark' | 'light';

/** 이 브라우저에 기억하는 화면 편의 설정(테마) — 못 읽으면 기본(어둡게). 토큰·업무 값은 두지 않는다 */
const THEME_KEY = 'pmart-sim-theme';
function loadTheme(): Theme {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export class ViewController extends Emitter {
  readonly views: ZoneView[];
  selection: Selection = null;
  /** 카메라가 따라가는 사람(작업자·입고 작업자 id). 사람을 고르면 켜지고, 다른 곳으로 옮기거나 끄면 풀린다 */
  follow: string | null = null;
  /** 실제 주문 탭에서 고른 출고(바코드 탭·스캔 말풍선이 같이 쓴다). 없으면 null */
  scanShipment: string | null = null;
  /** 3D 에서 누른 선반 칸(실서버, 백엔드 위치 코드) — 왼쪽 "구역" 화면에 그 칸 상품 정보(사용자 2026-11-20 "랙에 적치된 재고도 클릭하면 … 무슨 상품인지") */
  cellFocus: string | null = null;

  focusCell(code: string | null) {
    this.cellFocus = code;
    if (code) {
      const loc = this.sim.backendLocation(code);
      const key = loc ? (loc.temp === 'FROZEN' ? 'A' : loc.temp === 'CHILLED' ? 'B' : 'C-H') : null;
      if (key) this.focusedZone = key;
      this.leftView = 'zone';
    }
    this.emit();
  }
  /** 오른쪽 실제 주문을 이 자리(패킹대 PAK-·출하대기 랙 DSP-)의 주문만으로 — 3D 에서 그 자리를 누름(사용자 2026-11-20 "오른쪽 탭에 해당 주문이 뜨게") */
  placeFilter: string | null = null;

  showPlace(code: string | null) {
    this.placeFilter = code;
    if (code) {
      this.rightView = 'orders';
      const at = this.sim.shipmentsAt(code);
      this.scanShipment = at.length === 1 ? at[0].shipmentId : this.scanShipment;
    }
    this.emit();
  }
  focusedZone = 'ALL';
  /** 사용자가 벽 투명도를 고르지 않았으면(null) 구역 확대 때 벽을 옅게 한다 */
  wallUser: number | null = null;
  labelMode: LabelMode = 'all';
  /** 로케이션 정면 보기 중 근접 클리핑 거리 (맞은편 랙 숨김) */
  nearCut = 0;
  /** 오른쪽 패널(null = 접음) — 실서버는 실제 주문, MOCK 은 API 호출부터 */
  rightView: RightView | null;
  /** 왼쪽 패널(null = 접음) */
  leftView: LeftView | null = 'settings';
  /** 화면 테마(pmart-rider-simulation 과 같은 토큰, 기본 어둡게) */
  theme: Theme = loadTheme();
  private cameraRequest: CameraRequest | null = null;

  constructor(private readonly sim: Simulation) {
    super();
    this.rightView = sim.real ? 'orders' : 'api';
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
    this.follow = null;
    this.nearCut = 0;
    this.focusedZone = key;
    // 구역을 고르면 왼쪽 "구역" 화면에 그 구역 정보를 고정해 보인다(사용자 2026-11-20 "팝업창으로 띄울 게 아니라 왼쪽탭에")
    if (key !== 'ALL' && this.leftView !== null) this.leftView = 'zone';
    const r = v.rect;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    // 위 머리줄·확인할 일·칩 줄(약 150px)과 좌우 패널이 가리므로 앞뒤로 긴 구역(냉동 A 등)은 더 물러선다
    const size = Math.max((r.x1 - r.x0) * 1.1, (r.z1 - r.z0) * 1.45);
    // 구역은 위에서 비스듬히(약 60°) 가깝게 — 랙 번호판이 읽힐 만큼(사용자 2026-11-20 "랙 식별 번호만 보일 만큼 위에서 비스듬하게"). 전체는 그대로
    // 구역 전체가 들어오는 거리는 그대로, 각도만 더 위에서(약 63°) — 위 머리줄·칩 줄에 가리지 않게 목표를 조금 앞으로
    const dist = key === 'ALL' ? 62 : size * 0.85 + 3;
    const target = new THREE.Vector3(cx, 0, key === 'ALL' ? cz + 1 : cz - dist * 0.12);
    const pos = key === 'ALL' ? new THREE.Vector3(cx, dist * 0.78, cz + dist * 0.72) : new THREE.Vector3(cx, dist * 0.92, cz + dist * 0.42);
    this.cameraRequest = { pos, target, animate };
    this.emit();
  }

  /** 로케이션(랙 칸) 정면으로 붙는다. */
  focusLocation(loc: Location) {
    this.follow = null;
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
    this.follow = null;
    const t = new THREE.Vector3(p.x, 0.5, p.z);
    this.cameraRequest = { pos: t.clone().add(new THREE.Vector3(0, 8, 8)), target: t, animate: true };
    this.marker = { x: p.x, y: 0, z: p.z, until: performance.now() + 8000 };
    this.emit();
    return true;
  }

  /** 사람의 지금 자리(없으면 null) — 카메라 따라가기가 프레임마다 읽는다 */
  personPos(id: string): { x: number; z: number } | null {
    return [...this.sim.siteWorkers(), ...this.sim.inboundWorkers].find((x) => x.id === id)?.pos ?? null;
  }

  /** 고른 사람 따라가기 켜기·끄기 */
  setFollow(on: boolean) {
    const id = this.selection && (this.selection.kind === 'worker' || this.selection.kind === 'inbound') ? this.selection.id : null;
    const next = on ? id : null;
    if (next === this.follow) return;
    this.follow = next;
    if (next) this.focusPerson(next);
    this.emit();
  }

  focusPerson(id: string) {
    this.nearCut = 0;
    const p = this.personPos(id);
    if (!p) return;
    const tTo = new THREE.Vector3(p.x, 0.5, p.z);
    this.cameraRequest = { pos: tTo.clone().add(new THREE.Vector3(0, 7, 7)), target: tTo, animate: true };
  }

  select(s: Selection, fly = true) {
    this.selection = s;
    this.follow = s && (s.kind === 'worker' || s.kind === 'inbound') ? s.id : null;
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
      // 출하대기 랙까지 끝난 출고는 작업자 대신 그 포장이 있는 랙으로(사용자 2026-11-19 "출하대기 끝나면 작업자 따라다니지 말고 출하대기랙으로")
      if (this.sim.onRack(id)) {
        this.focusBackendCode(this.sim.rackFor(id));
      } else {
        const w = this.sim.observedWorkers.find((x) => x.cue && x.pda?.shipmentId === id);
        if (w) this.focusPerson(w.id);
      }
    }
    this.emit();
  }

  /** 스캔 말풍선 선택 취소 — 고른 출고와 고른 작업자를 함께 푼다(말풍선·바코드 탭 주문 고름이 사라짐) */
  clearScanSelection() {
    this.scanShipment = null;
    if (this.selection?.kind === 'worker') {
      this.selection = null;
      this.follow = null;
    }
    this.emit();
  }

  /** 아이콘 메뉴: 오른쪽 화면 고르기 — 이미 열린 것을 다시 누르면 접는다 */
  toggleRight(v: RightView) {
    this.rightView = this.rightView === v ? null : v;
    this.emit();
  }

  toggleLeft(v: LeftView) {
    this.leftView = this.leftView === v ? null : v;
    this.emit();
  }

  setTheme(t: Theme) {
    this.theme = t;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, t);
    } catch {
      /* 저장 못 해도 이번 화면에선 바뀐다 */
    }
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
  /** 실서버 선반 상자(RealStock) — 상자 번호 → 칸 위치 코드(선반 밖 자리 상자는 null) */
  realCells: { mesh: THREE.InstancedMesh; codeAt: (instance: number) => string | null } | null = null;
  controls: OrbitControls | null = null;
}
