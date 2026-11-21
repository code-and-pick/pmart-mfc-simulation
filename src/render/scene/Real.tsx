// 실서버 관찰 표시: 진행 중 PICK·RETURN 의 남은 지시 칸(바닥 고리)과 그 작업 담당자(PDA 작업자) 표시, 주문 SKU 의 실제 재고.
// 작업자 위치는 서버가 주지 않는다 — "다음에 갈 지시 칸"에 세워 보여 줄 뿐 실제 위치가 아니다(SIM-2a 는 마지막 버튼 기준, 다음 단계).
import { RETURN_TABLE } from './Decor';
import { RESERVE_CODE, placeShortName, reserveName, WORK_SHORT } from '../../domain/placeName';

/** 팔레트 번호 이름표 — 예전 흰 이름표 그대로(사용자 2026-11-21 "저번처럼 그냥 하양으로 … 크기도 전처럼") */
const PALLET_LABEL = { size: 40, bg: 'rgba(255,255,255,0.96)', color: '#24304f', screenPx: 18 };
import { orderText } from '../../ui/OrderNo';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { BAG_COLOR, bagGeometry, boxTexture } from '../sprites';
import { SCENE, zoneBoxColor } from '../colors';
import { useApp } from '../../app/context';
import type { StockWorkState, TaskState, TemperatureZone } from '../../domain/contract';
import { RACK_DEPTH, type Location } from '../../domain/layout';
import { makeLabel } from '../sprites';
import { dispatchText, dispatchView } from '../../sim/realBoard';

const RING_COLOR: Partial<Record<TaskState, number>> = { IN_PROGRESS: 0x34a853, ASSIGNED: 0x4285f4, BLOCKED: 0xea4335 };
const MAX = 128;

export function RealMarkers() {
  const { sim } = useApp();
  const rings = useRef<THREE.InstancedMesh>(null!);
  const pins = useRef<THREE.InstancedMesh>(null!);
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.24, 0.36, 28).rotateX(-Math.PI / 2), []);
  const labels = useMemo(() => new THREE.Group(), []);
  const labelKey = useRef('');
  useFrame(() => {
    const real = sim.real;
    if (!real) return;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    const targets = real.pickTargets();
    // 작업자는 사람으로 그린다(가상 작업자 RealWorker, 실제 PDA 작업자 ObservedWorker) — 기둥은 사람을 세우지 못한 작업자만
    const drawn = new Set([...sim.virtualWorkerIds(), ...sim.observedWorkers.map((w) => w.workerId)]);
    let n = 0;
    // 작업마다 첫 지시 칸 = 담당자를 세울 자리
    const firstByTask = new Map<string, { x: number; z: number; name: string; state: TaskState }>();
    for (const t of targets) {
      const loc = sim.backendLocation(t.locationCode);
      if (!loc) continue;
      if (n < MAX) {
        mtx.makeTranslation(loc.pick.x, 0.03, loc.pick.z);
        rings.current.setMatrixAt(n, mtx);
        rings.current.setColorAt(n, col.setHex(RING_COLOR[t.state] ?? 0xbdc1c6));
        n++;
      }
      if (!firstByTask.has(t.taskId) && !(t.workerId && drawn.has(t.workerId))) firstByTask.set(t.taskId, { x: loc.pick.x, z: loc.pick.z, name: real.workerName(t.workerId), state: t.state });
    }
    rings.current.count = n;
    rings.current.instanceMatrix.needsUpdate = true;
    if (rings.current.instanceColor) rings.current.instanceColor.needsUpdate = true;

    let m = 0;
    for (const p of firstByTask.values()) {
      if (m >= MAX) break;
      mtx.makeTranslation(p.x, 0.85, p.z);
      pins.current.setMatrixAt(m, mtx);
      pins.current.setColorAt(m, col.setHex(RING_COLOR[p.state] ?? 0xbdc1c6));
      m++;
    }
    pins.current.count = m;
    pins.current.instanceMatrix.needsUpdate = true;
    if (pins.current.instanceColor) pins.current.instanceColor.needsUpdate = true;

    // 이름표는 바뀔 때만 다시 만든다
    const key = [...firstByTask.values()].map((p) => `${p.name}@${p.x.toFixed(1)},${p.z.toFixed(1)}`).join('|');
    if (key !== labelKey.current) {
      labelKey.current = key;
      for (const c of [...labels.children]) {
        const s = c as THREE.Sprite;
        s.material.map?.dispose();
        s.material.dispose();
        labels.remove(s);
      }
      for (const p of firstByTask.values()) {
        const s = makeLabel(`PDA ${p.name}`, { size: 40, bg: 'rgba(20,22,26,0.85)', screenPx: 20, prio: 3 });
        s.position.set(p.x, 2.05, p.z);
        labels.add(s);
      }
    }
  });
  return (
    <>
      <instancedMesh ref={rings} args={[ringGeo, undefined, MAX]} count={0} frustumCulled={false}>
        <meshBasicMaterial color={0xffffff} transparent opacity={0.95} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={pins} args={[undefined, undefined, MAX]} count={0} frustumCulled={false}>
        <cylinderGeometry args={[0.22, 0.22, 1.7, 16]} />
        <meshStandardMaterial transparent opacity={0.55} roughness={0.5} />
      </instancedMesh>
      <primitive object={labels} />
    </>
  );
}

/** 출하대기 랙(DSP-A-01) 위 이름표에 보이는 단계 — 포장 뒤 인계 전 출고 */
const SHIP_LABEL_STAGES = new Set(['NOT_REQUESTED', 'REQUESTED', 'WAITING_DISPATCH', 'DISPATCHING', 'DISPATCH_FAILED', 'ASSIGNED', 'AT_STORE']);
const MAX_SHIP_LABELS = 6;

/**
 * 출하대기 랙 이름표: 인계 전 출고마다 "출고 · 배차 단계"(rider 시뮬레이터 요청 M-01). 포장은 위치를 주지 않아 랙 1(DSP-A-01) 위에 쌓아 보인다.
 * 서버가 준 출고·배차·배송 상태만 쓴다.
 */
export function RealShipLabels() {
  const { sim } = useApp();
  const labels = useMemo(() => new THREE.Group(), []);
  const ver = useRef('');
  useFrame(() => {
    const real = sim.real;
    if (!real) return;
    const rows = real
      .shipments()
      .filter((r) => r.info && ['READY', 'PARTIALLY_HANDED_OVER', 'PREPARING'].includes(r.info.state) && SHIP_LABEL_STAGES.has(dispatchView(r).stage))
      .filter((r) => r.info!.state !== 'PREPARING' || !!r.info!.dispatchRequest)
      // 랙에 올라간 출고는 랙 말풍선이 주문번호·단계를 보인다 — 같은 글을 3D 이름표로 또 띄우지 않는다(사용자 2026-11-20 "겹치고 어수선")
      .filter((r) => !sim.onRack(r.shipmentId));
    // 랙에 올렸다고 본 출고는 그 랙(화면에서 고른 랙) 위, 나머지(포장 중·랙 찍기 전)는 랙 1 위
    const byRack = new Map<string, string[]>();
    for (const r of rows) {
      const rk = sim.onRack(r.shipmentId) ? sim.rackFor(r.shipmentId) : sim.racks[0];
      const list = byRack.get(rk) ?? [];
      byRack.set(rk, list);
      if (list.length < MAX_SHIP_LABELS) list.push(`${orderText(real.orderNumberOf(r.shipmentId), r.shipmentId)} · ${r.info!.state === 'PREPARING' ? '포장 중' : '출하 대기'} · ${dispatchText(r, (id) => real.riderLabel(id))}`);
      else if (list.length === MAX_SHIP_LABELS) list.push('외 더 있음');
    }
    const key = [...byRack].map(([k, v]) => `${k}:${v.join('|')}`).join('#');
    if (key === ver.current) return;
    ver.current = key;
    for (const c of [...labels.children]) {
      const s = c as THREE.Sprite;
      s.material.map?.dispose();
      s.material.dispose();
      labels.remove(s);
    }
    for (const [rk, texts] of byRack) {
      const p = sim.backendPoint(rk);
      if (!p) continue;
      texts.forEach((t, i) => {
        const s = makeLabel(t, { size: 36, bg: 'rgba(26,115,232,0.9)', screenPx: 18, prio: 5 });
        s.position.set(p.x, 2.4 + i * 0.45, p.z);
        labels.add(s);
      });
    }
  });
  return <primitive object={labels} />;
}

// 센터 전체 재고를 그리므로 넉넉히 — 선반 칸은 상자 수(CARTON_UNITS 낱개당 1개)
const MAX_BOXES = 16000;
/** 선반 칸 하나에 그리는 최대 개수 — 넘으면 이 수까지만 보이고 라벨 없이 둔다 */
/** 선반 밖 자리 한 곳에 그리는 최대 개수 */
const PER_POINT_CAP = 48;
/** 봉투(포장분) 최대 개수 */
const MAX_BAGS = 400;
const WORK_KO: Record<StockWorkState, string> = {
  STORED: '보관',
  PICKED: '집품',
  PACKED: '포장',
  CANCEL_RETURN_PENDING: '복귀 대기',
  UNSTOWED: '미적치',
};

/**
 * 실서버 재고(주문에 나온 SKU 만, GET /mfcs/{id}/stock): 선반 칸의 STORED 수량은 그 칸에, 집품·포장 등은 그 위치(패킹대·대기 지점)에
 * 상자로 쌓아 보인다. PDA 가 집으면 다음 조회에서 선반에서 빠지고 포장 구역에 생긴다. 수량은 서버 응답 그대로. 그리는 자리만 두 가지 예외:
 * - 작업자가 끌고 있는 장바구니의 집품분(PICKED)은 카트 보관 자리에 그리지 않는다 — 작업자 카트 위에 그린다(Simulation.heldCarts·cartLoad)
 * - 출고가 출하 대기(READY)면 밀봉한 포장 내용만큼의 포장분(PACKED, 서버 위치 PAK-…)을 출하대기 랙 1에 그린다 — PDA 랙 스캔은 서버에
 *   가지 않아(BR-52 R20 OPEN) 서버 위치는 패킹대 그대로. 이름표에 "추정"으로 적는다
 */
/** 선반 상자 하나가 나타내는 낱개 수 — 칸 수량을 상자 수로(그림) [시뮬] */
const CARTON_UNITS = 6;

export function RealStock() {
  const { sim, registry } = useApp();
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const bagMesh = useRef<THREE.InstancedMesh>(null!);
  // 상자 번호 → 칸 위치 코드(누르면 그 칸 상품 정보)
  const cellOf = useRef<(string | null)[]>([]);
  useEffect(() => {
    registry.realCells = { mesh: mesh.current, codeAt: (i) => cellOf.current[i] ?? null };
    return () => {
      registry.realCells = null;
    };
  }, [registry]);
  const labels = useMemo(() => new THREE.Group(), []);
  const ver = useRef('');
  useFrame(() => {
    const real = sim.real;
    if (!real) return;
    const held = sim.heldCarts();
    const racked = real.shipments().filter((r) => r.info?.state === 'READY' && sim.onRack(r.shipmentId)).map((r) => r.shipmentId);
    const sig = `${real.stockVersion}|${real.deliveryVersion}|${[...held].sort().join(',')}|${racked.map((id) => `${id}@${sim.rackFor(id)}`).join(',')}`;
    if (sig === ver.current) return;
    ver.current = sig;
    // 출하 대기 출고의 밀봉 포장 내용(랙 → SKU → 수량) — 그만큼의 PACKED 를 그 출고의 랙(화면에서 고른 랙, 모르면 랙 1)에
    const toRack = new Map<string, Map<string, number>>();
    for (const r of real.shipments()) {
      // 서버가 랙을 아는 출고(F-12)는 포장분 재고가 이미 랙 위치로 와 그대로 그려진다 — 추정에서 뺀다
      if (r.info?.state !== 'READY' || !racked.includes(r.shipmentId) || sim.serverRack(r.shipmentId)) continue;
      const rk = sim.rackFor(r.shipmentId);
      const bySku = toRack.get(rk) ?? new Map<string, number>();
      toRack.set(rk, bySku);
      for (const p of r.info.packages ?? []) {
        if (p.state !== 'SEALED') continue;
        for (const c of p.contents as { sku: string; qty: number }[]) bySku.set(c.sku, (bySku.get(c.sku) ?? 0) + c.qty);
      }
    }
    const rackGuess = new Map<string, number>();
    const m = mesh.current;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    const bm = bagMesh.current;
    let b = 0;

    const shelf = new Map<string, { loc: Location; code: string; normal: number; held: number }>();
    cellOf.current = [];
    const points = new Map<string, { x: number; z: number; table: boolean; by: Map<StockWorkState, number>; tz: Map<string, number> }>();
    // 상품 보관 온도대(SKU → 냉동·냉장·상온) — 재고 줄의 temperatureZone, 없으면 그 상품이 놓인 선반 칸의 온도대.
    // 입고칸·탁자 상자도 선반과 같은 구역색으로(사용자 2026-11-20 "입고되는 곳에는 다 같은 색의 상자들이 … 실제 재고 상품박스색대로")
    const skuTemp = new Map<string, TemperatureZone>();
    const isTemp = (v: unknown): v is TemperatureZone => v === 'AMBIENT' || v === 'CHILLED' || v === 'FROZEN';
    for (const u of real.stockUnits()) {
      if (skuTemp.has(u.sku)) continue;
      if (isTemp(u.temperatureZone)) skuTemp.set(u.sku, u.temperatureZone);
      else {
        // 선반 칸이 아니면 보충재고 팔레트의 온도대(재고 줄에 온도대가 빠진 것 — 사용자 2026-11-21 "입고창고 상품 박스 색은 온도별 색이 적용이 안 된")
        const t = sim.backendLocation(u.locationCode)?.temp ?? sim.backendReserve(u.locationCode)?.temp;
        if (t) skuTemp.set(u.sku, t);
      }
    }
    for (const u0 of real.stockUnits()) {
      let u = u0;
      if (u.workState === 'PICKED' && held.has(u.locationCode)) continue; // 작업자 카트 위에 그림
      if (u.workState === 'PACKED' && u.locationCode.startsWith('PAK-')) {
        for (const [rk, bySku] of toRack) {
          const rp = sim.backendPoint(rk);
          const take = rp ? Math.min(bySku.get(u.sku) ?? 0, u.qty) : 0;
          if (take <= 0) continue;
          bySku.set(u.sku, (bySku.get(u.sku) ?? 0) - take);
          rackGuess.set(rk, (rackGuess.get(rk) ?? 0) + take);
          const g = points.get(rk) ?? { x: rp!.x, z: rp!.z, table: true, by: new Map(), tz: new Map() };
          g.by.set('PACKED', (g.by.get('PACKED') ?? 0) + take);
          points.set(rk, g);
          u = { ...u, qty: u.qty - take };
          if (u.qty <= 0) break;
        }
        if (u.qty <= 0) continue;
      }
      const loc = u.workState === 'STORED' ? sim.backendLocation(u.locationCode) : null;
      if (loc) {
        const g = shelf.get(loc.code) ?? { loc, code: u.locationCode, normal: 0, held: 0 };
        if (u.qualityState === 'NORMAL') g.normal += u.qty;
        else g.held += u.qty;
        shelf.set(loc.code, g);
        continue;
      }
      const p = sim.backendPoint(u.locationCode) ?? (() => {
        const l = sim.backendLocation(u.locationCode);
        return l ? l.pick : null;
      })();
      if (!p) continue; // 평면에 없는 위치(MIGRATION 등)
      const key = u.locationCode;
      // 장바구니(CRT-) 재고(취소 주문의 되돌릴 상품)는 거치대 옆 탁자 위에 그린다(사용자 2026-11-20 "장바구니 옆에 테이블 두고 거기에 올리게")
      const crt = key.startsWith('CRT-');
      const cd = sim.layout.points.cartDepot;
      const g =
        points.get(key) ??
        (crt
          ? { x: cd.x + RETURN_TABLE.dx, z: cd.z + RETURN_TABLE.dz, table: true, by: new Map(), tz: new Map() }
          : // 인계 랙: 서버 점은 랙의 첫 칸(왼쪽 끝) — 봉투는 랙 가운데 아래 칸에
            { x: key.startsWith('DSP-') ? p.x + 0.45 : p.x, z: p.z, table: u.locationCode.startsWith('PAK-A'), by: new Map(), tz: new Map() });
      g.by.set(u.workState, (g.by.get(u.workState) ?? 0) + u.qty);
      // 인계 랙(DSP-)에 남은 것은 포장된 봉투째(취소 주문의 재진열 대기 포함) — 상자로 그리지 않는다(사용자 2026-11-21 "인계랙 옆에 상자는 … 비닐봉투 포장으로")
      if (u.workState !== 'PACKED' && !key.startsWith('DSP-')) {
        const tk = skuTemp.get(u.sku) ?? '?';
        g.tz.set(tk, (g.tz.get(tk) ?? 0) + u.qty);
      }
      points.set(key, g);
    }

    // 선반 칸: 낱개 작은 상자 대신 칸 크기에 맞춘 골판지 상자(참고 그림처럼 — 사용자 2026-11-20 "랙 확대한 모습인데 UI가 없어보여").
    // 상자 수 = 칸 수량 ÷ CARTON_UNITS(올림, 있으면 최소 1), 칸에 들어가는 만큼(가로 cols × 단 layers)까지. 품질 보류분은 붉은 상자
    const sc = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    for (const { loc, code, normal, held } of shelf.values()) {
      const cols = Math.max(1, Math.min(3, Math.floor((loc.slotW * 0.92) / 0.3)));
      const layers = loc.levelH > 0.5 ? 2 : 1;
      const cw = (loc.slotW * 0.92) / cols - 0.02;
      const ch = Math.min(0.32, (loc.levelH - 0.08) / layers - 0.02);
      const cd = RACK_DEPTH / 2 - 0.06;
      const rackCross = (loc.along === 'z' ? loc.shelf.x : loc.shelf.z) - (loc.face * RACK_DEPTH) / 4;
      const alongC = loc.along === 'z' ? loc.shelf.z : loc.shelf.x;
      const baseY = loc.shelf.y - 0.035;
      const want = (q0: number) => (q0 > 0 ? Math.max(1, Math.ceil(q0 / CARTON_UNITS)) : 0);
      const nNormal = want(normal);
      const total = Math.min(cols * layers, nNormal + want(held));
      for (let i = 0; i < total && n < MAX_BOXES; i++) {
        const c = i % cols;
        const l = Math.floor(i / cols);
        const a = alongC + (c - (cols - 1) / 2) * (cw + 0.02);
        const cross = rackCross + loc.face * 0.02; // 칸 앞쪽 반(통로 쪽)에
        const y = baseY + ch / 2 + l * (ch + 0.015);
        sc.set(loc.along === 'z' ? cd : cw, ch, loc.along === 'z' ? cw : cd);
        mtx.compose(new THREE.Vector3(loc.along === 'z' ? cross : a, y, loc.along === 'z' ? a : cross), quat, sc);
        m.setMatrixAt(n, mtx);
        m.setColorAt(n, i < nNormal ? zoneBoxColor(loc.temp, col) : col.setHex(0xd9826f));
        cellOf.current[n] = code;
        n++;
      }
    }

    // 선반 밖 자리(입고·검수 칸·카트·포장대 등): 골판지 상자로 쌓는다 — CARTON_UNITS 낱개당 1개, 3×3 한 층(MOCK 하차 칸처럼, 사용자 2026-11-20 "목업은 박스채로 옆 공간에 쌓아두던데")
    for (const [code, g] of points) {
      const baseY = g.table ? 0.9 : code.startsWith('DSP-') ? 0.22 : 0.02;
      const S = g.table ? 0.2 : 0.34;
      let i = 0;
      for (const [ws, qty] of g.by) {
        if (ws !== 'PACKED' && !code.startsWith('DSP-')) continue;
        {
          // 포장분 = 배달 봉투(사용자 2026-11-20 "박스가 아니라 비닐봉투에 패킹하는데?") — 낱개 CARTON_UNITS 개당 봉투 1개, 한 줄 4개씩
          const bags = Math.max(1, Math.ceil(qty / CARTON_UNITS));
          for (let q = 0; q < bags && b < MAX_BAGS; q++) {
            const c = q % 4;
            const l = Math.floor(q / 4);
            const row = Math.min(4, bags - l * 4); // 한 줄 봉투 수만큼 가운데 맞춤
            mtx.compose(new THREE.Vector3(g.x + (c - (row - 1) / 2) * 0.27, baseY + 0.16 + l * 0.33, g.z), quat, sc.set(0.24, 0.24, 0.24));
            bm.setMatrixAt(b, mtx);
            bm.setColorAt(b, col.setHex(BAG_COLOR.AMBIENT));
            b++;
          }
        }
      }
      // 상자 = 상품 온도대별 구역색(선반과 같은 zoneBoxColor) — 냉동·냉장·상온 순으로 쌓는다. 온도대를 모르면 골판지 기본색
      for (const tk of ['FROZEN', 'CHILLED', 'AMBIENT', '?'] as const) {
        const qty = g.tz.get(tk) ?? 0;
        if (qty <= 0) continue;
        const cartons = Math.max(1, Math.ceil(qty / CARTON_UNITS));
        for (let q = 0; q < cartons && i < PER_POINT_CAP && n < MAX_BOXES; q++, i++) {
          const c = i % 3;
          const r = Math.floor(i / 3) % 3;
          const l = Math.floor(i / 9);
          mtx.compose(new THREE.Vector3(g.x + (c - 1) * (S + 0.03), baseY + S / 2 + l * (S + 0.01), g.z + (r - 1) * (S + 0.03)), quat, sc.set(S, S, S));
          m.setMatrixAt(n, mtx);
          m.setColorAt(n, isTemp(tk) ? zoneBoxColor(tk, col) : col.setHex(SCENE.box));
          n++;
        }
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    bm.count = b;
    bm.instanceMatrix.needsUpdate = true;
    if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
    // 클릭 판정(레이캐스트)은 경계 구를 먼저 본다 — 상자가 바뀌면 다시 계산(안 하면 처음 빈 구라 상자를 못 누름)
    m.computeBoundingSphere();

    for (const c of [...labels.children]) {
      const s = c as THREE.Sprite;
      s.material.map?.dispose();
      s.material.dispose();
      labels.remove(s);
    }
    for (const [code, g] of points) {
      // 출하대기 랙은 랙 말풍선이 포장 수·주문을 보인다 — 같은 자리에 글을 또 띄우면 랙 번호판·구역 이름과 겹친다(사용자 2026-11-20 "겹쳐진 거 그대로")
      if (code.startsWith('DSP-')) continue;
      const text =
        rackGuess.get(code)
          ? `${code} 포장 ${rackGuess.get(code)} — 추정(서버 위치는 패킹대, PDA 랙 스캔 미전송 R20)`
          : code.startsWith('CRT-') || code.startsWith('RCV-')
            ? // 장바구니 옆 탁자 — 자리 이름(장바구니1) 대신 무엇인지(사용자 2026-11-20 "장바구니1은 테이블에 왜 있는데")
              [...g.by].map(([ws, q]) => `${WORK_SHORT[ws] ?? WORK_KO[ws]} ${q}개`).join(' · ')
            : RESERVE_CODE.test(code)
              ? // 팔레트: 번호와 수량을 한 이름표로(BR-1 · 361개)
                `${reserveName(code)} · ${[...g.by.values()].reduce((a, q) => a + q, 0).toLocaleString()}개`
              : `${placeShortName(code)} · ${[...g.by].map(([ws, q]) => `${WORK_SHORT[ws] ?? WORK_KO[ws]} ${q}`).join(' · ')}`;
      const pallet = RESERVE_CODE.test(code);
      const s = pallet ? makeLabel(text, PALLET_LABEL) : makeLabel(text, { size: 36, bg: 'rgba(20,22,26,0.85)', screenPx: 18 });
      // 쌓인 상자 더미 위에(전엔 0.9 m — 더미에 묻혔다, 사용자 2026-11-20 "여기도 겹치는데")
      let cartons = 0;
      for (const [ws, q] of g.by) if (ws !== 'PACKED') cartons += Math.max(1, Math.ceil(q / CARTON_UNITS));
      const S = g.table ? 0.2 : 0.34;
      const layers = Math.ceil(Math.min(cartons, PER_POINT_CAP) / 9);
      if (pallet) {
        s.userData.noNudge = true;
        s.userData.shrinkFar = true;
        s.userData.prio = 2; // 수량 있는 팔레트가 빈 팔레트(0)보다 먼저 자리 잡음
        // 팔레트는 상자 더미 바로 위에 붙여(아래 끝 = 더미 꼭대기) — 높이 띄우면 뒤 랙을 가렸다(사용자 2026-11-21 "BR1 식별값이랑 갯수가 박스보다 너무 위쪽에")
        s.center.set(0.5, 0);
        s.position.set(g.x, 0.16 + layers * (S + 0.01) + 0.08, g.z);
      } else if (code.startsWith('CRT-')) {
        // 재진열 대기(거치대 옆 탁자): 왼쪽 끝을 탁자 왼쪽에 두고 오른쪽으로 — 왼쪽 "장바구니 거치대" 이름표와 겹치지 않게, 같은 높이
        s.center.set(0, 0.5);
        s.position.set(g.x - 0.4, 1.8, g.z);
      } else s.position.set(g.x, (g.table ? 0.9 : 0.02) + Math.max(0.9, layers * (S + 0.01) + 0.35), g.z);
      labels.add(s);
    }
    // 빈 팔레트: 번호만 팔레트 바로 위에
    for (const rs of sim.layout.reserves) {
      const code = sim.reserveCode(rs);
      if (!code || points.has(code)) continue;
      const s = makeLabel(reserveName(code) ?? rs.id, PALLET_LABEL);
      s.center.set(0.5, 0);
      s.userData.noNudge = true;
      s.userData.shrinkFar = true;
      s.userData.prio = 0;
      s.position.set((rs.rect.x0 + rs.rect.x1) / 2, 0.22, (rs.rect.z0 + rs.rect.z1) / 2);
      labels.add(s);
    }
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX_BOXES]} count={0} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.65} map={boxTexture()} />
      </instancedMesh>
      <instancedMesh ref={bagMesh} args={[bagGeometry(), undefined, MAX_BAGS]} count={0} frustumCulled={false}>
        <meshStandardMaterial roughness={0.35} metalness={0.05} />
      </instancedMesh>
      <primitive object={labels} />
    </>
  );
}
