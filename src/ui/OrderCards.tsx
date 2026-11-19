// 실제 주문 — 관리자가 한눈에(ADR-0070 "겉은 직관적으로, 들어가면 상세", 사용자 2026-11-20 "오른쪽 표 … 직관적으로 보이겠냐").
// 카드 겉: 주문번호 · 지금 단계 하나(색) · 경과 분 · 대표 상품 · 단계 막대(피킹 → 패킹 → 랙 → 배차 → 인계).
// 카드를 누르면(주문 고르기 — 3D 말풍선·바코드 탭도 그 주문) 담당자·수량·배차 상세·서버 상태 원문·시스템 번호.
import { useApp } from '../app/context';
import type { Simulation } from '../sim/simulation';
import { dispatchText, dispatchView, type RealShipment, type RealTask } from '../sim/realBoard';
import { OrderNo, SystemIds } from './OrderNo';
import { useScanFocus } from './scanFocus';

type Dot = 'done' | 'now' | 'wait' | 'bad';
type Tone = 'run' | 'wait' | 'ok' | 'bad' | 'done';

const STEPS = ['피킹', '패킹', '랙', '배차', '인계'] as const;

function taskDot(t?: RealTask): Dot {
  if (!t) return 'wait';
  const st = t.closed?.state ?? t.summary.state;
  if (st === 'COMPLETED' || st === 'CLOSED_PARTIAL') return 'done';
  if (st === 'BLOCKED' || st === 'FAILED') return 'bad';
  if (st === 'IN_PROGRESS' || st === 'ASSIGNED') return 'now';
  return 'wait';
}

/** 단계 막대와 머리 상태 — 서버 값에서만 */
export function orderStatus(sim: Simulation, r: RealShipment): { dots: Dot[]; text: string; tone: Tone } {
  const v = dispatchView(r);
  const pick = taskDot(r.pick);
  const pack = taskDot(r.pack ?? r.ret);
  const racked = sim.onRack(r.shipmentId) || ['ASSIGNED', 'AT_STORE', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(v.stage);
  const rack: Dot = racked ? 'done' : pack === 'done' ? 'now' : 'wait';
  const disp: Dot = ['ASSIGNED', 'AT_STORE', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(v.stage)
    ? 'done'
    : v.stage === 'DISPATCH_FAILED'
      ? 'bad'
      : ['REQUESTED', 'WAITING_DISPATCH', 'DISPATCHING'].includes(v.stage)
        ? 'now'
        : 'wait';
  const hand: Dot = v.stage === 'OUT_FOR_DELIVERY' || v.stage === 'DELIVERED' ? 'done' : v.stage === 'AT_STORE' ? 'now' : 'wait';
  const dots: Dot[] = [pick, pack, rack, disp, hand];
  const qty = (t?: RealTask) => (t ? ` ${t.summary.completedQty}/${t.summary.plannedQty}` : '');
  if (v.stage === 'SHIPMENT_CANCELLED') return { dots, text: '주문 취소', tone: 'done' };
  if (pick === 'bad' || pack === 'bad') return { dots, text: pick === 'bad' ? '피킹 막힘(결품 등)' : '패킹 막힘', tone: 'bad' };
  if (v.stage === 'DISPATCH_FAILED') return { dots, text: '배차 실패', tone: 'bad' };
  if (hand === 'done') return { dots, text: v.stage === 'DELIVERED' ? '전달 완료' : '픽업 완료 · 배송 중', tone: 'done' };
  if (hand === 'now') return { dots, text: '라이더 가게 도착', tone: 'run' };
  if (disp === 'done') return { dots, text: '라이더 오는 중', tone: 'ok' };
  if (pick !== 'done') return { dots, text: pick === 'now' ? `피킹 중${qty(r.pick)}` : '피킹 기다림', tone: pick === 'now' ? 'run' : 'wait' };
  if (pack !== 'done') return { dots, text: pack === 'now' ? `패킹 중${qty(r.pack ?? r.ret)}` : '패킹 기다림', tone: pack === 'now' ? 'run' : 'wait' };
  if (!racked) return { dots, text: '랙에 올리는 중', tone: 'run' };
  if (disp === 'now') return { dots, text: v.stage === 'DISPATCHING' ? '랙 · 라이더 찾는 중' : '랙 · 배차 기다림', tone: 'wait' };
  return { dots, text: '랙 · 배차 요청 전', tone: 'wait' };
}

function mins(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

function Detail({ r }: { r: RealShipment }) {
  const { sim } = useApp();
  const real = sim.real!;
  const v = dispatchView(r);
  const who = (t?: RealTask) => {
    if (!t) return '—';
    const s = t.summary;
    const w = s.assignment?.workerId ? real.workerName(s.assignment.workerId) : s.pickedBy ? `${real.workerName(s.pickedBy)}(피킹한 사람, 다음 작업)` : '담당 전';
    return `${w} · ${s.completedQty}/${s.plannedQty}`;
  };
  return (
    <div className="oc-d" onClick={(e) => e.stopPropagation()}>
      <dl>
        <dt>피킹</dt>
        <dd>{who(r.pick)}</dd>
        <dt>{r.ret && !r.pack ? '복귀' : '패킹'}</dt>
        <dd>{who(r.pack ?? r.ret)}</dd>
        <dt>배차</dt>
        <dd>{dispatchText(r).replace(/ RD-\S+/, '')}</dd>
        {r.info?.packages?.length ? (
          <>
            <dt>포장</dt>
            <dd>
              {r.info.packages.length}개 · 랙 {sim.rackFor(r.shipmentId).replace('DSP-A-0', '')}
              {sim.serverRack(r.shipmentId) ? '' : ' (추정)'}
            </dd>
          </>
        ) : null}
      </dl>
      <div className="oc-raw">
        서버 상태: 출고 {r.info?.state ?? '—'}
        {v.dispatchState ? ` · 배차 ${v.dispatchState}` : ''}
        {v.execState ? ` · 배송 ${v.execState}` : ''}
      </div>
      <SystemIds
        ids={[
          ['출고', r.shipmentId],
          ['이행', r.fulfillmentId],
          ['배송', r.delivery?.deliveryId],
        ]}
      />
    </div>
  );
}

export function OrderCards() {
  const { sim } = useApp();
  const real = sim.real!;
  const focus = useScanFocus();
  const now = Date.now();
  return (
    <div className="ocs">
      {real.shipments().map((r) => {
        const t = (r.pick ?? r.pack ?? r.ret)!.summary;
        const st = orderStatus(sim, r);
        const on = focus.shipmentId === r.shipmentId;
        const head = t.headline;
        const flags = [r.pick, r.pack, r.ret].some((x) => x?.summary.late) ? '늦음' : [r.pick, r.pack, r.ret].some((x) => x?.summary.idle) ? '30분 멈춤' : '';
        return (
          <div
            key={r.shipmentId}
            className={`oc ${on ? 'on' : ''} tone-${st.tone}`}
            onClick={() => (on ? focus.clear() : focus.show(r.shipmentId))}
            title={on ? '다시 누르면 선택 취소' : '누르면 상세 · 3D 말풍선·바코드가 이 주문'}
          >
            <div className="oc-h">
              <b className="oc-no">
                <OrderNo shipmentId={r.shipmentId} />
              </b>
              <span className="oc-st">{st.text}</span>
              {flags && <span className="oc-flag">{flags}</span>}
              <span className="oc-t">{mins(t.createdAt, now)}</span>
            </div>
            <div className="oc-p">
              {head?.productName ?? '—'}
              {head && head.otherLineCount > 0 ? ` 외 ${head.otherLineCount}건` : ''}
            </div>
            <div className="oc-bar">
              {st.dots.map((d, i) => (
                <span key={STEPS[i]} className={`oc-s ${d}`}>
                  <i />
                  {STEPS[i]}
                </span>
              ))}
            </div>
            {on && <Detail r={r} />}
          </div>
        );
      })}
    </div>
  );
}
