// 관리 탭(실서버 전용) — 사용자 2026-11-20 "방금 전 주문 보고 피킹내역이랑 현재흐름을 보려고 해도 이미 인계가 끝나서 볼 수가 없었어",
// "관리자가 바로 피패킹 제어가능한 탭", "API 받아오면 되잖아. 허락 받았어".
// 세 칸: 지난 주문(끝난 주문의 흐름·집품 실적) · 진행 중 작업(담당 바꾸기·내려놓기) · 인계 확인(허가 만료 포장).
// 쓰기는 누를 때마다 한 번 더 확인(사유 입력). 계약에 없는 조치(작업 중지·취소·막힘 해제·다시 열기)는 없다 — 백엔드 R-29.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp, useView } from '../app/context';
import type { AdminDesk, HistoryOrder } from '../sim/admin';
import type { RealTask } from '../sim/realBoard';
import type { TaskSummary } from '../domain/contract';
import { TASK_STATE_KO } from './RealPanel';
import { normalize } from './orderSearch';

const TYPE_KO: Record<string, string> = { PICK: '피킹', PACK: '패킹', RETURN: '복귀', DISPATCH: '배차' };
const PKG_KO: Record<string, string> = { OPEN: '포장 중', SEALED: '밀봉', HANDED_OVER: '인계됨', INVALIDATED: '무효(재포장)', VOIDED: '취소' };
const hm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—');
const dur = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return '';
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
};

function useDesk(desk: AdminDesk) {
  useSyncExternalStore(desk.subscribe, desk.getVersion);
  return desk;
}

type Sub = 'history' | 'live' | 'checks';

export function AdminPanel() {
  const { sim } = useApp();
  const view = useView();
  const desk = sim.admin;
  const [sub, setSub] = useState<Sub>('history');
  if (!desk) return <div className="note">관리 탭은 실서버 모드에서만 씁니다(MOCK 에는 지난 주문·관리자 계정이 없음).</div>;
  const remote = !!sim.realTokens?.serverInjected;
  // 실제 주문 탭 검색에서 "지난 주문에서 찾기"로 들어오면 그 칸
  const s = view.adminSub ?? sub;
  return (
    <div className="adm">
      <div className="adm-tabs">
        {(
          [
            ['history', '지난 주문'],
            ['live', '진행 중 작업'],
            ['checks', '인계 확인'],
          ] as [Sub, string][]
        ).map(([k, l]) => (
          <button
            key={k}
            className={s === k ? 'on' : ''}
            onClick={() => {
              setSub(k);
              view.setAdminSub(null);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {remote && s !== 'history' && <div className="note warn">다른 기기에서 연 화면은 조회만 됩니다 — 관리자 조치는 시뮬레이터를 띄운 PC 화면에서.</div>}
      {s === 'history' && <History desk={desk} />}
      {s === 'live' && <Live desk={desk} readOnly={remote} />}
      {s === 'checks' && <Checks desk={desk} readOnly={remote} />}
    </div>
  );
}

function History({ desk: d0 }: { desk: AdminDesk }) {
  const desk = useDesk(d0);
  const view = useView();
  const [q, setQ] = useState(view.adminQuery ?? '');
  useEffect(() => {
    if (!desk.history.readAt && !desk.history.loading) void desk.loadHistory();
  }, [desk]);
  useEffect(() => {
    if (view.adminQuery != null) {
      setQ(view.adminQuery);
      view.setAdminQuery(null);
    }
  }, [view.adminQuery, view]);
  if (desk.detail) return <Detail desk={desk} />;
  const n = normalize(q);
  const rows = desk.history.orders.filter((o) => !n || normalize(o.orderNumber ?? o.shipmentId).includes(n));
  return (
    <>
      <div className="ocd-search">
        <input type="date" value={desk.historyDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => e.target.value && void desk.loadHistory(e.target.value)} style={{ flex: '0 0 auto' }} />
        <input type="text" value={q} placeholder="주문번호" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className="link" onClick={() => void desk.loadHistory()} title="다시 읽기">
          ↻
        </button>
      </div>
      {desk.history.loading && <div className="note">끝난 작업 읽는 중…</div>}
      {desk.history.error && <div className="note warn">읽지 못함: {desk.history.error}</div>}
      {!desk.history.loading && !rows.length && <div className="scan-empty">{q ? `"${q}" 와 맞는 끝난 주문이 그날 없습니다.` : '그날 끝난 작업이 없습니다.'}</div>}
      {rows.map((o) => (
        <HistoryRow key={o.shipmentId} o={o} onOpen={() => void desk.openOrder(o.shipmentId, o.orderNumber)} />
      ))}
    </>
  );
}

function HistoryRow({ o, onOpen }: { o: HistoryOrder; onOpen: () => void }) {
  const { sim } = useApp();
  const real = sim.board!;
  return (
    <button className="adm-row" onClick={onOpen} title="누르면 흐름·집품 내역">
      <div className="adm-h">
        <b>{o.orderNumber ?? <span className="muted">{o.shipmentId.slice(-8)} · 번호 없음</span>}</b>
        <span className="muted">{hm(o.lastAt)} 끝</span>
      </div>
      <div className="adm-chips">
        {o.tasks.map((t) => (
          <span key={t.taskId} className={`adm-chip st-${t.state}`}>
            {TYPE_KO[t.taskType] ?? t.taskType} {TASK_STATE_KO[t.state] ?? t.state}
            {t.pickedBy || t.assignment?.workerId ? ` · ${real.workerName(t.pickedBy ?? t.assignment?.workerId)}` : ''}
          </span>
        ))}
      </div>
    </button>
  );
}

function Detail({ desk }: { desk: AdminDesk }) {
  const { sim } = useApp();
  const real = sim.board!;
  const d = desk.detail!;
  const names = new Map(d.names);
  for (const t of real.tasks.values()) for (const l of t.detail?.lines ?? []) if (l.productName) names.set(l.sku, l.productName);
  const wos = d.view?.workOrders ?? [];
  return (
    <div className="adm-detail">
      <div className="ocd-place">
        <button className="link" onClick={() => desk.closeOrder()}>
          ← 목록
        </button>
        <b>{d.orderNumber ?? real.orderNumberOf(d.shipmentId) ?? <span className="muted">{d.shipmentId.slice(-8)} · 번호 없음</span>}</b>
        <span>주문 흐름 · 집품 내역</span>
      </div>
      {d.loading && <div className="note">읽는 중…</div>}
      {d.error && <div className="note warn">읽지 못함: {d.error}</div>}
      {wos.map((w) =>
        w.shipments.map((s) => (
          <div key={s.shipmentId} className="adm-ship">
            <div className="adm-h">
              <b>{w.kind === 'RESHIPMENT' ? '재발송 출고' : '출고'}</b>
              <span className="muted">
                접수 {hm(w.createdAt)} · 준비 시작 {hm(w.preparationStartedAt)} · 출하 대기 {hm(s.readyAt)}
              </span>
            </div>
            <table className="adm-t">
              <thead>
                <tr>
                  <th>단계</th>
                  <th>담당</th>
                  <th>시작 → 끝</th>
                  <th>수량</th>
                </tr>
              </thead>
              <tbody>
                {s.tasks.map((t) => (
                  <tr key={t.taskId}>
                    <td>
                      {TYPE_KO[t.taskType] ?? t.taskType} <span className={`adm-chip st-${t.state}`}>{TASK_STATE_KO[t.state] ?? t.state}</span>
                      {t.blockReason ? <div className="sub warn">{t.blockReason}</div> : null}
                    </td>
                    <td>{t.startedBy || t.workerId ? real.workerName(t.startedBy ?? t.workerId) : '—'}</td>
                    <td>
                      {hm(t.startedAt)} → {hm(t.endedAt)} <span className="muted">{dur(t.startedAt, t.endedAt)}</span>
                    </td>
                    <td>
                      {t.completedQty}/{t.plannedQty}
                      {t.cancelledQty ? <span className="warn"> 취소 {t.cancelledQty}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!!s.shortages.length && (
              <div className="adm-sec">
                <h5>결품</h5>
                {s.shortages.map((x, i) => (
                  <div key={i} className="adm-line warn">
                    {hm(x.reportedAt)} · {names.get(x.sku) ?? x.sku} {x.qty}개 · {x.reason ?? ''}
                  </div>
                ))}
              </div>
            )}
            <div className="adm-sec">
              <h5>포장 {s.packages.length}개</h5>
              {s.packages.map((p) => (
                <div key={p.packageId} className={`adm-line ${p.state === 'INVALIDATED' ? 'muted' : ''}`} title={p.packageId}>
                  밀봉 {hm(p.sealedAt)} · {PKG_KO[p.state] ?? p.state}
                  {p.handedOverAt ? ` · 인계 ${hm(p.handedOverAt)}` : ''}
                  {p.handoverRejectReason ? <span className="warn"> · {p.handoverRejectReason}</span> : null}
                </div>
              ))}
            </div>
            {s.tasks
              .filter((t) => d.execs.get(t.taskId)?.length)
              .map((t) => (
                <div key={t.taskId} className="adm-sec">
                  <h5>{TYPE_KO[t.taskType]} 내역 (찍은 순)</h5>
                  {[...(d.execs.get(t.taskId) ?? [])].reverse().map((x) => (
                    <div key={x.executionId} className={`adm-line ${x.state === 'REJECTED' ? 'warn' : ''}`}>
                      <span className="muted">{hm(x.recordedAt)}</span> {x.fromLocation ?? '—'} → {x.toLocation ?? '—'} ·{' '}
                      {(x.lines ?? []).map((l) => `${names.get(l.sku) ?? l.sku} ${l.pickedQty}개`).join(', ') || (x.shortages.length ? '결품 보고' : '')}
                      {x.state !== 'APPLIED' ? ` · ${x.state === 'REJECTED' ? `거절 ${x.rejectReason ?? x.rejectCode ?? ''}` : x.state}` : ''}
                      {x.workerId ? <span className="muted"> · {real.workerName(x.workerId)}</span> : null}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )),
      )}
    </div>
  );
}

/** 쓰기 버튼 — 누르면 사유 칸과 "확인"이 나온다(두 번 눌러야 보냄) */
function Confirm({ label, danger, onGo, disabled, children }: { label: string; danger?: boolean; onGo: (reason: string) => void; disabled?: boolean; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open)
    return (
      <button className={`adm-btn ${danger ? 'danger' : ''}`} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <span className="adm-confirm">
      {children}
      <input type="text" value={reason} placeholder="사유(선택)" onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <button
        className={`adm-btn ${danger ? 'danger' : ''}`}
        onClick={() => {
          setOpen(false);
          onGo(reason);
        }}
      >
        확인
      </button>
      <button className="link" onClick={() => setOpen(false)}>
        취소
      </button>
    </span>
  );
}

function ActionNote({ desk, k }: { desk: AdminDesk; k: string }) {
  const a = desk.actions.get(k);
  if (!a) return null;
  return <div className={`adm-act ${a.state}`}>{a.msg}</div>;
}

function Live({ desk: d0, readOnly }: { desk: AdminDesk; readOnly: boolean }) {
  const desk = useDesk(d0);
  const { sim } = useApp();
  const real = sim.board!;
  const open = [...real.tasks.values()].filter((t) => !t.closed && ['READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'WAITING'].includes(t.summary.state));
  const by = new Map<string, RealTask[]>();
  for (const t of open) {
    const k = t.summary.shipmentId ?? t.summary.fulfillmentId;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  const workers = [...real.workers.values()].map((w) => ({ id: w.workerId, name: real.workerName(w.workerId) })).sort((a, b) => a.name.localeCompare(b.name));
  if (!open.length) return <div className="scan-empty">지금 열린 작업이 없습니다.</div>;
  return (
    <>
      <div className="note">담당 바꾸기·내려놓기는 센터 관리자 계정(claude-mfc-sup)으로 보냅니다. 작업 중지·취소·막힘 해제는 계약에 없어 백엔드 요청 중(R-29).</div>
      {[...by].map(([sid, ts]) => (
        <div key={sid} className="adm-ship">
          <div className="adm-h">
            <b>{real.orderNumberOf(sid) ?? sid.slice(-8)}</b>
          </div>
          {ts.map((t) => (
            <LiveTask key={t.summary.taskId} desk={desk} t={t.summary} workers={workers} readOnly={readOnly} />
          ))}
        </div>
      ))}
    </>
  );
}

function LiveTask({ desk, t, workers, readOnly }: { desk: AdminDesk; t: TaskSummary; workers: { id: string; name: string }[]; readOnly: boolean }) {
  const { sim } = useApp();
  const real = sim.board!;
  const [to, setTo] = useState('');
  const who = t.assignment?.workerId ?? null;
  const canRelease = (t.state === 'ASSIGNED' || t.state === 'IN_PROGRESS') && !!who;
  const canAssign = ['READY', 'ASSIGNED', 'IN_PROGRESS'].includes(t.state);
  return (
    <div className="adm-task">
      <div className="adm-h">
        <span>
          {TYPE_KO[t.taskType] ?? t.taskType} <span className={`adm-chip st-${t.state}`}>{TASK_STATE_KO[t.state] ?? t.state}</span> {t.completedQty}/{t.plannedQty}
          {t.late ? <span className="oc-flag">늦음</span> : t.idle ? <span className="oc-flag">30분 멈춤</span> : null}
        </span>
        <span className="muted">{who ? real.workerName(who) : '담당 없음'}</span>
      </div>
      {!readOnly && (
        <div className="adm-acts">
          {canAssign && (
            <>
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">담당 바꿀 사람…</option>
                {workers
                  .filter((w) => w.id !== who)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
              <Confirm label="담당 바꾸기" disabled={!to} onGo={(r) => void desk.reassign(t, to, r)}>
                <span className="muted">→ {workers.find((w) => w.id === to)?.name}</span>
              </Confirm>
            </>
          )}
          {canRelease && <Confirm label="내려놓기" danger onGo={(r) => void desk.release(t, r)} />}
        </div>
      )}
      <ActionNote desk={desk} k={`assign:${t.taskId}`} />
      <ActionNote desk={desk} k={`release:${t.taskId}`} />
    </div>
  );
}

function Checks({ desk: d0, readOnly }: { desk: AdminDesk; readOnly: boolean }) {
  const desk = useDesk(d0);
  const { sim } = useApp();
  const real = sim.board!;
  useEffect(() => {
    if (!readOnly && !desk.checks.readAt && !desk.checks.loading) void desk.loadChecks();
  }, [desk, readOnly]);
  if (readOnly) return null;
  return (
    <>
      <div className="note">
        라이더 인계 허가가 만료됐는데 확정이 없는 포장 — 실물을 보고 "자리에 있음"(허가 해제) 또는 "라이더가 가져감"(인계·재고 전기)을 정합니다.{' '}
        <button className="link" onClick={() => void desk.loadChecks()}>
          ↻
        </button>
      </div>
      {desk.checks.loading && <div className="note">읽는 중…</div>}
      {desk.checks.error && <div className="note warn">읽지 못함: {desk.checks.error}</div>}
      {!desk.checks.loading && !desk.checks.items.length && !desk.checks.error && <div className="scan-empty">확인이 필요한 포장이 없습니다.</div>}
      {desk.checks.items.map((p) => (
        <div key={p.packageId} className="adm-task">
          <div className="adm-h">
            <b>{p.orderNumber ?? p.shipmentId?.slice(-8) ?? p.packageId.slice(-8)}</b>
            <span className="muted">
              {p.packingLocation ?? ''} · 라이더 {real.riderLabel(p.riderId) ?? (p.riderId ? '번호 확인 중' : '—')} · 허가 만료 {hm(p.fence?.expiresAt)}
            </span>
          </div>
          <div className="adm-acts">
            <Confirm label="자리에 있음" onGo={(r) => void desk.check(p.packageId, 'AT_STATION', r)} />
            <Confirm label="라이더가 가져감" danger onGo={(r) => void desk.check(p.packageId, 'TAKEN_BY_RIDER', r)} />
          </div>
          <ActionNote desk={desk} k={`check:${p.packageId}`} />
        </div>
      ))}
    </>
  );
}
