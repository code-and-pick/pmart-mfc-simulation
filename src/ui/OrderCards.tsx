// 실제 주문 카드 — 관리자가 한눈에(ADR-0070, 라이더 관제 카드 참고). 아래 OrderCard 설명.
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

const won = (n: number) => `${n.toLocaleString()}원`;
const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : null;

/** 걸린 시간 "3분 12초" — 시작 전이면 null */
function dur(fromIso: string | null | undefined, toMs: number | null): string | null {
  if (!fromIso) return null;
  const sec = Math.max(0, Math.round(((toMs ?? Date.now()) - Date.parse(fromIso)) / 1000));
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}분 ${sec % 60}초` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

interface Stage {
  start: string | null;
  text: string | null;
  running: boolean;
}

/** 피킹·패킹에 걸린 시간 — 시작(센터 출고 목록 startedAt, 진행 중이면 작업 activeStart) ~ 끝(작업 completedAt, 없으면 다음 단계 시작·출하 대기 시각). 서버 값만 */
export function stageTimes(sim: Simulation, r: RealShipment): { pick: Stage; pack: Stage; readyAt: string | null } {
  const c = sim.real?.centerShipments.get(r.shipmentId);
  const readyAt = c?.readyAt ?? r.info?.readyAt ?? null;
  const packStart = c?.pack?.startedAt ?? (r.pack ?? r.ret)?.detail?.activeStart?.startedAt ?? null;
  const one = (t: RealTask | undefined, started: string | null | undefined, next: string | null): Stage => {
    const s = started ?? t?.detail?.activeStart?.startedAt ?? null;
    const st = t?.closed?.state ?? t?.summary.state;
    const done = st === 'COMPLETED' || st === 'CLOSED_PARTIAL';
    const end = t?.summary.completedAt ?? t?.detail?.completedAt ?? next ?? null;
    if (done && !end) return { start: s, text: null, running: false };
    return { start: s, text: dur(s, end ? Date.parse(end) : null), running: !!s && !end && !done };
  };
  return { pick: one(r.pick, c?.pick?.startedAt, packStart), pack: one(r.pack ?? r.ret, packStart, readyAt), readyAt };
}

/**
 * 주문 카드(라이더 관제 카드 참고 — 사용자 2026-11-20 "주문 내역이 중요하다니까 가격이랑 상품은 왜 다시 축소했어", "라이더 쪽 … UI가 직관적이잖아").
 * 펼치지 않아도 보이는 것: 주문번호·합계 금액 / 단계 칩 / 단계마다 시각·걸린 시간·담당 / 배송지·전달 요청 / 상품 전부(수량·금액).
 * 카드를 누르면 그 주문을 고른다(3D 말풍선·바코드 탭). "시스템 번호"만 접어 둔다.
 */
export function OrderCard({ r }: { r: RealShipment }) {
  const { sim } = useApp();
  const real = sim.real!;
  const focus = useScanFocus();
  const on = focus.shipmentId === r.shipmentId;
  const st = orderStatus(sim, r);
  const tm = stageTimes(sim, r);
  const v = dispatchView(r);
  const os = real.orderSummaryOf(r);
  const c = real.centerShipments.get(r.shipmentId);
  const items = os?.items?.length
    ? os.items.map((i) => ({ k: i.orderLineId ?? i.name, name: `${i.name}${i.optionLabel ? ` (${i.optionLabel})` : ''}`, qty: i.qty, amt: i.lineAmount as number | null }))
    : ((r.pick ?? r.pack)?.detail?.lines ?? []).map((l) => ({ k: l.orderLineId, name: l.productName ?? l.sku, qty: l.plannedQty, amt: null as number | null }));
  const who = (t?: RealTask) => (t?.summary.assignment?.workerId ? real.workerName(t.summary.assignment.workerId) : t?.summary.pickedBy ? real.workerName(t.summary.pickedBy) : null);
  const flag = [r.pick, r.pack, r.ret].some((x) => x?.summary.late) ? '늦음' : [r.pick, r.pack, r.ret].some((x) => x?.summary.idle) ? '30분 멈춤' : '';
  // 단계 칩 — 지금 단계만 채운 칩(라이더 카드처럼), 끝난 단계는 ✓
  const chipText = ['피킹', '패킹', '랙', '배차', '인계'];
  // 배차를 기다린 시간(점원 배차 요청부터)
  const dispSince = c?.dispatchRequestedAt ?? r.info?.dispatchRequest?.requestedAt ?? null;
  const waitingRider = st.dots[3] === 'now' || st.dots[3] === 'bad';
  const rack = sim.rackFor(r.shipmentId).replace('DSP-A-0', '랙 ');
  return (
    <div className={`ocd tone-${st.tone} ${on ? 'on' : ''}`} onClick={() => (on ? focus.clear() : focus.show(r.shipmentId))} title={on ? '다시 누르면 선택 취소' : '누르면 3D 말풍선·바코드가 이 주문'}>
      <div className="ocd-h">
        <b className="ocd-no">
          <OrderNo shipmentId={r.shipmentId} />
        </b>
        {flag && <span className="oc-flag">{flag}</span>}
        <span className="ocd-amt">{os?.itemAmount != null ? won(os.itemAmount) : ''}</span>
      </div>
      <div className="ocd-chips">
        {st.dots.map((d, i) => (
          <Fragment key={STEPS[i]}>
            {i > 0 && <span className="ocd-sep">›</span>}
            <span className={`ocd-chip ${d}`}>
              {d === 'done' ? '✓ ' : ''}
              {chipText[i]}
            </span>
          </Fragment>
        ))}
      </div>
      <dl className="ocd-rows">
        <dt>피킹</dt>
        <dd>
          {tm.pick.start ? (
            <>
              {clock(tm.pick.start)} · <b className={tm.pick.running ? 'run' : ''}>{tm.pick.text ?? '—'}{tm.pick.running ? '째' : ''}</b>
            </>
          ) : (
            <span className="muted">시작 전</span>
          )}
        </dd>
        <dt>패킹</dt>
        <dd>
          {tm.pack.start ? (
            <>
              {clock(tm.pack.start)} · <b className={tm.pack.running ? 'run' : ''}>{tm.pack.text ?? '—'}{tm.pack.running ? '째' : ''}</b>
            </>
          ) : (
            <span className="muted">시작 전</span>
          )}
        </dd>
        {(who(r.pick) || who(r.pack ?? r.ret)) && (
          <>
            <dt>담당</dt>
            <dd className="muted">
              {who(r.pick) === who(r.pack ?? r.ret) || !who(r.pack ?? r.ret)
                ? who(r.pick)
                : `피킹 ${who(r.pick) ?? '—'} · 패킹 ${who(r.pack ?? r.ret)}`}
            </dd>
          </>
        )}
        {tm.readyAt && (
          <>
            <dt>랙</dt>
            <dd>
              {clock(tm.readyAt)} · {rack}
              {sim.serverRack(r.shipmentId) ? '' : <span className="guess">추정</span>} · 포장 {r.info?.packages?.length ?? 0}개
            </dd>
          </>
        )}
        {(dispSince || waitingRider) && (
          <>
            <dt>배차</dt>
            <dd className={st.tone === 'bad' ? 'bad' : ''}>
              {dispSince ? `${clock(dispSince)} · ` : ''}
              <b className={waitingRider ? 'warn' : ''}>
                {waitingRider && dispSince ? `${dur(dispSince, null)}째 ` : ''}
                {dispatchText(r).replace(/ RD-\S+/, '')}
              </b>
            </dd>
          </>
        )}
      </dl>
      {/* 라이더 카드처럼: 픽업(이 센터·랙) → 전달지(동 단위, R-27), 그 밑에 고객 요청사항 */}
      <ul className="ocd-route">
        <li>
          <span>픽업</span>
          <b>
            {sim.centerLabel} · {rack}
          </b>
        </li>
        <li>
          <span>전달지</span>
          {r.dispatch?.dropAreaLabel ? <b>{r.dispatch.dropAreaLabel}</b> : <i>아직 안 옴 — R-27 배포 전</i>}
        </li>
        <li className="note-li">
          <span>요청</span>
          {os ? <b>{os.deliveryNote || '없음'}</b> : <i>배송이 생기면 보임</i>}
        </li>
      </ul>
      <div className="ocd-items">
        <div className="ocd-ih">
          <span>상품 {items.length}개</span>
          <span />
        </div>
        {items.map((l) => (
          <div key={l.k}>
            <span className="nm">{l.name}</span>
            <span className="q">수량 {l.qty}개</span>
            <span className="a">{l.amt != null ? won(l.amt) : ''}</span>
          </div>
        ))}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <SystemIds
          ids={[
            ['출고', r.shipmentId],
            ['이행', r.fulfillmentId],
            ['배송', r.delivery?.deliveryId],
            ['서버 상태', `출고 ${r.info?.state ?? '—'}${v.dispatchState ? ` · 배차 ${v.dispatchState}` : ''}${v.execState ? ` · 배송 ${v.execState}` : ''}`],
          ]}
        />
      </div>
    </div>
  );
}

export function OrderCards() {
  const { sim } = useApp();
  return (
    <div className="ocds">
      {sim.real!.shipments().map((r) => (
        <OrderCard key={r.shipmentId} r={r} />
      ))}
    </div>
  );
}
