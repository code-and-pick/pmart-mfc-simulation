// 스캔 말풍선(사용자 2026-11-17 "직원이 카트, 상품이 있는 칸까지 움직였을때 바코드를 찍을수있게"):
// 실제 PDA 작업자(ObservedWorker)가 3D 에서 카트·지금 갈 칸에 도착하면 그 머리 위에 찍을 바코드를 띄운다.
// 고른 것만 띄운다(사용자 2026-11-17 "해당 주문/작업자를 선택했을때 뜨는걸로"): 3D 에서 그 작업자를 클릭했거나, 실제 주문 탭에서 그 출고 줄을 눌렀을 때.
// 선택 취소("선택취소하는 기능도"): 말풍선의 ✕, Esc, 고른 주문 줄 다시 누르기, 바코드 탭 "진행 중 전체 보기".
// 순서는 PDA 앱과 같다(domain/pickStop): ① 카트 → ② 칸 위치 → ③ 상품(× 집을 양). 서버에 집품이 확정되면 다음 칸으로 걸어간다.
// 위치는 매 프레임(requestAnimationFrame) 카메라로 바꿔 DOM 에 바로 쓴다 — React 상태로 올리지 않는다.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useApp, useTick, useView } from '../app/context';
import { cameraTap } from '../render/cameraTap';
import type { ObservedWorker } from '../sim/observedWorker';
import { Barcode } from './Barcode';

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
        <Barcode value={c.cart} caption={`카트 ${c.cart} (PDA 는 어느 카트든 받음)`} height={40} />
        <button className="btn" onClick={() => sim.passCart(w.workerId)} title="서버는 카트 스캔을 모릅니다 — 찍었으면 눌러 첫 칸으로. 첫 집품이 서버에 오면 저절로 넘어갑니다">
          카트 QR 찍음 → 카트 들고 첫 칸으로
        </button>
      </>
    );
  }
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
      {l.barcode ? (
        <Barcode value={l.barcode} kind={kindOf(l.barcode)} caption={`③ 상품 ${l.sku} — ${stop.qty}번 찍기`} height={36} />
      ) : (
        <div className="note warn">작업 지시 줄에 상품 바코드가 없습니다 — 오른쪽 스캔 판의 상품 정보 바코드(참고)를 보세요.</div>
      )}
      {more.length > 0 && <div className="note">같은 상품 다른 바코드 {more.join(', ')} — PDA 는 첫 값만 비교(C-1)</div>}
      {stop.otherLocations.length > 0 && <div className="note">지시 칸이 비었으면 같은 LOT 칸: {stop.otherLocations.join(', ')}</div>}
    </>
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
