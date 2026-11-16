import { useRef, useState } from 'react';
import { useApp, useTick } from '../app/context';
import { HttpBackend } from '../backend/http/HttpBackend';
import { TokenSource } from '../backend/http/tokens';
import { BACKEND_FACTS, REAL_LINK } from '../config';
import { INBOUND_COLOR, STATE_COLOR, TEMP_COLOR, hex } from '../render/colors';
import type { InboundState } from '../sim/inbound';
import { fmtClock } from '../sim/metrics';
import type { HttpSettings } from '../sim/simulation';
import type { WorkerState } from '../sim/worker';
import { INBOUND_KO, STATE_KO } from './text';

function Slider(props: { name: string; initial: number; min: number; max: number; step: number; hint: string; apply: (v: number) => void }) {
  const [v, setV] = useState(props.initial);
  return (
    <div className="field">
      <label>
        {props.name}
        <b>{v}</b>
      </label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={v}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          props.apply(n);
        }}
      />
      <small>{props.hint}</small>
    </div>
  );
}

const LEGEND_WORKER: WorkerState[] = ['IDLE', 'TO_CART', 'PICKING', 'WAIT_STATION', 'PACKING', 'TO_SHIP', 'ERROR'];
const LEGEND_INBOUND: InboundState[] = ['RECEIVING', 'PUTAWAY', 'REPLENISH'];

function Legend() {
  const dot = (bg: string, square = false) => <i className="dot" style={{ background: bg, ...(square ? { borderRadius: 2 } : {}) }} />;
  return (
    <div className="legend">
      {LEGEND_WORKER.map((s) => (
        <span key={s}>
          {dot(hex(STATE_COLOR[s]))}
          {STATE_KO[s]}
        </span>
      ))}
      {LEGEND_INBOUND.map((s) => (
        <span key={s}>
          {dot(hex(INBOUND_COLOR[s]))}입고 {INBOUND_KO[s]}
        </span>
      ))}
      <span>{dot('#1e88e5', true)}파란 조끼 피킹·패킹</span>
      <span>{dot('#ff9800', true)}주황 조끼 입고</span>
      <span>{dot(hex(TEMP_COLOR.AMBIENT))}상온 상품</span>
      <span>{dot(hex(TEMP_COLOR.CHILLED))}냉장 상품</span>
      <span>{dot(hex(TEMP_COLOR.FROZEN))}냉동 상품</span>
      <span>{dot('#26c6da')}라이더</span>
    </div>
  );
}

function InboundControls() {
  const { sim, controller } = useApp();
  useTick();
  const p = sim.params;
  const ibb = sim.inboundBoard();
  return (
    <>
      <h3>입고·적치·보충</h3>
      <Slider name="입고 작업자" initial={p.inboundWorkers} min={0} max={8} step={1} hint="기준 3명 (검수 2 + 이송 1, MFC 10장 가정)" apply={(v) => sim.setInboundWorkers(v)} />
      <Slider
        name="입고 차량 주기 (시간)"
        initial={p.inboundIntervalHours}
        min={1}
        max={8}
        step={1}
        hint="실제는 매일 오전 1회 [확정] — 적치 과정을 보려고 짧게 [시뮬]"
        apply={(v) => (sim.params.inboundIntervalHours = v)}
      />
      <button
        className="btn"
        onClick={() => {
          if (sim.callTruck()) controller.focusZone('RCV');
        }}
      >
        입고 차량 지금 부르기
      </button>
      <div className="probe">
        다음 정기 입고 {fmtClock(ibb.nextTruckAt)} · 입고 작업자 {sim.inboundWorkers.filter((w) => !w.idle).length}/{sim.inboundWorkers.length} 작업 중
      </div>
    </>
  );
}

function BackendSettings() {
  const { sim, settings, restart } = useApp();
  useTick();
  const mock = sim.mode === 'mock';
  const baseUrl = useRef<HTMLInputElement>(null);
  const [probe, setProbe] = useState('—');
  const readHttp = (): HttpSettings => ({ baseUrl: baseUrl.current?.value.trim() || '/api/v1' });
  const runProbe = async () => {
    setProbe('확인 중…');
    const tokens = new TokenSource(REAL_LINK.observerAccount, REAL_LINK.tokenRefreshMarginSec);
    const be = new HttpBackend({ baseUrl: readHttp().baseUrl, token: () => tokens.get(), sourceSystem: 'mfc-simulator', now: () => sim.time, timeoutMs: 8000 });
    be.onApi((r) => sim.apiLog.push(r));
    const r = await be.probe(sim.params.mfcId);
    setProbe(tokens.lastError ? `${tokens.lastError}` : tokens.serverInjected ? `${r} (다른 기기 — 조회만)` : r);
  };
  const real = sim.real;
  return (
    <>
      <h3>실서버 연결</h3>
      <div className="field">
        <label>게이트웨이 경로</label>
        <input type="text" ref={baseUrl} defaultValue={settings.http.baseUrl} />
        <small>개발 서버가 /api 를 PMART_GATEWAY(기본 http://D603-16:8080)로 넘깁니다.</small>
      </div>
      <div className="probe">
        계정 {REAL_LINK.observerAccount} · 센터 {sim.params.mfcId}
        <br />
        {sim.realTokens?.serverInjected
          ? '다른 기기에서 보는 중 — 개발 서버가 관찰 계정으로 조회해 줍니다(조회만, 토큰은 이 기기로 오지 않음).'
          : '토큰은 개발 서버가 LAN 시험 계정으로 받아 줍니다(비밀번호는 브라우저로 오지 않음).'}
      </div>
      <button className="btn ghost" onClick={runProbe}>
        연결 점검
      </button>
      <div className="probe">{probe}</div>
      {real && (
        <div className="probe">
          {real.lastError
            ? `조회 오류: ${real.lastError}${sim.realTokens?.lastError ? ` (${sim.realTokens.lastError})` : ''}`
            : real.lastOkMs
              ? `${REAL_LINK.pollSec}초마다 조회 · 마지막 ${new Date(real.lastOkMs).toLocaleTimeString()} · ${real.polls}회`
              : '첫 조회 중…'}
        </div>
      )}
      <button className="btn" onClick={() => restart({ mode: 'http', http: readHttp() })}>
        {mock ? '실서버 모드로 재시작' : '실서버 설정 다시 적용'}
      </button>
      {!mock && (
        <button className="btn ghost" onClick={() => restart({ mode: 'mock', http: readHttp() })}>
          MOCK 모드로 돌아가기
        </button>
      )}
      {!mock && <VirtualWorkers />}
      <p className="note">
        실서버 모드는 고객 앱 주문으로 생긴 작업과 PDA 작업자의 진행을 {REAL_LINK.pollSec}초마다 읽어 그립니다. 가짜 주문은 없습니다. 가상 작업자를 켜지 않으면 실서버 재고·작업을 바꾸지 않습니다. 시계는 실제 시각(1×)입니다.
      </p>
    </>
  );
}

/** 실서버 가상 작업자(mfcw-pp-01~10) — 켜면 실제 주문을 집고 포장한다(실서버 작업·재고가 바뀜) */
function VirtualWorkers() {
  const { sim } = useApp();
  useTick();
  if (sim.realTokens?.serverInjected) return <p className="note">다른 기기에서는 가상 작업자를 켤 수 없습니다(조회만).</p>;
  const ws = sim.virtualWorkers.filter((w) => !w.left);
  return (
    <>
      <h3>가상 작업자 (실서버)</h3>
      <Slider
        name="가상 피킹·포장 작업자"
        initial={sim.virtualWorkerCount}
        min={0}
        max={REAL_LINK.virtualAccounts.length}
        step={1}
        hint="mfcw-pp-01부터 켭니다. 켜면 실제 주문을 받아 집품·배차 요청·포장까지 실서버에 기록합니다. 줄이면 들고 있는 작업을 마치고 멈춥니다. 한 탭에서만 켜세요."
        apply={(v) => sim.setVirtualWorkers(v)}
      />
      {ws.filter((w) => !w.leaving).length > BACKEND_FACTS.cartLocations.length && (
        <p className="note warn">
          카트가 {BACKEND_FACTS.cartLocations.length}대뿐입니다(백엔드 라벨 README) — 현장에서는 {BACKEND_FACTS.cartLocations.length}명 넘게 동시에 피킹할 수 없습니다. 서버는 카트 수를 막지 않으므로 화면에서는 그대로 돕니다.
        </p>
      )}
      {ws.length > 0 && (
        <div className="probe">
          {ws.map((w) => (
            <div key={w.account}>
              {w.account.replace('mfcw-', '')} · {w.leaving ? '퇴근 예정 · ' : ''}
              {w.activity}
              {w.lastProblem && <span className="warn"> · {w.lastProblem}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function LeftPanel() {
  const { sim } = useApp();
  return (
    <div className="panel left">
      {sim.mode === 'mock' && <OutboundControls />}
      {sim.mode === 'mock' && <InboundControls />}

      <h3>색 구분</h3>
      <Legend />
      <p className="note">
        구역 바닥을 클릭하면 그 구역으로 확대(랙 위 노란 판 = 랙 번호, 가까이 가면 선반 앞단에 칸 번호), 선반 상품을 클릭하면 로케이션 정보, 작업자를 클릭하면 PDA 화면을 봅니다. 드래그 회전 · 우클릭 이동 · 휠 확대.
      </p>

      <BackendSettings />
    </div>
  );
}

function OutboundControls() {
  const { sim } = useApp();
  const p = sim.params;
  return (
    <>
      <h3>출고 (실행 중 변경)</h3>
      <Slider name="시간당 주문" initial={p.ordersPerHour} min={5} max={120} step={1} hint="기준안 피크 약 40건/시간, 낙관안 88건 (MFC 7-1 가정)" apply={(v) => (sim.params.ordersPerHour = v)} />
      <Slider name="피킹·패킹 작업자" initial={p.workers} min={1} max={24} step={1} hint="기준안 약 10명, 낙관안 약 22명 (MFC 7-2 가정)" apply={(v) => sim.setWorkers(v)} />
      <Slider name="가동 패킹대" initial={p.packingStations} min={1} max={8} step={1} hint="기본 4대 · 최대 8대 (MFC 11장)" apply={(v) => sim.setStations(v)} />
      <Slider name="결품률 (%)" initial={p.shortageRate * 100} min={0} max={10} step={0.5} hint="피킹 시 선반 실물 부족 보고 확률 (시뮬 값)" apply={(v) => (sim.params.shortageRate = v / 100)} />
      <div className="field">
        <label>피킹 순서</label>
        <select defaultValue={p.pickSequence} onChange={(e) => (sim.params.pickSequence = e.target.value as 'DOC_B_A_C' | 'AMBIENT_FIRST')}>
          <option value="DOC_B_A_C">B→A→C~H (원본 관찰, MFC 8-3)</option>
          <option value="AMBIENT_FIRST">상온 → 냉장 → 냉동</option>
        </select>
      </div>
    </>
  );
}
