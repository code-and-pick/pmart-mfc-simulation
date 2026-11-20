import { describe, expect, it } from 'vitest';
import { AdminDesk, seoulDate } from '../src/sim/admin';
import { ApiProblem, ResultUnknown, type TaskSummary } from '../src/domain/contract';
import type { HttpBackend } from '../src/backend/http/HttpBackend';

const task = (over: Partial<TaskSummary>): TaskSummary =>
  ({ taskId: 'S1-PICK', taskType: 'PICK', state: 'COMPLETED', version: 1, mfcId: 'M', fulfillmentId: 'F', shipmentId: 'S1', assignment: { workerId: 'OP-1' }, lineCount: 1, plannedQty: 1, completedQty: 1, remainingQty: 0, promisedReadyAt: null, createdAt: '2026-11-20T00:00:00Z', ...over }) as TaskSummary;

describe('관리 탭', () => {
  it('서울 날짜', () => {
    expect(seoulDate(Date.parse('2026-11-20T16:00:00Z'))).toBe('2026-11-21');
  });

  it('지난 주문: 끝난 작업을 출고별로 묶고 최근 끝난 것이 위', async () => {
    const obs = {
      listTasksByActivity: async () => [
        task({ taskId: 'S1-PACK', taskType: 'PACK', completedAt: '2026-11-20T03:10:00Z', orderNumber: '11111111' }),
        task({ taskId: 'S1-PICK', completedAt: '2026-11-20T03:05:00Z', orderNumber: '11111111' }),
        task({ taskId: 'S2-PICK', shipmentId: 'S2', completedAt: '2026-11-20T04:00:00Z', orderNumber: '22222222' }),
      ],
    } as unknown as HttpBackend;
    const d = new AdminDesk(obs, obs, 'M', () => Date.parse('2026-11-20T05:00:00Z'), 1, () => null);
    await d.loadHistory();
    expect(d.history.orders.map((o) => o.orderNumber)).toEqual(['22222222', '11111111']);
    expect(d.history.orders[1].tasks.map((t) => t.taskType)).toEqual(['PICK', 'PACK']);
  });

  it('응답이 없으면 결과 불명 — 다시 누르면 같은 Idempotency-Key, 거절은 오류로', async () => {
    const keys: string[] = [];
    let n = 0;
    const sup = {
      releaseTask: async (_t: string, _b: unknown, key: string) => {
        keys.push(key);
        n++;
        if (n === 1) throw new ResultUnknown('timeout');
        if (n === 2) return task({ state: 'READY' });
        throw new ApiProblem({ status: 409, code: 'EXECUTION_IN_FLIGHT' });
      },
    } as unknown as HttpBackend;
    let now = 1000;
    const d = new AdminDesk(sup, sup, 'M', () => now, 1, () => 'OP-SUP');
    const t = task({ state: 'IN_PROGRESS' });
    await d.release(t, '');
    expect(d.actions.get('release:S1-PICK')?.state).toBe('unknown');
    now = 2000;
    await d.release(t, '');
    expect(keys[1]).toBe(keys[0]);
    expect(d.actions.get('release:S1-PICK')?.state).toBe('done');
    now = 3000;
    await d.release(t, '');
    expect(keys[2]).not.toBe(keys[0]); // 끝난 조치를 다시 하면 새 키
    expect(d.actions.get('release:S1-PICK')).toMatchObject({ state: 'error' });
  });

  it('재배정은 지금 활성 배정 버전을 X-Expected-Version 으로', async () => {
    let got = -1;
    const sup = {
      listAssignments: async () => [{ state: 'ACTIVE', assignmentVersion: 3 }],
      assignTask: async (_b: unknown, v: number) => {
        got = v;
        return { warnings: [] };
      },
    } as unknown as HttpBackend;
    const d = new AdminDesk(sup, sup, 'M', () => 1, 1, () => null);
    await d.reassign(task({ state: 'ASSIGNED' }), 'OP-2', '');
    expect(got).toBe(3);
    expect(d.actions.get('assign:S1-PICK')?.state).toBe('done');
  });
  it('주문 취소: 원래 지시 PICK 줄의 미이행 수량으로 관리자 판단 취소, 사유 없으면 안 보냄', async () => {
    const sent: unknown[] = [];
    const obs = {
      getOrderFulfillment: async () => ({
        orderId: 'ORD-1',
        workOrders: [
          { kind: 'ORIGINAL', shipments: [{ shipmentId: 'S1', tasks: [{ taskId: 'S1-PICK', taskType: 'PICK' }, { taskId: 'S1-PACK', taskType: 'PACK' }] }] },
          { kind: 'RESHIPMENT', shipments: [{ shipmentId: 'S9', tasks: [{ taskId: 'S9-PICK', taskType: 'PICK' }] }] },
        ],
      }),
      getTask: async (id: string) => ({
        lines:
          id === 'S1-PICK'
            ? [
                { orderLineId: 'L1', plannedQty: 3, cancelledQty: 1 },
                { orderLineId: 'L2', plannedQty: 2, cancelledQty: 2 },
              ]
            : [{ orderLineId: 'L9', plannedQty: 5, cancelledQty: 0 }],
      }),
    } as unknown as HttpBackend;
    const sup = {
      createOperatorCancel: async (body: unknown) => {
        sent.push(body);
        return { claimId: 'CLM-1', orderId: 'ORD-1', type: 'CANCEL', state: 'STOP_PENDING' };
      },
    } as unknown as HttpBackend;
    const d = new AdminDesk(obs, sup, 'M', () => 1, 1, () => 'OP-SUP');
    await d.cancelOrder('S1', 'ORD-1', '  ');
    expect(d.actions.get('cancel:S1')?.state).toBe('error');
    expect(sent).toEqual([]);
    await d.cancelOrder('S1', 'ORD-1', '고객 요청 — 배송지 오류');
    expect(d.actions.get('cancel:S1')?.state).toBe('done');
    expect(sent).toEqual([{ orderId: 'ORD-1', type: 'CANCEL', lines: [{ orderLineId: 'L1', qty: 2 }], reason: 'OPERATOR_DECISION', reasonDetail: '고객 요청 — 배송지 오류', channel: 'OPERATOR' }]);
  });
  it('작업 중지·막힘 해제·남은 수량 취소: 사유·실물 확인이 없으면 안 보내고, 있으면 관리자 계정으로', async () => {
    const calls: string[] = [];
    const ctl = (action: string, toState: string) => ({ controlId: 'C', taskId: 'S1-PICK', action, fromState: 'IN_PROGRESS', toState, taskVersion: 2, reason: 'r', actorId: 'OP-SUP', at: 'x' });
    const sup = {
      blockTask: async (id: string, r: string) => (calls.push(`block ${id} ${r}`), ctl('BLOCK', 'BLOCKED')),
      unblockTask: async (id: string, r: string, ok: boolean) => (calls.push(`unblock ${id} ${r} ${ok}`), ctl('UNBLOCK', 'ASSIGNED')),
      partialCloseTask: async (id: string, r: string) => (calls.push(`pclose ${id} ${r}`), ctl('PARTIAL_CLOSE', 'BLOCKED')),
    } as unknown as HttpBackend;
    const d = new AdminDesk(sup, sup, 'M', () => 1, 1, () => 'OP-SUP');
    const t = task({ state: 'IN_PROGRESS', completedQty: 1, plannedQty: 3 });
    await d.block(t, ' ');
    await d.unblock(t, '확인함', false);
    expect(calls).toEqual([]);
    expect(d.actions.get('block:S1-PICK')?.state).toBe('error');
    expect(d.actions.get('unblock:S1-PICK')?.state).toBe('error');
    await d.block(t, '선반 확인');
    await d.unblock(t, '확인함', true);
    await d.partialClose(t, '나머지 없음');
    expect(calls).toEqual(['block S1-PICK 선반 확인', 'unblock S1-PICK 확인함 true', 'pclose S1-PICK 나머지 없음']);
    expect(d.actions.get('unblock:S1-PICK')?.msg).toContain('원래 담당');
  });
});
