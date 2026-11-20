// 화면 번호(ADR-0070, 백엔드 PR #184 — 사용자 2026-11-18 "DLV-… 무슨 번호인지 알 수 있어야"): 목록·이름표·말풍선에는 주문번호(8자리, fulfillment 0.13.0 orderNumber)만.
// 번호가 없으면(번호 전 주문·조회 전) 시스템 ID 끝 8자리를 회색 + "번호 없음". 시스템 ID 는 상세의 접힌 "시스템 번호"(SystemIds)에서 복사.
import { useApp } from '../app/context';

/** 출고의 주문번호 — 없으면 null */
export function useOrderNumber(shipmentId: string | null | undefined): string | null {
  const { sim } = useApp();
  return shipmentId && sim.board ? sim.board.orderNumberOf(shipmentId) : null;
}

/** 이름표처럼 글자만 필요할 때: 주문번호, 없으면 "끝8자리(번호 없음)" */
export function orderText(orderNumber: string | null | undefined, systemId: string): string {
  return orderNumber ?? `${systemId.slice(-8)}(번호 없음)`;
}

export function OrderNo({ shipmentId }: { shipmentId: string }) {
  const n = useOrderNumber(shipmentId);
  if (n) return <span title={shipmentId}>{n}</span>;
  return (
    <span className="muted" title={shipmentId}>
      {shipmentId.slice(-8)} · 번호 없음
    </span>
  );
}

/** 상세의 접힌 "시스템 번호" + 복사 — 문의·로그 대조용 */
export function SystemIds({ ids }: { ids: [string, string | null | undefined][] }) {
  const list = ids.filter((x): x is [string, string] => !!x[1]);
  if (!list.length) return null;
  return (
    <details className="sys-ids">
      <summary>시스템 번호</summary>
      {list.map(([k, v]) => (
        <div key={k}>
          <span className="sub">{k}</span> <code>{v}</code>{' '}
          <button className="bc-zoom" onClick={() => void navigator.clipboard?.writeText(v).catch(() => undefined)} title="복사">
            복사
          </button>
        </div>
      ))}
    </details>
  );
}
