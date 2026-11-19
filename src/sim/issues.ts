// "확인할 일" — 화면 맨 위 띠에 올릴 이상 상황(pmart-rider-simulation ui/IssueBar·ops 참고, 2026-11-19 사용자 "화면 ui 참고").
// 서버가 확정한 상태(작업 목록·상세)와 이 화면 가상 작업자 상태만 본다. 기준 값은 config ISSUES [시뮬].
import { ISSUES } from '../config';
import type { Simulation } from './simulation';

export type IssueLevel = 'bad' | 'warn';

export interface Issue {
  /** 같은 이상은 같은 키(목록이 깜빡이지 않게) */
  key: string;
  level: IssueLevel;
  icon: string;
  /** 무엇(짧게) */
  title: string;
  /** 어느 주문·작업자 · 얼마나 */
  what: string;
  /** 누르면 갈 곳 */
  go: { shipmentId?: string; personId?: string; settings?: boolean } | null;
}

const min = (ms: number) => Math.max(0, Math.round(ms / 60_000));

export function collectIssues(sim: Simulation, nowMs = Date.now()): Issue[] {
  const out: Issue[] = [];
  const real = sim.real;
  if (real) {
    if (real.lastError) out.push({ key: 'poll', level: 'bad', icon: '⚡', title: '실서버 조회 오류', what: real.lastError, go: { settings: true } });
    for (const t of real.tasks.values()) {
      if (t.closed) continue;
      const s = t.summary;
      const ord = s.orderNumber ?? s.fulfillmentId.slice(-8);
      const ship = s.shipmentId ?? undefined;
      if (s.state === 'BLOCKED') {
        out.push({ key: `blk:${s.taskId}`, level: 'bad', icon: '⛔', title: `${s.taskType} 막힘`, what: `주문 ${ord}${t.detail?.blockReason ? ` · ${t.detail.blockReason}` : ''}`, go: { shipmentId: ship } });
        continue;
      }
      if (s.late) out.push({ key: `late:${s.taskId}`, level: 'bad', icon: '🕒', title: `${s.taskType} 늦음`, what: `주문 ${ord} · 예상 시간의 2배 넘김(서버)`, go: { shipmentId: ship } });
      else if (s.idle) out.push({ key: `idle:${s.taskId}`, level: 'warn', icon: '⏸', title: `${s.taskType} 멈춤`, what: `주문 ${ord} · 30분 실적 없음(서버)`, go: { shipmentId: ship } });
      if (s.taskType === 'PACK' && s.state === 'READY' && !s.assignment?.workerId && s.pickedBy) {
        const since = Date.parse(s.lastActivityAt ?? s.createdAt) || nowMs;
        if (nowMs - since > ISSUES.packWaitMin * 60_000)
          out.push({ key: `pack:${s.taskId}`, level: 'warn', icon: '📦', title: '패킹 안 받음', what: `주문 ${ord} · 피킹 끝 ${min(nowMs - since)}분 — PDA 다음 작업 받기`, go: { shipmentId: ship } });
      }
      if (s.taskType === 'PICK' && s.state === 'READY') {
        const since = Date.parse(s.createdAt) || nowMs;
        if (nowMs - since > ISSUES.pickWaitMin * 60_000)
          out.push({ key: `pick:${s.taskId}`, level: 'warn', icon: '⏳', title: '피킹 배정 대기', what: `주문 ${ord} · ${min(nowMs - since)}분째 담당 없음`, go: { shipmentId: ship } });
      }
    }
    for (const w of sim.virtualWorkers) {
      if (w.left || (w.state !== 'ERROR' && !w.halted)) continue;
      out.push({ key: `vw:${w.account}`, level: w.halted ? 'bad' : 'warn', icon: '🤖', title: w.halted ? '가상 작업자 멈춤' : '가상 작업자 오류', what: `${w.account.replace('mfcw-', '')} · ${w.lastProblem ?? w.activity}`, go: { personId: w.id } });
    }
    for (const c of sim.interruptedVirtual())
      out.push({ key: `cut:${c.account}`, level: 'warn', icon: '✂', title: '끊긴 가상 작업', what: `${c.account.replace('mfcw-', '')} · ${c.taskType} ${c.orderNumber ?? ''} — 설정에서 이어 하기`, go: { settings: true } });
  } else {
    const b = sim.taskBoard();
    const blocked = Object.entries(b).filter(([k]) => k.endsWith(':BLOCKED')).reduce((a, [, n]) => a + n, 0);
    if (blocked) out.push({ key: 'mock:blocked', level: 'bad', icon: '⛔', title: '막힌 작업', what: `${blocked}건(결품 등)`, go: null });
    if (sim.metrics.ordersBlockedStock) out.push({ key: 'mock:stock', level: 'warn', icon: '📦', title: '재고 부족 차단', what: `주문 ${sim.metrics.ordersBlockedStock}건`, go: null });
  }
  if (sim.metrics.apiErrors) out.push({ key: 'api', level: 'warn', icon: '⚠', title: 'API 오류', what: `${sim.metrics.apiErrors}회 — API 기록`, go: null });
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
}
