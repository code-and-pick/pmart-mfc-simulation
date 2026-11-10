import * as THREE from 'three';

/** screenPx 를 주면 화면 고정 크기(px) 라벨, 아니면 월드 크기 라벨. */
export function makeLabel(text: string, opts: { size?: number; color?: string; bg?: string; screenPx?: number } = {}): THREE.Sprite {
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
