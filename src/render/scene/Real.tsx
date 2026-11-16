// 실서버 관찰 표시: 진행 중 PICK·RETURN 의 남은 지시 칸(바닥 고리)과 그 작업 담당자(PDA 작업자) 표시, 주문 SKU 의 실제 재고.
// 작업자 위치는 서버가 주지 않는다 — "다음에 갈 지시 칸"에 세워 보여 줄 뿐 실제 위치가 아니다(SIM-2a 는 마지막 버튼 기준, 다음 단계).
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import type { StockWorkState, TaskState } from '../../domain/contract';
import { RACK_DEPTH, type Location } from '../../domain/layout';
import { TEMP_COLOR } from '../colors';
import { makeLabel } from '../sprites';

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
      if (!firstByTask.has(t.taskId)) firstByTask.set(t.taskId, { x: loc.pick.x, z: loc.pick.z, name: real.workerName(t.workerId), state: t.state });
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
 * 상자로 쌓아 보인다. PDA 가 집으면 다음 조회에서 선반에서 빠지고 포장 구역에 생긴다. 서버 응답 그대로 — 추정하지 않는다.
 */
export function RealStock() {
  const { sim } = useApp();
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const labels = useMemo(() => new THREE.Group(), []);
  const ver = useRef(-1);
  useFrame(() => {
    const real = sim.real;
    if (!real || real.stockVersion === ver.current) return;
    ver.current = real.stockVersion;
    const m = mesh.current;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;

    const shelf = new Map<string, { loc: Location; normal: number; held: number }>();
    const points = new Map<string, { x: number; z: number; table: boolean; by: Map<StockWorkState, number> }>();
    for (const u of real.stockUnits()) {
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
      const text = `${code} ${[...g.by].map(([ws, q]) => `${WORK_KO[ws]} ${q}`).join(' · ')}`;
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
