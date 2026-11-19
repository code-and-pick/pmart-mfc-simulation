import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, ISSUES } from '../src/config';
import type { TaskDetail } from '../src/domain/contract';
import { collectIssues } from '../src/sim/issues';
import { Simulation } from '../src/sim/simulation';

function task(extra: Record<string, unknown>): TaskDetail {
  return {
    taskId: 'T1', taskType: 'PICK', state: 'IN_PROGRESS', version: 1, mfcId: 'MFC-SEED-01', fulfillmentId: 'FUL-12345678', shipmentId: 'ORD-1-S1',
    assignment: { workerId: 'OP-1', assignmentVersion: 1 }, lineCount: 1, plannedQty: 1, completedQty: 0, remainingQty: 1,
    promisedReadyAt: null, createdAt: new Date().toISOString(), blockReason: null, orderNumber: '11112222', lines: [], ...extra,
  } as unknown as TaskDetail;
}

describe('확인할 일(이상 상황 띠)', () => {
  it('없으면 빈 목록, 막힘은 심각·패킹 안 받음은 주의(심각 먼저), 누르면 그 출고', () => {
    const sim = new Simulation({ ...DEFAULT_PARAMS }, 'http');
    const real = sim.real!;
    expect(collectIssues(sim)).toEqual([]);
    const old = new Date(Date.now() - (ISSUES.packWaitMin + 1) * 60_000).toISOString();
    const pack = task({ taskId: 'K1', taskType: 'PACK', state: 'READY', assignment: { workerId: null, assignmentVersion: 0 }, pickedBy: 'OP-1', lastActivityAt: old });
    const blocked = task({ taskId: 'B1', state: 'BLOCKED', blockReason: '결품', shipmentId: 'ORD-2-S1' });
    real.tasks.set('K1', { summary: pack, detail: pack, firstSeenMs: 0, closed: null });
    real.tasks.set('B1', { summary: blocked, detail: blocked, firstSeenMs: 0, closed: null });
    const out = collectIssues(sim);
    expect(out.map((i) => [i.level, i.title])).toEqual([
      ['bad', 'PICK 막힘'],
      ['warn', '패킹 안 받음'],
    ]);
    expect(out[0].what).toContain('결품');
    expect(out[0].go).toEqual({ shipmentId: 'ORD-2-S1' });
    // 막 끝난 피킹(기준 안)은 아직 아님
    const fresh = { ...pack, lastActivityAt: new Date().toISOString() } as TaskDetail;
    real.tasks.set('K1', { summary: fresh, detail: fresh, firstSeenMs: 0, closed: null });
    expect(collectIssues(sim).map((i) => i.title)).toEqual(['PICK 막힘']);
  });
});
