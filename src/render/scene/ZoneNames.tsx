// 구역 이름판 — 둥근 보라 판 + 아이콘 + 작은 둘째 말(랙 수·평)(사용자 2026-11-20 참고 그림 "좀 세련되게").
// 공중에 띄우면 작업자를 가려(사용자 "구역 카드가 공중에 떠있으니까 작업자 다 가리잖아. 아까처럼 투명 벽에다가 … 붙여줘")
// 구역 안쪽 뒷벽(북쪽, 문을 피한 가장 긴 조각)에 붙인다. 뒷벽이 없는 구역(격리·라이더 대기 등)은 바닥에 눕힌다.
// 빛을 받지 않는 재질(meshBasic)이라 색이 탁해지지 않는다. 벽 숨김·랙 번호 끔과 상관없이 늘 보인다.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Layout, Zone, ZoneKind } from '../../domain/layout';
import { SCENE } from '../colors';

const ICON: Partial<Record<ZoneKind, string>> = {
  FROZEN: '❄',
  CHILLED: '🌡',
  AMBIENT: '📦',
  INBOUND_STORE: '🚚',
  RECEIVING: '🔍',
  OFFICE: '🖥',
  PACKING: '🎁',
  PARKING: '🛵',
};

/** 둥근 판 캔버스 → 텍스처(+ 가로세로 비). 그림처럼 아래로 번지는 그림자 + 위가 밝은 보라 그라데이션 + 위쪽 얇은 빛 */
function makePill(title: string, sub: string | null, icon: string | null, bg: string, top: string): { tex: THREE.CanvasTexture; aspect: number } {
  const S = 64; // 글자 기준 크기(캔버스 px)
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const fT = `800 ${S}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const fS = `600 ${Math.round(S * 0.62)}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const fI = `${Math.round(S * 0.8)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.font = fT;
  const wT = ctx.measureText(title).width;
  ctx.font = fS;
  const wS = sub ? ctx.measureText(sub).width : 0;
  const iconW = icon ? S * 1.25 : 0;
  const padX = S * 0.6;
  const gap = sub ? S * 0.35 : 0;
  const M = S * 0.45; // 그림자 여백
  const pw = Math.ceil(padX * 2 + iconW + wT + gap + wS);
  const ph = Math.ceil(S * 1.55);
  c.width = Math.ceil(pw + M * 2);
  c.height = Math.ceil(ph + M * 2);
  const x0 = M;
  const y0 = M * 0.6;
  const r = ph / 2;
  // 그림자(아래로)
  ctx.save();
  ctx.shadowColor = 'rgba(40,32,120,0.38)';
  ctx.shadowBlur = S * 0.45;
  ctx.shadowOffsetY = S * 0.18;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x0, y0, pw, ph, r);
  ctx.fill();
  ctx.restore();
  // 판(위 밝게 → 아래 진하게)
  const g = ctx.createLinearGradient(0, y0, 0, y0 + ph);
  g.addColorStop(0, top);
  g.addColorStop(1, bg);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x0, y0, pw, ph, r);
  ctx.fill();
  // 위쪽 얇은 빛
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = S * 0.05;
  ctx.beginPath();
  ctx.roundRect(x0 + S * 0.05, y0 + S * 0.05, pw - S * 0.1, ph - S * 0.1, r);
  ctx.stroke();
  ctx.textBaseline = 'middle';
  const cy = y0 + ph / 2 + 2;
  let x = x0 + padX;
  if (icon) {
    ctx.font = fI;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(icon, x, cy);
    x += iconW;
  }
  ctx.font = fT;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, x, cy);
  x += wT + gap;
  if (sub) {
    ctx.font = fS;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(sub, x, cy + 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

function rackCount(L: Layout, z: Zone): number {
  const r = z.rect;
  return L.racks.filter((k) => k.cx >= r.x0 && k.cx <= r.x1 && k.cz >= r.z0 && k.cz <= r.z1).length;
}

/** 구역 뒤(z0) 벽 조각 중 문을 뺀 가장 긴 것 — 높이 2.5 m 이상(울타리 제외), 구역 폭 안. 판은 그 벽의 남쪽(구역 안쪽) 면 */
function backWall(L: Layout, z: Zone): { x0: number; x1: number; face: number } | null {
  const r = z.rect;
  let best: { x0: number; x1: number; face: number } | null = null;
  for (const w of L.walls) {
    const wr = w.rect;
    if (w.height < 2.5 || wr.x1 - wr.x0 < wr.z1 - wr.z0) continue; // 가로(동서) 벽만
    const cz = (wr.z0 + wr.z1) / 2;
    if (Math.abs(cz - r.z0) > 0.35) continue;
    const x0 = Math.max(wr.x0, r.x0);
    const x1 = Math.min(wr.x1, r.x1);
    if (x1 - x0 < 2.5) continue;
    if (!best || x1 - x0 > best.x1 - best.x0) best = { x0, x1, face: wr.z1 + 0.03 };
  }
  return best;
}

/** 벽 판 높이(m)·가운데 높이 — 랙(2.1 m) 위로 보이게, 벽(3 m) 위로 조금 솟게(전체 보기에서도 읽히게) */
const WALL_CARD_H = 1.7;
const WALL_CARD_Y = 2.95;

interface Tag {
  id: string;
  tex: THREE.CanvasTexture;
  pos: [number, number, number];
  rotX: number;
  w: number;
  h: number;
}

export function zoneTags(L: Layout): Tag[] {
  const out: Tag[] = [];
  for (const z of L.zones) {
    if (z.kind === 'SHIPPING') continue; // 라이더 대기와 같은 곳 — 인계 랙 번호판으로 충분
    const r = z.rect;
    const cx = (r.x0 + r.x1) / 2;
    const dim = z.kind === 'QUARANTINE';
    const racks = rackCount(L, z);
    const sub = dim ? (z.docPyeong ? `${z.docPyeong}평` : null) : z.kind === 'PACKING' ? null : racks ? `랙 ${racks}` : z.docPyeong ? `${z.docPyeong}평` : null;
    const { tex, aspect } = makePill(z.label, sub, dim ? null : (ICON[z.kind] ?? null), dim ? SCENE.pillDim : SCENE.pill, dim ? '#44528a' : SCENE.pillTop);
    const wall = dim || z.kind === 'PARKING' ? null : backWall(L, z);
    if (wall) {
      let h = WALL_CARD_H;
      let w = h * aspect;
      const room = (wall.x1 - wall.x0) * 0.9;
      if (w > room) {
        w = room;
        h = w / aspect;
      }
      out.push({ id: z.id, tex, pos: [(wall.x0 + wall.x1) / 2, WALL_CARD_Y, wall.face], rotX: 0, w, h });
    } else {
      // 바닥에 눕힘 — 격리는 작게
      let h = dim ? 0.55 : 0.9;
      let w = h * aspect;
      const room = (r.x1 - r.x0) * 0.85;
      if (w > room) {
        w = room;
        h = w / aspect;
      }
      out.push({ id: z.id, tex, pos: [cx, 0.03, (r.z0 + r.z1) / 2], rotX: -Math.PI / 2, w, h });
    }
  }
  return out;
}

export function ZoneNames({ L }: { L: Layout }) {
  const tags = useMemo(() => zoneTags(L), [L]);
  return (
    <>
      {tags.map((t) => (
        <mesh key={t.id} position={t.pos} rotation={[t.rotX, 0, 0]} renderOrder={5} raycast={() => null} userData={{ declutterBlock: true }}>
          <planeGeometry args={[t.w, t.h]} />
          <meshBasicMaterial map={t.tex} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ))}
    </>
  );
}
