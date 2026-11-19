// 실서버 관찰 화면: 실제 주문(출고)별 PICK·PACK 상태와 담당 작업자. 서버가 준 값만 보인다.
// 주문 줄을 누르면 "바코드" 탭으로 넘어가 그 주문에서 찍을 바코드(카트·지시 칸·상품·포장 위치)를 보인다.
import { OrderCards } from './OrderCards';
import { useApp } from '../app/context';
import { BACKEND_FACTS, REAL_LINK } from '../config';
import type { TaskState } from '../domain/contract';

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

const RETURN_STATE_KO: Partial<Record<string, string>> = {
  UNASSIGNED: '배차 대기',
  ASSIGNED: '라이더 배정 — 회수지로',
  ARRIVED_AT_CUSTOMER: '회수지 도착',
  FAILURE_REPORTED: '회수 실패 보고',
  RETURN_IN_PROGRESS: '회수 중',
  RETURN_PICKED_UP: '회수함 — MFC 로 오는 중',
  PICKED_UP: '회수함 — 오는 중',
  RETURNED_TO_STORE: 'MFC 반납(회수 반입 자리)',
  COMPLETED: '끝남',
};

/** 이 센터로 오는 회수 배송(고객 반품·오배송 회수, type RETURN) — 배송 찾기 요약만(회수지 좌표는 읽지 않음) */
const PURPOSE_KO: Record<string, string> = { CLAIM_RETURN: '반품 회수', MISDELIVERY_RECOVERY: '오배송 회수', FAILED_DELIVERY_RETURN: '전달 실패 반납' };

/**
 * MFC 반납 인증번호(delivery-execution 0.28.0 — 센터 직원 화면 4자리, 라이더가 넣어야 반납). 서버 값 그대로.
 * 번호가 없으면 서버가 조회 때 만든다. 이 PC 화면만(다른 기기 조회 경로에는 넣지 않음 — 반납 확인용 번호).
 */
function ReturnHandovers() {
  const { sim } = useApp();
  const real = sim.real!;
  const hs = real.returnHandovers;
  // 다른 기기(조회만)는 이 경로를 허용 목록에 넣지 않았다(403) — 오류로 보이지 않는다
  if (!hs.length) return real.returnHandoverError && !sim.realTokens?.serverInjected ? <div className="note warn">반납 인증번호를 읽지 못했습니다: {real.returnHandoverError}</div> : null;
  return (
    <>
      <h4>MFC 반납 대기 · 반납 인증번호 (라이더가 입력)</h4>
      <table className="inv real">
        <thead>
          <tr>
            <th>배송</th>
            <th>인증번호</th>
          </tr>
        </thead>
        <tbody>
          {hs.map((h) => (
            <tr key={h.deliveryId} title={h.deliveryId}>
              <td>
                <div>{h.deliveryNumber ?? <span className="muted">번호 없음</span>}</div>
                <div className="sub">
                  {PURPOSE_KO[h.purpose ?? ''] ?? h.purpose ?? '—'} · {RETURN_STATE_KO[h.state] ?? h.state}
                </div>
              </td>
              <td>
                <b className="code4">{h.code}</b>
                {h.locked ? <div className="sub warn">잠김(5번 틀림) — 센터에서 새로 내기</div> : h.failedAttempts ? <div className="sub warn">틀림 {h.failedAttempts}번</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ReturnPickups() {
  const { sim } = useApp();
  const rp = sim.real!.returnPickups;
  if (!rp.length) return <ReturnHandovers />;
  return (
    <>
      <ReturnHandovers />
      <h4 className="oc-sec">회수 배송 {rp.length}건 → 회수 반입 {BACKEND_FACTS.returnIntake.code}</h4>
      <table className="ot big">
        <tbody>
          {rp.map((d) => (
            <tr key={d.deliveryId} className={`ot-r tone-${d.riderId ? 'ok' : 'wait'}`}>
              <td>
                <div className="ob-1">
                  <b className="ob-no">{d.deliveryNumber ?? <span className="muted">번호 없음</span>}</b>
                  <span className="ob-st">{RETURN_STATE_KO[d.state] ?? d.state}</span>
                  <span className="ob-t">{d.riderId ? '라이더 있음' : '라이더 없음'}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** 실제 주문(출고) 목록 */
export function RealOrders() {
  const { sim } = useApp();
  const real = sim.real!;
  const rows = real.shipments();
  if (!rows.length) {
    return (
      <>
        <div className="note">
          {real.lastOkMs
            ? `${sim.params.mfcId} 에 열린 작업이 없습니다. 고객 앱에서 주문하면 ${REAL_LINK.pollSec}초 안팎에 여기 나타나고, 피킹이 시작되면 3D 선반에 지시 칸이 표시됩니다.`
            : '실서버 첫 조회 중…'}
        </div>
        <ReturnPickups />
      </>
    );
  }
  return (
    <>
      <OrderCards />
    <ReturnPickups />
    </>
  );
}

const WORK_KO: Record<string, string> = { STORED: '보관', PICKED: '집품', PACKED: '포장', CANCEL_RETURN_PENDING: '복귀 대기', UNSTOWED: '미적치' };

/** 주문에 나온 SKU 의 실제 재고(서버 응답 그대로). 평면에 없는 위치는 표에만 나온다 */
/**
 * 주문에 나온 상품의 실제 재고(서버 응답 그대로) — 상품마다 카드: 이름·합계 / 위치마다 한 줄(위치 · 상태 · 수량).
 * 위치를 누르면 3D 에서 그 칸으로. 평면에 없는 위치는 회색(사용자 2026-11-20 "재고·바코드 탭도 … 작고 빽빽").
 */
export function RealStockTable() {
  const { sim, controller } = useApp();
  const real = sim.real!;
  const units = real.stockUnits();
  if (!units.length) {
    return <div className="note">열린 주문에 나온 상품이 없어 읽은 재고가 없습니다(센터 전체 재고를 칸 단위로 읽는 API 는 없음).</div>;
  }
  const names = new Map<string, string>();
  for (const t of real.tasks.values()) for (const l of t.detail?.lines ?? []) if (l.productName) names.set(l.sku, l.productName);
  const bySku = new Map<string, typeof units>();
  // 같은 칸·같은 상태는 LOT 이 달라도 한 줄로(수량 합) — 칸마다 한 번만 보이게
  for (const u of units) {
    const list = bySku.get(u.sku) ?? [];
    const same = list.find((x) => x.locationCode === u.locationCode && x.workState === u.workState && x.qualityState === u.qualityState);
    if (same) same.qty += u.qty;
    else list.push({ ...u });
    bySku.set(u.sku, list);
  }
  const groups = [...bySku].sort((x, y) => (names.get(x[0]) ?? x[0]).localeCompare(names.get(y[0]) ?? y[0]));
  return (
    <div className="stk">
      <div className="stk-h">
        주문 상품 {groups.length}개 · 위치를 누르면 3D 에서 그 칸
      </div>
      {groups.map(([sku, us]) => {
        const stored = us.filter((u) => u.workState === 'STORED' && u.qualityState === 'NORMAL').reduce((a, u) => a + u.qty, 0);
        const total = us.reduce((a, u) => a + u.qty, 0);
        return (
          <div key={sku} className="stk-c">
            <div className="stk-t">
              <span className="nm">{names.get(sku) ?? sku}</span>
              <span className="tot">
                <b>{stored}</b>
                <small>선반 · 전체 {total}</small>
              </span>
            </div>
            {us
              .sort((x, y) => x.locationCode.localeCompare(y.locationCode))
              .map((u, i) => {
                const onPlan = !!(sim.backendLocation(u.locationCode) || sim.backendPoint(u.locationCode));
                return (
                  <button key={i} className={`stk-r ${onPlan ? '' : 'off'}`} onClick={() => onPlan && controller.focusBackendCode(u.locationCode)} title={onPlan ? '3D 에서 그 칸으로' : '평면에 없는 위치'}>
                    <span className="loc">{u.locationCode}</span>
                    <span className={`ws ws-${u.workState}`}>{WORK_KO[u.workState] ?? u.workState}</span>
                    {u.qualityState !== 'NORMAL' && <span className="ws bad">{u.qualityState === 'QUARANTINED' ? '격리' : u.qualityState}</span>}
                    <b className="q">{u.qty}</b>
                  </button>
                );
              })}
            <div className="stk-sku">{sku}</div>
          </div>
        );
      })}
    </div>
  );
}
