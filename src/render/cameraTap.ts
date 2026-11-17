// 3D 카메라를 화면(DOM) 쪽에서 쓰게 넘겨 둔다 — 3D 위치 위에 HTML(스캔 말풍선)을 띄울 때 좌표 변환용.
import type * as THREE from 'three';

export const cameraTap: { camera: THREE.Camera | null; width: number; height: number } = { camera: null, width: 0, height: 0 };
