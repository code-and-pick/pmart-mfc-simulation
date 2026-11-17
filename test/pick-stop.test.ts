// PDA 앱 nextPickStop(클라이언트 3f2048f task_controllers.dart — visitSeq 순서)과 같은 칸을 고르는지
import { describe, expect, it } from 'vitest';
import type { TaskLine } from '../src/domain/contract';
import { nextPickStop } from '../src/domain/pickStop';

const line = (o: Partial<TaskLine> & { orderLineId: string }): TaskLine => ({
  taskLineId: o.orderLineId, sku: 'S', barcode: null, locationId: null, lotId: null, expiresOn: null,
  plannedQty: 3, completedQty: 0, cancelledQty: 0, remainingQty: 3, pendingQty: 0, picks: [], ...o,
});

describe('nextPickStop — PDA 와 같은 다음 칸', () => {
  it('서버 방문 순서(visitSeq)가 가장 앞인 조각 — 줄 순서와 달라도, 남은 양 없는 줄은 건너뜀', () => {
    const s = nextPickStop([
      line({ orderLineId: 'a', remainingQty: 0, picks: [{ lotId: 'L0', expiresOn: null, remainingQty: 0, visitSeq: 1, locations: [{ locationCode: 'A-C1-01-1-01', qty: 5 }] }] }),
      line({ orderLineId: 'b', picks: [{ lotId: 'L1', expiresOn: null, remainingQty: 3, visitSeq: 9, locations: [{ locationCode: 'A-C1-02-1-01', qty: 5 }] }] }),
      line({ orderLineId: 'c', picks: [{ lotId: 'L2', expiresOn: null, remainingQty: 3, visitSeq: 2, locations: [{ locationCode: 'A-C1-03-1-01', qty: 5 }] }] }),
    ]);
    expect(s?.line.orderLineId).toBe('c');
    expect(s?.location).toBe('A-C1-03-1-01');
  });

  it('한 줄 조각이 다른 줄 조각 사이에 끼어도 방문 순서, 방문 순서가 없으면 줄 순서', () => {
    const s = nextPickStop([
      line({ orderLineId: 'a', picks: [
        { lotId: 'L1', expiresOn: null, remainingQty: 1, visitSeq: 1, pickStatus: 'DONE', locations: [{ locationCode: 'A-C1-01-1-01', qty: 5 }] },
        { lotId: 'L2', expiresOn: null, remainingQty: 2, visitSeq: 3, locations: [{ locationCode: 'A-C1-05-1-01', qty: 5 }] },
      ] }),
      line({ orderLineId: 'b', picks: [{ lotId: 'L3', expiresOn: null, remainingQty: 3, visitSeq: 2, locations: [{ locationCode: 'C-B2-06-3-01', qty: 5 }] }] }),
    ]);
    expect(s).toMatchObject({ lotId: 'L3', location: 'C-B2-06-3-01' });
    const n = nextPickStop([
      line({ orderLineId: 'a', picks: [{ lotId: 'L1', expiresOn: null, remainingQty: 3, locations: [{ locationCode: 'A-C1-09-1-01', qty: 5 }] }] }),
      line({ orderLineId: 'b', picks: [{ lotId: 'L2', expiresOn: null, remainingQty: 3, locations: [{ locationCode: 'A-C1-01-1-01', qty: 5 }] }] }),
    ]);
    expect(n?.line.orderLineId).toBe('a');
  });

  it('배정 칸 우선·그 칸 몫만큼, 재고 있는 다른 칸은 대안, DONE 조각과 pending 은 뺀다', () => {
    const s = nextPickStop([
      line({
        orderLineId: 'a', remainingQty: 4, pendingQty: 1,
        picks: [
          { lotId: 'L0', expiresOn: null, remainingQty: 1, pickStatus: 'DONE', locations: [{ locationCode: 'A-C1-09-1-01', qty: 5 }] },
          { lotId: 'L1', expiresOn: null, remainingQty: 1, locations: [{ locationCode: 'A-C1-08-1-01', qty: 5 }] },
          { lotId: 'L2', expiresOn: null, remainingQty: 3, locations: [{ locationCode: 'A-C1-01-1-01', qty: 9 }, { locationCode: 'A-C1-02-1-01', qty: 4, allocatedQty: 2 }, { locationCode: 'A-C1-03-1-01', qty: 0 }] },
        ],
      }),
    ]);
    // L1 1개는 pending 1 로 다 접수됨 → L2, 배정 칸 A-C1-02-1-01 의 몫 2
    expect(s).toMatchObject({ lotId: 'L2', location: 'A-C1-02-1-01', qty: 2, otherLocations: ['A-C1-01-1-01'] });
  });

  it('지시가 비면 줄의 지시 칸, 다 집으면 null', () => {
    expect(nextPickStop([line({ orderLineId: 'a', locationId: 'F-A1-01-1-01', remainingQty: 2 })])).toMatchObject({ location: 'F-A1-01-1-01', qty: 2 });
    expect(nextPickStop([line({ orderLineId: 'a', remainingQty: 0 })])).toBeNull();
  });
});
