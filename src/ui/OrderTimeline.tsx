// 고른 주문의 현장 기록 — fulfillment 0.10.0 GET /work-orders?orderId=(백오피스 통합 조회 MFC 칸과 같은 원장, 개인정보 없음).
// 화면 번호 규칙(ADR-0070, 사용자 2026-11-20 "식별값 긴 것들 … 다 줄여서"): 긴 ID(FUL-·SHP-·PKG-)·영어 상태값은 겉에 내지 않는다.
// 시각 순서 한 줄씩(시각 · 일 · 담당), 포장은 온도·라벨 번호로. 시스템 ID 는 맨 아래 접힌 "시스템 번호"에만.
import { useEffect } from 'react';
import { useApp } from '../app/context';
import { SystemIds } from './OrderNo';
import { TASK_STATE_KO } from './RealPanel';
import { TEMP_KO } from './text';

const hm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '');
const KIND_KO: Record<string, string> = { PICK: '피킹', PACK: '패킹', RETURN: '취소품 복귀', DISPATCH: '배차' };
const SHIP_KO: Record<string, string> = {
  PREPARING: '준비 중',
  READY: '출하 대기',
  PARTIALLY_HANDED_OVER: '일부 인계',
  HANDED_OVER: '인계 끝',
  CANCELLED: '취소',
};
const PKG_KO: Record<string, string> = { OPEN: '포장 중', SEALED: '밀봉', HANDED_OVER: '인계됨', INVALIDATED: '무효' };

type Row = { at: string; what: string; who?: string; tone?: 'warn' | 'ok' };

export function OrderTimeline({ shipmentId }: { shipmentId: string }) {
  const { sim } = useApp();
  const real = sim.board!;
  const orderId = real.shipmentInfo.get(shipmentId)?.data.orderId ?? null;
  useEffect(() => {
    if (orderId) real.requestOrderView(orderId);
  });
  // MOCK 은 현장 기록(work-orders)이 없다
  if (!sim.real) return null;
  if (!orderId) return <div className="note">현장 기록: 출고를 읽는 중</div>;
  const v = real.orderViews.get(orderId);
  if (v?.notYet) return <div className="note">현장 기록: 작업 지시가 아직 MFC 에 오지 않음</div>;
  if (!v || (!v.data && v.loading)) return <div className="note">현장 기록 읽는 중…</div>;
  if (!v.data) return <div className="note warn">현장 기록을 읽지 못함</div>;
  const w = (id: string | null | undefined) => (id ? real.workerName(id) : undefined);
  const ids: [string, string][] = [];
  return (
    <details className="otl">
      <summary>
        현장 기록 <span>{hm(new Date(v.readMs).toISOString())} 읽음</span>
      </summary>
      {v.data.workOrders.map((wo) => {
        ids.push([wo.kind === 'RESHIPMENT' ? '재발송 지시' : '작업 지시', wo.fulfillmentId]);
        return (
          <div key={wo.fulfillmentId} className="otl-wo">
            <div className="otl-wo-h">
              <b>{wo.kind === 'RESHIPMENT' ? '재발송' : '원래 주문'}</b>
              <span className={wo.acceptance === 'ACCEPTED' ? 'ok' : 'bad'}>{wo.acceptance === 'ACCEPTED' ? '수락' : `거절${wo.rejectReason ? ` · ${wo.rejectReason}` : ''}`}</span>
            </div>
            {wo.shipments.map((s, si) => {
              ids.push([`출고 ${si + 1}`, s.shipmentId]);
              const info = real.shipmentInfo.get(s.shipmentId)?.data;
              const rows: Row[] = [];
              for (const k of s.tasks) {
                const kind = KIND_KO[k.taskType] ?? k.taskType;
                if (k.startedAt) rows.push({ at: k.startedAt, what: `${kind} 시작`, who: w(k.workerId ?? k.startedBy) });
                if (k.endedAt)
                  rows.push({
                    at: k.endedAt,
                    what: `${kind} ${TASK_STATE_KO[k.state] ?? k.state} ${k.completedQty}/${k.plannedQty}${k.cancelledQty ? ` · 취소 ${k.cancelledQty}` : ''}`,
                    tone: k.state === 'COMPLETED' ? 'ok' : undefined,
                  });
                if (k.blockReason) rows.push({ at: k.startedAt ?? wo.createdAt, what: `${kind} 막힘 — ${k.blockReason}`, tone: 'warn' });
              }
              for (const x of s.shortages) rows.push({ at: x.reportedAt, what: `결품 보고 ${x.qty}개${x.reason ? ` · ${x.reason}` : ''}`, tone: 'warn' });
              // 점원이 고른 예상 포장 시간(PDA "배차 요청", estimatedPackMinutes)과 서버가 정한 준비 예정 시각(사용자 2026-11-20 "배차시간 뭐 선택했는지")
              if (s.dispatchRequestedAt) {
                const dr = info?.dispatchRequest;
                const min = dr?.estimatedPackMinutes;
                rows.push({ at: s.dispatchRequestedAt, what: `배차 요청${min ? ` · 예상 포장 ${min}분` : ''}${dr?.estimatedReadyAt ? ` (준비 ${hm(dr.estimatedReadyAt)})` : ''}`, who: dr?.requestedBy ? w(dr.requestedBy) : undefined });
              }
              s.packages.forEach((p, pi) => {
                ids.push([`포장 ${pi + 1}`, p.packageId]);
                const pk = info?.packages?.find((x) => x.packageId === p.packageId);
                const name = `포장 ${pk?.temperatureZone ? TEMP_KO[pk.temperatureZone as keyof typeof TEMP_KO] : pi + 1}${pk?.handoverCode ? ` ${pk.handoverCode}` : ''}`;
                if (p.sealedAt) rows.push({ at: p.sealedAt, what: `${name} ${PKG_KO[p.state] ?? p.state}` });
                if (p.handoverAuthorizedAt) rows.push({ at: p.handoverAuthorizedAt, what: `${name} 라이더 스캔`, tone: 'ok' });
              });
              if (s.readyAt) rows.push({ at: s.readyAt, what: '출하 대기(랙)', tone: 'ok' });
              rows.sort((a, b) => a.at.localeCompare(b.at));
              return (
                <div key={s.shipmentId} className={`otl-sh ${s.shipmentId === shipmentId ? 'me' : ''}`}>
                  <div className="otl-sh-h">
                    {s.shipmentId === shipmentId ? '이 출고' : `다른 출고 ${si + 1}`} <span>{SHIP_KO[s.state] ?? s.state}</span>
                  </div>
                  <ol>
                    {rows.map((r, i) => (
                      <li key={i} className={r.tone ?? ''}>
                        <time>{hm(r.at)}</time>
                        <span>
                          {r.what}
                          {r.who && <em> · {r.who}</em>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        );
      })}
      {v.data.stopRequests.length > 0 && <div className="note warn">중지 요청 {v.data.stopRequests.length}건</div>}
      <SystemIds ids={ids} />
    </details>
  );
}
