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
/** 팔레트를 누를 때 카메라 거리(m) — 지금 거리가 max 보다 멀면 max 로, min 보다 가까우면 min 으로, 내려다보는 각은 minElevDeg 이상 [시뮬] */
const RESERVE_VIEW_DIST = { min: 6, max: 9, minElevDeg: 55 };

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
export type RightView = 'orders' | 'api' | 'events' | 'logs' | 'inventory' | 'scan' | 'admin';
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

  /**
   * 확대하기 전 시야 — 구역·점원·칸·자리로 들어가기 직전 카메라. MFC 바깥(구역 아닌 곳)을 누르면 여기로 돌아가고 고른 것을 모두 푼다
   * (사용자 2026-11-20 "구역 아닌 쪽 클릭하면 … 클릭하기 전 시야로", "점원 … 다른 곳 클릭하면 … 전 시야로").
   */
  private homeView: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  /** 카메라 담당(CameraRig)이 지금 시야를 알려 준다 */
  cameraNow: (() => { pos: THREE.Vector3; target: THREE.Vector3 }) | null = null;
  private rememberHome() {
    if (!this.homeView && this.cameraNow) this.homeView = this.cameraNow();
  }

  /** 바깥을 누름 — 고른 것 모두 풀고, 확대하기 전 시야로(없으면 전체) */
  backOut() {
    this.selection = null;
    this.follow = null;
    this.workerFilter = null;
    this.placeFilter = null;
    this.cellFocus = null;
    this.scanShipment = null;
    this.nearCut = 0;
    const home = this.homeView;
    this.homeView = null;
    if (home) {
      this.focusedZone = 'ALL';
      this.cameraRequest = { pos: home.pos, target: home.target, animate: true };
      this.emit();
    } else this.focusZone('ALL');
  }

  focusCell(code: string | null) {
    if (code) {
      this.rememberHome();
      // 칸을 누르면 점원 고름·따라가기는 푼다(다른 것을 고른 것)
      if (this.selection?.kind === 'worker') this.selection = null;
      this.follow = null;
      this.workerFilter = null;
    }
    this.cellFocus = code;
    if (code) {
      const loc = this.sim.backendLocation(code);
      // 보충재고 팔레트: 냉동·냉장은 그 저온 구역, 상온은 입고창고(사용자 2026-11-21 "냉장냉동 입고창고는 눌러도 수량이 안 나와")
      const rs = loc ? null : this.sim.backendReserve(code);
      const temp = loc?.temp ?? rs?.temp;
      const key = !temp ? null : temp === 'FROZEN' ? 'A' : temp === 'CHILLED' ? 'B' : rs || loc?.reserve ? 'WH' : 'C-H';
      if (key) this.focusedZone = key;
      this.leftView = 'zone';
    }
    this.emit();
  }
  /** 오른쪽 실제 주문을 이 자리(패킹대 PAK-·출하대기 랙 DSP-)의 주문만으로 — 3D 에서 그 자리를 누름(사용자 2026-11-20 "오른쪽 탭에 해당 주문이 뜨게") */
  placeFilter: string | null = null;

  /** 오른쪽 실제 주문을 이 점원의 주문만으로 — 3D 에서 점원을 누름(사용자 2026-11-20 "옆에 오른쪽 탭에 해당 주문내역이 뜨게") */
  workerFilter: { id: string; shipmentId: string | null } | null = null;

  /** 오른쪽 실제 주문 검색어(주문번호·점원·라이더) — 탭을 바꿔도 남고, 검색칸 ✕ 로만 지운다(사용자 2026-11-20) */
  orderSearch = '';
  setOrderSearch(q: string) {
    this.orderSearch = q;
    this.emit();
  }
  /** 관리 탭 안 칸(지난 주문·진행 중 작업·인계 확인)을 밖에서 정할 때 — 화면이 한 번 읽고 지운다 */
  adminSub: 'history' | 'live' | 'checks' | 'returns' | null = null;
  /** 관리 탭 지난 주문 검색어를 밖에서 넣을 때(실제 주문 검색에서 "지난 주문에서 찾기") */
  adminQuery: string | null = null;
  setAdminSub(s: 'history' | 'live' | 'checks' | 'returns' | null) {
    this.adminSub = s;
    this.emit();
  }
  setAdminQuery(q: string | null) {
    this.adminQuery = q;
    this.emit();
  }
  /** 실제 주문에 없는(끝난) 주문 → 관리 탭 지난 주문에서 그 번호로 */
  openAdminHistory(q: string) {
    this.adminSub = 'history';
    this.adminQuery = q;
    this.rightView = 'admin';
    this.emit();
  }
  /** 현장 흐름판에서 주문을 누름 — 실제 주문 탭을 그 주문 검색으로(자리·점원 거르기는 풂) */
  openOrder(orderNo: string) {
    this.orderSearch = orderNo;
    this.placeFilter = null;
    this.workerFilter = null;
    this.rightView = 'orders';
    this.emit();
  }

  showPlace(code: string | null) {
    this.placeFilter = code;
    if (code) {
      // 자리를 누르면 점원 고름·따라가기·칸 고름은 푼다
      this.workerFilter = null;
      if (this.selection?.kind === 'worker') this.selection = null;
      this.follow = null;
      this.cellFocus = null;
    }
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
    this.rightView = 'orders';
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
    if (key === 'ALL') this.homeView = null;
    else this.rememberHome();
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
    const dist = this.zoneDist(key);
    const target = new THREE.Vector3(cx, 0, key === 'ALL' ? cz + 1 : cz - dist * 0.12);
    const pos = key === 'ALL' ? new THREE.Vector3(cx, dist * 0.78, cz + dist * 0.72) : new THREE.Vector3(cx, dist * 0.92, cz + dist * 0.42);
    this.cameraRequest = { pos, target, animate };
    this.emit();
  }

  /** 구역 위에서 보기의 카메라 거리 */
  zoneDist(key: string): number {
    if (key === 'ALL') return 62;
    const r = this.views.find((x) => x.key === key)?.rect;
    if (!r) return 62;
    // 위 머리줄·확인할 일·칩 줄(약 150px)과 좌우 패널이 가리므로 앞뒤로 긴 구역(냉동 A 등)은 더 물러선다
    const size = Math.max((r.x1 - r.x0) * 1.1, (r.z1 - r.z0) * 1.45);
    // 구역은 위에서 비스듬히(약 63°) — 랙 번호판이 읽힐 만큼(사용자 2026-11-20 "랙 식별 번호만 보일 만큼 위에서 비스듬하게").
    // 사용자 2026-11-20 "각도는 좋은데 조금 멀리서" — 같은 각도로 약 20% 가깝게(0.85·+3 → 0.7·+2.5)
    return size * 0.7 + 2.5;
  }

  /**
   * 3D 에서 선반 칸을 누름 — 카메라가 멀면(구역 위에서 보기보다 멀리) 그 구역 위에서 보기, 가까우면 그 칸 정면으로(+ 칸 카드).
   * (사용자 2026-11-20 "멀리서 구역 클릭하면 위에서 … 가까이서 클릭하면 랙 가까이서", 통로 위 비스듬한 시야에 "선반 칸을 보고 싶어서 클릭하는데 왜 자꾸 측면 천장에서" → 칸 정면)
   */
  clickCell(code: string, camDist: number) {
    const loc = this.sim.backendLocation(code);
    if (loc) {
      const v = this.views.find((x) => x.key !== 'ALL' && x.zoneId && loc.shelf.x >= x.rect.x0 && loc.shelf.x <= x.rect.x1 && loc.shelf.z >= x.rect.z0 && loc.shelf.z <= x.rect.z1);
      if (v && camDist > this.zoneDist(v.key) * 1.25) {
        this.focusZone(v.key);
        return;
      }
      this.rememberHome();
      this.focusLocation(loc);
    } else {
      // 보충재고 팔레트: 그 팔레트 앞(꺼내는 통로 쪽) 비스듬히 위로 다가가고 칸 카드(수량)를 띄운다
      // (사용자 2026-11-21 "입고 박스 클릭해도 좀 가까이 다가가지게 해줘")
      const rs = this.sim.backendReserve(code);
      if (rs) {
        this.rememberHome();
        this.follow = null;
        // 보던 방향은 그대로 두고(돌리지 않음) 팔레트를 가운데로, 거리만 줄인다 — 너무 붙지 않게 RESERVE_VIEW_DIST(사용자 2026-11-21 "너무 가까이 가지고 쳐다보던 방향도 돌려버리네")
        const c = new THREE.Vector3((rs.rect.x0 + rs.rect.x1) / 2, 0.6, (rs.rect.z0 + rs.rect.z1) / 2);
        const now = this.cameraNow?.();
        const off = now ? now.pos.clone().sub(now.target) : new THREE.Vector3(0, 6, 5);
        const d = off.length();
        const want = Math.min(d, RESERVE_VIEW_DIST.max);
        if (d < 1e-3) off.set(0, 6, 5);
        // 좀 더 위에서 내려다보게 — 수평 방향(보던 쪽)은 그대로, 올려본 각만 RESERVE_VIEW_DIST.minElevDeg 이상(사용자 2026-11-21 "조금 더 위쪽에서 바라봐지게")
        off.normalize();
        const flat = Math.hypot(off.x, off.z);
        const elev = Math.max((RESERVE_VIEW_DIST.minElevDeg * Math.PI) / 180, Math.atan2(off.y, flat));
        const hx = flat > 1e-4 ? off.x / flat : 0;
        const hz = flat > 1e-4 ? off.z / flat : 1;
        off.set(hx * Math.cos(elev), Math.sin(elev), hz * Math.cos(elev));
        const pos = c.clone().add(off.multiplyScalar(Math.max(RESERVE_VIEW_DIST.min, want)));
        this.cameraRequest = { pos, target: c, animate: true };
      }
    }
    this.focusCell(code);
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
    // 카메라에서 맞은편 랙 앞면까지 약 1.79 m — 1.75 는 그 앞 기둥·선반 끝이 4 cm 남아 화면을 가렸다
    this.nearCut = 1.85;
  }

  /** 바코드에서 고른 자리 — 3D 에 잠깐 표시(노란 기둥·고리). until = performance.now() 기준 ms */
  marker: { x: number; y: number; z: number; until: number } | null = null;

  /** 백엔드 위치 코드로: 선반 칸이면 정면, 카트·포장대·출하대기 같은 바닥 자리면 위에서. 모르는 코드면 false */
  focusBackendCode(code: string): boolean {
    this.rememberHome();
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
    // 선반 밖 자리(패킹대·인계 랙·입고칸 등): 그 구역 보기로(구역 버튼과 같은 거리) + 노란 표시 — 11 m 위에서 붙으면 너무 가까웠다
    // (사용자 2026-11-21 "재고탭에서 패킹이랑 출하대기 클릭하니까 그 구역에 너무 가까이 간다")
    const v = this.views.find((x) => x.key !== 'ALL' && p.x >= x.rect.x0 && p.x <= x.rect.x1 && p.z >= x.rect.z0 && p.z <= x.rect.z1);
    if (v) this.focusZone(v.key);
    else {
      const t = new THREE.Vector3(p.x, 0.5, p.z);
      this.cameraRequest = { pos: t.clone().add(new THREE.Vector3(0, 14, 14)), target: t, animate: true };
    }
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
    if (s && fly) this.rememberHome();
    this.selection = s;
    // 실서버: 점원을 누르면 오른쪽에 그 점원 주문만(실제 주문·바코드 탭이 그 주문). 다른 걸 고르면 풂
    if (s?.kind === 'worker' && this.sim.board) {
      const w = this.sim.siteWorkers().find((x) => x.id === s.id);
      const sid = w?.pda?.shipmentId ?? null;
      this.workerFilter = { id: s.id, shipmentId: sid };
      this.placeFilter = null;
      if (sid) this.scanShipment = sid;
      if (this.rightView !== 'scan') this.rightView = 'orders';
    } else if (this.workerFilter) {
      this.workerFilter = null;
    }
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
