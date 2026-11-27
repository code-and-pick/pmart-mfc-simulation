// 입고 알림 카드 — 화면 오른쪽 위에 쌓인다. 배차·출발·도착·인계·수령·검사·적치 끝.
// 도착(할 일)·입고 끝은 닫을 때까지, 나머지는 20초 뒤 사라짐. 누르면 그 일의 오른쪽 탭(바코드·입고 추적)으로.
// (사용자 2026-11-27 "어디냤고 알림이랑 하차작업 팝업 좀 바로바로 띄워")
import { useEffect } from 'react';
import { useApp, useTick, useView } from '../app/context';

const AUTO_HIDE_MS = 20_000;

export function InboundAlerts() {
  const { sim } = useApp();
  const ctl = useView();
  useTick();
  const now = Date.now();
  // 지난 것 지우기(sticky 아님)
  useEffect(() => {
    for (const a of sim.alerts) if (!a.sticky && now - a.at > AUTO_HIDE_MS) sim.dismissAlert(a.id);
  });
  const list = sim.alerts.filter((a) => a.sticky || now - a.at <= AUTO_HIDE_MS);
  if (!list.length) return null;
  return (
    <div className="ia">
      {list.map((a) => (
        <div
          key={a.id}
          className={`ia-c ${a.tone}`}
          role="alert"
          onClick={() => {
            if (a.view && ctl.rightView !== a.view) ctl.toggleRight(a.view);
          }}
        >
          <div className="ia-h">
            <b>{a.title}</b>
            <span>{new Date(a.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
            <button
              className="ia-x"
              title="닫기"
              onClick={(e) => {
                e.stopPropagation();
                sim.dismissAlert(a.id);
              }}
            >
              ✕
            </button>
          </div>
          {a.lines.map((l, i) => (
            <div key={i} className="ia-l">
              {l}
            </div>
          ))}
          {a.view && <div className="ia-go">{a.view === 'scan' ? '바코드 탭에서 보기 ›' : '입고 추적에서 보기 ›'}</div>}
        </div>
      ))}
    </div>
  );
}
