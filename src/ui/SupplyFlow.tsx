// 입고 신청 한 건 자세히 — 세로 흐름(발주 → 승인 → DC 로 보냄 → DC 출고 작업 → 출발 → 도착 → 인계 → 수령 → 검사 → 적치 → 끝).
// 단계마다 상태 점·시각·내용(번호는 줄 하나에 하나). 열려 있는 동안 5초마다 서버에서 다시 읽는다(읽기만).
// (사용자 2026-11-27 "입고 신청한 거 자세히 볼 수 있는흐름")
import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import type { SupplyRequest, SupplyTransfer } from '../domain/contract';
import type { FlowStep } from '../sim/supplyFlow';
import { TrfRef } from './TrfRef';

const kst = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
};
const DOT = { done: '✓', now: '●', wait: '', warn: '!' } as const;

export function SupplyFlowView({ req, t }: { req: SupplyRequest; t: SupplyTransfer }) {
  const { sim } = useApp();
  const [steps, setSteps] = useState<FlowStep[] | null>(null);
  const [err, setErr] = useState('');
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    const load = () =>
      sim.supplyFlow(req, t).then(
        (s) => {
          if (!on) return;
          setSteps(s);
          setErr('');
          setAt(Date.now());
        },
        (e: Error) => on && setErr(e.message),
      );
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      on = false;
      clearInterval(timer);
    };
  }, [sim, req, t]);
  const now = steps?.find((s) => s.state === 'now' || s.state === 'warn');
  return (
    <div className="sf">
      <div className="sf-sum">
        <div>
          <span>발주</span>
          <b className="mono">{req.supplyRequestId}</b>
        </div>
        <div>
          <span>송장</span>
          <b>
            <TrfRef trfId={t.trfId} cdcId={t.cdcId} />
          </b>
        </div>
        <div>
          <span>지금</span>
          <b>{now ? now.title : steps ? '끝' : '읽는 중…'}</b>
        </div>
      </div>
      {err && <div className="note warn">읽기 실패 — {err}</div>}
      <ol className="sf-list">
        {(steps ?? []).map((s) => (
          <li key={s.key} className={`sf-step ${s.state}`}>
            <i>{DOT[s.state]}</i>
            <div className="sf-body">
              <div className="sf-h">
                <b>{s.title}</b>
                {s.at && <span>{kst(s.at)}</span>}
              </div>
              {s.lines.map((l, k) => (
                <div key={k} className="sf-l">
                  {l}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div className="sf-foot">{at ? `${kst(new Date(at).toISOString())} 읽음 · 5초마다 다시` : ''} · DC 안쪽(피킹·검품)은 MFC 계정으로 못 읽어 운행이 생기면 보입니다</div>
    </div>
  );
}
