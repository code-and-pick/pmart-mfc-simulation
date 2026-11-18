// 실제 주문 줄 → "바코드" 탭: 고른 출고와 탭 넘기기를 오른쪽 패널 안에서 나눠 쓴다.
import { createContext, useContext } from 'react';

export interface ScanFocus {
  /** 바코드 탭에 보일 출고(없으면 진행 중 작업 전부) */
  shipmentId: string | null;
  /** 그 출고를 고른다(탭은 그대로 — 바코드 탭·3D 말풍선이 그 주문을 본다) */
  show: (shipmentId: string) => void;
  clear: () => void;
}

export const ScanFocusContext = createContext<ScanFocus>({ shipmentId: null, show: () => {}, clear: () => {} });

export const useScanFocus = () => useContext(ScanFocusContext);
