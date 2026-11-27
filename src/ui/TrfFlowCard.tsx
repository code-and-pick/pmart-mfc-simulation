// 입고 추적 탭 맨 위 "TRF 흐름" — DC 시뮬레이터 TRF 흐름 카드 모양(사용자 2026-11-27 캡처 "이런 식으로").
// 머리: T번호(누르면 DC 백오피스)·W번호·센터·상품, 상태 배지 / 송장 칩(지금 일하는 건이 앞·자동 선택) / 단계(색 점 + 오른쪽 값) / 차량 / MFC 작업 / 기록(최신순).
// 열려 있는 동안 5초마다 다시 읽음(읽기만).
import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import type { TrfFlowView } from '../sim/trfFlow';
import { TrfRef } from './TrfRef';
import { CDC_BACKOFFICE } from '../config';

export function TrfFlowCard() {
  const { sim } = useApp();
  const ids = sim.flowTrfIds();
  const [pick, setPick] = useState<string | null>(null);
  const [fold, setFold] = useState(false);
  // 고른 게 없거나 목록에서 빠졌으면 지금 일하는 건 → 첫 건
  const sel = (pick && ids.some((x) => x.trfId === pick) ? pick : null) ?? ids.find((x) => x.live)?.trfId ?? ids[0]?.trfId ?? null;
  const [view, setView] = useState<TrfFlowView | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!sel) return;
    let on = true;
    setView((v) => (v?.trfId === sel ? v : null));
    const load = () =>
      sim.trfFlow(sel).then(
        (v) => {
          if (!on) return;
          setView(v);
          setAt(Date.now());
          setErr('');
        },
        (e: Error) => on && setErr(e.message),
      );
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [sim, sel]);
  if (!sel) return null;
  const v = view?.trfId === sel ? view : null;
  const info = sim.trfInfo(sel);
  return (
    <section className="tf">
      <div className="tf-head">
        <div>
          <div className="tf-no">
            <TrfRef trfId={sel} wave={false} />
          </div>
          <div className="tf-sub">
            {info.waveId ? <TrfWave trfId={sel} /> : null}
            {info.waveId ? ' · ' : ''}
            {sim.centerLabel}
          </div>
          {v && v.products.length > 0 && (
            <div className="tf-prod">
              {v.products[0].name} × {v.products[0].qty}
              {v.products.length > 1 ? ` 외 ${v.products.length - 1}` : ''}
            </div>
          )}
        </div>
        <div className="tf-head-r">
          {v && <span className="tf-badge">{v.badge}</span>}
          <button className="tf-fold" onClick={() => setFold((f) => !f)} title={fold ? '펼치기' : '접기'}>
            {fold ? '▾' : '▴'}
          </button>
        </div>
      </div>
      {ids.length > 1 && (
        <div className="tf-chips">
          {ids.map((x) => (
            <button key={x.trfId} className={x.trfId === sel ? 'on' : undefined} onClick={() => setPick(x.trfId)} title={x.trfId}>
              {x.live && <i className="tf-live" />}
              {sim.trfInfo(x.trfId).short}
            </button>
          ))}
        </div>
      )}
      {!fold && (
        <>
          <div className="tf-h">
            <b>TRF 흐름</b>
            <span>{at ? `${new Date(at).toLocaleTimeString('ko-KR', { hour12: false })} 기준` : '읽는 중…'}</span>
          </div>
          {err && <div className="note warn">읽기 실패 — {err}{/503/.test(err) ? ' (서버 재시작 중일 수 있음 — 5초 뒤 다시)' : ''}</div>}
          <ol className="tf-steps">
            {(v?.steps ?? []).map((s, i) => (
              <li key={s.key} className={`tf-step ${s.state} k-${s.key}`}>
                <i>{s.state === 'done' ? '✓' : s.state === 'warn' ? '!' : i + 1}</i>
                <b>{s.title}</b>
                <span>{s.value}</span>
              </li>
            ))}
          </ol>
          {v?.vehicle && (
            <div className="tf-veh">
              <b>{v.vehicle.title}</b>
              <span>{v.vehicle.sub}</span>
            </div>
          )}
          {v && v.tasks.length > 0 && (
            <>
              <div className="tf-h">
                <b>MFC 작업 · {sim.centerLabel}</b>
                <span>{v.tasks.length}건</span>
              </div>
              {v.tasks.map((t) => (
                <div key={t.taskId} className="tf-task">
                  <div className="tf-task-h">
                    <b>{t.kind}</b>
                    <span className={t.state === 'COMPLETED' ? 'ok' : 'run'}>{t.state === 'COMPLETED' ? '끝' : '진행'}</span>
                  </div>
                  <div className="tf-task-b">
                    <span>
                      {t.from}
                      {t.to.length ? ` → ${t.to.join(', ')}` : ''}
                    </span>
                    <span>
                      {t.product} <b>{t.done}/{t.planned}</b>
                    </span>
                  </div>
                  {t.who && <div className="tf-task-w">{t.who}</div>}
                </div>
              ))}
            </>
          )}
          {v && v.events.length > 0 && (
            <>
              <div className="tf-h">
                <b>기록</b>
                <span>최근 순</span>
              </div>
              <ol className="tf-ev">
                {v.events.map((e, i) => (
                  <li key={i}>
                    <span>{e.at}</span>
                    <div>
                      <b>{e.title}</b>
                      {e.who && <small>{e.who}</small>}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Wave 번호만(링크) */
function TrfWave({ trfId }: { trfId: string }) {
  const { sim } = useApp();
  const x = sim.trfInfo(trfId);
  if (!x.waveId) return null;
  return (
    <a className="tf-wave" href={CDC_BACKOFFICE.base + CDC_BACKOFFICE.wavePath('CDC01', x.waveId)} target="_blank" rel="noreferrer" title={x.waveId}>
      {x.waveNumber ?? 'Wave'}
    </a>
  );
}
