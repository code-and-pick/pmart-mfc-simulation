import { useRef, useState } from 'react';
import { useApp, useTick } from '../app/context';
import { HttpBackend } from '../backend/http/HttpBackend';
import { TokenSource } from '../backend/http/tokens';
import { BACKEND_FACTS, REAL_LINK, REAL_ORDER, REAL_WORKERS } from '../config';
import { MODE_KO, type OrderModeChoice, type RealOrderResult } from '../domain/realOrder';
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
      {!mock && !sim.realTokens?.serverInjected && <RealOrderControls />}
      <p className="note">
        실서버 모드는 고객 앱 주문으로 생긴 작업과 PDA 작업자의 진행을 {REAL_LINK.pollSec}초마다 읽어 그립니다. 가짜 주문은 없습니다. 가상 작업자를 켜지 않으면 실서버 재고·작업을 바꾸지 않습니다. 시계는 실제 시각(1×)입니다.
      </p>
    </>
  );
}

/** 실제 주문 넣기(R-21) — 개발 서버가 고객 토큰을 받아 고객 경로 그대로 주문하고 시험 결제로 승인한다. 이 PC 에서만 */
function RealOrderControls() {
  const { sim } = useApp();
  const [customer, setCustomer] = useState(REAL_ORDER.customers[0].key);
  const [mode, setMode] = useState<OrderModeChoice>('RANDOM');
  const [count, setCount] = useState(1);
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<{ at: string; text: string; warn?: boolean; ask?: boolean }[]>([]);
  const cust = REAL_ORDER.customers.find((c) => c.key === customer)!;
  const push = (text: string, warn = false, ask = false) =>
    setLog((l) => [{ at: new Date().toLocaleTimeString(), text, warn, ask }, ...l].slice(0, 12));

  const run = async (m: OrderModeChoice, n: number) => {
    setArm(false);
    for (let i = 0; i < n; i++) {
      setBusy(`${i + 1}/${n}건 넣는 중…`);
      let r: RealOrderResult;
      try {
        const res = await fetch('/sim-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer, mode: m, mfcId: sim.params.mfcId }),
        });
        r = (await res.json()) as RealOrderResult;
      } catch {
        r = { ok: false, step: 'NETWORK', code: 'NO_RESPONSE', detail: '개발 서버 응답 없음 — 결과 불명, 실제 주문 탭에서 확인하세요' };
      }
      if (r.ok) {
        const w = r.window ? ` ${r.window.date.slice(5)} ${r.window.start}–${r.window.end}` : '';
        push(`주문 ${r.orderNumber ?? `(번호 아직 없음 ${r.orderId.slice(-8)})`} · ${MODE_KO[r.mode]}${w} · ${r.amount.toLocaleString()}원 · ${r.items.length}품목`);
      } else {
        push(`${r.step} ${r.code} — ${r.detail}`, true, !!r.askScheduled);
        break;
      }
    }
    setBusy('');
  };

  return (
    <>
      <h3>실제 주문 넣기</h3>
      <div className="field">
        <label>고객</label>
        <select value={customer} onChange={(e) => (setCustomer(e.target.value), setArm(false))}>
          {REAL_ORDER.customers.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <small className="warn">{cust.warn}</small>
      </div>
      <div className="field">
        <label>배송 방식</label>
        <div className="btn-row">
          {(['SINGLE', 'BUNDLED', 'SCHEDULED', 'RANDOM'] as const).map((m) => (
            <button key={m} className={`btn ${mode === m ? '' : 'ghost'}`} onClick={() => (setMode(m), setArm(false))}>
              {MODE_KO[m]}
            </button>
          ))}
        </div>
        <small>예약은 고를 수 있는 가장 빠른 시간대, 랜덤은 지금 되는 방식 중 하나(예약이면 빠른 {REAL_ORDER.randomSlotPool}개 중 하나).</small>
      </div>
      <Slider name="건수" initial={count} min={1} max={REAL_ORDER.maxCount} step={1} hint="한 건씩 차례로 넣고, 실패하면 멈춥니다." apply={(v) => (setCount(v), setArm(false))} />
      {busy ? (
        <div className="probe">{busy}</div>
      ) : arm ? (
        <div className="btn-row">
          <button className="btn" onClick={() => run(mode, count)}>
            정말 {count}건 넣기
          </button>
          <button className="btn ghost" onClick={() => setArm(false)}>
            취소
          </button>
        </div>
      ) : (
        <button className="btn" onClick={() => setArm(true)}>
          주문 넣기
        </button>
      )}
      <small>
        출하 가능한 상품으로 최소 주문 금액을 넘게 담아 주문하고 시험 결제(TEST_AUTO)로 승인합니다. 실제 주문이라 MFC 작업 지시·배송까지 그대로 흘러갑니다. 고객 토큰은 개발 서버 안에서만 씁니다.
      </small>
      {log.length > 0 && (
        <div className="probe">
          {log.map((l, i) => (
            <div key={i} className={l.warn ? 'warn' : ''}>
              {l.at} · {l.text}
              {l.ask && !busy && (
                <button className="btn ghost" onClick={() => run('SCHEDULED', 1)}>
                  예약으로 1건 넣기
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** 실서버 가상 작업자(mfcw-pp-01~10) — 켜면 실제 주문을 집고 포장한다(실서버 작업·재고가 바뀜) */
function VirtualWorkers() {
  const { sim } = useApp();
  useTick();
  // 속도 배수는 이 화면에서만 — 다른 기기(LAN, 조회만)도 아바타 걷기 속도는 바꿀 수 있다(사용자 2026-11-18 "왜 나한테만 뜨지")
  const speed = (
    <Slider
      name="속도 배수"
      initial={sim.speedBoost}
      min={1}
      max={REAL_WORKERS.speedBoostMax}
      step={1}
      hint={
        sim.realTokens?.serverInjected
          ? '이 화면의 작업자 아바타 걷기 속도만 — 서버 속도 배율(speedFactor) 위에 곱합니다. 가상 작업자는 켠 PC 의 배수를 따릅니다.'
          : '작업자마다 서버 속도 배율(speedFactor) 위에 곱합니다. 가상 작업자의 걷기·집기·포장 시간과 실제 PDA 작업자 아바타의 걷기에만 — 서버 응답 기다림·조회 간격(3초)은 실제 시각 그대로라, 배수를 크게 해도 서버 반영보다 빨라지지는 않습니다. 이 화면에서만 적용됩니다.'
      }
      apply={(v) => sim.setSpeedBoost(v)}
    />
  );
  if (sim.realTokens?.serverInjected)
    return (
      <>
        <p className="note">다른 기기에서는 가상 작업자를 켤 수 없습니다(조회만).</p>
        {speed}
      </>
    );
  const ws = sim.virtualWorkers.filter((w) => !w.left);
  const skipped = sim.virtualWorkers.filter((w) => w.skipped);
  const cut = sim.interruptedVirtual();
  return (
    <>
      <h3>가상 작업자 (실서버)</h3>
      <Slider
        name="가상 피킹·포장 작업자"
        initial={sim.virtualWorkerCount}
        min={0}
        max={REAL_LINK.virtualAccounts.length}
        step={1}
        hint="mfcw-pp-01부터 켭니다(실제 PDA 가 쓰는 계정은 건너뜀). 켜면 실제 주문을 받아 집품·배차 요청·포장까지 실서버에 기록합니다. 줄이면 들고 있는 작업을 마치고 멈춥니다. 한 탭에서만 켜세요."
        apply={(v) => sim.setVirtualWorkers(v)}
      />
      {speed}
      {ws.filter((w) => !w.leaving).length > BACKEND_FACTS.cartLocations.length && (
        <p className="note warn">
          카트가 {BACKEND_FACTS.cartLocations.length}대뿐입니다(백엔드 라벨 README) — 현장에서는 {BACKEND_FACTS.cartLocations.length}명 넘게 동시에 피킹할 수 없습니다. 서버는 카트 수를 막지 않으므로 화면에서는 그대로 돕니다.
        </p>
      )}
      {cut.length > 0 && (
        <div className="probe">
          <b>끊긴 가상 작업자 작업</b> — 서버에 남아 있습니다(시작한 기기가 가상 작업자). 이어 하면 그 작업과 자기가 피킹한 주문 패킹까지 하고 퇴근합니다.
          {cut.map((c) => (
            <div key={c.account}>
              {c.account.replace('mfcw-', '')} · {c.taskType} {c.orderNumber ?? c.taskId.slice(-12)}{' '}
              <button className="btn ghost" onClick={() => sim.resumeVirtual(c.account)}>
                이어 하기
              </button>
            </div>
          ))}
        </div>
      )}
      {skipped.length > 0 && (
        <p className="note">
          실제 PDA 가 쓰는 중이라 건너뛴 계정: {skipped.map((w) => w.account.replace('mfcw-', '')).join(', ')} — 다음 계정으로 채웁니다(최근 {Math.round(REAL_LINK.pdaSkipSec / 60)}분 안 서버 작업 기준).
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
