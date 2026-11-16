// 스캔 판: PDA 앱으로 찍을 바코드를 화면에 띄운다(사용자 2026-11-16 "바로 클릭하면 보이게", "실제 주문건 눌렀을때 그 바코드 뜨게").
// - 인쇄용 전체 라벨: 백엔드가 만든 카트·위치 라벨(개발 서버 /labels/ — 읽기만)
// - 카트 4장(Code128, 값 = 위치 코드)
// - 실서버: 진행 중 PICK 의 지시 칸(Code128)·상품(EAN-13, GET /skus/{sku} 의 barcodes), PACK 의 포장 위치
import { useEffect } from 'react';
import { useApp } from '../app/context';
import { BACKEND_FACTS } from '../config';
import type { RealTask } from '../sim/realBoard';
import { Barcode } from './Barcode';
import { TASK_STATE_KO } from './RealPanel';
import { useScanFocus } from './scanFocus';
import { scanView, useScanView } from './scanView';

const SCAN_STATES = new Set(['READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED']);

/** 화면에 나온 PICK 의 상품 바코드를 서버에서 (SKU 마다 한 번) 읽게 한다 */
const kindOf = (v: string) => (/^\d{13}$/.test(v) ? 'ean13' : 'code128');

export function useSkuBarcodes(tasks: (RealTask | undefined)[]) {
  const { sim } = useApp();
  const real = sim.real;
  const skus = tasks.filter((t): t is RealTask => !!t && t.summary.taskType === 'PICK' && !!t.detail).flatMap((t) => t.detail!.lines.map((l) => l.sku));
  const skuKey = [...new Set(skus)].sort().join(',');
  useEffect(() => {
    if (real && skuKey) real.requestSkuBarcodes(skuKey.split(','));
  }, [real, skuKey]);
}

/** 위치 코드 바코드 — 누르면 3D 에서 그 칸(자리)으로 */
function LocBarcode({ code, caption }: { code: string; caption: string }) {
  const { controller } = useApp();
  return <Barcode value={code} caption={caption} height={44} onGo={() => controller.focusBackendCode(code)} />;
}

export function CartBarcodes() {
  return (
    <div className="bc-grid">
      {BACKEND_FACTS.cartLocations.map((c) => (
        <LocBarcode key={c.code} code={c.code} caption={c.label} />
      ))}
    </div>
  );
}

/** 작업 하나의 찍을 바코드 — PICK: 방문 순서별 지시 칸 + 상품, PACK: 포장 위치 + 출하대기 랙 */
export function TaskBarcodes({ t }: { t: RealTask }) {
  const { sim } = useApp();
  const real = sim.real!;
  const s = t.summary;
  const d = t.detail;
  if (!d) return <div className="note">작업 상세를 읽는 중…</div>;
  if (s.taskType === 'PACK') {
    return (
      <div className="bc-grid">
        {(d.packingLocations ?? []).map((c) => (
          <LocBarcode key={c} code={c} caption="포장 위치(집품분)" />
        ))}
        <LocBarcode code="DSP-A-01" caption="출하대기 랙 1" />
      </div>
    );
  }
  if (s.taskType !== 'PICK') return <div className="note">{s.taskType} 작업은 바코드 판이 없습니다.</div>;
  const stops = d.lines
    .flatMap((l) =>
      (l.picks ?? []).map((p) => {
        const locs = p.locations ?? [];
        const loc = (locs.find((x) => (x.allocatedQty ?? 0) > 0) ?? locs[0])?.locationCode ?? l.locationId;
        return { l, p, loc, seq: p.visitSeq ?? 9999 };
      }),
    )
    .sort((a, b) => a.seq - b.seq);
  if (!stops.length) return <div className="note">지시 칸이 아직 없습니다(피킹 시작 뒤 방문 순서가 정해집니다).</div>;
  return (
    <>
      {stops.map(({ l, p, loc }) => {
        const bc = real.skuBarcodes.get(l.sku);
        // 작업 지시 바코드 중 첫 값 말고 나머지(0.7.0 barcodes) — 계약은 "barcodes 중 하나면 같은 상품"
        const more = (l.barcodes ?? []).filter((v) => v !== l.barcode);
        return (
          <div className="scan-stop" key={`${l.orderLineId}:${p.lotId}`}>
            <div className="sub">
              {p.visitSeq != null ? `${p.visitSeq}번째 · ` : ''}
              {l.productName ?? l.sku} × {p.remainingQty}
              {p.remainingQty === 0 ? ' (집음)' : ''}
            </div>
            <div className="bc-grid">
              {loc ? <LocBarcode code={loc} caption="위치 (누르면 3D 에서 그 칸)" /> : <div className="note">지시 칸 없음</div>}
              {/* PDA 앱은 찍은 값을 작업 지시 줄의 barcode 와 비교한다(mfc_app task_controllers scan, 클라이언트 3cab409 기준 첫 값만) — 그 값을 먼저 보인다 */}
              {l.barcode ? (
                <>
                  <Barcode value={l.barcode} kind={kindOf(l.barcode)} caption={`상품 ${l.sku} (작업 지시 바코드)`} height={44} />
                  {more.map((v) => (
                    <Barcode key={v} value={v} kind={kindOf(v)} caption={`상품 ${l.sku} (같은 상품 다른 바코드)`} height={44} />
                  ))}
                </>
              ) : bc === 'LOADING' || bc === undefined ? (
                <div className="note">상품 바코드 읽는 중…</div>
              ) : bc === 'ERR' ? (
                <div className="note warn">상품 조회 실패 ({l.sku})</div>
              ) : bc.length === 0 ? (
                <div className="note warn">{l.sku} 바코드 없음(서버 상품 데이터)</div>
              ) : (
                bc.map((v) => <Barcode key={v} value={v} kind={kindOf(v)} caption={`상품 ${l.sku} (상품 정보 — 참고)`} height={44} />)
              )}
            </div>
            {!l.barcode && (
              <div className="note warn">
                이 작업 지시 줄에 상품 바코드가 비어 있습니다 — PDA 는 찍은 값을 작업 지시 바코드와 비교하므로 "다른 상품"이 됩니다. 서버(0.7.0)는 조회 때 채우므로 비어 있으면 재고 서비스 조회 실패이거나 그 상품의 바코드가 없는 것입니다. 위 바코드는 상품 정보의 값(참고)입니다.
              </div>
            )}
            {more.length > 0 && <div className="note">PDA 앱은 지금 첫 바코드({l.barcode})로만 비교합니다 — 다른 바코드는 앱이 barcodes 전체로 비교하게 바뀌면 맞습니다.</div>}
            {l.barcode && Array.isArray(bc) && bc.length > 0 && !bc.includes(l.barcode) && (
              <div className="note warn">작업 지시 바코드({l.barcode})가 지금 상품 정보 바코드({bc.join(', ')})와 다릅니다 — PDA 는 작업 지시 바코드로 비교합니다.</div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function ScanBoard() {
  const { sim } = useApp();
  const focus = useScanFocus();
  const view = useScanView();
  const real = sim.real;
  // 실제 주문 줄에서 고른 출고면 그 출고의 PICK·PACK(끝난 것도), 아니면 진행 중 작업 전부
  const tasks = real
    ? [...real.tasks.values()]
        .filter((t) => (t.summary.taskType === 'PICK' || t.summary.taskType === 'PACK') && t.detail)
        .filter((t) => (focus.shipmentId ? t.summary.shipmentId === focus.shipmentId : !t.closed && SCAN_STATES.has(t.summary.state)))
        .sort((a, b) => a.summary.createdAt.localeCompare(b.summary.createdAt) || (a.summary.taskType === b.summary.taskType ? 0 : a.summary.taskType === 'PICK' ? -1 : 1))
    : [];
  useSkuBarcodes(tasks);

  return (
    <div className="scan">
      <div className="scan-mode">
        <button className={view.mode === 'qr' ? 'on' : undefined} onClick={() => scanView.setMode('qr')}>
          QR
        </button>
        <button className={view.mode === 'bar' ? 'on' : undefined} onClick={() => scanView.setMode('bar')}>
          바코드
        </button>
        <span className="sub">값은 같음 · 위치 코드를 누르면 3D 에서 그 칸으로 · "크게" = 화면 가득</span>
      </div>
      <div className="note">
        PDA 앱 입력칸의 카메라 버튼으로 화면을 찍거나, PC 브라우저라면 입력칸에 아래 글자를 치고 Enter. 인쇄용 전체 라벨:{' '}
        <a href="/labels/cart-labels-MFC-SEED-01.html" target="_blank" rel="noreferrer">
          카트 4장
        </a>{' '}
        ·{' '}
        <a href="/labels/locations/index.html" target="_blank" rel="noreferrer">
          위치 6,811곳 목록
        </a>
        (백엔드 deploy/lan/seed/labels)
      </div>

      {focus.shipmentId && (
        <div className="scan-focus">
          <b>주문 {focus.shipmentId}</b>
          <button className="btn ghost" onClick={focus.clear}>
            진행 중 전체 보기
          </button>
        </div>
      )}
      <h4>카트 (피킹 때 찍은 카트를 패킹 때 다시 찍음)</h4>
      <CartBarcodes />

      {!real && <div className="note">실서버 모드에서는 진행 중인 실제 주문의 지시 칸·상품 바코드가 여기에 나옵니다. 선반 칸을 클릭하면 그 칸의 위치 바코드가 카드에 나옵니다.</div>}
      {real && !tasks.length && (
        <div className="note">{focus.shipmentId ? '이 주문의 작업이 화면에서 빠졌습니다.' : `${sim.params.mfcId} 에 바코드를 찍을 PICK·PACK 작업이 없습니다. 실제 주문 탭에서 주문 줄을 누르면 그 주문의 바코드가 여기에 나옵니다.`}</div>
      )}
      {tasks.map((t) => (
        <div className="scan-task" key={t.summary.taskId}>
          <h4>
            {t.summary.taskType} · {t.summary.shipmentId ?? t.summary.fulfillmentId} · {TASK_STATE_KO[t.closed ? t.closed.state : t.summary.state]} · {real!.workerName(t.summary.assignment?.workerId)}
          </h4>
          <TaskBarcodes t={t} />
        </div>
      ))}
    </div>
  );
}
