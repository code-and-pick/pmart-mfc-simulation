// 고른 주문의 현장 기록 — fulfillment 0.10.0 GET /work-orders?orderId=(백오피스 통합 조회 MFC 칸과 같은 원장, 개인정보 없음).
// 작업 지시(원래·재발송) → 출고별 작업(담당·시작·끝)·결품 보고·포장·인계, 배차 요청·출하 대기 시각. 서버 값 그대로 보인다.
import { useEffect } from 'react';
import { useApp } from '../app/context';
import { TASK_STATE_KO } from './RealPanel';

const t = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString() : '—');

export function OrderTimeline({ shipmentId }: { shipmentId: string }) {
  const { sim } = useApp();
  const real = sim.real!;
  const orderId = real.shipmentInfo.get(shipmentId)?.data.orderId ?? null;
  useEffect(() => {
    if (orderId) real.requestOrderView(orderId);
  });
  if (!orderId) return <div className="note">현장 기록: 출고 조회 전이라 주문 번호를 아직 모릅니다.</div>;
  const v = real.orderViews.get(orderId);
  if (!v || (!v.data && v.loading)) return <div className="note">현장 기록 읽는 중… (GET /work-orders?orderId=)</div>;
  if (!v.data) return <div className="note warn">현장 기록을 읽지 못했습니다: {v.error}</div>;
  const w = (id: string | null | undefined) => (id ? real.workerName(id) : '—');
  return (
    <details className="order-timeline" open>
      <summary>
        현장 기록 · 주문 {orderId} <span className="sub">(fulfillment 0.10.0, {t(new Date(v.readMs).toISOString())} 읽음)</span>
      </summary>
      {v.data.workOrders.map((wo) => (
        <div key={wo.fulfillmentId}>
          <div className="sub">
            {wo.kind === 'RESHIPMENT' ? '재발송' : '원래'} 작업 지시 {wo.fulfillmentId} · {wo.acceptance === 'ACCEPTED' ? '수락' : `거절 ${wo.rejectReason ?? ''}`} · 준비 시작 {t(wo.preparationStartedAt)}
          </div>
          {wo.shipments.map((s) => (
            <table className="inv real" key={s.shipmentId}>
              <thead>
                <tr>
                  <th>
                    {s.shipmentId === shipmentId ? <b>{s.shipmentId}</b> : s.shipmentId} · {s.state}
                  </th>
                  <th>
                    배차 요청 {t(s.dispatchRequestedAt)} · 출하 대기 {t(s.readyAt)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.tasks.map((k) => (
                  <tr key={k.taskId}>
                    <td>
                      {k.taskType} · {TASK_STATE_KO[k.state] ?? k.state} {k.completedQty}/{k.plannedQty}
                      {k.cancelledQty ? <span className="warn"> · 취소 {k.cancelledQty}</span> : null}
                      {k.blockReason ? <div className="sub warn">{k.blockReason}</div> : null}
                    </td>
                    <td>
                      {w(k.workerId)}
                      <div className="sub">
                        시작 {t(k.startedAt)} · 끝 {t(k.endedAt)}
                      </div>
                    </td>
                  </tr>
                ))}
                {s.shortages.map((x, i) => (
                  <tr key={`sh${i}`}>
                    <td className="warn">
                      결품 보고 {x.sku} × {x.qty} {x.reason ?? ''}
                    </td>
                    <td>
                      {t(x.reportedAt)} · {x.executionState}
                    </td>
                  </tr>
                ))}
                {s.packages.map((p) => (
                  <tr key={p.packageId}>
                    <td>
                      포장 {p.packageId} · {p.state}
                    </td>
                    <td>
                      밀봉 {t(p.sealedAt)} · 인계 {p.fenceState}
                      {p.handoverStatus ? ` ${p.handoverStatus}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      ))}
      {v.data.stopRequests.length > 0 && <div className="note warn">중지 요청 {v.data.stopRequests.length}건</div>}
    </details>
  );
}
