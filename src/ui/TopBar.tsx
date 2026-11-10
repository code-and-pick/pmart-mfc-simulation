import { useApp, useTick, useView } from '../app/context';
import { SPEEDS } from '../config';
import type { LabelMode } from '../render/controller';
import { fmtClock } from '../sim/metrics';

const LABEL_MODES: { mode: LabelMode; text: string }[] = [
  { mode: 'all', text: '번호' },
  { mode: 'rack', text: '랙만' },
  { mode: 'off', text: '끔' },
];
const WALLS: { o: number; text: string }[] = [
  { o: 0.32, text: '벽' },
  { o: 0, text: '벽 숨김' },
];

export function TopBar() {
  const { sim, ticker } = useApp();
  const view = useView();
  useTick();
  const mock = sim.mode === 'mock';
  const wall = view.wallUser ?? 0.32;
  return (
    <div className="topbar">
      <div className="brand">PMart MFC 가상 현장</div>
      <span className={`badge ${sim.mode}`}>{mock ? 'MOCK 백엔드' : '실서버'}</span>
      <div className="clock">{fmtClock(sim.time)}</div>
      <div className="seg">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={sim.speed === s ? 'on' : undefined}
            onClick={() => {
              sim.speed = s;
              ticker.bump();
            }}
          >
            {s === 0 ? '❚❚' : `${s}×`}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <div className="seg" id="zones">
        {view.views.map((v) => (
          <button key={v.key} className={view.focusedZone === v.key ? 'on' : undefined} onClick={() => view.focusZone(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="seg" title="랙 번호판은 늘, 칸 번호는 가까이 확대했을 때 보입니다">
        {LABEL_MODES.map((l) => (
          <button key={l.mode} className={view.labelMode === l.mode ? 'on' : undefined} onClick={() => view.setLabelMode(l.mode)}>
            {l.text}
          </button>
        ))}
      </div>
      <div className="seg">
        {WALLS.map((w) => (
          <button key={w.o} className={wall === w.o ? 'on' : undefined} onClick={() => view.setWallOpacity(w.o)}>
            {w.text}
          </button>
        ))}
      </div>
    </div>
  );
}
