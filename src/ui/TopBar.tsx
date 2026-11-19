// 머리줄(pmart-rider-simulation ConsoleHeader 참고) — 왼쪽: 이름·센터·데이터 출처·작업자 수, 오른쪽: 실시간 시각·속도와 3D 보기 조작 한 묶음.
import { useApp, useTick, useView } from '../app/context';
import { SPEEDS } from '../config';
import type { LabelMode, RightView } from '../render/controller';
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
const VIEW_KO: Record<RightView, string> = { orders: '실제 주문', inventory: '재고', scan: '바코드', api: 'API 호출', events: '계약 이벤트', logs: '현장 기록' };

export function TopBar() {
  const { sim, ticker } = useApp();
  const view = useView();
  useTick();
  const mock = sim.mode === 'mock';
  const wall = view.wallUser ?? 0.32;
  const people = mock ? sim.workers : [...sim.observedWorkers, ...sim.virtualWorkers.filter((w) => !w.left)];
  const busy = people.filter((w) => w.state !== 'IDLE').length;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="title">MFC 가상 현장</span>
        {view.rightView && <span className="sub">{VIEW_KO[view.rightView]}</span>}
        <span className="chip" title="센터">
          {sim.params.mfcId}
        </span>
        <span className={`badge ${sim.mode}`} title={mock ? '가상(MOCK) — 시뮬레이터가 흉내 낸 값' : '실서버(LAN 백엔드)에서 읽은 값'}>
          {mock ? 'MOCK' : '실서버'}
        </span>
        <span className="stat" title={mock ? '작업 중 / 전체 작업자' : '작업 중 / 화면의 작업자(실제 PDA + 가상)'}>
          작업자 <b>{busy}</b>/{people.length}
        </span>
      </div>
      <div className="spacer" />
      <div className="clock" title={mock ? '시뮬레이션 시각' : '실제 시각'}>
        <span className={`live ${sim.speed === 0 ? 'paused' : ''}`} />
        {fmtClock(sim.time)}
      </div>
      <div className="seg" title={mock ? undefined : '실서버 모드는 실제 시각(1×)만 — SIM-1'}>
        {(mock ? SPEEDS : ([0, 1] as const)).map((s) => (
          <button
            key={s}
            className={sim.speed === s ? 'on' : undefined}
            onClick={() => {
              sim.speed = s;
              ticker.bump();
            }}
          >
            {s === 0 ? '❚❚' : mock ? `${s}×` : '실제 시각'}
          </button>
        ))}
      </div>
      <div className="seg" id="zones" aria-label="구역">
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
    </header>
  );
}
