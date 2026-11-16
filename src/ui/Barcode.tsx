// 화면에 띄우는 바코드(PDA 카메라로 모니터를 찍는 용도). 흰 바탕·조용한 여백 10 모듈·글자 표시.
import { code128, ean13, type Bars } from '../domain/barcode';

/** 바코드 한 장의 최대 화면 폭(CSS px) — 오른쪽 패널에 들어가게 */
const MAX_CSS_WIDTH = 380;

export function Barcode({ value, kind = 'code128', caption, height = 56 }: { value: string; kind?: 'code128' | 'ean13'; caption?: string; height?: number }) {
  const b: Bars | null = kind === 'ean13' ? ean13(value) : code128(value);
  if (!b) return <div className="bc bad">그릴 수 없는 값: {value}{kind === 'ean13' ? ' (EAN-13 검사 숫자가 맞지 않음)' : ''}</div>;
  const q = 10;
  const w = b.modules + q * 2;
  // 1 모듈 = 화면 픽셀(장치 픽셀) 정수 개 — 소수 배율이면 막대 폭이 들쭉날쭉해져 카메라가 잘 못 읽는다. 기본 3 장치 픽셀, 넓으면 줄이되 2 이상
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const devPerModule = Math.max(2, Math.min(Math.round(3 * dpr), Math.floor((MAX_CSS_WIDTH * dpr) / w)));
  const cssWidth = (w * devPerModule) / dpr;
  return (
    <div className="bc" title={value}>
      {caption && <div className="bc-cap">{caption}</div>}
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" shapeRendering="crispEdges" style={{ width: cssWidth, height }}>
        <rect width={w} height={height} fill="#fff" />
        {b.bars.map(([x, bw]) => (
          <rect key={x} x={x + q} y={0} width={bw} height={height} fill="#000" />
        ))}
      </svg>
      <div className="bc-val">{value}</div>
    </div>
  );
}
