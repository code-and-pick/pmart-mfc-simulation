// 스캔 판: PDA 앱으로 찍을 바코드를 화면에 띄운다(사용자 2026-11-16 "바로 클릭하면 보이게", "실제 주문건 눌렀을때 그 바코드 뜨게").
// - 인쇄용 전체 라벨: 백엔드가 만든 카트·위치 라벨(개발 서버 /labels/ — 읽기만)
// - 카트 40대(Code128, 값 = 위치 코드 CRT-A-01~40, 온도 구분 없음 — 백엔드 0cbfecaa)
// - 실서버: 고른 주문 PICK 의 지시 칸(Code128)·상품(EAN-13, GET /skus/{sku} 의 barcodes)·LOT 라벨(QR `LOT:{lotId}`), PACK 의 포장 위치
import { OrderNo } from './OrderNo';
import { useEffect } from 'react';
import { useApp } from '../app/context';
import { lotGs1 } from '../domain/barcode';
import { BACKEND_FACTS } from '../config';
import type { TaskLine, TaskPick } from '../domain/contract';
import type { RealTask } from '../sim/realBoard';
import { Barcode } from './Barcode';
import { OrderTimeline } from './OrderTimeline';
import { TASK_STATE_KO } from './RealPanel';
import { useScanFocus } from './scanFocus';
import { scanView, useScanView } from './scanView';
import { Why } from './Why';

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

/** 장바구니 40대(온도 구분 없음) — 10대씩 접어 둔다. PDA 는 CRT- 면 어느 카트든 받고, 찍은 카트가 그 주문의 장바구니가 된다 */
export function CartBarcodes() {
  const all = BACKEND_FACTS.cartLocations;
  const groups = Array.from({ length: Math.ceil(all.length / 10) }, (_, i) => all.slice(i * 10, i * 10 + 10));
  return (
    <>
      {groups.map((carts, gi) => {
        return (
          <details key={gi} open={gi === 0}>
            <summary>
              카트 {carts[0]?.code} ~ {carts[carts.length - 1]?.code} ({carts.length}대)
            </summary>
            <div className="bc-grid">
              {carts.map((c) => (
                <LocBarcode key={c.code} code={c.code} caption={c.label} />
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}

/** LOT 라벨(GS1-128) — 피킹 지시의 LOT 번호·소비기한과 줄 상품 바코드로 만든다(서버 조회 없음) */
export function LotLabel({ l, p, height }: { l: TaskLine; p: TaskPick; height: number }) {
  if (!p.lotNo) return <div className="note">LOT 번호 없음(fulfillment 0.11.0 전 작업이거나 재고 조회 실패) — LOT 라벨을 그릴 수 없습니다</div>;
  const v = lotGs1(l.barcodes?.length ? l.barcodes : l.barcode ? [l.barcode] : [], p.lotNo, p.expiresOn);
  if (!v) return <div className="note">숫자 상품 바코드가 없어 LOT 라벨(GS1)을 만들 수 없습니다 — LOT {p.lotNo}</div>;
  return <Barcode value={v} kind="gs1" caption={`LOT 라벨 ${p.lotNo}${p.expiresOn ? ` · 기한 ${p.expiresOn}` : ''} (PDA 전환 뒤 — C-2)`} height={height} />;
}

/** 작업 하나의 찍을 바코드 — PICK: 방문 순서별 지시 칸 + 상품, PACK: 포장 위치 + 출하대기 랙 */
export function TaskBarcodes({ t }: { t: RealTask }) {
  const { sim } = useApp();
  const real = sim.real!;
  const s = t.summary;
  const d = t.detail;
  if (!d) return <div className="note">작업 상세를 읽는 중…</div>;
  if (s.taskType === 'PACK') {
    // 포장: PDA 포장 화면 순서(packing_screen.dart) ① 패킹대 → ② 카트 → ③ 배차 요청(바코드 없음) → ④ 담기(상품) → ⑤ 출하대기 랙
    const seen = s.shipmentId ? real.picksOf(s.shipmentId) : [];
    const locs = d.packingLocations ?? [];
    const station = locs.find((c) => c.startsWith('PAK-')) ?? 'PAK-A-01';
    const carts = locs.filter((c) => c.startsWith('CRT-'));
    return (
      <>
        <div className="bc-grid">
          <LocBarcode code={station} caption="① 패킹대 (PDA 는 PAK- 면 받음)" />
          {carts.length ? (
            carts.map((c) => <LocBarcode key={c} code={c} caption="② 카트 (이 주문을 담은 장바구니)" />)
          ) : (
            <div className="note">② 카트 — 서버가 아직 모름(집품 전)</div>
          )}
          <div className="note">③ 배차 요청 — 찍을 바코드 없음(PDA 에서 예상 포장 시간)</div>
        </div>
        {d.lines
          .filter((l) => l.plannedQty - l.cancelledQty > 0)
          .map((l) => (
            <div className="scan-stop" key={l.orderLineId}>
              <div className="sub">
                ④ 담기 · {l.productName ?? l.sku} × {l.plannedQty - l.cancelledQty}
              </div>
              <div className="bc-grid">
                <ProductBarcodes l={l} />
                {seen
                  .filter((x) => x.line.orderLineId === l.orderLineId)
                  .map((x) => (
                    <LotLabel key={x.pick.lotId} l={l} p={x.pick} height={44} />
                  ))}
              </div>
              <ProductBarcodeNotes l={l} />
            </div>
          ))}
        <div className="bc-grid">
          {/* 출하대기 랙 2곳(백엔드 deploy/lan/seed/mfc_layout.py DISPATCH_STAGING) — PDA 는 DSP- 면 어느 랙이든 받고 서버에 보내지 않는다 */}
          <LocBarcode code="DSP-A-01" caption="⑤ 출하대기 랙 1 (밀봉 뒤)" />
          <LocBarcode code="DSP-A-02" caption="⑤ 출하대기 랙 2 (밀봉 뒤, 둘 중 하나)" />
        </div>
      </>
    );
  }
  if (s.taskType === 'RETURN') {
    // 취소품 복귀: 조각마다 출발 위치(장바구니·패킹대) → 상품 → 돌려놓을 추천 선반 칸(PDA 복귀 화면 순서)
    const pieces = d.lines.flatMap((l) => (l.picks ?? []).filter((p) => (p.remainingQty ?? 0) > 0).map((p) => ({ l, p })));
    if (!pieces.length) return <div className="note">옮길 조각이 없습니다(다 옮겼거나 확정 대기).</div>;
    return (
      <>
        {pieces.map(({ l, p }) => {
          const from = p.locations.find((c) => (c.qty ?? 0) > 0)?.locationCode;
          return (
            <div className="scan-stop" key={`${l.orderLineId}:${p.lotId}`}>
              <div className="sub">
                {l.productName ?? l.sku} × {p.remainingQty} 복귀
              </div>
              <div className="bc-grid">
                {from ? <LocBarcode code={from} caption="① 출발 위치(취소된 집품분)" /> : <div className="note">출발 위치 없음</div>}
                {l.barcode ? <Barcode value={l.barcode} kind={kindOf(l.barcode)} caption={`② 상품 ${l.sku} (싣기)`} height={44} /> : <div className="note warn">상품 바코드 없음</div>}
                {(p.suggestedToLocations ?? []).map((c, i) => (
                  <LocBarcode key={c} code={c} caption={i === 0 ? '③ 돌려놓을 선반 칸(추천)' : '다른 추천 칸'} />
                ))}
              </div>
            </div>
          );
        })}
      </>
    );
  }
  if (s.taskType !== 'PICK') return <div className="note">{s.taskType} 작업은 바코드 판이 없습니다.</div>;
  // 서버는 다 집은 조각을 상세 picks 에서 뺀다 — 본 조각(RealBoard.seenPicks)으로 집은 칸도 패킹까지 남긴다
  const seen = s.shipmentId ? real.picksOf(s.shipmentId) : [];
  const stops = seen.length
    ? seen.map((x) => ({ l: x.line, p: x.pick, loc: x.loc, gone: x.gone }))
    : d.lines
        .flatMap((l) =>
          (l.picks ?? []).map((p) => {
            const locs = p.locations ?? [];
            const loc = (locs.find((x) => (x.allocatedQty ?? 0) > 0) ?? locs[0])?.locationCode ?? l.locationId;
            return { l, p, loc, gone: false };
          }),
        )
        .sort((a, b) => (a.p.visitSeq ?? 9999) - (b.p.visitSeq ?? 9999));
  if (!stops.length)
    return <div className="note">{t.closed || t.summary.state === 'COMPLETED' ? '피킹 끝 — 더 찍을 것 없음' : '지시 칸이 아직 없습니다(피킹 시작 뒤 방문 순서가 정해집니다).'}</div>;
  // ① 카트 — 서버가 아는 카트(첫 집품 뒤), 아니면 이 주문 안내 카트(다른 주문과 겹치지 않는 빈 카트)
  const known = sim.serverCart(s.shipmentId);
  const cart = known ?? sim.cartFor(s.shipmentId);
  return (
    <>
      <div className="bc-grid">
        <LocBarcode code={cart} caption={known ? '① 카트 (서버: 이 주문을 담은 장바구니)' : '① 카트 (이 주문 안내 — 다른 주문과 겹치지 않게)'} />
      </div>
      {stops.map(({ l, p, loc, gone }) => (
        <div className={`scan-stop${gone ? ' done' : ''}`} key={`${l.orderLineId}:${p.lotId}`}>
          <div className="sub">
            {p.visitSeq != null ? `${p.visitSeq}번째 · ` : ''}
            {l.productName ?? l.sku} × {gone ? `${p.remainingQty} (집음)` : p.remainingQty}
          </div>
          <div className="bc-grid">
            {loc ? <LocBarcode code={loc} caption={gone ? '위치 (집은 칸)' : '위치 (누르면 3D 에서 그 칸)'} /> : <div className="note">지시 칸 없음</div>}
            <ProductBarcodes l={l} />
            {/* LOT 라벨(GS1-128 (01)GTIN(17)기한(10)LOT 번호 — inventory 0.21.0·fulfillment 0.11.0). 지금 PDA 는 상품 바코드로 비교하고, LOT 라벨로 바뀌면 이것을 찍는다(C-2) */}
            <LotLabel l={l} p={p} height={44} />
          </div>
          <ProductBarcodeNotes l={l} />
        </div>
      ))}
    </>
  );
}

/** 상품 바코드 — 작업 지시 줄 값(PDA 가 비교하는 값) 먼저, 없으면 상품 정보(참고) */
function ProductBarcodes({ l }: { l: TaskLine }) {
  const { sim } = useApp();
  const bc = sim.real!.skuBarcodes.get(l.sku);
  // 작업 지시 바코드 중 첫 값 말고 나머지(0.7.0 barcodes) — 계약은 "barcodes 중 하나면 같은 상품"
  const more = (l.barcodes ?? []).filter((v) => v !== l.barcode);
  // PDA 앱은 찍은 값이 작업 지시 줄의 barcode 또는 barcodes 중 하나면 받는다(mfc_app task_list.dart matchesBarcode, 클라이언트 c6f4930 — C-1 해소)
  if (l.barcode)
    return (
      <>
        <Barcode value={l.barcode} kind={kindOf(l.barcode)} caption={`상품 ${l.sku} (작업 지시 바코드)`} height={44} />
        {more.map((v) => (
          <Barcode key={v} value={v} kind={kindOf(v)} caption={`상품 ${l.sku} (같은 상품 다른 바코드)`} height={44} />
        ))}
      </>
    );
  if (bc === 'LOADING' || bc === undefined) return <div className="note">상품 바코드 읽는 중…</div>;
  if (bc === 'ERR') return <div className="note warn">상품 조회 실패 ({l.sku})</div>;
  if (bc.length === 0) return <div className="note warn">{l.sku} 바코드 없음(서버 상품 데이터)</div>;
  return (
    <>
      {bc.map((v) => (
        <Barcode key={v} value={v} kind={kindOf(v)} caption={`상품 ${l.sku} (상품 정보 — 참고)`} height={44} />
      ))}
    </>
  );
}

function ProductBarcodeNotes({ l }: { l: TaskLine }) {
  const { sim } = useApp();
  const bc = sim.real!.skuBarcodes.get(l.sku);
  return (
    <>
      {!l.barcode && (
        <div className="note warn">
          이 작업 지시 줄에 상품 바코드가 비어 있습니다 — PDA 는 찍은 값을 작업 지시 바코드와 비교하므로 "다른 상품"이 됩니다. 서버(0.7.0)는 조회 때 채우므로 비어 있으면 재고 서비스 조회 실패이거나 그 상품의 바코드가 없는 것입니다. 위 바코드는 상품 정보의 값(참고)입니다.
        </div>
      )}
      {l.barcode && Array.isArray(bc) && bc.length > 0 && !bc.includes(l.barcode) && (
        <div className="note warn">작업 지시 바코드({l.barcode})가 지금 상품 정보 바코드({bc.join(', ')})와 다릅니다 — PDA 는 작업 지시 바코드로 비교합니다.</div>
      )}
    </>
  );
}

export function ScanBoard() {
  const { sim } = useApp();
  const focus = useScanFocus();
  const view = useScanView();
  const real = sim.real;
  // 실제 주문 줄에서 고른 출고의 PICK·PACK(끝난 것도)만 — 고르기 전에는 주문 바코드를 보이지 않는다(3D 말풍선과 같은 기준, 사용자 2026-11-17)
  const tasks =
    real && focus.shipmentId
      ? [...real.tasks.values()]
          .filter((t) => (t.summary.taskType === 'PICK' || t.summary.taskType === 'PACK' || t.summary.taskType === 'RETURN') && t.detail)
          .filter((t) => t.summary.shipmentId === focus.shipmentId)
          .sort((a, b) => a.summary.createdAt.localeCompare(b.summary.createdAt) || (a.summary.taskType === b.summary.taskType ? 0 : a.summary.taskType === 'PICK' ? -1 : 1))
      : [];
  useSkuBarcodes(tasks);

  const KIND_KO: Record<string, string> = { PICK: '피킹', PACK: '패킹', RETURN: '취소품 복귀' };
  return (
    <div className="scan">
      {/* 위: 보기 방식 + 인쇄 라벨 — 찍는 법은 "설명"(사용자 2026-11-20 "글 엄청 길고 작네") */}
      <div className="scan-top">
        <div className="scan-mode">
          <button className={view.mode === 'qr' ? 'on' : undefined} onClick={() => scanView.setMode('qr')}>
            QR
          </button>
          <button className={view.mode === 'bar' ? 'on' : undefined} onClick={() => scanView.setMode('bar')}>
            바코드
          </button>
        </div>
        <span className="scan-print">
          인쇄{' '}
          <a href="/labels/cart-labels-MFC-SEED-01.html" target="_blank" rel="noreferrer">
            카트 {BACKEND_FACTS.cartLocations.length}장
          </a>{' '}
          ·{' '}
          <a href="/labels/locations/index.html" target="_blank" rel="noreferrer">
            위치 {BACKEND_FACTS.labelLocationCount.toLocaleString()}곳
          </a>
        </span>
      </div>
      <Why label="찍는 법">
        PDA 앱 입력칸의 카메라로 이 화면을 찍거나, PC 브라우저면 입력칸에 바코드 밑 글자를 치고 Enter. QR·바코드는 값이 같습니다. 위치 코드를 누르면 3D 에서 그 칸, "크게"는 화면 가득.
      </Why>

      {/* ① 고른 주문 — 작업마다 칸 하나 */}
      {real && !focus.shipmentId && <div className="scan-empty">실제 주문 탭에서 주문을 누르면 그 주문의 지시 칸·상품·포장 위치 바코드가 여기에 나옵니다.</div>}
      {!real && <div className="scan-empty">실서버 모드에서 고른 주문의 바코드가 여기에 나옵니다. 선반 칸을 누르면 그 칸의 위치 바코드가 카드에 나옵니다.</div>}
      {focus.shipmentId && (
        <section className="scan-sec">
          <div className="scan-sec-h">
            <b>
              주문 <OrderNo shipmentId={focus.shipmentId} />
            </b>
            <button className="link" onClick={focus.clear}>
              선택 취소
            </button>
          </div>
          {/* 시스템 번호는 현장 기록 맨 아래 한 곳에 */}
          {real && <OrderTimeline shipmentId={focus.shipmentId} />}
        </section>
      )}
      {real && focus.shipmentId && !tasks.length && <div className="scan-empty">이 주문의 작업이 화면에서 빠졌습니다.</div>}
      {tasks.map((t) => (
        <section className="scan-sec scan-task" key={t.summary.taskId}>
          <div className="scan-sec-h">
            <b>{KIND_KO[t.summary.taskType] ?? t.summary.taskType} 바코드</b>
            <span>
              {TASK_STATE_KO[t.closed ? t.closed.state : t.summary.state]} · {real!.workerName(t.summary.assignment?.workerId)}
            </span>
          </div>
          <TaskBarcodes t={t} />
        </section>
      ))}

      {/* ② 카트 QR — 늘 같은 것이라 맨 아래 */}
      <section className="scan-sec">
        <div className="scan-sec-h">
          <b>카트 QR · {BACKEND_FACTS.cartLocations.length}대</b>
          <span>피킹 때 찍고, 패킹 때 같은 카트를 다시 찍음</span>
        </div>
        <CartBarcodes />
      </section>
    </div>
  );
}
