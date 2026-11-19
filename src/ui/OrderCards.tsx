// 실제 주문 — 관리자가 한눈에(ADR-0070 "겉은 직관적으로, 들어가면 상세", 사용자 2026-11-20 "오른쪽 표 … 직관적으로 보이겠냐").
// 표 한 줄: 주문번호(+대표 상품) · 지금 단계 하나(색) · 진행 점 5개(피킹 → 패킹 → 랙 → 배차 → 인계) · 경과.
// 줄을 누르면(주문 고르기 — 3D 말풍선·바코드 탭도 그 주문) 바로 아래 단계 막대·담당자·수량·배차 상세·서버 상태 원문·시스템 번호.
import { Fragment } from 'react';
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
  // 표 칸이 좁아 1시간 넘으면 시간만(상세 아님)
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간`;
}

const won = (n: number) => `${n.toLocaleString()}원`;

/** 걸린 시간 "3분 12초" — 시작 전이면 null */
function dur(fromIso: string | null | undefined, toMs: number | null): string | null {
  if (!fromIso) return null;
  const sec = Math.max(0, Math.round(((toMs ?? Date.now()) - Date.parse(fromIso)) / 1000));
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}분 ${sec % 60}초` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

/** 피킹·패킹에 걸린 시간 — 시작(센터 출고 목록 startedAt, 진행 중이면 작업 activeStart) ~ 끝(작업 completedAt, 진행 중이면 지금). 서버 값만 */
export function stageTimes(sim: Simulation, r: RealShipment): { pick: string | null; pack: string | null; pickRunning: boolean; packRunning: boolean } {
  const c = sim.real?.centerShipments.get(r.shipmentId);
  const readyAt = c?.readyAt ?? r.info?.readyAt ?? null;
  const packStart = c?.pack?.startedAt ?? (r.pack ?? r.ret)?.detail?.activeStart?.startedAt ?? null;
  // 끝 = 작업 completedAt, 없으면 다음 단계 시작(피킹 → 패킹 시작, 패킹 → 출하 대기 시각). 끝난 작업인데 끝 시각을 모르면 진행 중으로 세지 않는다
  const one = (t: RealTask | undefined, started: string | null | undefined, next: string | null) => {
    const s = started ?? t?.detail?.activeStart?.startedAt ?? null;
    const st = t?.closed?.state ?? t?.summary.state;
    const done = st === 'COMPLETED' || st === 'CLOSED_PARTIAL';
    const end = t?.summary.completedAt ?? t?.detail?.completedAt ?? next ?? null;
    if (done && !end) return { text: null, running: false };
    return { text: dur(s, end ? Date.parse(end) : null), running: !!s && !end && !done };
  };
  const p = one(r.pick, c?.pick?.startedAt, packStart);
  const k = one(r.pack ?? r.ret, packStart, readyAt);
  return { pick: p.text, pack: k.text, pickRunning: p.running, packRunning: k.running };
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
  const os = real.orderSummaryOf(r);
  // 품목: 배송 상세의 주문 요약(금액 포함), 배송 전이면 피킹 작업 줄(수량만)
  const lines = os?.items?.length
    ? os.items.map((i) => ({ k: i.orderLineId ?? i.name, name: `${i.name}${i.optionLabel ? ` (${i.optionLabel})` : ''}`, qty: i.qty, amt: i.lineAmount as number | null }))
    : ((r.pick ?? r.pack)?.detail?.lines ?? []).map((l) => ({ k: l.orderLineId, name: l.productName ?? l.sku, qty: l.plannedQty, amt: null as number | null }));
  const tm = stageTimes(sim, r);
  return (
    <div className="oc-d" onClick={(e) => e.stopPropagation()}>
      <table className="od-items">
        <tbody>
          {lines.map((l) => (
            <tr key={l.k}>
              <td>{l.name}</td>
              <td>×{l.qty}</td>
              <td>{l.amt != null ? won(l.amt) : ''}</td>
            </tr>
          ))}
        </tbody>
        {os?.itemAmount != null && (
          <tfoot>
            <tr>
              <td colSpan={2}>상품 합계</td>
              <td>{won(os.itemAmount)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <dl>
        <dt>시간</dt>
        <dd>
          피킹 {tm.pick ?? '시작 전'}
          {tm.pickRunning ? '째' : ''} · 패킹 {tm.pack ?? '시작 전'}
          {tm.packRunning ? '째' : ''}
        </dd>
        <dt>전달</dt>
        <dd>{os ? os.deliveryNote || '요청사항 없음' : '배송이 생기면 보임'}</dd>
        <dt>배송지</dt>
        <dd className="muted">MFC 계정엔 주소가 안 옴 — 백엔드 요청 R-27</dd>
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

/** 실제 주문 표 — 한 줄: 주문번호(+상품) · 지금 단계 · 진행 점 5개 · 경과. 줄을 누르면 바로 아래 상세(사용자 2026-11-20 "오른쪽 표에서 직관적으로") */
/** 줄 겉에 바로: 피킹·패킹 걸린 시간, 상품 합계 */
function OrderFacts({ r }: { r: RealShipment }) {
  const { sim } = useApp();
  const tm = stageTimes(sim, r);
  const os = sim.real!.orderSummaryOf(r);
  return (
    <div className="ob-f">
      <span className={tm.pickRunning ? 'run' : ''}>
        <em>피킹</em> {tm.pick ?? '—'}
      </span>
      <span className={tm.packRunning ? 'run' : ''}>
        <em>패킹</em> {tm.pack ?? '—'}
      </span>
      {os?.itemAmount != null && (
        <span className="amt">
          <em>금액</em> {won(os.itemAmount)}
        </span>
      )}
    </div>
  );
}

export function OrderCards() {
  const { sim } = useApp();
  const real = sim.real!;
  const focus = useScanFocus();
  const now = Date.now();
  return (
    <table className="ot big">
      <tbody>
        {real.shipments().map((r) => {
          const t = (r.pick ?? r.pack ?? r.ret)!.summary;
          const st = orderStatus(sim, r);
          const on = focus.shipmentId === r.shipmentId;
          const head = t.headline;
          const flags = [r.pick, r.pack, r.ret].some((x) => x?.summary.late) ? '늦음' : [r.pick, r.pack, r.ret].some((x) => x?.summary.idle) ? '30분 멈춤' : '';
          return (
            <Fragment key={r.shipmentId}>
              <tr
                className={`ot-r tone-${st.tone} ${on ? 'on' : ''}`}
                onClick={() => (on ? focus.clear() : focus.show(r.shipmentId))}
                title={on ? '다시 누르면 접기' : '누르면 상세 · 3D 말풍선·바코드가 이 주문'}
              >
                <td>
                  {/* 한눈에: 큰 주문번호 · 색 배지(지금 단계) · 경과 / 단계 이름 붙은 막대 / 상품 */}
                  <div className="ob-1">
                    <b className="ob-no">
                      <OrderNo shipmentId={r.shipmentId} />
                    </b>
                    <span className="ob-st">{st.text}</span>
                    {flags && <span className="oc-flag">{flags}</span>}
                    <span className="ob-t">{mins(t.createdAt, now)}</span>
                  </div>
                  <div className="ob-bar">
                    {st.dots.map((d, i) => (
                      <span key={STEPS[i]} className={`ob-s ${d}`}>
                        <i />
                        {STEPS[i]}
                      </span>
                    ))}
                  </div>
                  <div className="ob-p">
                    {head?.productName ?? '—'}
                    {head && head.otherLineCount > 0 ? ` 외 ${head.otherLineCount}건` : ''}
                  </div>
                  <OrderFacts r={r} />
                </td>
              </tr>
              {on && (
                <tr className="ot-d">
                  <td>
                    <Detail r={r} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
