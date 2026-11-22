// 고정 장식 묶기(draw call 줄이기) — 감싼 자식 Mesh 들을 "같은 재질"끼리 지오메트리 하나로 합쳐 그리고, 원본은 숨긴다.
// 모양·색·재질·그림자 설정은 원본 그대로(같은 재질 객체를 그대로 씀, 지오메트리는 원본을 복사해 위치만 굽는다) — 화면은 같고 그리기 호출만 준다.
//
// 안전 규칙(합치지 않고 원본 그대로 두는 것):
//  - 투명 재질(transparent) — 합치면 서로 겹친 면의 그리는 순서가 바뀌어 색이 달라질 수 있다
//  - userData 가 있는 Mesh(클릭·이름표 겹침 판정 등에 쓰는 것), InstancedMesh, 이미 숨긴 Mesh
//  - 배열 재질, 지오메트리 속성이 달라 합칠 수 없는 것(합치기 실패하면 그 묶음은 원본 그대로)
// 감싼 내용은 처음 그린 뒤 바뀌지 않는 것(장식·시설)만 — 매 프레임 움직이는 부품(팔·다리 등)이 든 것은 감싸지 않는다.
// 감싼 묶음 전체를 옮기거나 숨기는 것(부모 group 이동·visible)은 그대로 된다(합친 Mesh 가 같은 부모 아래에 있음).
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function matKey(m: THREE.Material): string | null {
  if (m.transparent) return null;
  const a = m as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
  return [
    m.type,
    a.color?.getHex(),
    a.roughness,
    a.metalness,
    a.emissive?.getHex(),
    a.emissiveIntensity,
    a.map?.uuid ?? '',
    m.side,
    m.depthWrite,
    m.depthTest,
    m.toneMapped,
    m.polygonOffset,
    m.polygonOffsetFactor,
    a.flatShading,
    m.vertexColors,
    m.opacity,
    m.visible,
  ].join('|');
}

function shownInside(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * root 아래 Mesh 를 같은 재질끼리 합쳐 dst 에 넣고 원본을 숨긴다. 되돌리는 함수를 돌려준다.
 * root·dst 는 같은 부모 아래 같은 변환(보통 둘 다 원점)이어야 한다 — 지오메트리를 root 기준 좌표로 굽는다.
 */
export function mergeStaticMeshes(root: THREE.Object3D, dst: THREE.Object3D): { merged: number; replaced: number; undo: () => void } {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; order: number; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || (o as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (Object.keys(o.userData).length || Array.isArray(m.material) || !shownInside(o, root)) return;
    const mk = matKey(m.material as THREE.Material);
    if (!mk) return;
    const g = m.geometry;
    const attrs = Object.keys(g.attributes).sort().join(',');
    const key = `${mk}#${attrs}#${g.index ? 'i' : 'n'}#${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}#${m.renderOrder}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: m.material as THREE.Material, cast: m.castShadow, recv: m.receiveShadow, order: m.renderOrder, meshes: [] }));
    b.meshes.push(m);
  });
  const made: THREE.Mesh[] = [];
  const hidden: THREE.Mesh[] = [];
  const tmp = new THREE.Matrix4();
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue; // 하나뿐이면 합쳐도 줄지 않는다
    const geos = b.meshes.map((m) => m.geometry.clone().applyMatrix4(tmp.multiplyMatrices(inv, m.matrixWorld)));
    let merged: THREE.BufferGeometry | null = null;
    try {
      merged = mergeGeometries(geos, false);
    } catch {
      merged = null;
    }
    for (const g of geos) g.dispose();
    if (!merged) continue; // 합칠 수 없으면 원본 그대로
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.renderOrder = b.order;
    mesh.raycast = () => {}; // 장식 — 클릭 판정에서 빠진다(클릭에 쓰는 것은 userData 가 있어 합치지 않음)
    mesh.userData.staticMerged = b.meshes.length;
    dst.add(mesh);
    made.push(mesh);
    for (const m of b.meshes) {
      m.visible = false;
      hidden.push(m);
    }
  }
  return {
    merged: made.length,
    replaced: hidden.length,
    undo: () => {
      for (const m of made) {
        dst.remove(m);
        m.geometry.dispose();
      }
      for (const m of hidden) m.visible = true;
    },
  };
}

export function StaticMerge({ children }: { children: ReactNode }) {
  const src = useRef<THREE.Group>(null!);
  const out = useRef<THREE.Group>(null!);
  useLayoutEffect(() => mergeStaticMeshes(src.current, out.current).undo, []);
  return (
    <>
      <group ref={src}>{children}</group>
      <group ref={out} />
    </>
  );
}
