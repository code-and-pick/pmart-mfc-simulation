// 왼쪽 패널 — 화면에는 값과 할 일만, 이유·근거는 ⓘ 툴팁과 "?" 도움말(Help.tsx)로(사용자 2026-11-20 "주절주절 … 구리게").
// 위에서부터: 할 일(실제 주문 넣기 · 재고 채우기 — 확인 버튼 "입고 차량 부르기") → 현장 설정(한 줄 슬라이더) → 가상 작업자 → 고급(실서버 연결, 접힘).
import { workerShortName, workerRoleName } from '../domain/workerName';
import { Fragment as Frag, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApp, useTick, useView } from '../app/context';
import { HttpBackend } from '../backend/http/HttpBackend';
import { TokenSource } from '../backend/http/tokens';
import { BACKEND_FACTS, REAL_LINK, REAL_ORDER, REAL_WORKERS, INBOUND_ORDER, TEST_INBOUND } from '../config';
import { MODE_KO, type OrderModeChoice, type RealOrderResult } from '../domain/realOrder';
import { clampOrderQty, RECOMMEND_REASON_KO, orderTotals, splitOrder, upsertLine, type OrderDraftLine } from '../domain/testInbound';
import type { InitialStockLoad, SupplyRequest } from '../domain/contract';
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
function Ask({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return createPortal(
    <div className="ask-back" onClick={onClose}>
      <div className={wide ? "ask wide" : "ask"} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
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
      <Slider name="패킹대" initial={p.packingStations} min={1} max={sim.layout.stations.length} step={1} hint={`가동 패킹대. 기본 4대 · 최대 ${sim.layout.stations.length}대(지점 평면에 따라 — 부산진구 8, 세종 10). 다 차면 나머지 패킹대도 씀`} apply={(v) => sim.setStations(v)} />
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
      <Act
        icon="↩"
        title="회수품 반납 지금 부르기"
        sub={`반납 대기 ${ibb.returns.waiting} · 검수 대기 ${ibb.returns.inspecting} · 격리 ${ibb.returns.quarantined} — 정상은 선반, 폐기는 온도대 격리 구역`}
        onClick={() => {
          // 회수품은 라이더가 들고 와 인계 창 밖 회수반입 자리(RTN-A-01)에 놓는다 → 출하대기·라이더 앞마당 쪽을 본다(사용자 2026-11-23 "왜 승강기 쪽으로 가는 거야? 이건 라이더가 들고 오는건데")
          if (sim.callReturn()) controller.focusZone('SHIP');
        }}
      />
    </Sec>
  );
}

// ───────── 실서버: 실제 주문 넣기(R-21) — 두 번 묻기 ─────────

type OrderLog = { at: string; text: string; warn?: boolean; ask?: boolean };

function RealOrderControls() {
  const { sim } = useApp();
  // 고객은 지점마다 허용 목록의 한 계정(1호점 PC 1 지정 고객, 2호점 목포 시험 고객) — 고르지 않는다
  const cust = REAL_ORDER.customers.find((c) => c.mfcId === sim.params.mfcId);
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
          body: JSON.stringify({ customer: cust!.key, mode: m, mfcId: sim.params.mfcId }),
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

  if (!cust)
    return (
      <Sec title="주문 넣기">
        <div className="note">이 지점({sim.params.mfcId})의 시험 고객이 허용 목록에 없어 실제 주문을 넣을 수 없습니다.</div>
      </Sec>
    );
  return (
    <Sec title="주문 넣기">
      <Act icon="＋" title="실제 주문 넣기" sub={busy || `${cust.label} · 시험 결제`} primary disabled={!!busy} onClick={() => setStep(1)} />
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

// ───────── 실서버: 입고 발주(시험 입고 MI-3·R-23) — 사용자 2026-11-24 "사용자 지정 발주·추천값 자동 채움·입고 전 수량 보기" ─────────
// 발주 넣기 = 센터 발주(SUBMITTED) → "승인 대기"에서 센터 관리자가 승인(줄이기·사유)·거절 → 승인하면 입고 예정(EXPECTED) → 수령(입고 차량).
// 추천 = 백엔드 발주 수량 추천(mfc-inbound 0.21.0 MI-4, R-48) 그대로. 추천 안 한 상품은 사유만(0 으로 채우지 않음).

const TEMP_KO = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' } as const;

/** 입고·검수 구역 카드(Cards)에서도 쓴다 — 사용자 2026-11-20 "왼쪽에 있다는 문구 없애고 버튼 만들어" */
export function TestInboundControls() {
  const { sim, controller } = useApp();
  useTick();
  const [draft, setDraft] = useState<OrderDraftLine[] | null>(null);
  const [expected, setExpected] = useState<InitialStockLoad[] | null>(null);
  const [pending, setPending] = useState<SupplyRequest[] | null>(null);
  const [decide, setDecide] = useState<{ req: SupplyRequest; mode: 'APPROVE' | 'REJECT' } | null>(null);
  const [recv, setRecv] = useState<InitialStockLoad[] | null>(null);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<OrderLog[]>([]);
  const push = (text: string, warn = false) => setLog((l) => [{ at: new Date().toLocaleTimeString(), text, warn }, ...l].slice(0, 12));
  const why = (e: unknown) => ((e as Error).message ?? String(e)).slice(0, 90);

  const refresh = async () => {
    try {
      setExpected(await sim.expectedInbound());
    } catch (e) {
      push(`입고 예정 읽기 실패 — ${why(e)}`, true);
    }
    try {
      setPending(await sim.pendingSupply());
    } catch (e) {
      push(`승인 대기 발주 읽기 실패 — ${why(e)}`, true);
    }
  };
  useEffect(() => {
    void refresh();
    // 하차 끝나 수령되면 목록에서 빠진다 — 가끔 다시 읽는다
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim.params.mfcId]);

  const recommend = async (base: OrderDraftLine[]) => {
    setBusy('서버 발주 추천 읽는 중…');
    try {
      const rec = await sim.recommendInbound();
      const skip = Object.entries(rec.skipped)
        .map(([k, n]) => `${RECOMMEND_REASON_KO[k] ?? k} ${n}`)
        .join(' · ');
      if (!rec.lines.length) {
        // 오류가 아니라 서버가 아직 추천을 안 낸 것 — 빨간 글로 보이면 고장으로 읽힘(사용자 2026-11-25 "계속 에러나던데")
        const hist = rec.skipped.INSUFFICIENT_HISTORY ?? 0;
        push(
          hist === rec.asked
            ? `서버 추천이 아직 없습니다 — 상품 ${rec.asked}개 모두 판매 기록이 7일이 안 됨(서버는 7일 쌓여야 추천). 지금은 "직접 고르기"로 발주하세요`
            : rec.zero === rec.asked
              ? `지금 더 시킬 상품이 없습니다(상품 ${rec.asked}개 모두 추천 0)`
              : `추천할 상품이 없습니다(상품 ${rec.asked}개 물음${rec.zero ? ` · 지금 필요 없음 ${rec.zero}` : ''}${skip ? ` · 추천 안 함: ${skip}` : ''})`,
        );
        if (base.length) setDraft(base);
      } else {
        push(`추천 ${rec.lines.length}줄(상품 ${rec.asked}개 물음${rec.zero ? ` · 지금 필요 없음 ${rec.zero}` : ''}${skip ? ` · 추천 안 함: ${skip}` : ''}${rec.salesThrough ? ` · 판매 ${rec.salesThrough}까지` : ''})`);
        setDraft(rec.lines.reduce((ls, l) => upsertLine(ls, l, true), base));
      }
    } catch (e) {
      const m = why(e);
      push(`추천 읽기 실패 — ${/500|50[234]/.test(m) ? `서버 오류(${m}), 잠시 뒤 다시 눌러 보세요` : m}`, true);
    }
    setBusy('');
  };
  const order = async (lines: OrderDraftLine[]) => {
    setDraft(null);
    setBusy('발주 넣는 중…');
    try {
      const reqs = await sim.placeInboundOrder(lines);
      const t = orderTotals(lines);
      push(`발주 ${t.items}품목 ${t.units}개 → ${reqs.length}건 승인 대기 — 아래 "승인"을 누르면 입고 예정이 생깁니다`);
      await refresh();
    } catch (e) {
      push(`발주 실패 — ${why(e)}`, true);
    }
    setBusy('');
  };
  const receive = async (withVirtual: boolean) => {
    if (!recv) return;
    const loads = recv;
    setRecv(null);
    for (const [i, load] of loads.entries()) {
      setBusy(`수령하는 중… ${i + 1}/${loads.length}`);
      try {
        const out = await sim.receiveInbound(load, withVirtual);
        push(
          out.queued
            ? `입고 ${load.receiptId.slice(-6)} ${load.lines.length}품목 ${out.units}개 하차 시작 — 가상 작업자가 승강기 → ${out.at}, 다 내리면 수령 → 검사·적치`
            : `입고 ${load.receiptId.slice(-6)} ${load.lines.length}품목 ${out.units}개 수령(${out.at}) → PDA 로 하차·검사·적치`,
        );
      } catch (e) {
        push(`입고 ${load.receiptId.slice(-6)} 수령 실패 — ${why(e)}`, true);
      }
    }
    controller.focusZone('RCV');
    await refresh();
    setBusy('');
  };

  const exp = expected ?? [];
  const sumQty = (l: InitialStockLoad) => l.lines.reduce((a, x) => a + x.qty, 0);
  const expUnits = exp.reduce((a, l) => a + sumQty(l), 0);
  const waiting = exp.filter((l) => !sim.isUnloading(l.receiptId));
  const recvUnits = (recv ?? []).reduce((a, l) => a + sumQty(l), 0);
  const recvItems = (recv ?? []).reduce((a, l) => a + l.lines.length, 0);
  return (
    <Sec title="입고 발주" aside="센터 발주">
      <div className="act-split">
        <Act icon="🧮" title="추천으로 채우기" sub="서버 발주 추천" disabled={!!busy} onClick={() => recommend([])} />
        <Act icon="✍" title="직접 고르기" sub="상품·수량 지정" disabled={!!busy} onClick={() => setDraft([])} />
      </div>
      {busy && <div className="busy">{busy}</div>}
      <div className="inb-exp">
        <div className="inb-exp-h">
          <b>승인 대기(발주)</b>
          <span>{pending === null ? '…' : `${pending.length}건 · ${pending.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.qty, 0), 0)}개`}</span>
        </div>
        {(pending ?? []).map((r) => (
          <div key={r.supplyRequestId} className="inb-load">
            <div className="inb-load-h">
              <span title={r.supplyRequestId}>발주 {r.supplyRequestId.slice(-6)}</span>
              <span>
                {r.lines.length}품목 {r.lines.reduce((a, l) => a + l.qty, 0)}개
              </span>
              <button className="inb-mini" disabled={!!busy} onClick={() => setDecide({ req: r, mode: 'APPROVE' })} title="센터 관리자 승인 — 줄마다 줄일 수 있음">
                ✅ 승인
              </button>
              <button className="inb-mini" disabled={!!busy} onClick={() => setDecide({ req: r, mode: 'REJECT' })} title="센터 관리자 거절 — 사유 필수">
                거절
              </button>
            </div>
            <details>
              <summary>상품 보기</summary>
              <table className="ask-tbl">
                <tbody>
                  {r.lines.map((x) => (
                    <tr key={x.sku}>
                      <td title={x.sku}>{sim.productName(x.sku)}</td>
                      <td>{x.qty}개</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        ))}
      </div>
      <div className="inb-exp">
        <div className="inb-exp-h">
          <b>입고 예정(수령 전)</b>
          <span>{expected === null ? '…' : `${exp.length}건 · ${expUnits}개`}</span>
          <button className="inb-mini" disabled={!!busy} onClick={() => void refresh()} title="다시 읽기">
            ↻
          </button>
        </div>
        {exp.length > 0 && (
          // 발주는 입고 예정만 만든다 — 차량·입고 작업자는 수령을 눌러야 움직인다(사용자 2026-11-24 "입고 작업자가 움직이지도 않고 입고차량이 들어오지도 않는데")
          <button className="inb-all" disabled={!!busy || !waiting.length} onClick={() => setRecv(waiting)}>
            🚚 {waiting.length > 1 ? `${waiting.length}건 모두 ` : ''}수령 — 입고 차량 부르기
          </button>
        )}
        {exp.map((l) => (
          <div key={l.receiptId} className="inb-load">
            <div className="inb-load-h">
              <span title={l.receiptId}>
                {l.approvalId.startsWith('DEV-') ? '시험' : '정식'} {l.receiptId.slice(-6)}
              </span>
              <span>
                {l.lines.length}품목 {sumQty(l)}개
              </span>
              {sim.isUnloading(l.receiptId) ? (
                <span className="inb-tag" title="가상 작업자가 승강기에서 입고칸으로 옮기는 중 — 다 내리면 수령">
                  하차 중
                </span>
              ) : (
                <button className="inb-mini" disabled={!!busy} onClick={() => setRecv([l])} title="이 건만 수령">
                  🚚 수령
                </button>
              )}
            </div>
            <details>
              <summary>상품 보기</summary>
              <table className="ask-tbl">
                <tbody>
                  {l.lines.map((x) => (
                    <tr key={x.sku}>
                      <td title={x.sku}>{x.productName ?? x.sku}</td>
                      <td>{x.qty}개</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        ))}
      </div>
      {decide && (
        <Decide
          req={decide.req}
          mode={decide.mode}
          onClose={() => setDecide(null)}
          onDone={(text, warn) => {
            setDecide(null);
            push(text, warn);
            void refresh();
          }}
        />
      )}
      {draft && <OrderDraft initial={draft} busy={!!busy} onRecommend={recommend} onOrder={order} onClose={() => setDraft(null)} />}
      {recv && (
        <Ask title={`${recv.length > 1 ? `입고 예정 ${recv.length}건 · ` : ''}${recvItems}품목 ${recvUnits}개를 수령할까요?`} onClose={() => setRecv(null)}>
          <table className="ask-tbl">
            <tbody>
              {recv.flatMap((l) =>
                l.lines.map((x) => (
                  <tr key={`${l.receiptId}:${x.sku}`}>
                    <td title={x.sku}>{x.productName ?? x.sku}</td>
                    <td>+{x.qty}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          <div className="ask-warn">
            ⚠ 실서버 재고가 바뀝니다 — 차량이 서면 가상 작업자가 승강기에서 롤테이너를 빼 온도대별 입고칸(상온 {TEST_INBOUND.receivingByTemp.AMBIENT}·냉장 {TEST_INBOUND.receivingByTemp.CHILLED}·냉동 {TEST_INBOUND.receivingByTemp.FROZEN})으로 옮기고, 다 내리면 예정 수량 그대로 수령 → 품질검사 → 선반 적치(없으면 하나 켬). PDA 면 바로 수령하고 하차·검사·적치는 PDA "다음 작업 받기"로.
          </div>
          <div className="ask-acts">
            <button onClick={() => setRecv(null)}>취소</button>
            <button className="go" onClick={() => void receive(false)} title="품질검사·적치는 PDA 로(가상 작업자가 켜져 있으면 그쪽이 받을 수도)">
              🚚 차량 · PDA
            </button>
            <button className="red" onClick={() => void receive(true)}>
              🤖 차량 · 가상 작업자
            </button>
          </div>
        </Ask>
      )}
      <ResultLog rows={log} />
    </Sec>
  );
}

/** 발주 승인·거절(센터 관리자) — 승인은 줄마다 0~요청 수량, 줄였으면 사유 필수. 모두 0 이면 거절로(서버 400) */
function Decide({ req, mode, onClose, onDone }: { req: SupplyRequest; mode: 'APPROVE' | 'REJECT'; onClose: () => void; onDone: (text: string, warn?: boolean) => void }) {
  const { sim } = useApp();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(req.lines.map((l) => [l.sku, l.qty])));
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const cut = req.lines.some((l) => qty[l.sku] !== l.qty);
  const all0 = req.lines.every((l) => qty[l.sku] === 0);
  const units = req.lines.reduce((a, l) => a + qty[l.sku], 0);
  const go = async () => {
    if (mode === 'APPROVE' && all0) return setMsg('모두 0 이면 거절로 하세요');
    if ((mode === 'REJECT' || cut) && !note.trim()) return setMsg(mode === 'REJECT' ? '거절 사유를 적으세요' : '줄인 사유를 적으세요');
    setBusy(true);
    setMsg('');
    try {
      if (mode === 'APPROVE') {
        const r = await sim.approveSupply(req, qty, note);
        onDone(`발주 ${req.supplyRequestId.slice(-6)} 승인 ${units}개 → 입고 예정 ${r.linkedReceiptId?.slice(-6) ?? ''} — 아래 "수령"으로 차량 부르기`);
      } else {
        await sim.rejectSupply(req, note.trim());
        onDone(`발주 ${req.supplyRequestId.slice(-6)} 거절 — ${note.trim()}`);
      }
    } catch (e) {
      setMsg(`못 함 — ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <Ask title={`발주 ${req.supplyRequestId.slice(-6)} ${mode === 'APPROVE' ? '승인' : '거절'}`} onClose={onClose}>
      <table className="ask-tbl">
        <thead>
          <tr>
            <th>상품</th>
            <th>요청</th>
            {mode === 'APPROVE' && <th>승인</th>}
          </tr>
        </thead>
        <tbody>
          {req.lines.map((l) => (
            <tr key={l.sku}>
              <td title={l.sku}>{sim.productName(l.sku)}</td>
              <td>{l.qty}</td>
              {mode === 'APPROVE' && (
                <td>
                  <input
                    className="inb-qty"
                    type="number"
                    min={0}
                    max={l.qty}
                    value={qty[l.sku]}
                    aria-label={`${sim.productName(l.sku)} 승인 수량`}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setQty((q) => ({ ...q, [l.sku]: Number.isFinite(v) ? Math.max(0, Math.min(l.qty, Math.round(v))) : l.qty }));
                    }}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <input
        className="inb-note"
        placeholder={mode === 'REJECT' ? '거절 사유(필수)' : cut ? '줄인 사유(필수)' : '메모(선택)'}
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
      />
      {msg && <div className="busy">{msg}</div>}
      <div className="ask-warn">{mode === 'APPROVE' ? `⚠ 실서버 — 승인하면 ${units}개 입고 예정(수령 전)이 생깁니다.` : '⚠ 실서버 — 거절하면 되돌릴 수 없습니다(다시 발주).'}</div>
      <div className="ask-acts">
        <button onClick={onClose}>취소</button>
        <button className={mode === 'APPROVE' ? 'go' : 'red'} disabled={busy} onClick={() => void go()}>
          {mode === 'APPROVE' ? '✅ 승인' : '거절'}
        </button>
      </div>
    </Ask>
  );
}

/** 발주표 — 상품 더하기·수량 고치기·빼기, 추천값으로 채우기, 넣기 전 온도대별 합계(입고 뒤 재고) */
function OrderDraft(props: { initial: OrderDraftLine[]; busy: boolean; onRecommend: (base: OrderDraftLine[]) => void; onOrder: (lines: OrderDraftLine[]) => void; onClose: () => void }) {
  const { sim } = useApp();
  const [lines, setLines] = useState(props.initial);
  const [catalog, setCatalog] = useState<{ sku: string; name: string }[] | null>(null);
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState(10);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setLines(props.initial), [props.initial]);
  useEffect(() => {
    sim.inboundCatalog().then(setCatalog, (e: Error) => setMsg(`상품 목록 읽기 실패 — ${e.message}`));
  }, [sim]);
  const label = (c: { sku: string; name: string }) => `${c.name} · ${c.sku}`;
  const add = async () => {
    const c = catalog?.find((x) => label(x) === pick || x.sku === pick.trim());
    if (!c) {
      setMsg('목록에 있는 상품을 고르세요(센터 취급·판매 중)');
      return;
    }
    setMsg('재고 읽는 중…');
    try {
      const l = await sim.manualOrderLine(c.sku, c.name, qty);
      setLines((ls) => upsertLine(ls, l, false));
      setPick('');
      setMsg('');
    } catch (e) {
      setMsg(`못 넣음 — ${(e as Error).message}`);
    }
  };
  const t = orderTotals(lines);
  const parts = splitOrder(lines).length;
  return (
    <Ask title="입고 발주" onClose={props.onClose} wide>
      <div className="inb-add">
        <input list="inb-catalog" placeholder={catalog ? `상품 이름·SKU (${catalog.length}개)` : '상품 목록 읽는 중…'} value={pick} onChange={(e) => setPick(e.target.value)} />
        <datalist id="inb-catalog">
          {catalog?.map((c) => (
            <option key={c.sku} value={label(c)} />
          ))}
        </datalist>
        <input type="number" min={1} max={INBOUND_ORDER.maxQty} value={qty} onChange={(e) => setQty(clampOrderQty(Number(e.target.value)))} aria-label="수량" />
        <button onClick={() => void add()}>추가</button>
      </div>
      <button className="inb-rec" disabled={props.busy} onClick={() => props.onRecommend(lines)}>
        🧮 추천값으로 채우기{' '}
        <Tip text="서버 발주 수량 추천 — 하루 판매(인계 실적 평균) × (주기 + 납기 + 안전 일수) = 목표, 목표 − (지금 판매 가능 + 입고 예정) 만큼. 추천 0 은 빼고, 추천 안 한 상품(인계 실적 7일 미만 등)은 사유만 아래 기록에. 직접 넣은 줄은 그대로 둡니다" />
      </button>
      {msg && <div className="busy">{msg}</div>}
      {lines.length > 0 && (
        <table className="ask-tbl">
          <thead>
            <tr>
              <th>상품</th>
              <th>온도</th>
              <th>지금</th>
              <th>입고</th>
              <th>입고 뒤</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.sku}>
                <td title={l.sku}>
                  {l.source === 'RECOMMEND' && (
                    <span className="inb-tag" title={l.basis ?? '서버 추천'}>
                      추천
                    </span>
                  )}
                  {l.name}
                </td>
                <td>{TEMP_KO[l.temp]}</td>
                <td>{l.available ?? '?'}</td>
                <td>
                  <input
                    className="inb-qty"
                    type="number"
                    min={1}
                    max={INBOUND_ORDER.maxQty}
                    value={l.qty}
                    aria-label={`${l.name} 입고 수량`}
                    onChange={(e) => {
                      const q = clampOrderQty(Number(e.target.value));
                      setLines((ls) => ls.map((x) => (x.sku === l.sku ? { ...x, qty: q, source: 'MANUAL' } : x)));
                    }}
                  />
                </td>
                <td>{l.available === null ? '?' : l.available + l.qty}</td>
                <td>
                  <button className="inb-mini" onClick={() => setLines((ls) => ls.filter((x) => x.sku !== l.sku))} aria-label="빼기">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <dl className="ask-sum">
        {(['AMBIENT', 'CHILLED', 'FROZEN'] as const)
          .filter((k) => t.byTemp[k].items)
          .map((k) => (
            <Frag key={k}>
              <dt>{TEMP_KO[k]}</dt>
              <dd>
                {t.byTemp[k].items}품목 {t.byTemp[k].units}개 → {TEST_INBOUND.receivingByTemp[k]}
              </dd>
            </Frag>
          ))}
        <dt>합계</dt>
        <dd>
          <b>
            {t.items}품목 {t.units}개
          </b>{' '}
          · 발주 {parts}건(온도대마다)
        </dd>
      </dl>
      {confirm && <div className="ask-warn">⚠ 실서버에 센터 발주를 넣습니다(승인 대기). 승인하면 입고 예정이 생기고, 재고는 수령(입고 차량 부르기)할 때 들어옵니다. 같은 상품의 승인 전 발주가 있으면 서버가 거절합니다.</div>}
      <div className="ask-acts">
        <button onClick={props.onClose}>취소</button>
        <button className="go" disabled={!lines.length || props.busy} onClick={() => (confirm ? props.onOrder(lines) : setConfirm(true))}>
          {confirm ? '📋 정말 발주 넣기' : '📋 발주 넣기'}
        </button>
      </div>
    </Ask>
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
/**
 * 따라가는 점원이 이번 피킹에서 고를 상품 — 실시간(약 4Hz). 집음(✓)은 서버가 받은 뒤에만 표시
 * (사용자 2026-11-22 "점원을 따라가면 실시간으로 픽업할 때 고른 제품이 뭔지 왼쪽 탭에 떴으면 좋겠어")
 */
function FollowBasket({ id }: { id: string }) {
  const { sim } = useApp();
  useTick();
  const w = sim.siteWorkers().find((x) => x.id === id);
  if (!w) return null;
  const basket = w.pda?.basket;
  const done = basket?.filter((b) => b.state === 'DONE' || b.state === 'SHORT').length ?? 0;
  return (
    <Sec title={`${workerRoleName(w.id, w.state)} 장바구니`} aside={basket ? `${done} / ${basket.length} 품목` : undefined}>
      {!basket ? (
        <div className="bk-empty">{w.pda ? `${w.pda.step} — 고를 상품 목록 없음` : '지금 피킹 중인 작업이 없어요'}</div>
      ) : (
        <>
          {w.pda?.taskType === 'PACK' && <div className="bk-empty">피킹 끝 — 포장 중: {w.pda.step}</div>}
          <ul className="bk">
            {basket.map((b, i) => (
              <li key={i} className={`bk-${b.state.toLowerCase()}`}>
                <span className="bk-i" aria-hidden>
                  {b.state === 'DONE' ? '✓' : b.state === 'NOW' ? '▶' : b.state === 'SHORT' ? '!' : '·'}
                </span>
                <span className="bk-n">
                  {b.name}
                  <small>
                    {b.location}
                    {b.temp ? ` · ${b.temp}` : ''}
                  </small>
                </span>
                <b className="bk-q">
                  {b.state === 'DONE' || b.state === 'SHORT' ? `${b.picked}/${b.planned}` : `×${b.planned}`}
                </b>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sec>
  );
}

// 개발용 성능 탭 내용 — npm run dev 에서만 불러온다(운영 빌드에서는 이 import 가 빠짐)
const PerfPanel = import.meta.env.DEV ? lazy(() => import('../dev/perf').then((m) => ({ default: m.PerfPanel }))) : null;

export function LeftPanel() {
  const { sim } = useApp();
  const view = useView();
  const follow = view.follow && sim.siteWorkers().some((x) => x.id === view.follow) ? view.follow : null;
  if (!view.leftView) {
    // 패널을 닫아 둬도 점원을 따라가는 동안은 장바구니만 띄운다
    return follow ? (
      <div className="panel left">
        <FollowBasket id={follow} />
      </div>
    ) : null;
  }
  const mock = sim.mode === 'mock';
  const injected = !!sim.realTokens?.serverInjected;
  return (
    <div className="panel left">
      {follow && <FollowBasket id={follow} />}
      {view.leftView === 'perf' ? (
        PerfPanel && (
          <Suspense fallback={null}>
            <PerfPanel />
          </Suspense>
        )
      ) : view.leftView === 'help' ? (
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
