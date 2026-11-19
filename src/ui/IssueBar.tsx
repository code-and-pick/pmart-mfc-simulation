// "확인할 일" 띠(pmart-rider-simulation ui/IssueBar 참고) — 없으면 얇은 초록 줄, 있으면 빨강(심각)·주황(주의) 띠 + 카드. 카드를 누르면 그 주문·작업자로.
import { useState } from 'react';
import { useApp, useTick, useView } from '../app/context';
import { ISSUES } from '../config';
import { collectIssues, type Issue } from '../sim/issues';

export function IssueBar() {
  const { sim } = useApp();
  const view = useView();
  useTick();
  const [open, setOpen] = useState(false);
  const issues = collectIssues(sim);
  if (!issues.length) return <div className="ib ib-ok">● 이상 없음 — 지금 확인할 일이 없어요</div>;
  const bad = issues.filter((i) => i.level === 'bad').length;
  const warn = issues.length - bad;
  const shown = open ? issues : issues.slice(0, ISSUES.shown);
  const go = (i: Issue) => {
    if (!i.go) return;
    if (i.go.shipmentId) {
      if (view.rightView !== 'orders' && sim.real) view.toggleRight('orders');
      view.setScanShipment(i.go.shipmentId);
    } else if (i.go.personId) view.select({ kind: 'worker', id: i.go.personId });
    else if (i.go.settings && view.leftView !== 'settings') view.toggleLeft('settings');
  };
  return (
    <div className={`ib ${bad ? 'ib-bad' : 'ib-warn'}`} role="alert">
      <div className="ib-head">
        <span className="ib-icon" aria-hidden>
          !
        </span>
        <div className="ib-count">
          <b>확인할 일 {issues.length}건</b>
          <span>
            {bad > 0 && <em className="bad">심각 {bad}</em>}
            {warn > 0 && <em className="warn">주의 {warn}</em>}
          </span>
        </div>
      </div>
      <ul className="ib-cards">
        {shown.map((i) => (
          <li key={i.key}>
            <button className={`ib-card ${i.level}`} onClick={() => go(i)} disabled={!i.go} title={i.go ? '눌러서 보기' : undefined}>
              <span className="ib-card-1">
                <span aria-hidden>{i.icon}</span> {i.title}
              </span>
              <span className="ib-card-2">{i.what}</span>
            </button>
          </li>
        ))}
      </ul>
      {issues.length > ISSUES.shown && (
        <button className="ib-more" onClick={() => setOpen(!open)}>
          {open ? '접기' : `${issues.length - ISSUES.shown}건 더`}
        </button>
      )}
    </div>
  );
}
