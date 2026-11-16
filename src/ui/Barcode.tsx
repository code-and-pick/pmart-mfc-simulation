// 화면에 띄우는 코드(PDA 카메라로 모니터를 찍는 용도). 값은 같고 모양만 QR 또는 1차원 바코드(위치·카트 Code128, 상품 EAN-13).
// PDA 앱 카메라(ML Kit)는 형식 제한 없이 읽으므로 QR 로 띄워도 같은 값이 들어간다. 인쇄 라벨은 백엔드 Code128 그대로.
import { code128, ean13, type Bars } from '../domain/barcode';
import { qrEncode } from '../domain/qr';
import { scanView, useScanView, type ScanCodeMode } from './scanView';

/** 1차원 바코드 한 장의 최대 화면 폭(CSS px) — 오른쪽 패널에 들어가게 */
const MAX_CSS_WIDTH = 380;

const dprNow = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

/** 코드 그림만(테두리·글자 없음). size: QR 은 한 변 CSS px, 1차원은 최대 폭 */
export function CodeImage({ value, kind, mode, size, height = 56 }: { value: string; kind: 'code128' | 'ean13'; mode: ScanCodeMode; size: number; height?: number }) {
  const dpr = dprNow();
  if (mode === 'qr') {
    const q = qrEncode(value);
    if (!q) return <div className="bc bad">QR 로 만들 수 없는 값: {value}</div>;
    const quiet = 4;
    const n = q.size + quiet * 2;
    // 1 모듈 = 장치 픽셀 정수 개
    const dev = Math.max(2, Math.floor((size * dpr) / n));
    const css = (n * dev) / dpr;
    return (
      <svg viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" style={{ width: css, height: css, display: 'block' }}>
        <rect width={n} height={n} fill="#fff" />
        {q.dark.flatMap((row, y) => row.map((d, x) => (d ? <rect key={`${x},${y}`} x={x + quiet} y={y + quiet} width={1} height={1} fill="#000" /> : null)))}
      </svg>
    );
  }
  const b: Bars | null = kind === 'ean13' ? ean13(value) : code128(value);
  if (!b) return <div className="bc bad">그릴 수 없는 값: {value}{kind === 'ean13' ? ' (EAN-13 검사 숫자가 맞지 않음)' : ''}</div>;
  const q = 10;
  const w = b.modules + q * 2;
  // 1 모듈 = 장치 픽셀 정수 개 — 소수 배율이면 막대 폭이 들쭉날쭉해져 카메라가 잘 못 읽는다
  const dev = Math.max(2, Math.min(Math.round(3 * dpr), Math.floor((size * dpr) / w)));
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" shapeRendering="crispEdges" style={{ width: (w * dev) / dpr, height, display: 'block' }}>
      <rect width={w} height={height} fill="#fff" />
      {b.bars.map(([x, bw]) => (
        <rect key={x} x={x + q} y={0} width={bw} height={height} fill="#000" />
      ))}
    </svg>
  );
}

export function Barcode({
  value,
  kind = 'code128',
  caption,
  height = 56,
  onGo,
}: {
  value: string;
  kind?: 'code128' | 'ean13';
  caption?: string;
  height?: number;
  /** 누르면 3D 에서 그 위치로(위치·카트 코드). 없으면 누르면 크게 */
  onGo?: () => void;
}) {
  const v = useScanView();
  const zoom = () => scanView.open({ value, kind, caption });
  return (
    <div className={`bc${onGo ? ' go' : ''}`} title={onGo ? `${value} — 누르면 3D 에서 그 위치로` : `${value} — 누르면 크게`}>
      {caption && <div className="bc-cap">{caption}</div>}
      <div className="bc-img" onClick={onGo ?? zoom}>
        <CodeImage value={value} kind={kind} mode={v.mode} size={v.mode === 'qr' ? 120 : MAX_CSS_WIDTH} height={height} />
      </div>
      <div className="bc-val">
        {value}
        <button className="bc-zoom" onClick={zoom} title="화면 가득 크게">
          크게
        </button>
      </div>
    </div>
  );
}

/** 화면 가득 크게 — 누르거나 Esc 로 닫는다 */
export function ScanZoom() {
  const v = useScanView();
  const z = v.zoom;
  if (!z) return null;
  const vw = typeof window === 'undefined' ? 800 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 600 : window.innerHeight;
  return (
    <div className="scan-zoom" onClick={() => scanView.close()} onKeyDown={(e) => e.key === 'Escape' && scanView.close()} tabIndex={-1} ref={(el) => el?.focus()}>
      <div className="scan-zoom-box">
        {z.caption && <div className="bc-cap">{z.caption}</div>}
        <CodeImage value={z.value} kind={z.kind} mode={v.mode} size={v.mode === 'qr' ? Math.min(vw, vh) * 0.6 : vw * 0.85} height={Math.round(vh * 0.28)} />
        <div className="bc-val big">{z.value}</div>
        <div className="note">누르거나 Esc 로 닫기 · 위의 QR/바코드 전환은 스캔 판 위쪽 단추</div>
      </div>
    </div>
  );
}
