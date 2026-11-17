// 스캔 판 표시 상태: QR/1차원 바코드 전환, "크게" 보기. 여러 패널·오버레이가 같이 본다(React 상태 밖 작은 저장소).
import { useSyncExternalStore } from 'react';

export type ScanCodeMode = 'qr' | 'bar';
export interface ZoomCode {
  value: string;
  /** qr = 늘 QR(LOT 라벨 — 실물 라벨이 QR). 그 밖은 QR/바코드 전환을 따른다 */
  kind: 'code128' | 'ean13' | 'qr';
  caption?: string;
}

let mode: ScanCodeMode = 'qr';
let zoom: ZoomCode | null = null;
let ver = 0;
const subs = new Set<() => void>();
const emit = () => {
  ver++;
  subs.forEach((f) => f());
};

export const scanView = {
  get mode() {
    return mode;
  },
  get zoom() {
    return zoom;
  },
  setMode(m: ScanCodeMode) {
    mode = m;
    emit();
  },
  open(z: ZoomCode) {
    zoom = z;
    emit();
  },
  close() {
    zoom = null;
    emit();
  },
};

export function useScanView() {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => ver,
  );
  return scanView;
}
