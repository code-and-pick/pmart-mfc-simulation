// 왼쪽 아이콘 메뉴(pmart-rider-simulation App Rail 참고) — 오른쪽·왼쪽 패널 화면을 고르고, 다시 누르면 접는다. 맨 아래 테마.
import { useApp, useTick, useView } from '../app/context';
import type { LeftView, RightView } from '../render/controller';
import { collectIssues } from '../sim/issues';

const REAL_RIGHT: [RightView, string, string][] = [
  ['orders', '📋', '실제 주문'],
  ['logs', '☰', '현장'],
  ['inventory', '▦', '재고'],
  ['scan', '▥', '바코드'],
  ['api', '⧉', 'API'],
];
const MOCK_RIGHT: [RightView, string, string][] = [
  ['logs', '☰', '현장'],
  ['api', '⧉', 'API'],
  ['events', '⇄', '이벤트'],
  ['inventory', '▦', '재고'],
  ['scan', '▥', '바코드'],
];
const LEFT: [LeftView, string, string][] = [
  ['settings', '⚙', '설정'],
  ['zone', '▣', '구역'],
  ['help', '?', '도움말'],
];

export function Rail() {
  const { sim } = useApp();
  const view = useView();
  useTick();
  const issues = collectIssues(sim).length;
  return (
    <nav className="rail" aria-label="화면">
      <span className="rail-logo" aria-hidden>
        P
      </span>
      {(sim.real ? REAL_RIGHT : [REAL_RIGHT[0], ...MOCK_RIGHT]).map(([v, icon, label]) => (
        <button key={v} className={view.rightView === v ? 'on' : ''} aria-pressed={view.rightView === v} onClick={() => view.toggleRight(v)} title={`${label} (다시 누르면 접기)`}>
          <span className="rail-i" aria-hidden>
            {icon}
          </span>
          <span className="rail-l">{label}</span>
          {v === 'orders' && issues > 0 && <span className="rail-badge">{issues}</span>}
        </button>
      ))}
      <span className="rail-sep" />
      {LEFT.map(([v, icon, label]) => (
        <button key={v} className={view.leftView === v ? 'on' : ''} aria-pressed={view.leftView === v} onClick={() => view.toggleLeft(v)} title={`${label} (다시 누르면 접기)`}>
          <span className="rail-i" aria-hidden>
            {icon}
          </span>
          <span className="rail-l">{label}</span>
        </button>
      ))}
      <button className="rail-theme" onClick={() => view.setTheme(view.theme === 'dark' ? 'light' : 'dark')} title={view.theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}>
        <span className="rail-i" aria-hidden>
          {view.theme === 'dark' ? '☀' : '☾'}
        </span>
        <span className="rail-l">{view.theme === 'dark' ? '밝게' : '어둡게'}</span>
      </button>
    </nav>
  );
}
