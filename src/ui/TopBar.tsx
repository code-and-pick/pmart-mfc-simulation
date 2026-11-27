// 머리줄(pmart-rider-simulation ConsoleHeader 참고) — 왼쪽: 이름·센터·데이터 출처·작업자 수, 오른쪽: 시각·속도.
// 3D 보기 조작(구역·번호판·벽)은 3D 위 떠 있는 칩 줄 ViewBar 로(2026-11-20 — 머리줄에서 두 줄로 깨지던 것).
import { useState } from 'react';
import { useApp, useTick, useView } from '../app/context';
import { MFC_SITES, SPEEDS } from '../config';
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
const VIEW_KO: Record<RightView, string> = { orders: '실제 주문', inventory: '재고', stock: '재고 변동', inbound: '입고 추적', scan: '바코드', api: 'API 호출', events: '계약 이벤트', logs: '현장 흐름', admin: '관리' };

export function TopBar() {
  const { sim, ticker } = useApp();
  const view = useView();
  useTick();
  const mock = sim.mode === 'mock';
  const people = mock ? sim.workers : [...sim.observedWorkers, ...sim.virtualWorkers.filter((w) => !w.left)];
  const busy = people.filter((w) => w.state !== 'IDLE').length;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="title">MFC 가상 현장</span>
        {view.rightView && <span className="sub">{VIEW_KO[view.rightView]}</span>}
        {/* 바코드·입고 추적 탭이면 지금 PDA 가 받아 둔 입고 작업의 TRF(사용자 2026-11-27 "오른쪽 탭에 어떤 trf 작업인지 뜨게") */}
        {/* 지금 하는 입고 일 — 와 있는 DC 차량(운행·송장) 또는 PDA 가 받아 둔 검사·적치(TRF). 어느 탭이든(사용자 2026-11-27 "도착 번호나 trf 번호가 안 떠서 내가 지금 무슨 작업 중인지 모르겠다") */}
        {sim.real &&
          (() => {
            const now = sim.inboundScan.items.find((x) => !!x.task.assigneeId);
            const truck = sim.dcArrivals.find((a) => a.stop === 'ARRIVED');
            return (
              <>
                {truck && (
                  <span className="chip inb-now-chip" title={`${truck.tripId} · ${truck.trfIds.join(', ')}`}>
                    하차 · 운행 {truck.tripId} · {truck.trfIds.join(', ')}
                  </span>
                )}
                {now && (
                  <span className="chip inb-now-chip" title={now.task.taskId}>
                    PDA {now.task.taskType === 'INSPECT' ? '품질검사' : now.task.taskType === 'PUTAWAY' ? '적치' : '격리 이동'} · {now.source.label} · {now.task.productName ?? now.task.sku}
                  </span>
                )}
              </>
            );
          })()}
        <span className="chip" title={`센터 ${sim.centerId}`}>
          {sim.centerLabel}
        </span>
        <SiteSwitch />
        <ModeSwitch />
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
    </header>
  );
}

/** 3D 위 떠 있는 보기 조작 — 왼쪽: 구역, 오른쪽: 번호판·벽 */
export function ViewBar() {
  const view = useView();
  const wall = view.wallUser ?? 0.32;
  return (
    <div className="viewbar">
      <div className="seg float" id="zones" aria-label="구역">
        {view.views.map((v) => (
          <button key={v.key} className={view.focusedZone === v.key ? 'on' : undefined} onClick={() => view.focusZone(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="seg float" title="랙 번호판은 늘, 칸 번호는 가까이 확대했을 때 보입니다">
        {LABEL_MODES.map((l) => (
          <button key={l.mode} className={view.labelMode === l.mode ? 'on' : undefined} onClick={() => view.setLabelMode(l.mode)}>
            {l.text}
          </button>
        ))}
        <span className="seg-sep" />
        {WALLS.map((w) => (
          <button key={w.o} className={wall === w.o ? 'on' : undefined} onClick={() => view.setWallOpacity(w.o)}>
            {w.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * MOCK ↔ 실서버 — 머리줄에서 바로 바꾼다(사용자 2026-11-20 "상단바에서 터치로 바꿀 수 있게"). 바꾸면 설정을 저장하고 화면을 다시 연다.
 * 가상 작업자가 돌고 있으면 한 번 더 눌러야 바뀐다(다시 열면 멈춤 — 서버에 남은 작업은 "끊긴 작업"으로 이어 하기).
 */
/**
 * 지점 전환(사용자 2026-11-22 "MFC 전환가능하도록 버튼 만들어주고") — 1호점 부산 · 2호점 목포. 평면·랙·상품 수는 같고 센터 ID·계정·MOCK 동네가 바뀐다.
 * 화면을 다시 연다(시뮬레이터를 새로 만듦). 실서버 가상 작업자가 돌고 있으면 한 번 더 눌러야 바뀐다(모드 전환과 같음)
 */
function SiteSwitch() {
  const { sim, settings, restart } = useApp();
  const [arm, setArm] = useState<string | null>(null);
  const running = sim.virtualWorkers.filter((w) => !w.left).length;
  const go = (id: string) => {
    if (id === sim.params.mfcId) return;
    if (running && arm !== id) {
      setArm(id);
      setTimeout(() => setArm(null), 4000);
      return;
    }
    restart({ ...settings, mfcId: id });
  };
  return (
    <span className="mode-sw" title="MFC 지점 — 평면·랙·상품 수는 같고 센터·계정이 다름">
      {MFC_SITES.map((s) => (
        <button key={s.id} className={sim.params.mfcId === s.id ? 'on mock' : ''} onClick={() => go(s.id)} title={`${s.name} (${sim.mode === 'mock' ? (s.mockId ?? s.id) : s.id}) · ${s.address}`}>
          {s.short}
        </button>
      ))}
      {arm && <span className="mode-warn">가상 작업자 {running}명이 멈춥니다 — 한 번 더 누르면 지점 전환</span>}
    </span>
  );
}

function ModeSwitch() {
  const { sim, settings, restart } = useApp();
  const [arm, setArm] = useState<'mock' | 'http' | null>(null);
  const mock = sim.mode === 'mock';
  const running = sim.virtualWorkers.filter((w) => !w.left).length;
  const go = (m: 'mock' | 'http') => {
    if (m === sim.mode) return;
    if (running && arm !== m) {
      setArm(m);
      setTimeout(() => setArm(null), 4000);
      return;
    }
    restart({ ...settings, mode: m, http: settings.http });
  };
  return (
    <span className="mode-sw" title={mock ? '가상(MOCK) — 시뮬레이터가 흉내 낸 값' : '실서버(LAN 백엔드)에서 읽은 값'}>
      <button className={mock ? 'on mock' : ''} onClick={() => go('mock')}>
        MOCK
      </button>
      <button className={!mock ? 'on http' : ''} onClick={() => go('http')}>
        실서버
      </button>
      {arm && <span className="mode-warn">가상 작업자 {running}명이 멈춥니다 — 한 번 더 누르면 전환</span>}
    </span>
  );
}
