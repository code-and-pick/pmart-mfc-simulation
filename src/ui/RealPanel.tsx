// 실서버 관찰 화면: 실제 주문(출고)별 PICK·PACK 상태와 담당 작업자. 서버가 준 값만 보인다.
import { useApp } from '../app/context';
import { REAL_LINK } from '../config';
import type { TaskState } from '../domain/contract';
import type { RealTask } from '../sim/realBoard';

export const TASK_STATE_KO: Record<TaskState | 'CHECKING', string> = {
  WAITING: '대기',
  READY: '준비(배정 전)',
  ASSIGNED: '배정',
  IN_PROGRESS: '진행',
  COMPLETED: '완료',
  BLOCKED: '막힘',
  FAILED: '실패',
  CANCELLED: '취소',
  CLOSED_PARTIAL: '부분 종료',
  CHECKING: '확인 중',
};

const STATE_CLASS: Partial<Record<TaskState | 'CHECKING', string>> = {
  IN_PROGRESS: 'st-run',
  ASSIGNED: 'st-asg',
  READY: 'st-ready',
  BLOCKED: 'st-bad',
  FAILED: 'st-bad',
  COMPLETED: 'st-done',
  CANCELLED: 'st-done',
  CLOSED_PARTIAL: 'st-done',
  CHECKING: 'st-wait',
};

/** 실서버 요약 — 열린 작업 수 */
export function RealSummary() {
  const { sim } = useApp();
  const real = sim.real!;
  const c = real.counts();
  const n = (k: string) => c[k] ?? 0;
  const kpis: [string, string][] = [
    ['열린 출고', `${real.shipments().filter((s) => [s.pick, s.pack, s.ret].some((t) => t && !t.closed)).length}`],
    ['PICK 준비·배정·진행', `${n('PICK:READY') + n('PICK:WAITING')}·${n('PICK:ASSIGNED')}·${n('PICK:IN_PROGRESS')}`],
    ['PACK 대기·배정·진행', `${n('PACK:WAITING') + n('PACK:READY')}·${n('PACK:ASSIGNED')}·${n('PACK:IN_PROGRESS')}`],
    ['막힘 (결품 등)', `${Object.entries(c).filter(([k]) => k.endsWith(':BLOCKED')).reduce((a, [, v]) => a + v, 0)}`],
    ['복귀(RETURN) 열린 것', `${n('RETURN:READY') + n('RETURN:ASSIGNED') + n('RETURN:IN_PROGRESS') + n('RETURN:WAITING')}`],
    ['센터 작업자', `${real.workers.size}명`],
  ];
  return (
    <div className="kpis">
      {kpis.map(([k, v]) => (
        <div className="kpi" key={k}>
          <div className="v">{v}</div>
          <div className="k">{k}</div>
        </div>
      ))}
    </div>
  );
}

function TaskCell({ t }: { t?: RealTask }) {
  const { sim } = useApp();
  if (!t) return <td className="muted">—</td>;
  const s = t.summary;
  const state = t.closed ? t.closed.state : s.state;
  const flags = [s.late && '늦음', s.idle && '30분 실적 없음'].filter(Boolean).join(' · ');
  return (
    <td>
      <span className={`st ${STATE_CLASS[state] ?? ''}`}>{TASK_STATE_KO[state]}</span> {s.completedQty}/{s.plannedQty}
      <div className="sub">
        {sim.real!.workerName(s.assignment?.workerId)}
        {flags && <span className="warn"> · {flags}</span>}
      </div>
    </td>
  );
}

/** 실제 주문(출고) 목록 */
export function RealOrders() {
  const { sim } = useApp();
  const real = sim.real!;
  const rows = real.shipments();
  if (!rows.length) {
    return (
      <div className="note">
        {real.lastOkMs
          ? `${sim.params.mfcId} 에 열린 작업이 없습니다. 고객 앱에서 주문하면 ${REAL_LINK.pollSec}초 안팎에 여기 나타나고, 피킹이 시작되면 3D 선반에 지시 칸이 표시됩니다.`
          : '실서버 첫 조회 중…'}
      </div>
    );
  }
  return (
    <table className="inv real">
      <thead>
        <tr>
          <th>출고 · 상품</th>
          <th>PICK</th>
          <th>PACK</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const head = (r.pick ?? r.pack ?? r.ret)!.summary.headline;
          const created = new Date((r.pick ?? r.pack ?? r.ret)!.summary.createdAt);
          return (
            <tr key={r.shipmentId} title={`${r.shipmentId}\n${r.fulfillmentId}`}>
              <td>
                <div>{shortId(r.shipmentId)}</div>
                <div className="sub">
                  {head?.productName ?? '—'}
                  {head && head.otherLineCount > 0 ? ` 외 ${head.otherLineCount}건` : ''} · {created.toLocaleTimeString()}
                </div>
              </td>
              <TaskCell t={r.pick} />
              <TaskCell t={r.pack ?? r.ret} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const WORK_KO: Record<string, string> = { STORED: '보관', PICKED: '집품', PACKED: '포장', CANCEL_RETURN_PENDING: '복귀 대기', UNSTOWED: '미적치' };

/** 주문에 나온 SKU 의 실제 재고(서버 응답 그대로). 평면에 없는 위치는 표에만 나온다 */
export function RealStockTable() {
  const { sim } = useApp();
  const real = sim.real!;
  const units = real.stockUnits().sort((a, b) => a.sku.localeCompare(b.sku) || a.locationCode.localeCompare(b.locationCode));
  if (!units.length) {
    return <div className="note">열린 주문에 나온 상품이 없어 읽은 재고가 없습니다. 센터 전체 재고를 칸 단위로 읽는 API 는 없어 주문 상품만 읽습니다.</div>;
  }
  const names = new Map<string, string>();
  for (const t of real.tasks.values()) for (const l of t.detail?.lines ?? []) if (l.productName) names.set(l.sku, l.productName);
  return (
    <>
      <div className="note">
        주문 상품 {real.stock.size}개의 재고 (GET /mfcs/{sim.params.mfcId}/stock) — 작업이 바뀌면 바로, 아니면 {REAL_LINK.stockRefreshSec}초마다 다시 읽습니다. 3D 의 다른 칸은 회색(수량 모름).
      </div>
      <table className="inv real">
        <thead>
          <tr>
            <th>상품</th>
            <th>위치</th>
            <th>상태</th>
            <th>수량</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u, i) => (
            <tr key={i} title={u.sku}>
              <td>
                <div>{u.sku}</div>
                <div className="sub">{names.get(u.sku) ?? ''}</div>
              </td>
              <td>
                {u.locationCode}
                {!sim.backendLocation(u.locationCode) && !sim.backendPoint(u.locationCode) && <div className="sub">평면에 없는 위치</div>}
              </td>
              <td>
                {WORK_KO[u.workState] ?? u.workState}
                {u.qualityState !== 'NORMAL' && <div className="sub warn">{u.qualityState}</div>}
              </td>
              <td>{u.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** ORD-0e67de38-7acf-…-S1 → ORD-0e67de38…S1 */
function shortId(id: string): string {
  const m = /^([A-Z0-9]+-[0-9a-f]{8})[0-9a-f-]*(-S\d+)?$/i.exec(id);
  return m ? `${m[1]}…${m[2] ?? ''}` : id;
}
