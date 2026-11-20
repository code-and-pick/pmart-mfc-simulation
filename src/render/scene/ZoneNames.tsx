// 구역 이름을 벽·바닥에 크게(사용자 2026-11-20 "MFC 안에 나타나는 글자가 너무 작은데 … 벽에 적히는 건?", "하양에 가까운 바닥색으로").
// 구역 앞(남쪽, 처음 시야 쪽) 벽의 바깥 면에 칠한 글씨 — 문을 피해 가장 긴 벽 조각에. 앞에 벽이 없으면(상온 C~H) 앞 가장자리 바로 바깥 통로 바닥에.
// 글자색 = 구역 색을 조금 섞은 흰색, 노란 바닥에서도 보이게 얇은 어두운 테두리. 벽 숨김·랙 번호 끔과 상관없이 늘 보인다.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Layout, Zone } from '../../domain/layout';
import { ZONE_COLOR } from '../colors';

/** 글씨를 쓸 구역 — 격리·출하대기·라이더 대기는 작아서 기존 이름표 */
export const BIG_NAME_KINDS = new Set(['FROZEN', 'CHILLED', 'AMBIENT', 'INBOUND_STORE', 'RECEIVING', 'OFFICE', 'PACKING']);

const WALL_TEXT_H = 2.6; // 벽(3 m)에 쓰는 글씨 판 높이
const FLOOR_TEXT_H = 2.6; // 바닥 글씨 판 길이(앞뒤)

function tint(hex: number): string {
  const c = new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.82);
  return `#${c.getHexString()}`;
}

/** 큰 이름(+ 작은 둘째 줄) 캔버스 */
function makeTexture(name: string, sub: string | null, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const big = 220;
  const small = 84;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const fBig = `800 ${big}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const fSmall = `700 ${small}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.font = fBig;
  const wBig = ctx.measureText(name).width;
  ctx.font = fSmall;
  const wSmall = sub ? ctx.measureText(sub).width : 0;
  c.width = Math.ceil(Math.max(wBig, wSmall) + big * 0.4);
  c.height = Math.ceil(big * 1.2 + (sub ? small * 1.3 : 0));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const draw = (t: string, font: string, y: number, lw: number) => {
    ctx.font = font;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = lw;
    ctx.strokeText(t, c.width / 2, y);
    ctx.fillStyle = color;
    ctx.fillText(t, c.width / 2, y);
  };
  draw(name, fBig, big * 0.62, big * 0.07);
  if (sub) draw(sub, fSmall, big * 1.2 + small * 0.55, small * 0.08);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

interface Placement {
  zone: Zone;
  /** 판 가운데 */
  pos: [number, number, number];
  rotX: number;
  w: number;
  h: number;
}

/** 구역 앞(z1) 벽 조각 중 문을 뺀 가장 긴 것 — 높이 2.5 m 이상(울타리 제외), 구역 폭 안 */
function frontWall(L: Layout, z: Zone): { x0: number; x1: number; face: number } | null {
  const r = z.rect;
  let best: { x0: number; x1: number; face: number } | null = null;
  for (const w of L.walls) {
    const wr = w.rect;
    if (w.height < 2.5 || wr.x1 - wr.x0 < wr.z1 - wr.z0) continue; // 가로(동서) 벽만
    const cz = (wr.z0 + wr.z1) / 2;
    if (Math.abs(cz - r.z1) > 0.35) continue;
    const x0 = Math.max(wr.x0, r.x0);
    const x1 = Math.min(wr.x1, r.x1);
    if (x1 - x0 < 2.5) continue;
    if (!best || x1 - x0 > best.x1 - best.x0) best = { x0, x1, face: wr.z1 + 0.02 };
  }
  return best;
}

export function placeZoneNames(L: Layout, aspectOf: (z: Zone) => number): Placement[] {
  const out: Placement[] = [];
  for (const z of L.zones) {
    if (!BIG_NAME_KINDS.has(z.kind)) continue;
    const r = z.rect;
    const a = aspectOf(z);
    const wall = frontWall(L, z);
    if (wall) {
      let h = WALL_TEXT_H;
      let w = h * a;
      const room = (wall.x1 - wall.x0) * 0.9;
      if (w > room) {
        w = room;
        h = w / a;
      }
      out.push({ zone: z, pos: [(wall.x0 + wall.x1) / 2, 0.15 + h / 2, wall.face], rotX: 0, w, h });
    } else {
      let h = FLOOR_TEXT_H;
      let w = h * a;
      const room = (r.x1 - r.x0) * 0.8;
      if (w > room) {
        w = room;
        h = w / a;
      }
      // 앞 가장자리 바깥 통로 바닥 — 랙이 덮지 않고, 가장자리의 장바구니 거치대·점원 이름표와 겹치지 않게 2 m 더 앞
      out.push({ zone: z, pos: [(r.x0 + r.x1) / 2, 0.02, r.z1 + 2.0 + h / 2], rotX: -Math.PI / 2, w, h });
    }
  }
  return out;
}

export function ZoneNames({ L }: { L: Layout }) {
  const items = useMemo(() => {
    const tex = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
    for (const z of L.zones) if (BIG_NAME_KINDS.has(z.kind)) tex.set(z.id, makeTexture(z.label, null, tint(ZONE_COLOR[z.kind]))); // 평수는 작아 안 읽혀 뺌(왼쪽 구역 패널에 있음)
    return placeZoneNames(L, (z) => tex.get(z.id)!.aspect).map((p) => ({ ...p, tex: tex.get(p.zone.id)!.tex }));
  }, [L]);
  return (
    <>
      {items.map((p) => (
        <mesh key={p.zone.id} position={p.pos} rotation={[p.rotX, 0, 0]} renderOrder={5}>
          <planeGeometry args={[p.w, p.h]} />
          <meshBasicMaterial map={p.tex} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ))}
    </>
  );
}
