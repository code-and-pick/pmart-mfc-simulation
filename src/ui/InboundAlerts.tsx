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
          // 색 클래스는 t- 접두어 — "act" 가 왼쪽 패널 단추 .act 와 겹쳐 카드가 가로로 깨지던 것(사용자 2026-11-27 캡처)
          className={`ia-c t-${a.tone}`}
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
          {/* 송장·운행은 이름표 + 값 두 칸, 상품은 굵게, "다음:"은 아래 강조 줄 — 고정폭 글자 덩어리로 보이던 것(사용자 2026-11-27 "UI 구려") */}
          <dl className="ia-kv">
            {a.lines
              .filter((l) => /^(송장|운행|박스|보냄) /.test(l))
              .map((l, i) => {
                const [k, ...v] = l.split(' ');
                return (
                  <div key={i}>
                    <dt>{k}</dt>
                    <dd>{v.join(' ')}</dd>
                  </div>
                );
              })}
          </dl>
          {a.lines
            .filter((l) => !/^(송장|운행|박스|보냄) /.test(l) && !l.startsWith('다음:'))
            .map((l, i) => (
              <div key={i} className="ia-p">
                {l}
              </div>
            ))}
          {a.lines
            .filter((l) => l.startsWith('다음:'))
            .map((l, i) => (
              <div key={i} className="ia-next">
                {l.replace(/^다음:\s*/, '다음 · ')}
              </div>
            ))}
          {a.view && <div className="ia-go">{a.view === 'scan' ? '바코드 탭 ›' : '입고 탭 ›'}</div>}
        </div>
      ))}
    </div>
  );
}
