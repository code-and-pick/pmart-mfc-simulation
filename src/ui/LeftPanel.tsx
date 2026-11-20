// 왼쪽 패널 — 화면에는 값과 할 일만, 이유·근거는 ⓘ 툴팁과 "?" 도움말(Help.tsx)로(사용자 2026-11-20 "주절주절 … 구리게").
// 위에서부터: 할 일(실제 주문 넣기 · 재고 채우기 — 확인 버튼 "입고 차량 부르기") → 현장 설정(한 줄 슬라이더) → 가상 작업자 → 고급(실서버 연결, 접힘).
import { workerShortName } from '../domain/workerName';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp, useTick, useView } from '../app/context';
import { HttpBackend } from '../backend/http/HttpBackend';
import { TokenSource } from '../backend/http/tokens';
import { BACKEND_FACTS, REAL_LINK, REAL_ORDER, REAL_WORKERS, TEST_INBOUND } from '../config';
import { MODE_KO, type OrderModeChoice, type RealOrderResult } from '../domain/realOrder';
import type { InboundPlanLine } from '../domain/testInbound';
import { fmtClock } from '../sim/metrics';
import type { HttpSettings } from '../sim/simulation';
import { Help } from './Help';
import { ZonePanel } from './Cards';

/** ⓘ — 마우스를 올리거나 누르면 한두 줄 설명 */
export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} aria-label={text}>
      i<span className="tip-box">{text}</span>
    </span>
  );
}

/** 한 줄 슬라이더 — 이름 · 막대 · 값 · ⓘ */
function Slider(props: { name: string; initial: number; min: number; max: number; step: number; hint: string; unit?: string; apply: (v: number) => void }) {
  const [v, setV] = useState(props.initial);
  return (
    <div className="srow">
      <span className="srow-l">{props.name}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={v}
        aria-label={props.name}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          props.apply(n);
        }}
      />
      <b className="srow-v">
        {v}
        {props.unit ?? ''}
      </b>
      <Tip text={props.hint} />
    </div>
  );
}

function Sec({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec">
      <h4>
        {title}
        {aside && <span>{aside}</span>}
      </h4>
      {children}
    </section>
  );
}

/** 큰 할 일 버튼(아이콘 · 이름 · 한 줄 부제) */
function Act({ icon, title, sub, onClick, primary, disabled }: { icon: string; title: string; sub: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button className={`act ${primary ? 'pri' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="act-i" aria-hidden>
        {icon}
      </span>
      <span>
        <span className="act-t">{title}</span>
        <span className="act-s">{sub}</span>
      </span>
    </button>
  );
}

/** 두 번 묻는 창 — 왼쪽 패널 옆에 뜬다. 패널(backdrop-filter)이 fixed 를 가두므로 body 로 뺀다 */
function Ask({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return createPortal(
    <div className="ask-back" onClick={onClose}>
      <div className="ask" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h5>{title}</h5>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ───────── MOCK ─────────

function OutboundControls() {
  const { sim } = useApp();
  const p = sim.params;
  return (
    <Sec title="출고">
      <Slider name="시간당 주문" initial={p.ordersPerHour} min={5} max={120} step={1} hint="기준안 피크 약 40건/시간, 낙관안 88건 (MFC 7-1 가정)" apply={(v) => (sim.params.ordersPerHour = v)} />
      <Slider name="작업자" initial={p.workers} min={1} max={24} step={1} hint="피킹·패킹 작업자. 기준안 약 10명, 낙관안 약 22명 (MFC 7-2 가정)" apply={(v) => sim.setWorkers(v)} />
      <Slider name="패킹대" initial={p.packingStations} min={1} max={8} step={1} hint="가동 패킹대. 기본 4대 · 최대 8대 (MFC 11장)" apply={(v) => sim.setStations(v)} />
      <Slider name="결품률" unit="%" initial={p.shortageRate * 100} min={0} max={10} step={0.5} hint="피킹 때 선반 실물 부족을 보고할 확률 (시뮬 값)" apply={(v) => (sim.params.shortageRate = v / 100)} />
      <div className="srow">
        <span className="srow-l">피킹 순서</span>
        <select className="srow-sel" defaultValue={p.pickSequence} onChange={(e) => (sim.params.pickSequence = e.target.value as 'DOC_B_A_C' | 'AMBIENT_FIRST')}>
          <option value="DOC_B_A_C">B→A→C~H</option>
          <option value="AMBIENT_FIRST">상온→냉장→냉동</option>
        </select>
        <Tip text="B→A→C~H 는 원본 관찰 순서(MFC 8-3)" />
      </div>
    </Sec>
  );
}

function InboundControls() {
  const { sim, controller } = useApp();
  useTick();
  const p = sim.params;
  const ibb = sim.inboundBoard();
  return (
    <Sec title="입고·적치·보충" aside={`다음 ${fmtClock(ibb.nextTruckAt)}`}>
      <Slider name="입고 작업자" initial={p.inboundWorkers} min={0} max={8} step={1} hint="기준 3명 (검수 2 + 이송 1, MFC 10장 가정)" apply={(v) => sim.setInboundWorkers(v)} />
      <Slider name="차량 주기" unit="h" initial={p.inboundIntervalHours} min={1} max={8} step={1} hint="실제는 매일 오전 1회 [확정] — 적치 과정을 보려고 짧게 [시뮬]" apply={(v) => (sim.params.inboundIntervalHours = v)} />
      <Act
        icon="🚚"
        title="입고 차량 지금 부르기"
        sub={`입고 작업자 ${sim.inboundWorkers.filter((w) => !w.idle).length}/${sim.inboundWorkers.length} 작업 중`}
        onClick={() => {
          if (sim.callTruck()) controller.focusZone('RCV');
        }}
      />
    </Sec>
  );
}

// ───────── 실서버: 실제 주문 넣기(R-21) — 두 번 묻기 ─────────

type OrderLog = { at: string; text: string; warn?: boolean; ask?: boolean };

function RealOrderControls() {
  const { sim } = useApp();
  // 고객은 허용 목록의 한 계정뿐(R-22 보류) — 고르지 않는다
  const cust = REAL_ORDER.customers[0];
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [mode, setMode] = useState<OrderModeChoice>('RANDOM');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<OrderLog[]>([]);
  const push = (text: string, warn = false, ask = false) => setLog((l) => [{ at: new Date().toLocaleTimeString(), text, warn, ask }, ...l].slice(0, 12));

  const run = async (m: OrderModeChoice, n: number) => {
    setStep(0);
    for (let i = 0; i < n; i++) {
      setBusy(`${i + 1}/${n}건 넣는 중…`);
      let r: RealOrderResult;
      try {
        const res = await fetch('/sim-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer: cust.key, mode: m, mfcId: sim.params.mfcId }),
        });
        r = (await res.json()) as RealOrderResult;
      } catch {
        r = { ok: false, step: 'NETWORK', code: 'NO_RESPONSE', detail: '개발 서버 응답 없음 — 결과 불명, 실제 주문 탭에서 확인' };
      }
      if (r.ok) {
        const w = r.window ? ` ${r.window.date.slice(5)} ${r.window.start}–${r.window.end}` : '';
        push(`${r.orderNumber ?? r.orderId.slice(-8)} · ${MODE_KO[r.mode]}${w} · ${r.amount.toLocaleString()}원`);
      } else {
        push(`${r.step} ${r.code} — ${r.detail}`, true, !!r.askScheduled);
        break;
      }
    }
    setBusy('');
  };

  return (
    <Sec title="주문 넣기">
      <Act icon="＋" title="실제 주문 넣기" sub={busy || '내 계정 · 시험 결제'} primary disabled={!!busy} onClick={() => setStep(1)} />
      {step === 1 && (
        <Ask title="어떤 주문을 넣을까요?" onClose={() => setStep(0)}>
          <div className="ask-l">배송 방식</div>
          <div className="chips">
            {(['SINGLE', 'BUNDLED', 'SCHEDULED', 'RANDOM'] as const).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {MODE_KO[m]}
              </button>
            ))}
          </div>
          <div className="ask-l">건수</div>
          <div className="stepper">
            <button onClick={() => setCount((c) => Math.max(1, c - 1))}>−</button>
            <b>{count}</b>
            <button onClick={() => setCount((c) => Math.min(REAL_ORDER.maxCount, c + 1))}>＋</button>
          </div>
          <div className="ask-acts">
            <button onClick={() => setStep(0)}>취소</button>
            <button className="go" onClick={() => setStep(2)}>
              다음
            </button>
          </div>
        </Ask>
      )}
      {step === 2 && (
        <Ask title={`실제 주문 ${count}건을 넣을까요?`} onClose={() => setStep(0)}>
          <dl className="ask-sum">
            <dt>고객</dt>
            <dd>내 계정</dd>
            <dt>방식</dt>
            <dd>{MODE_KO[mode]}</dd>
            <dt>결제</dt>
            <dd>시험 결제</dd>
            <dt>센터</dt>
            <dd>{sim.centerLabel}</dd>
          </dl>
          <div className="ask-warn">⚠ 실서버에 진짜 주문 — 배차까지 흘러가고, 주문 내역·배송 알림이 내 휴대폰으로 갑니다</div>
          <div className="ask-acts">
            <button onClick={() => setStep(1)}>뒤로</button>
            <button className="red" onClick={() => run(mode, count)}>
              {count}건 넣기
            </button>
          </div>
        </Ask>
      )}
      <ResultLog rows={log}>
        {(l) =>
          l.ask && !busy ? (
            <button className="link" onClick={() => run('SCHEDULED', 1)}>
              예약으로 1건
            </button>
          ) : null
        }
      </ResultLog>
    </Sec>
  );
}

function ResultLog({ rows, children }: { rows: OrderLog[]; children?: (l: OrderLog) => ReactNode }) {
  if (!rows.length) return null;
  return (
    <div className="results">
      {rows.slice(0, 5).map((l, i) => (
        <div key={i} className={l.warn ? 'bad' : 'ok'}>
          {l.warn ? '✕' : '✓'} {l.text} {children?.(l)}
        </div>
      ))}
    </div>
  );
}

// ───────── 실서버: 재고 채우기(시험 입고 MI-3·R-23) — 계획을 보여 주고 한 번 더 묻기 ─────────

/** 입고·검수 구역 카드(Cards)에서도 쓴다 — 사용자 2026-11-20 "왼쪽에 있다는 문구 없애고 버튼 만들어" */
export function TestInboundControls() {
  const { sim, controller } = useApp();
  useTick();
  const [plan, setPlan] = useState<{ lines: InboundPlanLine[]; withVirtual: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<OrderLog[]>([]);
  const push = (text: string, warn = false) => setLog((l) => [{ at: new Date().toLocaleTimeString(), text, warn }, ...l].slice(0, 12));
  const why = (e: unknown) => ((e as Error).message ?? String(e)).slice(0, 90);

  const start = async (withVirtual: boolean) => {
    setBusy('재고 적은 상품 찾는 중…');
    try {
      const lines = await sim.planTestInbound();
      if (!lines.length) push('채울 상품을 못 찾았습니다(센터 취급 상품 없음)', true);
      else setPlan({ lines, withVirtual });
    } catch (e) {
      push(`상품 찾기 실패 — ${why(e)}`, true);
    }
    setBusy('');
  };
  const go = async () => {
    if (!plan) return;
    const p = plan;
    setPlan(null);
    setBusy('입고 예정 만들고 수령하는 중…');
    try {
      const r = await sim.runTestInbound(p.lines, p.withVirtual);
      push(`시험 입고 ${p.lines.length}품목 ${r.units}개 수령 → ${p.withVirtual ? '가상 작업자가 검사·적치' : 'PDA 로 검사·적치'}`);
      controller.focusZone('RCV');
    } catch (e) {
      push(`시험 입고 실패 — ${why(e)}`, true);
    }
    setBusy('');
  };
  const units = plan?.lines.reduce((a, l) => a + l.qty, 0) ?? 0;
  return (
    <Sec title="재고 채우기" aside="시험 입고">
      <div className="act-split">
        <Act icon="📦" title="입고 예정만" sub="검사·적치는 PDA" disabled={!!busy} onClick={() => start(false)} />
        <Act icon="🤖" title="가상 작업자로" sub="수령→검사→적치" disabled={!!busy} onClick={() => start(true)} />
      </div>
      {busy && <div className="busy">{busy}</div>}
      {plan && (
        <Ask title={`${plan.lines.length}품목 ${units}개를 입고할까요?`} onClose={() => setPlan(null)}>
          <table className="ask-tbl">
            <thead>
              <tr>
                <th>상품</th>
                <th>지금</th>
                <th>입고</th>
              </tr>
            </thead>
            <tbody>
              {plan.lines.map((l) => (
                <tr key={l.sku}>
                  <td title={l.sku}>{l.name}</td>
                  <td>{l.available ?? '?'}</td>
                  <td>+{l.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ask-warn">
            ⚠ 실서버 재고가 바뀝니다 — {TEST_INBOUND.receivingLocation} 에 수령까지 하고,{' '}
            {plan.withVirtual ? '품질검사·적치는 가상 작업자가(없으면 하나 켬)' : '품질검사·적치는 PDA "다음 작업 받기"로(가상 작업자가 켜져 있으면 그쪽이 받을 수도)'}
          </div>
          <div className="ask-acts">
            <button onClick={() => setPlan(null)}>취소</button>
            {/* 확인 버튼 이름 = 입고 차량 부르기(사용자 2026-11-20 "입고하기 버튼을 없애고 거기에 입고차량 부르기 버튼을 넣어") */}
            <button className="red" onClick={go}>
              🚚 입고 차량 부르기
            </button>
          </div>
        </Ask>
      )}
      <ResultLog rows={log} />
    </Sec>
  );
}

// ───────── 실서버: 가상 작업자 ─────────

function VirtualWorkers() {
  const { sim } = useApp();
  useTick();
  const injected = !!sim.realTokens?.serverInjected;
  const speed = (
    <Slider
      name="속도 배수"
      unit="×"
      initial={sim.speedBoost}
      min={1}
      max={REAL_WORKERS.speedBoostMax}
      step={1}
      hint={
        injected
          ? '이 화면에서 사람들이 걷는 속도만 빨라져요'
          : '가상 작업자가 일하는 속도예요. 숫자만큼 빨라져요'
      }
      apply={(v) => sim.setSpeedBoost(v)}
    />
  );
  if (injected) return <Sec title="가상 작업자" aside="조회만">{speed}</Sec>;
  const ws = sim.virtualWorkers.filter((w) => !w.left && REAL_LINK.virtualAccounts.includes(w.account));
  const inb = sim.inboundVirtual();
  const skipped = sim.virtualWorkers.filter((w) => w.skipped);
  const cut = sim.interruptedVirtual();
  const tooMany = ws.filter((w) => !w.leaving).length > BACKEND_FACTS.cartLocations.length;
  return (
    <Sec title="가상 작업자" aside={`피킹·포장 ${ws.filter((w) => !w.leaving).length} · 입고 ${inb.filter((w) => !w.leaving).length}`}>
      <Slider
        name="피킹·포장"
        initial={sim.virtualWorkerCount}
        min={0}
        max={REAL_LINK.virtualAccounts.length}
        step={1}
        hint="피킹·포장을 하는 가상 직원 수예요. 실제 서버에 기록되니 한 화면에서만 켜세요"
        apply={(v) => sim.setVirtualWorkers(v)}
      />
      {/* 입고 작업자(품질검사 mfcw-qc · 적치 mfcw-rcv) — 같은 칸·같은 속도 배수(사용자 2026-11-20 "따론데 속도 올리면 같이 빨라지고 … 한 박스에 넣고 조절하게") */}
      <Slider
        name="입고 작업자"
        initial={sim.inboundTarget}
        min={0}
        max={REAL_LINK.inboundMax}
        step={1}
        hint="입고 상품을 검사하고 선반에 올리는 가상 직원 수예요. 한 화면에서만 켜세요"
        apply={(v) => sim.setInboundVirtual(v)}
      />
      {speed}
      {(tooMany || skipped.length > 0) && (
        <div className="chips static">
          {tooMany && <span className="y">카트 {BACKEND_FACTS.cartLocations.length}대뿐</span>}
          {skipped.map((w) => (
            <span key={w.account} title="실제 PDA 가 쓰는 중이라 건너뜀">
              {w.account.replace('mfcw-', '')} 건너뜀
            </span>
          ))}
        </div>
      )}
      {cut.length > 0 && (
        <div className="cut">
          <div className="cut-h">
            끊긴 작업 {cut.length} <Tip text="화면을 새로고침해서 멈춘 작업이에요. 이어 하기를 누르면 마저 끝내요" />
          </div>
          {cut.map((c) => (
            <div key={c.account} className="cut-r">
              <span>
                {c.account.replace('mfcw-', '')} · {c.taskType} {c.orderNumber ?? '번호 없음'}
              </span>
              <button className="link" onClick={() => sim.resumeVirtual(c.account)}>
                이어 하기
              </button>
            </div>
          ))}
        </div>
      )}
      {ws.length + inb.length > 0 && (
        <div className="vw">
          {[...ws, ...inb].map((w) => (
            <div key={w.account} className={w.lastProblem ? 'bad' : ''}>
              <b title={w.account}>{workerShortName(w.account)}</b> {w.leaving ? '퇴근 예정 · ' : ''}
              {w.activity}
              {w.lastProblem && <span> · {w.lastProblem}</span>}
            </div>
          ))}
        </div>
      )}
    </Sec>
  );
}

// ───────── 고급: 실서버 연결(접힘) ─────────

/** 실서버 조회가 끊겼을 때만 한 줄(평소엔 안 보임) */
function RealConnWarning() {
  const { sim } = useApp();
  useTick();
  const real = sim.real;
  if (!real?.lastError) return null;
  return <div className="note warn">실서버 조회 오류 — {real.lastError} (3초마다 다시 시도)</div>;
}

function BackendSettings() {
  const { sim, settings, restart } = useApp();
  useTick();
  const mock = sim.mode === 'mock';
  const baseUrl = useRef<HTMLInputElement>(null);
  const [probe, setProbe] = useState('');
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
  const status = real
    ? real.lastError
      ? `조회 오류 ${real.lastError}`
      : real.lastOkMs
        ? `${REAL_LINK.pollSec}초마다 · ${new Date(real.lastOkMs).toLocaleTimeString()}`
        : '첫 조회 중…'
    : '꺼짐';
  return (
    <details className="sec adv" open={mock ? false : undefined}>
      <summary>
        <h4>
          {mock ? '실서버 연결' : '고급 · 실서버 연결'}
          <span className={real?.lastError ? 'bad' : ''}>{status}</span>
        </h4>
      </summary>
      <div className="srow">
        <span className="srow-l">게이트웨이</span>
        <input type="text" className="srow-in" ref={baseUrl} defaultValue={settings.http.baseUrl} />
        <Tip text="개발 서버가 /api 를 PMART_GATEWAY(기본 http://192.168.0.40:8080 — 게이트웨이 PC D603-16)로 넘깁니다" />
      </div>
      <div className="kv">
        <span>계정</span>
        <b>{REAL_LINK.observerAccount}</b>
        <span>센터</span>
        <b>
          {sim.centerLabel}
          {sim.centerLabel !== sim.params.mfcId && <span className="muted"> · {sim.params.mfcId}</span>}
        </b>
      </div>
      <div className="btn-row">
        <button className="btn ghost" onClick={runProbe}>
          연결 점검
        </button>
        <button className="btn" onClick={() => restart({ mode: 'http', http: readHttp() })}>
          {mock ? '실서버로 재시작' : '다시 적용'}
        </button>
      </div>
      {probe && <div className="busy">{probe}</div>}
      {!mock && (
        <button className="btn ghost" onClick={() => restart({ mode: 'mock', http: readHttp() })}>
          MOCK 으로 돌아가기
        </button>
      )}
    </details>
  );
}

/** 왼쪽 패널 — 아이콘 메뉴의 "설정"·"도움말"(접으면 그리지 않음) */
export function LeftPanel() {
  const { sim } = useApp();
  const view = useView();
  if (!view.leftView) return null;
  const mock = sim.mode === 'mock';
  const injected = !!sim.realTokens?.serverInjected;
  return (
    <div className="panel left">
      {view.leftView === 'help' ? (
        <Help />
      ) : view.leftView === 'zone' ? (
        <ZonePanel />
      ) : mock ? (
        <>
          <OutboundControls />
          <InboundControls />
          <BackendSettings />
        </>
      ) : (
        <>
          {!injected && <RealOrderControls />}
          {!injected && <TestInboundControls />}
          <VirtualWorkers />
          {/* 이미 실서버 — "고급 · 실서버 연결" 칸은 뺌(사용자 2026-11-20 "이미 실서번데 고급 실서버 연결 버튼은 왜 있는 거야?"). MOCK 전환은 머리줄 스위치, 조회가 끊기면 한 줄만 */}
          <RealConnWarning />
        </>
      )}
    </div>
  );
}
