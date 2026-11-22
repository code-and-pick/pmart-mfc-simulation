// 개발용 성능 표시 — `npm run dev` 에서만 쓴다. 운영 빌드에는 들어가지 않는다
// (App·SiteScene 이 `import.meta.env.DEV ? lazy(() => import('../dev/perf')) : null` 로만 부름 → 빌드에서 import 자체가 지워짐).
// 시뮬레이션·디자인·재고는 건드리지 않는다. "시험" 단추(해상도 1x·그림자 끔·상품 숨김)는 누른 동안만, 패널을 닫거나 화면을 떠나면 되돌린다.
//
// 지표 (모두 실측 — 이 브라우저·이 기기에서 잰 값):
//  - FPS·프레임 간격(ms): requestAnimationFrame 사이 시간(평균·p95·최대)
//  - CPU(JS) 시간: 프레임 시작(가장 앞 useFrame) ~ gl.render() 끝 — 시뮬 진행·장면 갱신·three.js 그리기 명령 만들기
//  - 그리기 명령(render) 시간: gl.render() 안만
//  - GPU 시간: EXT_disjoint_timer_query_webgl2 가 있을 때만(없으면 "측정 불가")
//  - Draw calls·Triangles: renderer.info.render(그림자 패스 포함, 프레임마다)
//  - Geometries·Textures·Programs: renderer.info.memory / programs
//  - 인스턴스: InstancedMesh 마다 count(슬롯)와 크기 0 이 아닌 것(실제로 그려 보이는 것) — 1초마다 셈
//  - 화면 밖 Mesh: 카메라 시야(frustum) 밖이라 three.js 가 건너뛰는 개별 Mesh·Sprite 수
//  - 긴 작업(Long Task, 50 ms 넘게 메인 스레드를 막음), JS 힙(Chrome 만)
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import * as THREE from 'three';
import { useApp } from '../app/context';

// ── 값 저장(Canvas 안 측정기 → DOM 패널) ─────────────────────────
export interface PerfWindow {
  at: number;
  mode: string;
  fps: number;
  frameAvg: number;
  frameP95: number;
  frameMax: number;
  cpuAvg: number;
  cpuP95: number;
  renderAvg: number;
  gpuAvg: number | null;
  calls: number;
  callsMax: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  meshes: number;
  sprites: number;
  instanced: number;
  instSlots: number;
  instDrawn: number;
  offscreen: number;
  longTasks: number;
  longTaskMs: number;
  heapMb: number | null;
  dpr: number;
  canvasMpx: number;
  topInstanced: { name: string; slots: number; drawn: number; tris: number }[];
  /** 잰 때의 화면 — 구역 보기·시뮬 속도(같은 조건끼리 비교) */
  view: string;
}

interface Snapshot extends Omit<PerfWindow, 'topInstanced'> {
  label: string;
}

const SNAP_KEY = 'pmart-perf-snapshots'; // sessionStorage(토큰 아님)

const store = {
  last: null as PerfWindow | null,
  history: [] as PerfWindow[],
  gpuSupported: null as boolean | null,
  snaps: [] as Snapshot[],
  /** 측정 진행(10초 측정·구역 돌며 측정) — null 이면 쉬는 중 */
  run: null as null | { text: string; stop: boolean },
  ver: 0,
  listeners: new Set<() => void>(),
  emit() {
    this.ver++;
    for (const l of this.listeners) l();
  },
};
const subscribe = (l: () => void) => {
  store.listeners.add(l);
  return () => store.listeners.delete(l);
};
const getVer = () => store.ver;

function pct(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// ── Canvas 안 측정기 ─────────────────────────────────────────
export function PerfProbe() {
  const { sim, controller } = useApp();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const acc = useRef({
    frameStart: 0,
    lastStart: 0,
    frames: [] as number[],
    cpu: [] as number[],
    render: [] as number[],
    gpu: [] as number[],
    calls: [] as number[],
    tris: [] as number[],
    winStart: performance.now(),
    longTasks: 0,
    longTaskMs: 0,
  });

  // gl.render 를 감싸 그리기 명령 시간·draw call·GPU 시간을 잰다(떼면 원래대로)
  useEffect(() => {
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const ext = (ctx.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null) as {
      TIME_ELAPSED_EXT: number;
      GPU_DISJOINT_EXT: number;
    } | null;
    store.gpuSupported = !!ext && typeof ctx.createQuery === 'function';
    const pending: WebGLQuery[] = [];
    const orig = gl.render;
    const a = acc.current;
    gl.render = function (s: THREE.Object3D, c: THREE.Camera) {
      let q: WebGLQuery | null = null;
      if (ext && pending.length < 4) {
        q = ctx.createQuery();
        if (q) ctx.beginQuery(ext.TIME_ELAPSED_EXT, q);
      }
      const t0 = performance.now();
      orig.call(gl, s, c);
      const t1 = performance.now();
      if (q && ext) {
        ctx.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(q);
      }
      a.render.push(t1 - t0);
      if (a.frameStart) a.cpu.push(t1 - a.frameStart);
      a.calls.push(gl.info.render.calls);
      a.tris.push(gl.info.render.triangles);
      // 끝난 GPU 측정 읽기(앞에서부터)
      if (ext) {
        while (pending.length) {
          const p = pending[0];
          if (!ctx.getQueryParameter(p, ctx.QUERY_RESULT_AVAILABLE)) break;
          const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT);
          const ns = ctx.getQueryParameter(p, ctx.QUERY_RESULT) as number;
          if (!disjoint) a.gpu.push(ns / 1e6);
          ctx.deleteQuery(p);
          pending.shift();
        }
      }
    } as typeof gl.render;
    return () => {
      gl.render = orig;
      for (const p of pending) ctx.deleteQuery(p);
    };
  }, [gl]);

  // 긴 작업(Long Task) — Chrome 계열만
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    const a = acc.current;
    const ob = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        a.longTasks++;
        a.longTaskMs += e.duration;
      }
    });
    ob.observe({ entryTypes: ['longtask'] });
    return () => ob.disconnect();
  }, []);

  // 프레임 시작(가장 먼저 도는 useFrame — 음수 우선순위는 자동 그리기를 끄지 않는다)
  useFrame(() => {
    const a = acc.current;
    const now = performance.now();
    if (a.lastStart) a.frames.push(now - a.lastStart);
    a.lastStart = now;
    a.frameStart = now;
  }, -10000);

  // 1초마다 묶어서 패널로
  const frustum = useRef(new THREE.Frustum());
  const pm = useRef(new THREE.Matrix4());
  useFrame(() => {
    const a = acc.current;
    const now = performance.now();
    if (now - a.winStart < 1000) return;
    const secs = (now - a.winStart) / 1000;
    a.winStart = now;
    // 장면 세기
    pm.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.current.setFromProjectionMatrix(pm.current);
    let meshes = 0;
    let sprites = 0;
    let instanced = 0;
    let instSlots = 0;
    let instDrawn = 0;
    let offscreen = 0;
    const top: PerfWindow['topInstanced'] = [];
    scene.traverseVisible((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        instanced++;
        instSlots += im.count;
        const arr = im.instanceMatrix.array;
        let d = 0;
        for (let i = 0; i < im.count; i++) {
          const j = i * 16;
          if (arr[j] !== 0 || arr[j + 1] !== 0 || arr[j + 2] !== 0) d++;
        }
        instDrawn += d;
        const g = im.geometry;
        const tris = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
        top.push({ name: im.name || `${g.type.replace('Geometry', '')}#${instanced}`, slots: im.count, drawn: d, tris: Math.round(tris * d) });
        return;
      }
      if ((o as THREE.Sprite).isSprite) {
        sprites++;
        if (o.frustumCulled && !frustum.current.intersectsSprite(o as THREE.Sprite)) offscreen++;
        return;
      }
      if ((o as THREE.Mesh).isMesh) {
        meshes++;
        if (o.frustumCulled && !frustum.current.intersectsObject(o)) offscreen++;
      }
    });
    top.sort((x, y) => y.drawn - x.drawn);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const el = gl.domElement;
    const w: PerfWindow = {
      at: Date.now(),
      mode: sim.mode === 'mock' ? 'MOCK' : 'REAL',
      fps: a.frames.length / secs,
      frameAvg: avg(a.frames),
      frameP95: pct(a.frames, 0.95),
      frameMax: a.frames.length ? Math.max(...a.frames) : 0,
      cpuAvg: avg(a.cpu),
      cpuP95: pct(a.cpu, 0.95),
      renderAvg: avg(a.render),
      gpuAvg: a.gpu.length ? avg(a.gpu) : null,
      calls: Math.round(avg(a.calls)),
      callsMax: a.calls.length ? Math.max(...a.calls) : 0,
      triangles: Math.round(avg(a.tris)),
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
      meshes,
      sprites,
      instanced,
      instSlots,
      instDrawn,
      offscreen,
      longTasks: a.longTasks,
      longTaskMs: a.longTaskMs,
      heapMb: mem ? mem.usedJSHeapSize / 1048576 : null,
      dpr: gl.getPixelRatio(),
      canvasMpx: (el.width * el.height) / 1e6,
      topInstanced: top.slice(0, 6),
      view: `${controller.views.find((v) => v.key === controller.focusedZone)?.label ?? controller.focusedZone} · ${sim.speed}×`,
    };
    a.frames = [];
    a.cpu = [];
    a.render = [];
    a.gpu = [];
    a.calls = [];
    a.tris = [];
    a.longTasks = 0;
    a.longTaskMs = 0;
    store.last = w;
    store.history.push(w);
    if (store.history.length > 30) store.history.shift();
    store.emit();
  });
  return null;
}

// ── 병목 판단(추정 — 지표로 가리키는 쪽일 뿐) ───────────────────
function verdict(w: PerfWindow): { text: string; tone: 'ok' | 'cpu' | 'gpu' | 'mix' } {
  const budget = w.frameAvg; // 실제 프레임 간격
  if (w.fps >= 55) return { text: '여유 — 화면 주사율(보통 60Hz)에 묶여 있음', tone: 'ok' };
  if (w.gpuAvg !== null) {
    if (w.gpuAvg > w.cpuAvg * 1.2 && w.gpuAvg > budget * 0.6) return { text: `GPU 쪽 (GPU ${w.gpuAvg.toFixed(1)} ms > CPU ${w.cpuAvg.toFixed(1)} ms)`, tone: 'gpu' };
    if (w.cpuAvg > w.gpuAvg * 1.2 && w.cpuAvg > budget * 0.6) return { text: `CPU 쪽 (CPU ${w.cpuAvg.toFixed(1)} ms > GPU ${w.gpuAvg.toFixed(1)} ms)`, tone: 'cpu' };
    return { text: 'CPU·GPU 비슷 — 둘 다 줄여야', tone: 'mix' };
  }
  if (w.cpuP95 > budget * 0.7) return { text: `CPU 쪽(추정) — JS ${w.cpuAvg.toFixed(1)} ms 가 프레임 ${budget.toFixed(1)} ms 의 대부분`, tone: 'cpu' };
  return { text: `GPU 쪽(추정) — JS ${w.cpuAvg.toFixed(1)} ms 인데 프레임 ${budget.toFixed(1)} ms. "해상도 1x" 로 FPS 가 오르면 화소 채우기(fill-rate)`, tone: 'gpu' };
}

// ── DOM 패널 ─────────────────────────────────────────────────
const n0 = (v: number) => Math.round(v).toLocaleString('ko-KR');
const n1 = (v: number) => v.toFixed(1);

function loadSnaps(): Snapshot[] {
  try {
    return JSON.parse(sessionStorage.getItem(SNAP_KEY) ?? '[]') as Snapshot[];
  } catch {
    return [];
  }
}

function snapshotOf(ws: PerfWindow[], n = 5, note = ''): Snapshot | null {
  const recent = ws.slice(-n);
  if (!recent.length) return null;
  const last = recent[recent.length - 1];
  const m = (k: keyof PerfWindow) => avg(recent.map((w) => w[k] as number));
  const g = recent.filter((w) => w.gpuAvg !== null).map((w) => w.gpuAvg as number);
  return {
    ...last,
    label: `${last.mode} · ${last.view}${note ? ` · ${note}` : ''}`,
    fps: m('fps'),
    frameAvg: m('frameAvg'),
    frameP95: m('frameP95'),
    frameMax: Math.max(...recent.map((w) => w.frameMax)),
    cpuAvg: m('cpuAvg'),
    cpuP95: m('cpuP95'),
    renderAvg: m('renderAvg'),
    gpuAvg: g.length ? avg(g) : null,
    calls: m('calls'),
    triangles: m('triangles'),
    // 측정 구간(n초) 합계
    longTasks: recent.reduce((x, w) => x + w.longTasks, 0),
    longTaskMs: recent.reduce((x, w) => x + w.longTaskMs, 0),
  } as Snapshot;
}

function toMarkdown(rows: Snapshot[]): string {
  const head = '| 기록 | 시각 | FPS | 프레임 평균/p95 ms | CPU(JS) 평균/p95 ms | 그리기명령 ms | GPU ms | Draw calls | Triangles | Geo | Tex | Mesh | Sprite | 인스턴스(보임/슬롯) | 화면밖 | 긴작업(구간 합) | 힙 MB | DPR · 화소 |';
  const sep = '|' + '---|'.repeat(18);
  const body = rows.map(
    (r) =>
      `| ${r.label} | ${new Date(r.at).toLocaleTimeString('ko-KR')} | ${n1(r.fps)} | ${n1(r.frameAvg)}/${n1(r.frameP95)} | ${n1(r.cpuAvg)}/${n1(r.cpuP95)} | ${n1(r.renderAvg)} | ${r.gpuAvg === null ? '측정 불가' : n1(r.gpuAvg)} | ${n0(r.calls)} | ${n0(r.triangles)} | ${r.geometries} | ${r.textures} | ${r.meshes} | ${r.sprites} | ${n0(r.instDrawn)}/${n0(r.instSlots)} | ${r.offscreen} | ${r.longTasks}회 ${n0(r.longTaskMs)}ms | ${r.heapMb === null ? '-' : n1(r.heapMb)} | ${r.dpr} · ${n1(r.canvasMpx)}MP |`,
  );
  return [head, sep, ...body].join('\n');
}

store.snaps = loadSnaps(); // 새로고침해도 이 탭 기록 유지

function saveSnaps(next: Snapshot[]) {
  store.snaps = next.slice(-30);
  sessionStorage.setItem(SNAP_KEY, JSON.stringify(store.snaps));
  store.emit();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 최근 n초를 잰다 — 1초 묶음이 n개 새로 쌓일 때까지 기다린 뒤 그 평균을 기록 */
async function measure(n: number, note: string): Promise<boolean> {
  const start = store.history.length ? store.history[store.history.length - 1].at : 0;
  for (let t = 0; t < n * 20; t++) {
    if (store.run?.stop) return false;
    const fresh = store.history.filter((w) => w.at > start);
    if (fresh.length >= n) {
      const s = snapshotOf(fresh, n, note);
      if (s) saveSnaps([...store.snaps, s]);
      return true;
    }
    await sleep(250);
  }
  return false;
}

/**
 * 시험(화면·화질은 바꾸지 않음 — 카메라만 옮김, 사용자 2026-11-22 "해상도 1·그림자 끔·상품 숨김은 없어도 돼 … 다른 걸로 테스트할 거 있으면 넣어"):
 *  - 10초 측정: 지금 화면 그대로 10초 평균을 기록(5초보다 흔들림 적음)
 *  - 구역 돌며 측정: 구역 보기(전체·냉동·냉장·상온…)를 차례로 띄워 각 2초 쉬고 5초씩 기록 → 어느 화면에서 느린지. 끝나면 처음 보기로 돌아감
 */
async function runTimed(label: string, fn: () => Promise<void>) {
  if (store.run) return;
  store.run = { text: label, stop: false };
  store.emit();
  try {
    await fn();
  } finally {
    store.run = null;
    store.emit();
  }
}

type Ctl = ReturnType<typeof useApp>['controller'];
function sweepZones(controller: Ctl) {
  const back = controller.focusedZone;
  return runTimed('구역 돌며 측정', async () => {
    for (const [i, v] of controller.views.entries()) {
      if (store.run?.stop) break;
      store.run!.text = `구역 돌며 측정 ${i + 1}/${controller.views.length} · ${v.label}`;
      store.emit();
      controller.focusZone(v.key, false);
      if (controller.leftView !== 'perf') controller.toggleLeft('perf'); // 구역을 고르면 왼쪽이 "구역" 탭으로 가서 — 성능 탭으로 되돌림
      await sleep(2000);
      await measure(5, '구역 순회');
    }
    controller.focusZone(back, false);
    if (controller.leftView !== 'perf') controller.toggleLeft('perf');
  });
}

export function PerfPanel() {
  useSyncExternalStore(subscribe, getVer);
  const { controller } = useApp();
  const [copied, setCopied] = useState(false);
  const snaps = store.snaps;
  const w = store.last;
  const record = () => {
    const s = snapshotOf(store.history);
    if (s) saveSnaps([...store.snaps, s]);
  };
  const clear = () => {
    store.snaps = [];
    sessionStorage.removeItem(SNAP_KEY);
    store.emit();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(snaps));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 복사 권한 없음 — 무시 */
    }
  };

  // 왼쪽 패널 탭 안(사용자 2026-11-22 "팝업창이 아니라 왼쪽창에 뜨게 별도 탭으로") — 패널 색(var(--text)·var(--muted))을 따른다
  const box: CSSProperties = { font: '11px/1.4 ui-monospace, Consolas, monospace' };
  const btn: CSSProperties = { font: 'inherit', background: 'var(--soft)', color: 'inherit', border: '1px solid var(--line)', borderRadius: 5, padding: '2px 7px', cursor: 'pointer', marginRight: 4, marginTop: 4 };
  const v = w ? verdict(w) : null;
  const tone = { ok: '#68d391', cpu: '#f6ad55', gpu: '#fc8181', mix: '#f6e05e' };
  const row = (k: string, val: string, hint?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }} title={hint}>
      <span style={{ color: 'var(--muted)' }}>{k}</span>
      <b>{val}</b>
    </div>
  );
  return (
    <section className="sec" style={box}>
      <h4>
        개발용 성능 · {w?.mode ?? '-'}
        {w ? <span>{w.view}</span> : null}
      </h4>
      {!w ? (
        <div>재는 중…</div>
      ) : (
        <>
          {row('FPS', n1(w.fps))}
          {row('프레임 ms 평균/p95/최대', `${n1(w.frameAvg)} / ${n1(w.frameP95)} / ${n1(w.frameMax)}`)}
          {row('CPU(JS) ms 평균/p95', `${n1(w.cpuAvg)} / ${n1(w.cpuP95)}`, '프레임 시작(useFrame) ~ gl.render 끝: 시뮬 진행 + 장면 갱신 + 그리기 명령 만들기')}
          {row('  └ 그리기 명령(gl.render) ms', n1(w.renderAvg), 'three.js 가 WebGL 명령을 만드는 CPU 시간(draw call 수에 비례)')}
          {row('GPU ms', w.gpuAvg === null ? (store.gpuSupported ? '재는 중' : '측정 불가(확장 없음)') : n1(w.gpuAvg), 'EXT_disjoint_timer_query_webgl2 — 대부분 모바일·일부 브라우저는 막혀 있음')}
          {row('Draw calls 평균/최대', `${n0(w.calls)} / ${n0(w.callsMax)}`, '그림자 패스 포함')}
          {row('Triangles', n0(w.triangles), '그림자 패스 포함')}
          {row('Geometries / Textures / Programs', `${w.geometries} / ${w.textures} / ${w.programs}`)}
          {row('개별 Mesh / Sprite', `${n0(w.meshes)} / ${n0(w.sprites)}`)}
          {row('InstancedMesh · 인스턴스 보임/슬롯', `${w.instanced} · ${n0(w.instDrawn)} / ${n0(w.instSlots)}`, '보임 = 크기 0 이 아닌 인스턴스. InstancedMesh 는 화면 밖이어도 통째로 그림(frustumCulled 꺼진 것)')}
          {row('화면 밖 Mesh·Sprite(걸러짐)', n0(w.offscreen))}
          {row('긴 작업(1초)', `${w.longTasks}회 ${n0(w.longTaskMs)} ms`, '50 ms 넘게 메인 스레드를 막은 작업(Chrome 계열)')}
          {row('JS 힙', w.heapMb === null ? '측정 불가' : `${n1(w.heapMb)} MB`)}
          {row('DPR · 캔버스 화소', `${w.dpr} · ${n1(w.canvasMpx)} MP`)}
          <div style={{ marginTop: 6, color: tone[v!.tone] }}>병목: {v!.text}</div>
          <div style={{ marginTop: 6, color: 'var(--muted)' }}>인스턴스 많은 순 (보임/슬롯 · 삼각형)</div>
          {w.topInstanced.map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.name}</span>
              <span>
                {n0(t.drawn)}/{n0(t.slots)} · {n0(t.tris)}
              </span>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <span style={{ color: 'var(--muted)' }}>시험(화면은 그대로, 카메라만): </span>
            {store.run ? (
              <>
                <span style={{ color: '#f6ad55' }}>{store.run.text}…</span>
                <button
                  style={btn}
                  onClick={() => {
                    if (store.run) store.run.stop = true;
                  }}
                >
                  멈춤
                </button>
              </>
            ) : (
              <>
                <button style={btn} onClick={() => void runTimed('10초 측정', async () => void (await measure(10, '10초')))} title="지금 화면 그대로 10초 평균을 기록">
                  10초 측정
                </button>
                <button style={btn} onClick={() => void sweepZones(controller)} title="구역 보기를 차례로 띄워 각 5초씩 기록 — 어느 화면이 느린지(끝나면 처음 보기로)">
                  구역 돌며 측정
                </button>
              </>
            )}
          </div>
          <div style={{ marginTop: 6 }}>
            <button style={btn} onClick={record} title="최근 5초 평균을 이 모드(MOCK/REAL)·화면 이름으로 남김 — 탭을 닫으면 지워짐">
              {w.mode} 기록
            </button>
            <button style={btn} onClick={copy} disabled={!snaps.length}>
              {copied ? '복사됨' : '표 복사'}
            </button>
            <button style={btn} onClick={clear} disabled={!snaps.length}>
              기록 지움
            </button>
          </div>
          {snaps.length > 0 && (
            <table style={{ marginTop: 6, borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ color: 'var(--muted)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left' }}>기록</th>
                  <th>FPS</th>
                  <th>프레임</th>
                  <th>CPU</th>
                  <th>GPU</th>
                  <th>DC</th>
                  <th>삼각형</th>
                </tr>
              </thead>
              <tbody>
                {snaps.map((s, i) => (
                  <tr key={i} style={{ textAlign: 'right' }}>
                    <td style={{ textAlign: 'left' }}>{s.label}</td>
                    <td>{n1(s.fps)}</td>
                    <td>{n1(s.frameAvg)}</td>
                    <td>{n1(s.cpuAvg)}</td>
                    <td>{s.gpuAvg === null ? '-' : n1(s.gpuAvg)}</td>
                    <td>{n0(s.calls)}</td>
                    <td>{n0(s.triangles / 1000)}k</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
