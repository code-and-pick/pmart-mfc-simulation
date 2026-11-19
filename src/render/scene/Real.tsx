// 실서버 관찰 표시: 진행 중 PICK·RETURN 의 남은 지시 칸(바닥 고리)과 그 작업 담당자(PDA 작업자) 표시, 주문 SKU 의 실제 재고.
// 작업자 위치는 서버가 주지 않는다 — "다음에 갈 지시 칸"에 세워 보여 줄 뿐 실제 위치가 아니다(SIM-2a 는 마지막 버튼 기준, 다음 단계).
import { orderText } from '../../ui/OrderNo';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import type { StockWorkState, TaskState } from '../../domain/contract';
import { RACK_DEPTH, type Location } from '../../domain/layout';
import { TEMP_COLOR } from '../colors';
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
        const s = makeLabel(`PDA ${p.name}`, { size: 40, bg: 'rgba(20,22,26,0.85)', screenPx: 20 });
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
      if (list.length < MAX_SHIP_LABELS) list.push(`${orderText(real.orderNumberOf(r.shipmentId), r.shipmentId)} · ${r.info!.state === 'PREPARING' ? '포장 중' : '출하 대기'} · ${dispatchText(r)}`);
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
        const s = makeLabel(t, { size: 36, bg: 'rgba(26,115,232,0.9)', screenPx: 18 });
        s.position.set(p.x, 2.4 + i * 0.45, p.z);
        labels.add(s);
      });
    }
  });
  return <primitive object={labels} />;
}

const BOX = 0.1;
const GAP = 0.02;
const MAX_BOXES = 4000;
/** 선반 칸 하나에 그리는 최대 개수 — 넘으면 이 수까지만 보이고 라벨 없이 둔다 */
const PER_SLOT_CAP = 40;
/** 선반 밖 자리 한 곳에 그리는 최대 개수 */
const PER_POINT_CAP = 48;
const WORK_COLOR: Record<StockWorkState, number> = {
  STORED: 0xffffff, // 선반 STORED 는 온도대 색을 쓴다
  PICKED: 0xfbbc04,
  PACKED: 0xa1887f,
  CANCEL_RETURN_PENDING: 0xea4335,
  UNSTOWED: 0x9aa0a6,
};
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
export function RealStock() {
  const { sim } = useApp();
  const mesh = useRef<THREE.InstancedMesh>(null!);
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

    const shelf = new Map<string, { loc: Location; normal: number; held: number }>();
    const points = new Map<string, { x: number; z: number; table: boolean; by: Map<StockWorkState, number> }>();
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
          const g = points.get(rk) ?? { x: rp!.x, z: rp!.z, table: true, by: new Map() };
          g.by.set('PACKED', (g.by.get('PACKED') ?? 0) + take);
          points.set(rk, g);
          u = { ...u, qty: u.qty - take };
          if (u.qty <= 0) break;
        }
        if (u.qty <= 0) continue;
      }
      const loc = u.workState === 'STORED' ? sim.backendLocation(u.locationCode) : null;
      if (loc) {
        const g = shelf.get(loc.code) ?? { loc, normal: 0, held: 0 };
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
      const g = points.get(key) ?? { x: p.x, z: p.z, table: u.locationCode.startsWith('PAK-A'), by: new Map() };
      g.by.set(u.workState, (g.by.get(u.workState) ?? 0) + u.qty);
      points.set(key, g);
    }

    // 선반 칸: 앞(통로 쪽)부터 채운다
    for (const { loc, normal, held } of shelf.values()) {
      const cols = Math.max(1, Math.floor((loc.slotW * 0.9) / (BOX + GAP)));
      const rows = 3;
      const layers = Math.max(1, Math.min(3, Math.floor((loc.levelH - 0.05) / (BOX + GAP))));
      const rackCross = (loc.along === 'z' ? loc.shelf.x : loc.shelf.z) - (loc.face * RACK_DEPTH) / 4;
      const alongC = loc.along === 'z' ? loc.shelf.z : loc.shelf.x;
      const baseY = loc.shelf.y - 0.035;
      const total = Math.min(PER_SLOT_CAP, normal + held, cols * rows * layers);
      for (let i = 0; i < total && n < MAX_BOXES; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols) % rows;
        const l = Math.floor(i / (cols * rows));
        const a = alongC + (c - (cols - 1) / 2) * (BOX + GAP);
        const depth = 0.15 - r * (BOX + GAP); // 앞(+) → 뒤
        const cross = rackCross + loc.face * depth;
        const y = baseY + BOX / 2 + l * (BOX + 0.01);
        mtx.makeTranslation(loc.along === 'z' ? cross : a, y, loc.along === 'z' ? a : cross);
        m.setMatrixAt(n, mtx);
        m.setColorAt(n, col.setHex(i < normal ? TEMP_COLOR[loc.temp] : 0xd93025));
        n++;
      }
    }

    // 선반 밖 자리: 상태별로 차례로 쌓는다
    for (const g of points.values()) {
      const baseY = g.table ? 0.9 : 0.02;
      let i = 0;
      for (const [ws, qty] of g.by) {
        for (let q = 0; q < qty && i < PER_POINT_CAP && n < MAX_BOXES; q++, i++) {
          const c = i % 4;
          const r = Math.floor(i / 4) % 4;
          const l = Math.floor(i / 16);
          mtx.makeTranslation(g.x + (c - 1.5) * (BOX + GAP), baseY + BOX / 2 + l * (BOX + 0.01), g.z + (r - 1.5) * (BOX + GAP));
          m.setMatrixAt(n, mtx);
          m.setColorAt(n, col.setHex(WORK_COLOR[ws]));
          n++;
        }
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;

    for (const c of [...labels.children]) {
      const s = c as THREE.Sprite;
      s.material.map?.dispose();
      s.material.dispose();
      labels.remove(s);
    }
    for (const [code, g] of points) {
      const text =
        rackGuess.get(code)
          ? `${code} 포장 ${rackGuess.get(code)} — 추정(서버 위치는 패킹대, PDA 랙 스캔 미전송 R20)`
          : `${code} ${[...g.by].map(([ws, q]) => `${WORK_KO[ws]} ${q}`).join(' · ')}`;
      const s = makeLabel(text, { size: 36, bg: 'rgba(20,22,26,0.85)', screenPx: 18 });
      s.position.set(g.x, (g.table ? 0.9 : 0.02) + 0.9, g.z);
      labels.add(s);
    }
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX_BOXES]} count={0} frustumCulled={false}>
        <boxGeometry args={[BOX, BOX, BOX]} />
        <meshStandardMaterial roughness={0.55} />
      </instancedMesh>
      <primitive object={labels} />
    </>
  );
}
