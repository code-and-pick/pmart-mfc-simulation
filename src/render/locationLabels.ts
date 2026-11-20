// 랙·칸 로케이션 번호 표시.
//  - 랙 번호판: 랙 위에 노란 판(그룹-랙, 예 C01-03). 368개를 아틀라스 한 장 + 지오메트리 한 개로 그린다(그리기 호출 1회).
//  - 칸 번호: 가까이 확대했을 때만 카메라 주변 칸의 선반 앞단에 전체 코드(예 C01-03-205)를 붙인다(재사용 풀).
// 라벨 색: 처음엔 MFC 8-2 사진 관찰 "노란 라벨"을 따랐으나 2026-11-20 사용자 결정으로 랙 디자인(파랑)에 맞춤(코드 체계 자체는 가설).
import * as THREE from 'three';
import { RACK_DEPTH, RACK_HEIGHT, type Layout, type Location, type Rack } from '../domain/layout';

const UP = new THREE.Vector3(0, 1, 0);
/** 카메라가 보는 점에서 이 거리(m) 안이면 칸 번호를 붙인다 [시뮬] */
const SLOT_LABEL_DIST = 26;

function faceNormal(along: 'x' | 'z', face: 1 | -1): THREE.Vector3 {
  return along === 'z' ? new THREE.Vector3(face, 0, 0) : new THREE.Vector3(0, 0, face);
}

/**
 * 번호판 그리기(사용자 2026-11-20 "검정 글자에 테두리에 노란배경색 … 색과 디자인은 지금 랙 디자인에 어울리게") —
 * 랙 번호판 = 랙 기둥과 같은 파랑 판에 흰 글자(위 밝은 그라데이션), 칸 번호 = 흰 판에 남색 글자 + 왼쪽 파란 띠(가로대 앞에 붙임).
 * (예전 노란 라벨은 MFC 8-2 사진 관찰을 따랐으나 사용자 결정으로 바꿈)
 */
function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string, kind: 'rack' | 'slot') {
  const r = h * 0.3;
  if (kind === 'rack') {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#3d8bff');
    g.addColorStop(1, '#1f63d8');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, w - 4, h - 4, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, h - 2, r * 0.6);
    ctx.fill();
    ctx.strokeStyle = '#c9d6ee';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#1f6fe8';
    ctx.fillRect(x + 1, y + 1, h * 0.22, h - 2);
  }
  ctx.fillStyle = kind === 'rack' ? '#ffffff' : '#16255c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const left = kind === 'slot' ? h * 0.22 : 0;
  let size = Math.floor(h * 0.62);
  ctx.font = `800 ${size}px "Noto Sans KR", "Malgun Gothic", monospace`;
  while (ctx.measureText(text).width > w - 14 - left && size > 8) {
    size -= 1;
    ctx.font = `800 ${size}px "Noto Sans KR", "Malgun Gothic", monospace`;
  }
  ctx.fillText(text, x + left + (w - left) / 2, y + h / 2 + 1);
}

export class LocationLabels {
  /** 장면에 붙일 최상위 묶음(랙 번호판 + 칸 번호 풀) */
  readonly root = new THREE.Group();
  readonly rackPlates: THREE.Mesh;
  private readonly pool: { mesh: THREE.Mesh; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; code: string | null }[] = [];
  private readonly slotGroup = new THREE.Group();
  private timer = 0;
  rackVisible = true;
  slotVisible = true;

  constructor(
    private readonly layout: Layout,
    poolSize = 160,
  ) {
    this.rackPlates = this.buildRackPlates(layout.racks);
    this.root.add(this.rackPlates);
    for (let i = 0; i < poolSize; i++) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 56;
      const ctx = c.getContext('2d')!;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4 }));
      mesh.renderOrder = 6;
      mesh.visible = false;
      this.slotGroup.add(mesh);
      this.pool.push({ mesh, ctx, tex, code: null });
    }
    this.root.add(this.slotGroup);
  }

  private buildRackPlates(racks: Rack[]): THREE.Mesh {
    const CW = 204;
    const CH = 52;
    const cols = Math.floor(2048 / CW);
    const rows = Math.ceil(racks.length / cols);
    const H = THREE.MathUtils.ceilPowerOfTwo(rows * CH);
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const W = 0.95;
    const Hh = 0.24;
    racks.forEach((r, i) => {
      const cx0 = (i % cols) * CW;
      const cy0 = Math.floor(i / cols) * CH;
      drawTag(ctx, cx0, cy0, CW, CH, `${r.group}-${String(r.rackNo).padStart(2, '0')}`, 'rack');
      const n = faceNormal(r.along, r.face);
      const right = new THREE.Vector3().crossVectors(UP, n).normalize();
      // 위에서 내려다봐도 읽히도록 판을 뒤로 젖힌다
      const plateUp = UP.clone().addScaledVector(n, -0.75).normalize();
      const center = new THREE.Vector3(r.cx, RACK_HEIGHT + 0.2, r.cz).addScaledVector(n, RACK_DEPTH / 2);
      const base = pos.length / 3;
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const p = center.clone().addScaledVector(right, (sx * W) / 2).addScaledVector(plateUp, (sy * Hh) / 2);
        pos.push(p.x, p.y, p.z);
        uv.push((cx0 + (sx > 0 ? CW : 0)) / 2048, 1 - (cy0 + (sy > 0 ? 0 : CH)) / H);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  }

  /** 카메라 근처 칸에만 번호를 붙인다. 0.2초마다 다시 고른다. */
  update(dt: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
    this.rackPlates.visible = this.rackVisible;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    const camDist = camera.position.distanceTo(target);
    // 칸 번호는 조금만 다가가도 보이게(사용자 2026-11-20 "꼭 한 번 클릭해서 다가가야 칸 식별값이 뜨는 거니?") — 클릭 없이 휠 확대로도. 16 → 26 m
    const show = this.slotVisible && camDist < SLOT_LABEL_DIST;
    if (!show) {
      for (const p of this.pool) p.mesh.visible = false;
      return;
    }
    // 화면에 보이는 칸 중 카메라에 가까운 칸부터(전엔 화면 가운데 지점 둘레만 — 앞 랙엔 안 뜨고 뒤 랙에만 뜨는 일이 있었다,
    // 사용자 2026-11-20 "왜 앞엔 식별값 안 뜨고 또 뒤에는 식별값이 뜨는 거임?")
    const cam = camera.position;
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const pt = new THREE.Vector3();
    const cand: { loc: Location; d: number }[] = [];
    for (const loc of this.layout.locations) {
      if (loc.closed) continue; // 닫힌 칸(넓은 칸으로 합쳐짐) — 라벨 없음
      if (!frustum.containsPoint(pt.set(loc.shelf.x, loc.shelf.y, loc.shelf.z))) continue;
      // 카메라가 칸의 앞(통로) 쪽에 있을 때만
      const n = faceNormal(loc.along, loc.face);
      if ((cam.x - loc.shelf.x) * n.x + (cam.z - loc.shelf.z) * n.z <= 0) continue;
      // 근접 클리핑으로 잘린 칸(맞은편 랙)은 건너뛴다
      const dc = Math.sqrt((cam.x - loc.shelf.x) ** 2 + (cam.y - loc.shelf.y) ** 2 + (cam.z - loc.shelf.z) ** 2);
      if (dc < camera.near + 0.1) continue;
      cand.push({ loc, d: dc });
    }
    cand.sort((a, b) => a.d - b.d);
    const chosen = cand.slice(0, this.pool.length).map((c) => c.loc);
    // 이미 붙어 있는 라벨은 그대로 두고 빈 자리만 다시 그린다
    const want = new Map(chosen.map((l) => [l.code, l]));
    const free: typeof this.pool = [];
    for (const p of this.pool) {
      if (p.code && want.has(p.code)) {
        want.delete(p.code);
        p.mesh.visible = true;
      } else free.push(p);
    }
    for (const p of free) {
      const next = want.entries().next();
      if (next.done) {
        p.mesh.visible = false;
        p.code = null;
        continue;
      }
      const [code, loc] = next.value;
      want.delete(code);
      this.place(p, loc);
    }
  }

  private place(p: (typeof this.pool)[number], loc: Location) {
    p.code = loc.code;
    p.ctx.clearRect(0, 0, 256, 56);
    drawTag(p.ctx, 0, 0, 256, 56, loc.code, 'slot');
    p.tex.needsUpdate = true;
    const n = faceNormal(loc.along, loc.face);
    // 선반 앞단(빔) 높이, 칸 가운데
    const rackCross = (loc.along === 'z' ? loc.shelf.x : loc.shelf.z) - (loc.face * RACK_DEPTH) / 4;
    // 주황 가로대(앞면 = RACK_DEPTH/2 + 0.008) 보다 앞에 — 가로대가 칸 번호를 가리지 않게(사용자 2026-11-20 "칸 식별값 가리면 안 돼")
    const frontCross = rackCross + loc.face * (RACK_DEPTH / 2 + 0.03);
    // 그 칸 상품이 올라가는 선반 빔 앞면 (빔 중심 = shelf.y − 0.05)
    const y = loc.shelf.y - 0.05;
    const x = loc.along === 'z' ? frontCross : loc.shelf.x;
    const z = loc.along === 'z' ? loc.shelf.z : frontCross;
    p.mesh.position.set(x, y, z);
    p.mesh.lookAt(x + n.x, y, z + n.z);
    // 캔버스 비(256:56)대로 — 글자가 눌리지 않게, 칸 폭 안에서 크게
    const w = Math.min(0.36, loc.slotW * 0.98);
    p.mesh.scale.set(w, w * (56 / 256), 1);
    p.mesh.visible = true;
  }
}
