// 실제 주문 카드 — 관리자가 한눈에(ADR-0070, 라이더 관제 카드 참고). 아래 OrderCard 설명.
import { isInboundAccount, workerShortName } from '../domain/workerName';
import { placeShortName } from '../domain/placeName';
import { Fragment, useState } from 'react';
import { useApp, useView } from '../app/context';
import type { Simulation } from '../sim/simulation';
import { dispatchText, dispatchView, type RealShipment, type RealTask } from '../sim/realBoard';
import { OrderNo, SystemIds } from './OrderNo';
import { useScanFocus } from './scanFocus';
import { matchFields, searchFields, type SearchField } from './orderSearch';

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
  let pick = taskDot(r.pick);
  let pack = taskDot(r.pack ?? r.ret);
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
  // 뒤 단계가 시작됐으면 앞 단계는 끝난 것 — 끝난 작업이 목록에서 빠져(작업 없음 = 'wait') 피킹 기다림으로 보이던 것(사용자 2026-11-20 흐름판)
  for (let i = dots.length - 2; i >= 0; i--) if (dots[i] === 'wait' && dots[i + 1] !== 'wait') dots[i] = 'done';
  [pick, pack] = [dots[0], dots[1]];
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
let nowFn: () => number = () => Date.now();
function dur(fromIso: string | null | undefined, toMs: number | null): string | null {
  if (!fromIso) return null;
  const sec = Math.max(0, Math.round(((toMs ?? nowFn()) - Date.parse(fromIso)) / 1000));
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
  nowFn = () => sim.nowMs();
  const c = sim.board?.centerShipments.get(r.shipmentId);
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
export function OrderCard({ r, hit }: { r: RealShipment; hit?: SearchField | null }) {
  const { sim } = useApp();
  const real = sim.board!;
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
  const rack = sim.rackFor(r.shipmentId).replace('DSP-A-0', '인계 랙 ');
  return (
    <div className={`ocd tone-${st.tone} ${on ? 'on' : ''}`} onClick={() => (on ? focus.clear() : focus.show(r.shipmentId))} title={on ? '다시 누르면 선택 취소' : '누르면 3D 말풍선·바코드가 이 주문'}>
      <div className="ocd-h">
        <b className="ocd-no">
          <OrderNo shipmentId={r.shipmentId} />
        </b>
        {flag && <span className="oc-flag">{flag}</span>}
        <span className="ocd-amt">{os?.itemAmount != null ? won(os.itemAmount) : ''}</span>
      </div>
      {hit && hit.kind !== '주문번호' && (
        <div className="ocd-hit">
          <span>{hit.kind}</span>
          {hit.kind === '시스템 ID' ? <b>일치</b> : <b>{hit.text}</b>}
        </div>
      )}
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
                {dispatchText(r, (id) => real.riderLabel(id))}
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
          {(r.dispatch?.dropAreaLabel ?? (r.info as { dropAreaLabel?: string } | undefined)?.dropAreaLabel) ? <b>{r.dispatch?.dropAreaLabel ?? (r.info as { dropAreaLabel?: string }).dropAreaLabel}</b> : <i>배차되면 보임</i>}
        </li>
        <li className="note-li">
          <span>요청</span>
          {os ? <b>{os.deliveryNote || '없음'}</b> : <i>배송이 생기면 보임</i>}
        </li>
      </ul>
      {/* 현장 흐름판과 같은 단계 막대를 작고 얇게(사용자 2026-11-20 "상품 위쪽에 작고 얇게 *-*-*-*-*") */}
      <ol className="sfl-steps mini">
        {st.dots.map((d, i) => (
          <li key={STEPS[i]} className={d}>
            <i />
            <span className="n">{STEPS[i]}</span>
          </li>
        ))}
      </ol>
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

function placeName(code: string): string {
  if (code.startsWith('PAK-A-')) return `패킹대 ${Number(code.slice(-2))}`;
  if (code.startsWith('DSP-A-')) return `인계 랙 ${Number(code.slice(-2))}`;
  return code;
}

export function OrderCards() {
  const { sim } = useApp();
  const view = useView();
  const place = view.placeFilter;
  // 점원이 다음 주문으로 넘어가면 따라 바뀐다(누른 때 주문이 아니라 지금 주문)
  const wf0 = view.workerFilter;
  const inbW = wf0 && isInboundAccount(wf0.id) ? (sim.siteWorkers().find((x) => x.id === wf0.id) ?? null) : null;
  const wf = wf0 ? { id: wf0.id, shipmentId: sim.siteWorkers().find((x) => x.id === wf0.id)?.pda?.shipmentId ?? wf0.shipmentId } : null;
  const all = sim.board!.shipments();
  const at = place ? sim.shipmentsAt(place) : [];
  const base = place ? all.filter((r) => at.some((a) => a.shipmentId === r.shipmentId)) : wf ? all.filter((r) => r.shipmentId === wf.shipmentId) : all;
  // 검색은 자리·점원 거르기 위에 한 번 더(검색어가 있으면 맞은 주문만, 무엇이 맞았는지 카드에)
  const q = view.orderSearch;
  const hits = new Map<string, SearchField | null | undefined>();
  for (const r of base) hits.set(r.shipmentId, matchFields(searchFields(sim, r), q));
  const searched = q.trim() ? base.filter((r) => hits.get(r.shipmentId)) : base;
  // 흐름 칸을 누르면 그 단계 주문만
  const [stage, setStage] = useState<number | null>(null);
  const stageOf = (r: RealShipment) => {
    if (r.info?.state === 'CANCELLED') return -1; // 출고 취소 — 흐름에 넣지 않는다
    const i = orderStatus(sim, r).dots.findIndex((d) => d !== 'done');
    return i < 0 ? STEPS.length : i;
  };
  const rows = stage === null ? searched : searched.filter((r) => stageOf(r) === stage);
  return (
    <div className="ocds">
      <div className="ocd-search">
        <input
          type="text"
          value={q}
          placeholder="주문번호 · 점원 이름/사번 · 라이더 번호"
          onChange={(e) => view.setOrderSearch(e.target.value)}
          onKeyDown={(e) => {
            // Esc 는 3D 나가기로 가지 않고 검색만 지운다
            e.stopPropagation();
            if (e.key === 'Escape') view.setOrderSearch('');
          }}
        />
        {q.trim() && (
          <>
            <span className="cnt">
              {rows.length}/{base.length}건
            </span>
            <button className="link" onClick={() => view.setOrderSearch('')}>
              ✕
            </button>
          </>
        )}
      </div>
      <FlowStrip all={searched} stageOf={stageOf} sel={stage} onSel={setStage} />
      {q.trim() && !rows.length && (
        <div className="scan-empty">
          “{q.trim()}” 와 맞는 진행 중 주문이 없습니다. 주문번호 일부, 점원 이름·사번, 라이더 번호로 찾을 수 있어요.
          {sim.admin && (
            <div>
              <button className="link" onClick={() => view.openAdminHistory(q.trim())}>
                끝난 주문에서 찾기 →
              </button>
            </div>
          )}
        </div>
      )}
      {wf && (
        <div className="ocd-place">
          <b title={wf.id}>{workerShortName(wf.id)}</b>
          <span>{inbW ? '입고 작업' : wf.shipmentId ? '작업 중 주문' : '맡은 주문 없음'}</span>
          {/* 떠 있는 점원 카드 대신 여기서 따라가기 */}
          <button className={`follow ${view.follow === wf.id ? 'on' : ''}`} onClick={() => view.setFollow(view.follow !== wf.id)} title="카메라가 이 점원을 따라갑니다(왼쪽 끌기로 화면을 옮기면 꺼짐)">
            {view.follow === wf.id ? '따라가는 중' : '따라가기'}
          </button>
          <button className="link" onClick={() => view.select(null, false)}>
            전체 ✕
          </button>
        </div>
      )}
      {/* 입고 점원(검사·적치)은 주문이 없다 — 하고 있는 작업을 여기 오른쪽 탭에(사용자 2026-11-20 "팝업창이 아니라 오른쪽 탭에 뜨게 하라고") */}
      {inbW && <InboundWorkCard w={inbW} />}
      {wf && !inbW && !rows.length && <div className="scan-empty">이 점원은 지금 맡은 주문이 없습니다.</div>}
      {place && (
        <div className="ocd-place">
          <b>{placeName(place)}</b>
          <span>주문 {rows.length}건</span>
          {at.some((a) => a.guess) && <span className="guess" title="서버가 이 자리를 알려 주지 않아 화면이 짐작">추정</span>}
          <button className="link" onClick={() => view.showPlace(null)}>
            전체 주문 ✕
          </button>
        </div>
      )}
      {place && !rows.length && <div className="scan-empty">{place.startsWith('PAK-') ? '지금 이 패킹대에서 포장 중인 주문이 없습니다.' : '이 랙에 올린 포장이 없습니다.'}</div>}
      {rows.map((r) => (
        <OrderCard key={r.shipmentId} r={r} hit={hits.get(r.shipmentId)} />
      ))}
    </div>
  );
}

const INB_KO: Record<string, string> = { INSPECT: '품질검사', PUTAWAY: '적치' };

/** 입고 점원 작업 — 무슨 작업, 어떤 상품을 어디서 어디로, 몇 개, 지금 하는 일 */
function InboundWorkCard({ w }: { w: { activity: string; pda: { taskType: string; productName: string | null; barcode: string | null; location: string | null; nextLocation: string | null; temp: string | null; plannedQty: number | null; pickedQty: number | null; step: string } | null } }) {
  const d = w.pda;
  if (!d) return <div className="scan-empty">지금 하는 입고 작업이 없습니다 — {w.activity}</div>;
  const put = d.taskType === 'PUTAWAY';
  return (
    <div className="ocd inb-work">
      <div className="ocd-h">
        <b>{INB_KO[d.taskType] ?? d.taskType}</b>
        {d.temp && <span>{d.temp}</span>}
      </div>
      <dl className="inb-dl">
        <dt>상품</dt>
        <dd>{d.productName ?? '—'}</dd>
        {d.barcode && (
          <>
            <dt>바코드</dt>
            <dd>{d.barcode}</dd>
          </>
        )}
        <dt>수량</dt>
        <dd>{d.plannedQty ?? '—'}개</dd>
        {put ? (
          <>
            <dt>어디로</dt>
            <dd>
              <b>{d.nextLocation ?? d.location ?? '—'}</b>
            </dd>
          </>
        ) : (
          <>
            <dt>검사 자리</dt>
            <dd>{d.location ?? '—'}</dd>
          </>
        )}
      </dl>
      <InboundSteps put={put} step={d.step} from={d.location?.startsWith('RCV') ? d.location : null} to={d.nextLocation ?? d.location} />
    </div>
  );
}

/**
 * 입고 작업 흐름 — 세로 단계(끝난 단계 ✓, 지금 단계 강조). PDA 단계 문구(realWorker)로 지금 위치를 정한다
 * (사용자 2026-11-20 "적치 → RCV-A-01 — RCV-A-01 스캔 → 상품 싣기 이거 *-*-*-*-* 이런식으로 흐름 직관적으로 … 세로로")
 */
function InboundSteps({ put, step, from, to }: { put: boolean; step: string; from: string | null; to: string | null }) {
  const name = (c: string | null) => (c ? placeShortName(c) : '');
  const steps = put
    ? ['보낼 선반 찾기', `${name(from) || '입고칸'}에서 상자 싣기`, `${to && !to.startsWith('RCV') ? to : '선반'}에 내려놓기`, '적치 끝(서버 반영)']
    : [`${name(from) || '입고칸'}으로 가기`, '라벨·소비기한 확인', '정상/격리 판정 보내기', '검사 끝(서버 반영)'];
  const cur = put
    ? step.includes('반영됨') ? 4 : step.includes('내려놓기') ? 2 : step.includes('싣기') ? 1 : 0
    : step.includes('반영됨') ? 4 : step.startsWith('판정') ? 2 : step.includes('확인') ? 1 : 0;
  return (
    <ol className="inb-steps">
      {steps.map((t, i) => (
        <li key={i} className={i < cur ? 'done' : i === cur ? 'now' : ''}>
          <i>{i < cur ? '✓' : i + 1}</i>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * 피킹 → 패킹 → 랙 → 배차 → 인계 흐름 — 단계마다 지금 그 단계에 있는 주문 수와 주문번호(4개까지 + 외 N). 칸을 누르면 그 단계 주문만 아래에
 * (사용자 2026-11-20 "오른쪽화면탭에서 피킹-패킹 흐름에 따라 주문번호를 볼 수 있는 기능도 검색창 아래에")
 */
function FlowStrip({ all, stageOf, sel, onSel }: { all: RealShipment[]; stageOf: (r: RealShipment) => number; sel: number | null; onSel: (i: number | null) => void }) {
  const { sim } = useApp();
  const by: RealShipment[][] = STEPS.map(() => []);
  for (const r of all) {
    const i = stageOf(r);
    if (i >= 0 && i < STEPS.length) by[i].push(r);
  }
  const cancelled = all.filter((r) => stageOf(r) < 0).length;
  const no = (r: RealShipment) => sim.board!.orderNumberOf(r.shipmentId) ?? r.shipmentId.slice(-6);
  return (
    <div className="flow">
      {STEPS.map((name, i) => (
        <Fragment key={name}>
          {i > 0 && <span className="flow-arrow">›</span>}
          <button className={`flow-st ${sel === i ? 'on' : ''} ${by[i].length ? '' : 'empty'}`} onClick={() => onSel(sel === i ? null : i)} title={sel === i ? '다시 누르면 전체' : `${name} 단계 주문만 보기`}>
            <span className="flow-h">
              {name} <b>{by[i].length}</b>
            </span>
            {by[i].slice(0, 4).map((r) => (
              <span key={r.shipmentId} className="flow-no">
                {no(r)}
              </span>
            ))}
            {by[i].length > 4 && <span className="flow-more">외 {by[i].length - 4}</span>}
          </button>
        </Fragment>
      ))}
      {cancelled > 0 && (
        <button className={`flow-st cancel ${sel === -1 ? 'on' : ''}`} onClick={() => onSel(sel === -1 ? null : -1)} title="출고 취소된 주문">
          <span className="flow-h">
            취소 <b>{cancelled}</b>
          </span>
        </button>
      )}
    </div>
  );
}
