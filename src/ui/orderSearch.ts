// 오른쪽 실제 주문 검색 — 주문번호·점원(이름·사번·ID)·라이더(ID)로 그 주문만(사용자 2026-11-20 "주문이 여러개니까 내가 원하는 주문을 못 찾겠어").
// React 없이: 출고마다 찾을 말(종류·글자)을 모으고, 입력과 부분 일치로 비교한다. 대소문자·띄어쓰기·하이픈은 무시.
import type { Simulation } from '../sim/simulation';
import { dispatchView, type RealShipment, type RealTask } from '../sim/realBoard';

// 라이더: 번호 6자리·가린 이름·ID
export type HitKind = '주문번호' | '배송번호' | '점원' | '라이더' | '시스템 ID';

export interface SearchField {
  kind: HitKind;
  /** 화면에 "찾은 곳"으로 보이는 글자 */
  text: string;
  /** 비교에만 쓰는 글자(보이지 않음) — 예: 운영자 ID */
  extra?: string[];
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_·.]/g, '');
}

/** 입력과 맞는 첫 칸 — 없으면 null. 빈 입력은 모두 맞음(undefined) */
export function matchFields(fields: SearchField[], query: string): SearchField | null | undefined {
  const q = normalize(query);
  if (!q) return undefined;
  for (const f of fields) {
    if ([f.text, ...(f.extra ?? [])].some((t) => normalize(t).includes(q))) return f;
  }
  return null;
}

/** 출고 하나에서 찾을 말 — 서버 값(작업 배정·배송·배차)과 화면 점원(PDA 가 이 주문인 사람) */
export function searchFields(sim: Simulation, r: RealShipment): SearchField[] {
  const real = sim.board!;
  const out: SearchField[] = [];
  const no = real.orderNumberOf(r.shipmentId) ?? r.delivery?.orderNumber ?? null;
  if (no) out.push({ kind: '주문번호', text: no });
  if (r.delivery?.deliveryNumber) out.push({ kind: '배송번호', text: r.delivery.deliveryNumber });
  const workerIds = new Set<string>();
  const add = (t?: RealTask) => {
    if (t?.summary.assignment?.workerId) workerIds.add(t.summary.assignment.workerId);
    if (t?.summary.pickedBy) workerIds.add(t.summary.pickedBy);
  };
  add(r.pick);
  add(r.pack);
  add(r.ret);
  for (const w of sim.siteWorkers()) if (w.pda?.shipmentId === r.shipmentId) workerIds.add(w.id);
  for (const id of workerIds) {
    const name = real.workerName(id);
    const shown = name === '작업자 확인 중' || name === '미배정' ? id : name;
    out.push({ kind: '점원', text: shown, extra: [id] });
  }
  const rider = dispatchView(r).riderId;
  // 라이더 번호·가린 이름(ADR-0070, rider 0.18.0)으로도 찾는다 — 화면엔 번호 표기, ID 는 비교에만
  if (rider) out.push({ kind: '라이더', text: real.riderLabel(rider) ?? rider, extra: [rider, real.riderNames.get(rider)?.riderNumber ?? ''].filter(Boolean) });
  out.push({ kind: '시스템 ID', text: r.shipmentId, extra: [r.fulfillmentId, r.delivery?.deliveryId ?? '', r.delivery?.orderId ?? ''].filter(Boolean) });
  return out;
}
