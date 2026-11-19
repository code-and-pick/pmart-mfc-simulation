// 스캔 말풍선(사용자 2026-11-17 "직원이 카트, 상품이 있는 칸까지 움직였을때 바코드를 찍을수있게"):
// 실제 PDA 작업자(ObservedWorker)가 3D 에서 카트·지금 갈 칸에 도착하면 그 머리 위에 찍을 바코드를 띄운다.
// 고른 것만 띄운다(사용자 2026-11-17 "해당 주문/작업자를 선택했을때 뜨는걸로"): 3D 에서 그 작업자를 클릭했거나, 실제 주문 탭에서 그 출고 줄을 눌렀을 때.
// 선택 취소("선택취소하는 기능도"): 말풍선의 ✕, Esc, 고른 주문 줄 다시 누르기, 바코드 탭 "선택 취소".
// 순서는 PDA 앱과 같다(domain/pickStop): ① 카트 → ② 칸 위치 → ③ 상품(× 집을 양). 서버에 집품이 확정되면 다음 칸으로 걸어간다.
// 위치는 매 프레임(requestAnimationFrame) 카메라로 바꿔 DOM 에 바로 쓴다 — React 상태로 올리지 않는다.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useApp, useTick, useView } from '../app/context';
import { REAL_LINK } from '../config';
import { cameraTap } from '../render/cameraTap';
import type { ObservedWorker, ScanCue } from '../sim/observedWorker';
import { Barcode } from './Barcode';
import { LotLabel } from './ScanBoard';
import { Why } from './Why';

const HEAD_Y = 2.0;
/** 위 막대(상단 바) 아래부터 띄운다(px) */
const EDGE_TOP = 44;
const kindOf = (v: string) => (/^\d{13}$/.test(v) ? 'ean13' : 'code128');

export function ScanBubbles() {
  const { sim } = useApp();
  useTick();
  const view = useView();
  const refs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    let raf = 0;
    const v = new THREE.Vector3();
    const loop = () => {
      const cam = cameraTap.camera;
      for (const w of sim.observedWorkers) {
        const el = refs.current.get(w.workerId);
        if (!el) continue;
        let show = !!cam && !!w.cue && !w.moving;
        if (show) {
          v.set(w.pos.x, HEAD_Y, w.pos.z).project(cam!);
          show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
          // 화면 밖으로 잘리지 않게 — 위쪽이 모자라면 머리 아래로 내리고, 좌우는 안쪽으로 민다
          const x = ((v.x + 1) / 2) * cameraTap.width;
          const y = ((1 - v.y) / 2) * cameraTap.height;
          const bw = el.offsetWidth || 300;
          const bh = el.offsetHeight || 200;
          const below = y - bh - 14 < EDGE_TOP;
          const top = Math.min(below ? y + 24 : y - bh - 10, cameraTap.height - bh - 8);
          const left = Math.max(8, Math.min(x - bw / 2, cameraTap.width - bw - 8));
          el.style.transform = `translate(${left}px, ${Math.max(EDGE_TOP, top)}px)`;
          el.classList.toggle('below', below);
        }
        el.style.display = show ? 'block' : 'none';
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  // Esc = 선택 취소(크게 보기가 열려 있으면 그쪽이 먼저 닫힌다)
  const { controller } = useApp();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.scan-zoom')) return;
      if (controller.scanShipment || controller.selection?.kind === 'worker') controller.clearScanSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  // 출하대기 랙 말풍선 위치(랙마다 그 랙 위) — 작업자 말풍선과 같은 방식
  const rackRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    let raf = 0;
    const v = new THREE.Vector3();
    const loop = () => {
      const cam = cameraTap.camera;
      for (const [rack, el] of rackRefs.current) {
        const p = sim.backendPoint(rack);
        if (!cam || !p) continue;
        v.set(p.x, RACK_Y, p.z).project(cam);
        const show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        const x = ((v.x + 1) / 2) * cameraTap.width;
        const y = ((1 - v.y) / 2) * cameraTap.height;
        const bw = el.offsetWidth || 300;
        const bh = el.offsetHeight || 200;
        const top = Math.min(y - bh - 10 < EDGE_TOP ? y + 24 : y - bh - 10, cameraTap.height - bh - 8);
        const left = Math.max(8, Math.min(x - bw / 2, cameraTap.width - bw - 8));
        el.style.transform = `translate(${left}px, ${Math.max(EDGE_TOP, top)}px)`;
        el.style.display = show ? 'block' : 'none';
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  const sel = view.selection?.kind === 'worker' ? view.selection.id : null;
  const ws = sim.observedWorkers.filter((w) => w.cue && (w.id === sel || (!!view.scanShipment && w.pda?.shipmentId === view.scanShipment)));
  return (
    <div className="scan-bubbles">
      {ws.map((w) => (
        <div
          key={w.workerId}
          className="scan-bubble"
          ref={(el) => {
            if (el) refs.current.set(w.workerId, el);
            else refs.current.delete(w.workerId);
          }}
        >
          <Bubble w={w} />
        </div>
      ))}
      {sim.racks.map((rack) => (
        <RackBubble
          key={rack}
          rack={rack}
          innerRef={(el) => {
            if (el) rackRefs.current.set(rack, el);
            else rackRefs.current.delete(rack);
          }}
          shipmentId={view.scanShipment ?? null}
        />
      ))}
    </div>
  );
}

const RACK_Y = 1.8;
/** 한 번에 보이는 포장 수 — 넘으면 "외 N개" */
const RACK_MAX = 6;

/**
 * 출하대기 랙 말풍선(사용자 2026-11-18 "배차 대기 랙에 있는 패킹 완료 상품들의 qr 코드도 말풍선 넣어줘"):
 * 출고가 출하 대기(READY·부분 인계)인 밀봉 포장(SEALED)의 라벨 QR(`Package.qrCode` — 라이더 인계 때 찍음)·주문번호·숫자 인계 코드(F-8).
 * 서버는 포장이 어느 랙에 있는지 모른다(BR-52 R20) — 랙 1 위에 모아 보인다. 주문을 고르면 그 주문 것만.
 */
function RackBubble({ rack, innerRef, shipmentId }: { rack: string; innerRef: (el: HTMLDivElement | null) => void; shipmentId: string | null }) {
  const { sim } = useApp();
  const [open, setOpen] = useState(true);
  const real = sim.real;
  const list = (real?.shipments() ?? [])
    .filter((r) => r.info && (r.info.state === 'READY' || r.info.state === 'PARTIALLY_HANDED_OVER') && sim.onRack(r.shipmentId) && sim.rackFor(r.shipmentId) === rack)
    .filter((r) => !shipmentId || r.shipmentId === shipmentId)
    .flatMap((r) => (r.info!.packages ?? []).filter((p) => p.state === 'SEALED').map((p) => ({ r, p })));
  if (!list.length) return null;
  return (
    <div className="scan-bubble rack" ref={innerRef} style={{ display: 'none' }}>
      <div className="sb-head">
        출하대기 랙 {rack === 'DSP-A-02' ? 2 : 1} · 포장 {list.length}개 <span className="sub">라벨 QR — 라이더 인계 때 찍음</span>
        <button className="sb-x" onClick={() => setOpen(!open)} title={open ? '접기' : '펼치기'}>
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open &&
        list.slice(0, RACK_MAX).map(({ r, p }) => (
          <div key={p.packageId}>
            <div className="sub">
              주문 {p.orderNumber ?? r.info!.orderNumber ?? r.info!.orderId} · {p.temperatureZone ?? '-'} · 봉투 {p.bagCount}
              {p.handoverCode ? (
                <>
                  {' · '}QR 안 되면 번호 <b className="hcode">{p.handoverCode}</b>
                </>
              ) : (
                ''
              )}
            </div>
            <Barcode value={p.qrCode} caption={`포장 ${p.packageId} v${p.packageVersion}`} height={32} />
          </div>
        ))}
      {open && list.length > RACK_MAX && <div className="note">외 {list.length - RACK_MAX}개 — 실제 주문 탭에서 주문을 고르면 그 주문 것만</div>}
      <Why>PDA 가 랙을 찍어 서버에 올린 포장은 서버 랙 그대로(F-12). 서버가 모르는 포장은 이 화면에서 "랙 N 찍음"으로 고른 랙, 모르면 랙 1(추정).</Why>
    </div>
  );
}

function Bubble({ w }: { w: ObservedWorker }) {
  const { sim, controller } = useApp();
  const c = w.cue!;
  if (c.kind === 'CART') {
    return (
      <>
        <div className="sb-head">
          {w.id} · ① 카트 찍기 <span className="sub">다음 칸 {c.next.location}</span>
          <Close />
        </div>
        <Barcode value={c.cart} caption={`카트 ${c.cart} (PDA 는 어느 카트든 받음 — 찍은 카트가 이 주문의 장바구니)`} height={40} />
        <button className="btn" onClick={() => sim.passCart(w.workerId)} title="서버는 카트 스캔을 모릅니다 — 찍었으면 눌러 첫 칸으로. 첫 집품이 서버에 오면 저절로 넘어갑니다">
          카트 찍음 → 카트 들고 첫 칸으로
        </button>
      </>
    );
  }
  if (c.kind === 'PACK') return <PackBubble w={w} c={c} />;
  if (c.kind === 'NEXT') {
    return (
      <>
        <div className="sb-head">
          {w.id} · 피킹 끝 <span className="sub">패킹 배정 전</span>
          <Close />
        </div>
        <div className="note">
          PDA <b>다음 작업 받기</b> → 이 주문 패킹
        </div>
        <Why>서버가 피킹한 사람(이 작업자)에게 이 주문 패킹을 먼저 줍니다. 배정되면 ① 패킹대 찍기로 넘어갑니다.</Why>
        {c.cart && <CartAgain cart={c.cart} />}
      </>
    );
  }
  if (c.kind === 'RETURN') return <ReturnBubble w={w} c={c} />;
  const { stop, index, total } = c;
  const l = stop.line;
  const more = (l.barcodes ?? []).filter((v) => v !== l.barcode);
  return (
    <>
      <div className="sb-head">
        {w.id} · {index}/{total} · {l.productName ?? l.sku} × {stop.qty}
        <Close />
      </div>
      <Barcode value={stop.location} caption="② 칸 위치" height={36} onGo={() => controller.focusBackendCode(stop.location)} />
      {w.pda?.shipmentId && <CartAgain cart={sim.serverCart(w.pda.shipmentId) ?? sim.cartFor(w.pda.shipmentId)} />}
      {l.barcode ? (
        <Barcode value={l.barcode} kind={kindOf(l.barcode)} caption={stop.qty > 1 ? `③ 상품 ${l.sku} — 한 번 찍고 나머지 ${stop.qty - 1}개는 스캔·+·수기` : `③ 상품 ${l.sku} — 한 번 찍기`} height={36} />
      ) : (
        <div className="note warn">작업 지시 줄에 상품 바코드가 없습니다 — 오른쪽 스캔 판의 상품 정보 바코드(참고)를 보세요.</div>
      )}
      {more.length > 0 && <div className="note">같은 상품 다른 바코드 {more.join(', ')} — PDA 는 이 중 아무거나 받음</div>}
      {stop.pick && <LotLabel l={l} p={stop.pick} height={36} />}
      {stop.otherLocations.length > 0 && <div className="note">지시 칸이 비었으면 같은 LOT 칸: {stop.otherLocations.join(', ')}</div>}
    </>
  );
}

/** 취소품 복귀 — PDA 복귀 화면(① 출발 위치 → ② 상품 싣기 → "실었어요" → ③ 선반 칸 → 실적) */
function ReturnBubble({ w, c }: { w: ObservedWorker; c: Extract<ScanCue, { kind: 'RETURN' }> }) {
  const { sim, controller } = useApp();
  const p = c.piece;
  const l = p.line;
  const to = p.suggested[0];
  return (
    <>
      <div className="sb-head">
        {w.id} · 복귀 {c.index}/{c.total} · {l.productName ?? l.sku} × {p.left}
        <Close />
      </div>
      {c.step === 'FROM' ? (
        <>
          <Barcode value={p.from} caption={`① 출발 위치 ${p.from} (취소된 집품분이 놓인 곳)`} height={36} onGo={() => controller.focusBackendCode(p.from)} />
          {l.barcode ? (
            <Barcode value={l.barcode} kind={kindOf(l.barcode)} caption={p.left > 1 ? `② 상품 ${l.sku} — 한 번 찍고 나머지 ${p.left - 1}개는 스캔·+·수기로 싣기` : `② 상품 ${l.sku} — 한 번 찍어 싣기`} height={36} />
          ) : (
            <div className="note warn">작업 지시 줄에 상품 바코드가 없습니다 — PDA 에서 수량을 직접 넣습니다.</div>
          )}
          <button className="btn" onClick={() => sim.passScan(w.workerId)} title='서버는 싣기를 모릅니다 — PDA 에서 "실었어요"를 눌렀으면 눌러 선반으로. 실적이 서버에 오면 저절로 다음 조각'>
            실었어요 → 선반 칸으로
          </button>
        </>
      ) : to ? (
        <>
          <Barcode value={to} caption="③ 돌려놓을 선반 칸(추천 — PDA 는 다른 칸도 받음, 판정은 서버)" height={36} onGo={() => controller.focusBackendCode(to)} />
          <div className="note">찍으면 PDA 가 복귀 실적을 보냅니다 — 서버에 반영되면 다음 조각으로 넘어갑니다.</div>
        </>
      ) : (
        <div className="note warn">추천 선반 칸이 없습니다 — PDA 에서 돌려놓을 칸을 직접 찍습니다.</div>
      )}
      {p.suggested.length > 1 && <div className="note">다른 추천 칸: {p.suggested.slice(1).join(', ')}</div>}
    </>
  );
}

/**
 * 카트 다시 찍기(사용자 2026-11-18 "들고간 카트 못찍었을때를 대비해서 카트 누르면 다시 찍을수있게"): 카트 단계가 지난 말풍선에서
 * 누르면 그 주문 카트 바코드를 다시 띄운다. 카트 = 서버가 아는 이 주문 카트(첫 집품 뒤), 아니면 안내 카트.
 */
function CartAgain({ cart }: { cart: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cart-again">
      <button className="btn ghost" onClick={() => setOpen(!open)} title="PDA 에서 카트를 못 찍었으면 눌러 다시 띄움(같은 카트를 찍어야 함 — 다른 카트는 CART_MISMATCH)">
        카트 {cart} {open ? '닫기' : '다시 찍기'}
      </button>
      {open && <Barcode value={cart} caption={`카트 ${cart} — 이 주문을 담는 장바구니`} height={36} />}
    </div>
  );
}

/** 선택 취소(Esc 와 같음) */
function Close() {
  const { controller } = useApp();
  return (
    <button className="sb-x" onClick={() => controller.clearScanSelection()} title="선택 취소 (Esc)">
      ✕
    </button>
  );
}

/** 포장 말풍선 — PDA 포장 화면 단계: ① 패킹대 → ② 카트 → ③ 배차 요청 → ④ 담기·밀봉 → ⑤ 출하대기 랙 */
function PackBubble({ w, c }: { w: ObservedWorker; c: Extract<ScanCue, { kind: 'PACK' }> }) {
  const { sim, controller } = useApp();
  const head = (t: string) => (
    <div className="sb-head">
      {w.id} · 포장 {t}
      <Close />
    </div>
  );
  switch (c.step) {
    case 'STATION':
      return (
        <>
          {head('① 패킹대 찍기')}
          <Barcode value={c.station} caption={`패킹대 ${c.station} (PDA 는 PAK- 면 받음 — 집품분이 놓인 곳)`} height={36} onGo={() => controller.focusBackendCode(c.station)} />
          <button className="btn" onClick={() => sim.passScan(w.workerId)} title="서버는 패킹대 스캔을 모릅니다 — 찍었으면 눌러 다음으로. 배차 요청이 서버에 오면 저절로 넘어갑니다">
            패킹대 찍음 → 카트
          </button>
        </>
      );
    case 'CART':
      return (
        <>
          {head('② 카트 찍기')}
          <Barcode value={c.cart} caption={`카트 ${c.cart} — 이 주문을 담은 장바구니(PDA 가 같은 카트인지 봄)`} height={36} />
          <button className="btn" onClick={() => sim.passScan(w.workerId)} title="서버는 카트 스캔을 모릅니다 — 찍었으면 눌러 다음으로">
            카트 찍음 → 카트 내려놓고 배차 요청
          </button>
        </>
      );
    case 'DISPATCH':
      return (
        <>
          {head('③ 배차 요청')}
          <CartAgain cart={c.cart} />
          <div className="note">PDA 에서 예상 포장 시간 → 배차 요청</div>
          <Why>찍을 바코드가 없는 단계입니다. 서버에 배차 요청이 오면 다음 단계로 넘어갑니다.</Why>
        </>
      );
    case 'BAG':
      return (
        <>
          {head('④ 담기 — 상품 찍고 밀봉')}
          <CartAgain cart={c.cart} />
          {c.bag.map(({ line: l, left }) =>
            l.barcode ? (
              <Barcode key={l.orderLineId} value={l.barcode} kind={kindOf(l.barcode)} caption={`${l.productName ?? l.sku} — ${left}번 찍기`} height={32} />
            ) : (
              <div key={l.orderLineId} className="note warn">
                {l.productName ?? l.sku} × {left} — 작업 지시 줄에 상품 바코드 없음
              </div>
            ),
          )}
          <div className="note">다 담았으면 PDA 에서 밀봉</div>
          <Why>밀봉이 서버에 오면 남은 수가 줄고, 다 끝나면 출하대기 랙으로 갑니다.</Why>
        </>
      );
    case 'RACK':
      return (
        <>
          {head('⑤ 출하대기 랙 찍기')}
          {/* 출하대기 랙 2곳(DSP-A-01·02) — PDA 는 DSP- 면 어느 랙이든 받고 서버에 보내지 않는다(둘 중 하나) */}
          <Barcode value="DSP-A-01" caption="출하대기 랙 1 DSP-A-01" height={36} onGo={() => controller.focusBackendCode('DSP-A-01')} />
          <Barcode value="DSP-A-02" caption="출하대기 랙 2 DSP-A-02 (둘 중 하나)" height={36} onGo={() => controller.focusBackendCode('DSP-A-02')} />
          {/* PDA 에서 찍은 랙을 고른다 — 서버는 랙을 모름(R-20). 이 작업자가 다음 작업을 받아도 넘어가지만 그때는 어느 랙인지 몰라 랙 1 */}
          <div className="btn-row">
            <button className="btn" onClick={() => sim.passScan(w.workerId, 'DSP-A-01')} title="랙 1(DSP-A-01)을 찍었으면">
              랙 1 찍음
            </button>
            <button className="btn" onClick={() => sim.passScan(w.workerId, 'DSP-A-02')} title="랙 2(DSP-A-02)를 찍었으면">
              랙 2 찍음
            </button>
          </div>
          <Why>
            PDA 가 랙을 찍어 서버에 올리면(fulfillment 0.20.0) 바로 넘어갑니다. 서버에 안 오면 작업자가 랙에 서고 {REAL_LINK.rackAutoSec}초 뒤 랙에 둔 것으로 넘깁니다(버튼을 안 누르면 랙 1, 추정). 그다음 피킹 대기 자리로 갑니다.
          </Why>
        </>
      );
  }
}
