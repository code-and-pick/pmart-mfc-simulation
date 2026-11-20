import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** screenPx 를 주면 화면 고정 크기(px) 라벨, 아니면 월드 크기 라벨. */
/** 이름표 우선순위(겹치면 높은 것만 — Declutter): 5 지금 할 일·출하 상태, 4 라이더·피킹 카드, 3 작업자·PDA, 2 패킹대·인계 랙·차량, 1 참고(기본) */
export type LabelPrio = 1 | 2 | 3 | 4 | 5;

export function makeLabel(text: string, opts: { size?: number; color?: string; bg?: string; screenPx?: number; prio?: LabelPrio } = {}): THREE.Sprite {
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
  s.userData.prio = opts.prio ?? 1;
  return s;
}

let boxTex: THREE.CanvasTexture | null = null;
/**
 * 골판지 상자 무늬(사용자 2026-11-20 참고 그림 — 상자 디자인도 그림처럼): 가운데 테이프 띠·작은 흰 라벨·모서리 선.
 * 회색조 무늬라 인스턴스 색(갈색 골판지·냉장 흰 상자)과 곱해져 같은 무늬로 보인다. 모든 상자가 하나를 같이 쓴다.
 */
export function boxTexture(): THREE.CanvasTexture {
  if (boxTex) return boxTex;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e4e4e4';
  g.fillRect(0, 0, n, n);
  // 위쪽이 조금 밝게(빛)
  const sh = g.createLinearGradient(0, 0, 0, n);
  sh.addColorStop(0, 'rgba(255,255,255,0.18)');
  sh.addColorStop(1, 'rgba(0,0,0,0.06)');
  g.fillStyle = sh;
  g.fillRect(0, 0, n, n);
  // 테이프 띠(가운데 세로)
  g.fillStyle = '#bdbdbd';
  g.fillRect(n * 0.43, 0, n * 0.14, n);
  // 라벨(왼쪽 아래 흰 사각)
  g.fillStyle = '#ffffff';
  g.fillRect(n * 0.12, n * 0.58, n * 0.22, n * 0.18);
  g.strokeStyle = '#cfcfcf';
  g.lineWidth = 2;
  g.strokeRect(n * 0.12, n * 0.58, n * 0.22, n * 0.18);
  // 모서리 선
  g.strokeStyle = '#a9a9a9';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, n - 3, n - 3);
  boxTex = new THREE.CanvasTexture(c);
  boxTex.colorSpace = THREE.SRGBColorSpace;
  boxTex.anisotropy = 4;
  return boxTex;
}

/** 작은 둥근 판 이름표(화면 크기 고정) — 위 밝은 그라데이션 + 아래 그림자. 패킹대 PS-n 등 */
export function makePillSprite(text: string, bg: string, top: string, screenPx: number, prio: LabelPrio = 2): THREE.Sprite {
  const S = 48;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const f = `800 ${S}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  g.font = f;
  const w = g.measureText(text).width + S * 1.1;
  const h = S * 1.5;
  const M = S * 0.35;
  c.width = Math.ceil(w + M * 2);
  c.height = Math.ceil(h + M * 2);
  g.save();
  g.shadowColor = 'rgba(40,32,120,0.35)';
  g.shadowBlur = S * 0.35;
  g.shadowOffsetY = S * 0.14;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(M, M * 0.6, w, h, h * 0.32);
  g.fill();
  g.restore();
  const gr = g.createLinearGradient(0, M * 0.6, 0, M * 0.6 + h);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bg);
  g.fillStyle = gr;
  g.beginPath();
  g.roundRect(M, M * 0.6, w, h, h * 0.32);
  g.fill();
  g.font = f;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, M + w / 2, M * 0.6 + h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: false }));
  const sh = screenPx / (2.414 * 475);
  s.scale.set((sh * c.width) / c.height, sh, 1);
  s.renderOrder = 11;
  s.userData.prio = prio;
  return s;
}

let palletTex: THREE.CanvasTexture | null = null;
/** 나무 팔레트 무늬 — 판자 사이 틈(어두운 줄). 회색조라 팔레트 색과 곱해진다 */
export function palletTexture(): THREE.CanvasTexture {
  if (palletTex) return palletTex;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, n, n);
  g.fillStyle = '#9a9a9a';
  for (let i = 1; i < 5; i++) g.fillRect((i * n) / 5 - 2, 0, 4, n);
  g.strokeStyle = '#8a8a8a';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, n - 3, n - 3);
  palletTex = new THREE.CanvasTexture(c);
  palletTex.colorSpace = THREE.SRGBColorSpace;
  return palletTex;
}

let bagGeo: THREE.BufferGeometry | null = null;
/**
 * 배달 봉투 모양(사용자 2026-11-20 "박스가 아니라 비닐봉투에 패킹하는데?") — 크기 1 기준(가로 1 · 높이 1.2 · 두께 0.45) 몸통 +
 * 위쪽 접힌 입구 + 손잡이 고리. 인스턴스로 크기만 바꿔 쓴다. 상온 흰 비닐, 냉장·냉동 은색 보냉봉투(BAG_COLOR).
 */
export function bagGeometry(): THREE.BufferGeometry {
  if (bagGeo) return bagGeo;
  const body = new THREE.BoxGeometry(1, 1.0, 0.45, 1, 1, 1);
  body.translate(0, 0.5, 0);
  const lip = new THREE.BoxGeometry(0.92, 0.12, 0.3);
  lip.translate(0, 1.06, 0);
  const handle = new THREE.TorusGeometry(0.2, 0.035, 6, 16, Math.PI);
  handle.translate(0, 1.1, 0);
  bagGeo = mergeGeometries([body.toNonIndexed(), lip.toNonIndexed(), handle.toNonIndexed()]) ?? body;
  bagGeo.translate(0, -0.6, 0); // 가운데가 원점(높이 1.2 의 반)
  return bagGeo;
}

/** 봉투 색 — 상온 흰 비닐, 냉장·냉동 은색 보냉봉투 */
export const BAG_COLOR: Record<'AMBIENT' | 'CHILLED' | 'FROZEN', number> = { AMBIENT: 0xf7f8fa, CHILLED: 0xc9d3de, FROZEN: 0xb9c6d6 };
