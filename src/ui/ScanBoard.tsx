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

const SCAN_STATES = new Set(['READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED']);

/** 화면에 나온 PICK 의 상품 바코드를 서버에서 (SKU 마다 한 번) 읽게 한다 */
export function useSkuBarcodes(tasks: (RealTask | undefined)[]) {
  const { sim } = useApp();
  const real = sim.real;
  const skus = tasks.filter((t): t is RealTask => !!t && t.summary.taskType === 'PICK' && !!t.detail).flatMap((t) => t.detail!.lines.map((l) => l.sku));
  const skuKey = [...new Set(skus)].sort().join(',');
  useEffect(() => {
    if (real && skuKey) real.requestSkuBarcodes(skuKey.split(','));
  }, [real, skuKey]);
}

export function CartBarcodes() {
  return (
    <div className="bc-grid">
      {BACKEND_FACTS.cartLocations.map((c) => (
        <Barcode key={c.code} value={c.code} caption={c.label} height={44} />
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
          <Barcode key={c} value={c} caption="포장 위치(집품분)" height={44} />
        ))}
        <Barcode value="DSP-A-01" caption="출하대기 랙 1" height={44} />
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
        return (
          <div className="scan-stop" key={`${l.orderLineId}:${p.lotId}`}>
            <div className="sub">
              {p.visitSeq != null ? `${p.visitSeq}번째 · ` : ''}
              {l.productName ?? l.sku} × {p.remainingQty}
              {p.remainingQty === 0 ? ' (집음)' : ''}
            </div>
            <div className="bc-grid">
              {loc ? <Barcode value={loc} caption="위치" height={44} /> : <div className="note">지시 칸 없음</div>}
              {bc === 'LOADING' || bc === undefined ? (
                <div className="note">상품 바코드 읽는 중…</div>
              ) : bc === 'ERR' ? (
                <div className="note warn">상품 조회 실패 ({l.sku})</div>
              ) : bc.length === 0 ? (
                <div className="note warn">{l.sku} 바코드 없음(서버 상품 데이터)</div>
              ) : (
                bc.map((v) => <Barcode key={v} value={v} kind={/^\d{13}$/.test(v) ? 'ean13' : 'code128'} caption={`상품 ${l.sku}`} height={44} />)
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function ScanBoard() {
  const { sim } = useApp();
  const real = sim.real;
  const tasks = real
    ? [...real.tasks.values()]
        .filter((t) => !t.closed && t.detail && SCAN_STATES.has(t.summary.state) && (t.summary.taskType === 'PICK' || t.summary.taskType === 'PACK'))
        .sort((a, b) => (a.summary.createdAt < b.summary.createdAt ? -1 : 1))
    : [];
  useSkuBarcodes(tasks);

  return (
    <div className="scan">
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

      <h4>카트</h4>
      <CartBarcodes />

      {!real && <div className="note">실서버 모드에서는 진행 중인 실제 주문의 지시 칸·상품 바코드가 여기에 나옵니다. 선반 칸을 클릭하면 그 칸의 위치 바코드가 카드에 나옵니다.</div>}
      {real && !tasks.length && <div className="note">{sim.params.mfcId} 에 바코드를 찍을 PICK·PACK 작업이 없습니다.</div>}
      {tasks.map((t) => (
        <div className="scan-task" key={t.summary.taskId}>
          <h4>
            {t.summary.taskType} · {t.summary.shipmentId ?? t.summary.fulfillmentId} · {TASK_STATE_KO[t.summary.state]} · {real!.workerName(t.summary.assignment?.workerId)}
          </h4>
          <TaskBarcodes t={t} />
        </div>
      ))}
    </div>
  );
}
