// 화면에 띄우는 바코드(PDA 카메라로 모니터를 찍는 용도). 흰 바탕·조용한 여백 10 모듈·글자 표시.
import { code128, ean13, type Bars } from '../domain/barcode';

export function Barcode({ value, kind = 'code128', caption, height = 56 }: { value: string; kind?: 'code128' | 'ean13'; caption?: string; height?: number }) {
  const b: Bars | null = kind === 'ean13' ? ean13(value) : code128(value);
  if (!b) return <div className="bc bad">그릴 수 없는 값: {value}{kind === 'ean13' ? ' (EAN-13 검사 숫자가 맞지 않음)' : ''}</div>;
  const q = 10;
  const w = b.modules + q * 2;
  return (
    <div className="bc" title={value}>
      {caption && <div className="bc-cap">{caption}</div>}
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" shapeRendering="crispEdges" style={{ width: Math.min(360, w * 2.4), height }}>
        <rect width={w} height={height} fill="#fff" />
        {b.bars.map(([x, bw]) => (
          <rect key={x} x={x + q} y={0} width={bw} height={height} fill="#000" />
        ))}
      </svg>
      <div className="bc-val">{value}</div>
    </div>
  );
}
