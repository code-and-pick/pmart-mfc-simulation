// 현장 흐름판 — 주문마다 피킹 → 패킹 → 랙 → 배차 → 인계를 한 줄 단계 막대로(사용자 2026-11-20 "현장 탭 UI … 직관적이지 않잖아. 주문별로 … 피킹-패킹-인계 이런걸 볼 수 있는 게 없네").
// 맨 위 = 단계별 주문 수(누르면 그 단계만), 아래 = 지금 단계별 묶음. 주문 줄을 누르면 "실제 주문" 탭에서 그 주문 카드만(검색어로).
// 값은 주문 카드와 같은 곳(orderStatus·stageTimes, 서버/관찰판 값)에서만. 현장 사건(결품 등) 글 기록은 맨 아래 접어 둠.
import { useState } from 'react';
import { useApp, useView } from '../app/context';
import { fmtClock } from '../sim/metrics';
import { dispatchView, type RealShipment } from '../sim/realBoard';
import { orderStatus, stageTimes } from './OrderCards';
import { orderText } from './OrderNo';

const STEPS = ['피킹', '패킹', '랙', '배차', '인계'] as const;
/** 묶음: 0~4 = 지금 그 단계, 5 = 끝(픽업 완료·전달·취소) */
const GROUPS = ['피킹', '패킹', '랙 올리기', '배차 · 라이더', '인계(라이더 도착)', '끝'] as const;

const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : null);

export function SiteFlow() {
  const { sim } = useApp();
  const view = useView();
  const [only, setOnly] = useState<number | null>(null);
  const board = sim.board;
  const rows = (board?.shipments() ?? []).map((r) => {
    const st = orderStatus(sim, r);
    const cur = st.tone === 'done' ? 5 : Math.max(0, st.dots.findIndex((d) => d !== 'done'));
    return { r, st, cur: cur < 0 ? 5 : cur };
  });
  const count = GROUPS.map((_, i) => rows.filter((x) => x.cur === i).length);
  const open = (r: RealShipment) => {
    view.setScanShipment(r.shipmentId);
    view.openOrder(orderText(board!.orderNumberOf(r.shipmentId), r.shipmentId).replace(/\(번호 없음\)$/, ''));
  };
  return (
    <div className="sfl">
      <div className="sfl-pipe">
        {GROUPS.map((g, i) => (
          <button key={g} className={`sfl-p ${only === i ? 'on' : ''} ${count[i] ? '' : 'zero'}`} onClick={() => setOnly(only === i ? null : i)} title={only === i ? '다시 누르면 전체' : `${g} 단계 주문만`}>
            <b>{count[i]}</b>
            <span>{g === '인계(라이더 도착)' ? '인계' : g === '배차 · 라이더' ? '배차' : g === '랙 올리기' ? '랙' : g}</span>
          </button>
        ))}
      </div>
      {!rows.length && <div className="note">{board ? '지금 진행 중인 주문이 없습니다.' : '주문을 읽는 중…'}</div>}
      {GROUPS.map((g, gi) => {
        if (only != null && only !== gi) return null;
        const list = rows.filter((x) => x.cur === gi);
        if (!list.length) return null;
        // 오래 기다린 주문이 위로
        list.sort((a, b) => (a.r.createdAt < b.r.createdAt ? -1 : 1));
        return (
          <section key={g} className="sfl-g">
            <h4>
              {g} <span>{list.length}건</span>
            </h4>
            {list.map(({ r, st }) => {
              const tm = stageTimes(sim, r);
              const v = dispatchView(r);
              const c = board!.centerShipments.get(r.shipmentId);
              const disp = c?.dispatchRequestedAt ?? r.info?.dispatchRequest?.requestedAt ?? null;
              const who = r.pick?.summary.assignment?.workerId ?? r.pick?.summary.pickedBy ?? (r.pack ?? r.ret)?.summary.assignment?.workerId ?? null;
              const under = [
                tm.pick.text ? `${tm.pick.text}${tm.pick.running ? '째' : ''}` : '',
                tm.pack.text ? `${tm.pack.text}${tm.pack.running ? '째' : ''}` : '',
                clock(tm.readyAt) ?? '',
                v.riderId ? '라이더' : clock(disp) ?? '',
                clock(r.delivery?.pickedUpAt) ?? (v.stage === 'AT_STORE' ? '도착' : ''),
              ];
              return (
                <button key={r.shipmentId} className={`sfl-r tone-${st.tone}`} onClick={() => open(r)} title="누르면 실제 주문 탭에서 이 주문만">
                  <div className="sfl-h">
                    <b className={board!.orderNumberOf(r.shipmentId) ? '' : 'muted'}>{orderText(board!.orderNumberOf(r.shipmentId), r.shipmentId)}</b>
                    <span className="st">{st.text}</span>
                  </div>
                  <ol className="sfl-steps">
                    {STEPS.map((s, i) => (
                      <li key={s} className={st.dots[i]}>
                        <i />
                        <span className="n">{s}</span>
                        <span className="u">{under[i]}</span>
                      </li>
                    ))}
                  </ol>
                  {who && <div className="sfl-w">담당 {board!.workerName(who)}</div>}
                </button>
              );
            })}
          </section>
        );
      })}
      <details className="sfl-log">
        <summary>현장 사건 기록 {sim.logs.length ? `${sim.logs.length}건` : ''} (결품·보충·차단·오류)</summary>
        {sim.logs.length ? (
          sim.logs
            .slice(-80)
            .reverse()
            .map((l, i) => (
              <div className="row wrap" key={i}>
                <span className="t">{fmtClock(l.at)}</span>
                <span>{l.msg}</span>
              </div>
            ))
        ) : (
          <div className="note">아직 없습니다.</div>
        )}
      </details>
    </div>
  );
}
