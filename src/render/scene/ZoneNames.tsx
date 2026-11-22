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

/** 구역별 알약 색(아래 진하게 → 위 밝게) — 바닥 구역색과 같은 계열(사용자 2026-11-20 "알약 카드 다듬기만") */
const PILL: Partial<Record<ZoneKind, [string, string]>> = {
  FROZEN: ['#2f6fd8', '#5b9bf2'],
  CHILLED: ['#2e9a5c', '#56c286'],
  AMBIENT: ['#d9861c', '#f2a94a'],
  INBOUND_STORE: ['#1f8f9c', '#3fb6c2'],
  RECEIVING: ['#3d5bd1', '#6a84ec'],
  OFFICE: ['#56627a', '#7b879f'],
  PACKING: ['#6d4fd6', '#8f74ee'],
  PARKING: ['#6d4fd6', '#8f74ee'],
};

/**
 * 둥근 판 캔버스 → 텍스처(+ 가로세로 비). 다듬은 모양: 아이콘은 흰 원 안(구역색), 이름 굵게 흰 글자, 둘째 말(랙 수·평)은
 * 반투명 흰 작은 알약 안. 그림자는 짧고 부드럽게, 위쪽 반에 얇은 광택.
 */
export function makePill(title: string, sub: string | null, icon: string | null, bg: string, top: string): { tex: THREE.CanvasTexture; aspect: number } {
  const S = 64; // 글자 기준 크기(캔버스 px)
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const fT = `900 ${S}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const fS = `700 ${Math.round(S * 0.5)}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const fI = `${Math.round(S * 0.62)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.font = fT;
  const wT = ctx.measureText(title).width;
  ctx.font = fS;
  const wS = sub ? ctx.measureText(sub).width : 0;
  const ph = Math.ceil(S * 1.6);
  const iconD = ph - S * 0.36; // 아이콘 원 지름
  const padL = icon ? S * 0.18 : S * 0.6;
  const padR = S * 0.5;
  const badgeW = sub ? wS + S * 0.6 : 0;
  const gap = S * 0.3;
  const M = S * 0.4; // 그림자 여백
  const pw = Math.ceil(padL + (icon ? iconD + gap : 0) + wT + (sub ? gap + badgeW : 0) + padR);
  c.width = Math.ceil(pw + M * 2);
  c.height = Math.ceil(ph + M * 2);
  const x0 = M;
  const y0 = M * 0.5;
  const r = ph / 2;
  // 그림자(짧고 부드럽게)
  ctx.save();
  ctx.shadowColor = 'rgba(20,24,60,0.32)';
  ctx.shadowBlur = S * 0.35;
  ctx.shadowOffsetY = S * 0.12;
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
  // 위쪽 반 광택
  const gl = ctx.createLinearGradient(0, y0, 0, y0 + ph * 0.55);
  gl.addColorStop(0, 'rgba(255,255,255,0.28)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.roundRect(x0 + 3, y0 + 3, pw - 6, ph * 0.55, [r - 3, r - 3, 0, 0]);
  ctx.fill();
  // 테두리(얇은 흰 선)
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x0 + 1.5, y0 + 1.5, pw - 3, ph - 3, r);
  ctx.stroke();
  ctx.textBaseline = 'middle';
  const cy = y0 + ph / 2;
  let x = x0 + padL;
  if (icon) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + iconD / 2, cy, iconD / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = fI;
    ctx.textAlign = 'center';
    ctx.fillText(icon, x + iconD / 2, cy + 3);
    ctx.textAlign = 'left';
    x += iconD + gap;
  }
  ctx.font = fT;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, x, cy + 3);
  x += wT + gap;
  if (sub) {
    const bh = S * 0.78;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.roundRect(x, cy - bh / 2, badgeW, bh, bh / 2);
    ctx.fill();
    ctx.font = fS;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(sub, x + S * 0.3, cy + 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

function rackCount(L: Layout, z: Zone): number {
  const r = z.rect;
  // 구역 카드의 랙 수 = 피킹 랙(보충재고 랙은 입고창고 카드에만)
  return L.racks.filter((k) => k.cx >= r.x0 && k.cx <= r.x1 && k.cz >= r.z0 && k.cz <= r.z1 && (!k.reserve || z.kind === 'INBOUND_STORE')).length;
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
/** 냉동·냉장·상온·입고창고만 더 크게·더 위에(사용자 2026-11-20 "냉동, 냉장. 상온, 입고창고 구역카드들만 조금 더 위쪽으로 위치 올리고 사이즈 키워서") */
const WALL_CARD_H_BIG = 2.35;
const WALL_CARD_Y_BIG = 4.3;
const BIG_KINDS: readonly ZoneKind[] = ['FROZEN', 'CHILLED', 'AMBIENT', 'INBOUND_STORE', 'RECEIVING', 'OFFICE'];
/** 냉동과 같은 크기 — 문 때문에 벽 조각이 짧아도 줄이지 않고 구역 폭 안에서(사용자 2026-11-21 "휴게사무, 입고검수, 냉장 구역카드 크기 냉동이랑 같게 맞춰") */
const SAME_AS_FROZEN: readonly ZoneKind[] = ['FROZEN', 'CHILLED', 'RECEIVING', 'OFFICE'];

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
    const dim = z.kind === 'QUARANTINE';
    const racks = rackCount(L, z);
    const sub = dim ? (z.docPyeong ? `${z.docPyeong}평` : null) : z.kind === 'PACKING' ? null : racks ? `랙 ${racks}` : z.docPyeong ? `${z.docPyeong}평` : null;
    const [pbg, ptop] = PILL[z.kind] ?? [SCENE.pill, SCENE.pillTop];
    const { tex, aspect } = makePill(z.label, sub, dim ? null : (ICON[z.kind] ?? null), dim ? SCENE.pillDim : pbg, dim ? '#44528a' : ptop);
    const wall = dim || z.kind === 'PARKING' ? null : backWall(L, z);
    if (wall) {
      const big = BIG_KINDS.includes(z.kind);
      // 휴게·사무는 작게(사용자 2026-11-20 "휴게사무는 구역카드 사이즈 줄여")
      // (2026-11-21: 휴게·사무도 냉동과 같은 크기로 — 전엔 작게 "휴게사무는 구역카드 사이즈 줄여")
      let h = big ? WALL_CARD_H_BIG : WALL_CARD_H;
      let w = h * aspect;
      const same = SAME_AS_FROZEN.includes(z.kind);
      // 냉동과 같은 무리: 벽 조각이 아니라 구역 폭 기준·구역 가운데(문 위로 걸쳐도 카드는 벽 위에 떠 있다)
      const room = same ? (r.x1 - r.x0) * 0.95 : (wall.x1 - wall.x0) * 0.9;
      if (w > room) {
        w = room;
        h = w / aspect;
      }
      const cx = same ? (r.x0 + r.x1) / 2 : (wall.x0 + wall.x1) / 2;
      out.push({ id: z.id, tex, pos: [cx, big ? WALL_CARD_Y_BIG + (h - WALL_CARD_H_BIG) / 2 : WALL_CARD_Y, wall.face], rotX: 0, w, h });
    } else {
      // 바닥에 눕힘 — 격리는 작게, 패킹은 크게(벽을 뺀 뒤 바닥 카드, 사용자 2026-11-21 "바닥에 붙은 패킹구역카드 사이즈 좀 키워줘")
      let h = dim ? 0.55 : z.kind === 'PACKING' ? 1.8 : 0.9;
      let w = h * aspect;
      // 냉동·냉장 격리는 서쪽 벽에 흰 랙(x0+0.25~0.7)이 서 있어 그 동쪽 바닥에만(띠 폭 3.0 m, 사용자 2026-11-22 "가로 길이 줄여")
      const fx0 = z.id === 'AQ' || z.id === 'BQ' ? r.x0 + 0.8 : r.x0;
      const room = (r.x1 - fx0) * 0.85;
      if (w > room) {
        w = room;
        h = w / aspect;
      }
      out.push({ id: z.id, tex, pos: [(fx0 + r.x1) / 2, 0.03, (r.z0 + r.z1) / 2], rotX: -Math.PI / 2, w, h });
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
