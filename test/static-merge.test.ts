import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeStaticMeshes } from '../src/render/scene/StaticMerge';

// 성능(2026-11-22): 고정 장식을 같은 재질끼리 합칠 때 모양·위치·재질·그림자 설정이 그대로인지, 합치면 안 되는 것은 두는지
const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });

function worldBox(objs: THREE.Object3D[]): THREE.Box3 {
  const b = new THREE.Box3();
  for (const o of objs) {
    o.updateWorldMatrix(true, true);
    b.union(new THREE.Box3().setFromObject(o));
  }
  return b;
}

describe('mergeStaticMeshes', () => {
  it('같은 재질 Mesh 를 하나로 합치고 원본을 숨긴다 — 꼭짓점 자리·재질·그림자 그대로', () => {
    const parent = new THREE.Group();
    parent.position.set(5, 0, 3);
    const root = new THREE.Group();
    const dst = new THREE.Group();
    parent.add(root, dst);
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), std(0xff0000));
    a.position.set(1, 0, 0);
    a.castShadow = true;
    const sub = new THREE.Group();
    sub.position.set(0, 1, 0);
    sub.rotation.y = 0.7;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 2), std(0xff0000));
    b.position.set(0, 0, 2);
    b.castShadow = true;
    sub.add(b);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), std(0x00ff00)); // 다른 재질
    const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), std(0x00ff00));
    c2.position.x = -2;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std(0xff0000, { transparent: true, opacity: 0.5 }));
    const glass2 = glass.clone();
    const click = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std(0xff0000));
    click.userData.zoneId = 'A';
    const off = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std(0xff0000));
    off.visible = false;
    root.add(a, sub, c, c2, glass, glass2, click, off);
    const before = worldBox([a, b]);

    const r = mergeStaticMeshes(root, dst);
    expect(r.merged).toBe(2); // 빨강 상자 2개, 초록 원기둥 2개
    expect(r.replaced).toBe(4);
    expect(a.visible).toBe(false);
    expect(b.visible).toBe(false);
    expect(glass.visible && glass2.visible).toBe(true); // 투명은 그대로
    expect(click.visible).toBe(true); // 클릭 대상(userData)은 그대로
    expect(off.visible).toBe(false); // 숨겨져 있던 것은 손대지 않음

    const red = dst.children.find((m) => ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex() === 0xff0000) as THREE.Mesh;
    expect(red.material).toBe(a.material); // 같은 재질 객체
    expect(red.castShadow).toBe(true);
    const after = worldBox([red]);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(after.min[k]).toBeCloseTo(before.min[k], 5);
      expect(after.max[k]).toBeCloseTo(before.max[k], 5);
    }
    expect(red.geometry.index!.count).toBe(a.geometry.index!.count + b.geometry.index!.count); // 삼각형 수 그대로

    r.undo();
    expect(dst.children.length).toBe(0);
    expect(a.visible && b.visible && c.visible && c2.visible).toBe(true);
    expect(off.visible).toBe(false);
  });

  it('그림자 설정이 다르면 따로 묶는다', () => {
    const root = new THREE.Group();
    const dst = new THREE.Group();
    const m = std(0x123456);
    const p = [0, 1, 2, 3].map((i) => {
      const x = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
      x.position.x = i;
      x.castShadow = i < 2;
      root.add(x);
      return x;
    });
    const r = mergeStaticMeshes(root, dst);
    expect(r.merged).toBe(2);
    expect(dst.children.map((x) => (x as THREE.Mesh).castShadow).sort()).toEqual([false, true]);
    expect(p.every((x) => !x.visible)).toBe(true);
  });
});
