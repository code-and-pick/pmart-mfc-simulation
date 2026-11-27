// 바코드 탭 "입고" — 입고 건(DC 송장 TRF 하나)마다 카드 하나. 위 탭으로 건을 고르고, 카드는 위에서 아래로:
// ① 무슨 건인지(송장·운행·상품 — 번호는 한 줄에 하나) ② 단계 막대 ③ "지금 할 일" 한 줄 ④ 지금 단계에서 찍을 바코드만(PDA 화면 단계 이름·순서 그대로).
// (사용자 2026-11-27 "어느 TRF 바코든지 알아보게 … 위에 탭" → "qr코드 순서가 pda 순서랑 일치하지 않아서 헷갈려" → "도착 번호나 trf 번호가 안 떠서"
//  → "여기 UI좀 제대로 해라. 번호도 섞여있고 순서도 섞여있고 뭐가 뭔지도 모르겠잖아")
import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { cdcName } from '../config';
import { inboundJobs, type InboundJob, type InboundJobStage, type InboundScanItem } from '../sim/inboundTrack';
import { Barcode } from './Barcode';
import { TrfRef } from './TrfRef';

const kindOf = (v: string) => (/^\d{13}$/.test(v) ? 'ean13' : 'code128');
const TASK_KO = { INSPECT: '품질검사', PUTAWAY: '적치', QUARANTINE_MOVE: '격리 이동' } as const;
const STAGE_KO: Record<InboundJobStage, string> = { UNLOAD: '하차', RECEIVE: '수령', TASKS: '검사·적치', DONE: '끝' };
const DC_STEPS = ['하차·인계', '수령', '검사·적치', '끝'] as const;
const DC_AT: Record<InboundJobStage, number> = { UNLOAD: 0, RECEIVE: 1, TASKS: 2, DONE: 3 };
const DEST_WHY = {
  SUGGESTED: '서버 추천 칸',
  SAME_SKU: '이 상품이 있는 보충재고 칸(서버 추천 없음)',
  EMPTY_RESERVE: '빈 보충재고 칸(서버 추천 없음)',
  PICK_FACE: '이 상품 피킹 칸 — 꽉 찼으면 거절됨',
  QUARANTINE: '격리 구역 칸',
} as const;
const hm = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 탭 이름 — 송장 끝 6자리 + 단계(번호 전체는 카드 안 한 줄에) */

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <li className="ib-step">
      <div className="ib-step-h">
        <i>{n}</i>
        <b>{title}</b>
        {hint && <span>{hint}</span>}
      </div>
      <div className="bc-grid">{children}</div>
    </li>
  );
}

/** 검사·적치 한 작업 — PDA 적치 화면 단계: 위치 확인 → 상품 싣기 → 내려놓기 */
function TaskSteps({ it }: { it: InboundScanItem }) {
  const { task: t, dest } = it;
  return (
    <ol className="ib-steps">
      <Step n={1} title="위치 확인" hint="출발 칸 스캔">
        <Barcode value={t.locationCode} caption={t.locationCode} height={44} />
      </Step>
      <Step n={2} title={t.taskType === 'INSPECT' ? '상품' : '상품 싣기'} hint="1개씩 스캔">
        {(t.barcodes ?? []).length ? (t.barcodes ?? []).map((b) => <Barcode key={b} value={b} kind={kindOf(b)} caption={`${t.productName ?? t.sku}`} height={44} />) : <div className="note">바코드 없음 — 상품 번호 {t.sku} 를 쳐서 넣기</div>}
      </Step>
      {t.taskType !== 'INSPECT' && (
        <Step n={3} title="내려놓기" hint={`"실었어요" 뒤 도착 칸 스캔${dest[0] ? ` · ${DEST_WHY[dest[0].why]}` : ''}`}>
          {dest.length ? dest.map((d) => <Barcode key={d.code} value={d.code} caption={`${d.code}${d.qty ? ` · ${d.qty}개` : ''}`} height={44} />) : <div className="note">놓을 칸을 모릅니다 — 3D 에서 칸을 눌러 위치 바코드를 찍으세요</div>}
        </Step>
      )}
    </ol>
  );
}

function JobCard({ j }: { j: InboundJob }) {
  const { sim } = useApp();
  const a = j.arrival;
  // 상품은 한 줄에 하나 "이름 × 수량"(이름 끝 숫자와 수량이 붙어 "1126-1 20"처럼 섞이던 것)
  const products = j.trf?.products.map((p) => ({ name: p.name, qty: p.expected })) ?? [...new Map([...j.open.map((x) => x.task), ...j.done.map((d) => d.task)].map((t) => [t.sku, { name: t.productName ?? t.sku, qty: t.plannedQty }])).values()];
  const firstReceipt = j.open[0]?.task.receiptId ?? j.done[0]?.task.receiptId ?? null;
  const kindName = j.trfId ? `${cdcName(a?.cdcId ?? 'CDC01')} 입고` : j.label.replace(/\s+\S+$/, '');
  const pdaTasks = j.open.filter((x) => !!x.task.assigneeId);
  const freeTasks = j.open.filter((x) => !x.task.assigneeId);
  const virtual = a?.mode === 'VIRTUAL';
  const now: string =
    j.stage === 'UNLOAD'
      ? virtual
        ? '가상 작업자가 하차 중 — 찍을 것 없음'
        : `PDA 입고 → 하차: 박스 ${a?.boxes.length ?? 0}개를 찍고 인계`
      : j.stage === 'RECEIVE'
        ? 'PDA 입고 → 수령: 송장 → 박스 확인 → 상품 수량'
        : j.stage === 'TASKS'
          ? pdaTasks.length
            ? `PDA ${TASK_KO[pdaTasks[0].task.taskType]} 중 — ${pdaTasks[0].task.productName ?? pdaTasks[0].task.sku}`
            : `PDA "다음 작업 받기"로 받기 — ${freeTasks.length}건`
          : '모두 끝';
  return (
    <section className="scan-sec ib-card">
      <div className="ib-title">
        <b>{kindName}</b>
        <span className={`ib-stage s-${j.stage}`}>{STAGE_KO[j.stage]}</span>
      </div>
      <dl className="ib-info">
        {j.trfId && (
          <>
            <dt>송장</dt>
            <dd>
              <TrfRef trfId={j.trfId} cdcId={a?.cdcId} />
            </dd>
          </>
        )}
        {a && (
          <>
            <dt>운행</dt>
            <dd>
              <span className="mono">{a.tripId}</span> · 정차 {a.seq}
              {a.driver ? ` · ${a.driver}` : ''}
              {a.handover ? ` · 인계 ${a.handover === 'MATCHED' ? '박스 맞음' : '박스 차이'}` : ''}
            </dd>
          </>
        )}
        {!j.trfId && firstReceipt && (
          <>
            <dt>수령</dt>
            <dd className="mono">{firstReceipt}</dd>
          </>
        )}
        {products.length > 0 && (
          <>
            <dt>상품</dt>
            <dd>
              {products.map((p) => (
                <div key={p.name} className="ib-prod">
                  <span>{p.name}</span>
                  <b>× {p.qty}</b>
                </div>
              ))}
            </dd>
          </>
        )}
      </dl>
      {j.trfId && (
        <div className="itk-steps ib-bar" style={{ gridTemplateColumns: `repeat(${DC_STEPS.length}, 1fr)` }}>
          {DC_STEPS.map((k, i) => (
            <span key={k} className={i < DC_AT[j.stage] ? 'done' : i === DC_AT[j.stage] ? 'now' : ''}>
              <i />
              {k}
            </span>
          ))}
        </div>
      )}
      <div className="ib-now">
        지금 <b>{now}</b>
      </div>

      {j.stage === 'UNLOAD' && !virtual && a && (
        <ol className="ib-steps">
          <Step n={1} title="하차" hint={`박스 ${a.boxes.length}개 스캔 → 인계`}>
            {a.boxes.map((b) => (
              <Barcode key={b.lpn} value={b.lpn} caption={b.lpn} height={48} />
            ))}
          </Step>
        </ol>
      )}

      {j.stage === 'RECEIVE' && a && (
        <ol className="ib-steps">
          <Step n={1} title="송장" hint="수령 첫 단계">
            {j.trf ? <Barcode value={j.trf.label} caption={j.trf.label} height={48} /> : <div className="note">송장 읽는 중…</div>}
          </Step>
          <Step n={2} title="박스 확인" hint={`박스 ${a.boxes.filter((b) => b.trfId === j.trfId).length}개`}>
            {a.boxes
              .filter((b) => b.trfId === j.trfId)
              .map((b) => (
                <Barcode key={b.lpn} value={b.lpn} caption={b.lpn} height={44} />
              ))}
          </Step>
          <Step n={3} title="상품 수량" hint="상품 바코드">
            {(j.trf?.products ?? []).flatMap((p) => (p.barcodes.length ? p.barcodes.map((v) => <Barcode key={`${p.sku}:${v}`} value={v} kind={kindOf(v)} caption={`${p.name} × ${p.expected}`} height={44} />) : [<div key={p.sku} className="note">{p.name} 바코드 없음</div>]))}
          </Step>
          {j.trf && !j.trf.canReceipt && <div className="note warn">DC 출발 기록이 아직 없어 수령 확정은 서버가 막습니다.</div>}
        </ol>
      )}

      {pdaTasks.map((it) => (
        <div key={it.task.taskId} className="ib-task now">
          <div className="ib-task-h" title={it.task.taskId}>
            <b>PDA {TASK_KO[it.task.taskType]}</b> {it.task.productName ?? it.task.sku} · 남은 {it.remain}개{it.task.doneQty ? ` (${it.task.doneQty}/${it.task.plannedQty})` : ''} · {sim.board?.workerName(it.task.assigneeId) ?? ''}
          </div>
          <TaskSteps it={it} />
        </div>
      ))}
      {freeTasks.length > 0 && (
        <details className="ib-free" open={!pdaTasks.length && j.stage === 'TASKS'}>
          <summary title='PDA "다음 작업 받기"로 받는 순서는 서버가 정합니다'>안 받은 작업 {freeTasks.length}</summary>
          {freeTasks.map((it) => (
            <details key={it.task.taskId} className="ib-task">
              <summary title={it.task.taskId}>
                <b>{TASK_KO[it.task.taskType]}</b> {it.task.productName ?? it.task.sku} <span className="ib-qty">× {it.remain}</span>
              </summary>
              <TaskSteps it={it} />
            </details>
          ))}
        </details>
      )}
      {j.done.length > 0 && (
        <div className="ib-done">
          {j.done.map((d) => (
            <div key={d.task.taskId} title={d.task.taskId}>
              ✅ {TASK_KO[d.task.taskType]} 끝 · {d.task.productName ?? d.task.sku} {d.task.doneQty}개 · {hm(d.atMs)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** 목록 한 줄 — 상품 이름이 먼저(무슨 물건인지로 찾게), 그다음 할 일·수량 칩, 출처는 작게 */
function jobRow(j: InboundJob, short: (id: string) => string, name: (sku: string) => string) {
  const items = j.trf?.products.map((p) => ({ name: p.name, qty: p.expected })) ?? [...new Map([...j.open.map((x) => x.task), ...j.done.map((d) => d.task)].map((t) => [t.sku, { name: t.productName ?? name(t.sku), qty: t.plannedQty }])).values()];
  const what = items.length ? `${items[0].name} ${items[0].qty}개${items.length > 1 ? ` 외 ${items.length - 1}` : ''}` : '상품 읽는 중';
  const left = (type: string) => j.open.filter((x) => x.task.taskType === type);
  const qty = (xs: InboundScanItem[]) => `${xs.reduce((n, x) => n + x.task.doneQty, 0)}/${xs.reduce((n, x) => n + x.task.plannedQty, 0)}`;
  const todo =
    j.stage === 'UNLOAD'
      ? `하차 · 박스 ${j.arrival?.boxes.length ?? 0}`
      : j.stage === 'RECEIVE'
        ? '수령'
        : j.stage === 'TASKS'
          ? left('INSPECT').length
            ? `품질검사 ${qty(left('INSPECT'))}`
            : left('PUTAWAY').length
              ? `적치 ${qty(left('PUTAWAY'))}`
              : `격리 이동 ${qty(left('QUARANTINE_MOVE'))}`
          : '끝';
  const from = j.trfId ? `${cdcName(j.arrival?.cdcId ?? 'CDC01')} · ${short(j.trfId)}` : j.label.replace(/\s+\S+$/, '');
  return { what, todo, from };
}

export function InboundBoard() {
  const { sim } = useApp();
  useEffect(() => {
    void sim.refreshInboundScan();
    const t = setInterval(() => void sim.refreshInboundScan(), 5000);
    return () => clearInterval(t);
  }, [sim]);
  const jobs = inboundJobs(sim.dcArrivals, sim.inboundScan.items, sim.inboundScan.done);
  const [pick, setPick] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  if (!jobs.length) return sim.inboundScan.error ? <div className="note">입고 작업 읽기 실패 — {sim.inboundScan.error}</div> : null;
  const live = jobs.filter((j) => j.stage !== 'DONE');
  const done = jobs.filter((j) => j.stage === 'DONE');
  // 펼친 건 — 고른 것, 없으면 할 일 첫 건(PDA 작업 중 → 하차 → 수령 → 검사·적치 순)
  const open = pick === '' ? null : (jobs.find((j) => j.key === pick) ?? live[0] ?? null);
  const row = (j: InboundJob) => {
    const r = jobRow(j, (id) => sim.trfInfo(id).short, (s) => sim.productName(s));
    const on = open?.key === j.key;
    return (
      <div key={j.key} className={`ib-row-w${on ? ' on' : ''}`}>
        <button className={`ib-row s-${j.stage}`} onClick={() => setPick(on ? '' : j.key)} title={j.key}>
          <span className="ib-row-what">
            {j.pdaBusy && <i className="ib-dot" title="PDA 작업 중" />}
            {r.what}
          </span>
          <span className={`ib-chip s-${j.stage}`}>{r.todo}</span>
          <span className="ib-row-from">
            {r.from}
            {j.pdaBusy ? ' · PDA 작업 중' : ''}
          </span>
          <span className="ib-row-arrow">{on ? '▾' : '▸'}</span>
        </button>
        {on && <JobCard j={j} />}
      </div>
    );
  };
  return (
    <div className="ib">
      <div className="ib-head">
        <b>입고 작업</b>
        <span>할 일 {live.length}건{done.length ? ` · 끝 ${done.length}` : ''}</span>
      </div>
      {live.length ? live.map(row) : <div className="note">할 입고 일이 없습니다.</div>}
      {done.length > 0 && (
        <div className="ib-donelist">
          <button className="link" onClick={() => setShowDone((v) => !v)}>
            {showDone ? '▾' : '▸'} 끝난 입고 {done.length}
          </button>
          {showDone && done.map(row)}
        </div>
      )}
    </div>
  );
}
