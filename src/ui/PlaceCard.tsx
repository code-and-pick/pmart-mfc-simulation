// 패킹대·출하대기 랙을 누르면 그 자리 주문 팝업(사용자 2026-11-20 "작업 중인 패킹대랑 상품 쌓여 있는 인계랙 클릭하면 해당 주문내역이 팝업창으로").
// 주문마다 오른쪽 주문 카드와 같은 카드(OrderCard) — 상품·금액·단계·시간. 서버가 패킹대를 주지 않을 때는 "추정" 칩.
import { useApp, useTick, useView } from '../app/context';
import { OrderCard } from './OrderCards';

function placeName(code: string): string {
  if (code.startsWith('PAK-A-')) return `패킹대 ${Number(code.slice(-2))}`;
  if (code.startsWith('DSP-A-')) return `출하대기 랙 ${Number(code.slice(-2))}`;
  return code;
}

export function PlaceCard() {
  const { sim, controller } = useApp();
  const view = useView();
  useTick();
  const sel = view.selection;
  if (!sel || sel.kind !== 'place') return null;
  const at = sim.shipmentsAt(sel.code);
  const rows = (sim.real?.shipments() ?? []).filter((r) => at.some((a) => a.shipmentId === r.shipmentId));
  const guess = at.some((a) => a.guess);
  return (
    <div className="place-pop" role="dialog" aria-label={placeName(sel.code)}>
      <div className="place-h">
        <b>{placeName(sel.code)}</b>
        <span>{rows.length ? `주문 ${rows.length}건` : '비어 있음'}</span>
        {guess && <span className="guess" title="서버가 이 자리를 알려 주지 않아 화면이 짐작">추정</span>}
        <button className="place-x" onClick={() => controller.select(null, false)} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="place-body">
        {rows.length ? (
          rows.map((r) => <OrderCard key={r.shipmentId} r={r} />)
        ) : (
          <div className="scan-empty">{sel.code.startsWith('PAK-') ? '지금 이 패킹대에서 포장 중인 주문이 없습니다.' : '이 랙에 올린 포장이 없습니다.'}</div>
        )}
      </div>
    </div>
  );
}
