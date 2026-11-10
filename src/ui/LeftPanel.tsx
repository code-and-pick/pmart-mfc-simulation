import { useRef, useState } from 'react';
import { useApp, useTick } from '../app/context';
import { HttpBackend } from '../backend/http/HttpBackend';
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
  const mock = sim.mode === 'mock';
  const baseUrl = useRef<HTMLInputElement>(null);
  const token = useRef<HTMLInputElement>(null);
  const workerIds = useRef<HTMLInputElement>(null);
  const [probe, setProbe] = useState('—');
  const readHttp = (): HttpSettings => ({
    baseUrl: baseUrl.current?.value.trim() || '/api/v1',
    token: token.current?.value.trim() ?? '',
    workerIds: (workerIds.current?.value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  const runProbe = async () => {
    setProbe('확인 중…');
    const h = readHttp();
    const be = new HttpBackend({ baseUrl: h.baseUrl, token: () => h.token || null, sourceSystem: 'mfc-simulator', now: () => sim.time, timeoutMs: 6000 });
    be.onApi((r) => sim.apiLog.push(r));
    setProbe(await be.probe(sim.params.mfcId));
  };
  return (
    <>
      <h3>백엔드 연동</h3>
      <div className="field">
        <label>게이트웨이 경로</label>
        <input type="text" ref={baseUrl} defaultValue={settings.http.baseUrl} />
        <small>개발 서버가 /api 를 PMART_GATEWAY(기본 http://D603-16:8080)로 넘깁니다.</small>
      </div>
      <div className="field">
        <label>작업자 토큰 (Bearer)</label>
        <input type="password" ref={token} defaultValue={settings.http.token} placeholder="BR-02 결정 전에는 발급 경로 없음" />
      </div>
      <div className="field">
        <label>가상 작업자 ID (쉼표)</label>
        <input type="text" ref={workerIds} defaultValue={settings.http.workerIds.join(',')} placeholder="mfc-capacity 에 등록된 작업자" />
      </div>
      <button className="btn ghost" onClick={runProbe}>
        연결 점검
      </button>
      <div className="probe">{probe}</div>
      <button className="btn" onClick={() => restart({ mode: 'http', http: readHttp() })}>
        {mock ? '실서버 모드로 재시작' : '실서버 설정 다시 적용'}
      </button>
      {!mock && (
        <button className="btn ghost" onClick={() => restart({ mode: 'mock', http: readHttp() })}>
          MOCK 모드로 돌아가기
        </button>
      )}
      <p className="note">2026-10-31 기준 백엔드 이행(슬라이스 6)이 501 이라 실서버 모드는 연결·인증·계약 점검까지만 됩니다. 필요한 백엔드 변경은 docs/backend-requests.md.</p>
    </>
  );
}

export function LeftPanel() {
  const { sim } = useApp();
  const p = sim.params;
  return (
    <div className="panel left">
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
