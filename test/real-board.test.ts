import { describe, expect, it } from 'vitest';
import { keycloakUsername, passwordFileFor } from '../src/backend/http/accounts';
import { TokenSource } from '../src/backend/http/tokens';
import type { CapacityWorker, CenterStock, TaskDetail, TaskState, TaskSummary } from '../src/domain/contract';
import { RealBoard, type RealReader } from '../src/sim/realBoard';

function summary(p: Partial<TaskSummary> & { taskId: string }): TaskSummary {
  return {
    taskType: 'PICK',
    state: 'READY',
    version: 1,
    mfcId: 'MFC-SEED-01',
    fulfillmentId: 'FUL-1',
    shipmentId: 'ORD-1-S1',
    assignment: { workerId: null, assignmentVersion: 0 },
    lineCount: 1,
    plannedQty: 2,
    completedQty: 0,
    remainingQty: 2,
    promisedReadyAt: null,
    createdAt: '2026-11-16T03:00:00Z',
    ...p,
  };
}

function detail(s: TaskSummary, locs: { code: string; allocated?: number }[], remaining = 2): TaskDetail {
  return {
    ...s,
    blockReason: null,
    lines: [
      {
        taskLineId: 'L1',
        orderLineId: 'OL1',
        sku: 'B-1',
        barcode: null,
        locationId: null,
        lotId: null,
        expiresOn: null,
        plannedQty: 2,
        completedQty: 0,
        cancelledQty: 0,
        remainingQty: remaining,
        pendingQty: 0,
        picks: [{ lotId: 'LOT-1', expiresOn: null, remainingQty: remaining, locations: locs.map((l) => ({ locationCode: l.code, qty: 9, allocatedQty: l.allocated })) }],
      },
    ],
  };
}

class FakeReader implements RealReader {
  list: TaskSummary[] = [];
  details = new Map<string, TaskDetail>();
  calls = { list: 0, get: 0, workers: 0, stock: [] as string[] };
  stock = new Map<string, CenterStock>();
  async getCenterStock(_m: string, sku: string) {
    this.calls.stock.push(sku);
    const s = this.stock.get(sku);
    if (!s) throw new Error('404');
    return s;
  }
  async listTasks(_m: string, states: TaskState[]) {
    this.calls.list++;
    return this.list.filter((t) => states.includes(t.state));
  }
  async getTask(id: string) {
    this.calls.get++;
    const d = this.details.get(id);
    if (!d) throw new Error('404');
    return d;
  }
  async listWorkers(): Promise<CapacityWorker[]> {
    this.calls.workers++;
    return [{ mfcId: 'MFC-SEED-01', workerId: 'OP-a', displayName: 'MFC시험 피킹포장 11', state: 'ACTIVE' }];
  }
}

const OPEN: TaskState[] = ['WAITING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED'];

function board(r: FakeReader, now: { ms: number }) {
  return new RealBoard(
    r,
    'MFC-SEED-01',
    { pollSec: 3, workerRefreshSec: 60, recentKeepSec: 600, openStates: OPEN, stockRefreshSec: 30, maxStockPerPoll: 10 },
    () => now.ms,
  );
}

describe('RealBoard — 실서버 관찰(읽기 전용)', () => {
  it('열린 작업을 출고별로 묶고, 진행 중 PICK 만 상세를 읽어 지시 칸을 낸다(배정 칸 우선)', async () => {
    const r = new FakeReader();
    const pick = summary({ taskId: 'ORD-1-S1-PICK', state: 'IN_PROGRESS', version: 3, assignment: { workerId: 'OP-a', assignmentVersion: 1 } });
    const pack = summary({ taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'WAITING' });
    r.list = [pick, pack];
    r.details.set(pick.taskId, detail(pick, [{ code: 'A-B1-01-1-01' }, { code: 'A-B1-02-1-01', allocated: 2 }]));
    r.details.set(pack.taskId, detail(pack, []));
    const now = { ms: 0 };
    const b = board(r, now);
    await b.poll();
    const s = b.shipments();
    expect(s).toHaveLength(1);
    expect(s[0].pick?.summary.taskId).toBe('ORD-1-S1-PICK');
    expect(s[0].pack?.summary.state).toBe('WAITING');
    expect(r.calls.get).toBe(2); // 열린 작업은 모두 상세(줄의 SKU)를 읽는다 — 지시 칸은 PICK 진행 중만
    expect(b.pickTargets()).toEqual([{ locationCode: 'A-B1-02-1-01', taskId: pick.taskId, state: 'IN_PROGRESS', workerId: 'OP-a', qty: 2 }]);
    expect(b.workerName('OP-a')).toBe('MFC시험 피킹포장 11');
    expect(b.counts()).toEqual({ 'PICK:IN_PROGRESS': 1, 'PACK:WAITING': 1 });
  });

  it('version 이 같으면 상세를 다시 읽지 않고, 간격 전에는 조회하지 않는다', async () => {
    const r = new FakeReader();
    const pick = summary({ taskId: 'T1', state: 'ASSIGNED', version: 2 });
    r.list = [pick];
    r.details.set('T1', detail(pick, [{ code: 'X' }]));
    r.stock.set('B-1', { mfcId: 'MFC-SEED-01', sku: 'B-1', lots: [], units: [] });
    const now = { ms: 0 };
    const b = board(r, now);
    await b.tick();
    now.ms = 1000;
    await b.tick(); // 3초 전
    expect(r.calls.list).toBe(1);
    now.ms = 3500;
    await b.tick();
    expect(r.calls.list).toBe(2);
    expect(r.calls.get).toBe(1);
    expect(r.calls.stock).toEqual(['B-1']); // 같은 version 이고 30초 전이면 재고도 다시 읽지 않는다
    r.list = [{ ...pick, version: 3 }];
    r.details.set('T1', detail({ ...pick, version: 3 }, [{ code: 'Y' }]));
    now.ms = 7000;
    await b.tick();
    expect(r.calls.get).toBe(2);
    expect(b.pickTargets()[0].locationCode).toBe('Y');
    expect(r.calls.stock).toEqual(['B-1', 'B-1']); // version 이 바뀌면 그 SKU 재고를 다시 읽는다
  });

  it('주문 SKU 재고: 집품이 반영되면 선반 STORED 가 줄고 포장 구역 PICKED 가 생긴다 — 서버 응답 그대로', async () => {
    const r = new FakeReader();
    const pick = summary({ taskId: 'T1', state: 'IN_PROGRESS', version: 1 });
    r.list = [pick];
    r.details.set('T1', detail(pick, [{ code: 'A-B1-01-1-01', allocated: 2 }]));
    const stock = (stored: number, picked: number): CenterStock => ({
      mfcId: 'MFC-SEED-01',
      sku: 'B-1',
      lots: [],
      units: [
        { locationCode: 'A-B1-01-1-01', lotId: 'LOT-1', qualityState: 'NORMAL', workState: 'STORED', qty: stored },
        { locationCode: 'PAK-C-01', lotId: 'LOT-1', qualityState: 'NORMAL', workState: 'PICKED', qty: picked },
      ],
    });
    r.stock.set('B-1', stock(9, 0));
    const now = { ms: 0 };
    const b = board(r, now);
    await b.poll();
    expect(b.stockUnits()).toEqual([{ sku: 'B-1', locationCode: 'A-B1-01-1-01', workState: 'STORED', qualityState: 'NORMAL', qty: 9 }]);
    const v1 = b.stockVersion;

    // PDA 가 2개 집음 → 작업 version 이 오름 → 다음 조회에서 재고를 다시 읽는다
    r.list = [{ ...pick, version: 2, completedQty: 2 }];
    r.details.set('T1', detail({ ...pick, version: 2 }, [], 0));
    r.stock.set('B-1', stock(7, 2));
    now.ms = 3500;
    await b.poll();
    expect(b.stockVersion).toBeGreaterThan(v1);
    expect(b.stockUnits().map((u) => `${u.locationCode}:${u.workState}:${u.qty}`)).toEqual(['A-B1-01-1-01:STORED:7', 'PAK-C-01:PICKED:2']);
  });

  it('재고 조회 실패는 작업 조회를 막지 않고 다음에 다시 읽으며, 화면에서 빠진 작업의 SKU 재고는 버린다', async () => {
    const r = new FakeReader();
    const pick = summary({ taskId: 'T1', state: 'READY', version: 1 });
    r.list = [pick];
    r.details.set('T1', detail(pick, [{ code: 'X' }]));
    const now = { ms: 0 };
    const b = board(r, now);
    await b.poll(); // B-1 재고 응답 없음
    expect(b.lastError).toBeNull();
    expect(b.stock.size).toBe(0);
    r.stock.set('B-1', { mfcId: 'MFC-SEED-01', sku: 'B-1', lots: [], units: [] });
    now.ms = 3500;
    await b.poll();
    expect(b.stock.size).toBe(1);
    r.list = [];
    r.details.set('T1', { ...detail(pick, []), state: 'CANCELLED' });
    now.ms = 7000;
    await b.poll();
    now.ms = 7000 + 601_000;
    await b.poll();
    expect(b.tasks.size).toBe(0);
    expect(b.stock.size).toBe(0);
  });

  it('목록에서 빠진 작업은 상세로 최종 상태를 확인하기 전까지 "확인 중" — 실패로도 완료로도 단정하지 않는다', async () => {
    const r = new FakeReader();
    const pick = summary({ taskId: 'T1', state: 'IN_PROGRESS', version: 5 });
    r.list = [pick];
    r.details.set('T1', detail(pick, [{ code: 'X' }]));
    const now = { ms: 0 };
    const b = board(r, now);
    await b.poll();
    r.list = [];
    r.details.delete('T1'); // 응답 없음
    now.ms = 4000;
    await b.poll();
    expect(b.tasks.get('T1')?.closed?.state).toBe('CHECKING');
    expect(b.pickTargets()).toEqual([]);
    r.details.set('T1', { ...detail(pick, [], 0), state: 'COMPLETED', completedQty: 2 });
    now.ms = 8000;
    await b.poll();
    expect(b.tasks.get('T1')?.closed?.state).toBe('COMPLETED');
    expect(b.counts()).toEqual({});
    now.ms = 8000 + 601_000; // recentKeepSec 지나면 지운다
    await b.poll();
    expect(b.tasks.has('T1')).toBe(false);
  });

  it('조회 실패는 lastError 로 남기고 들고 있던 작업은 그대로 둔다', async () => {
    const r = new FakeReader();
    r.list = [summary({ taskId: 'T1' })];
    const now = { ms: 0 };
    const b = board(r, now);
    await b.poll();
    r.listTasks = async () => {
      throw Object.assign(new Error('x'), { problem: { status: 401, code: 'HTTP_401' } });
    };
    now.ms = 4000;
    await b.poll();
    expect(b.lastError).toBe('401 HTTP_401');
    expect(b.tasks.has('T1')).toBe(true);
  });
});

describe('시험 계정 — 비밀번호 파일 대응', () => {
  it('관찰 계정과 가상 작업자 pp-01~10 만 허용한다', () => {
    expect(passwordFileFor('claude-mfc-wrk')).toBe('keycloak-claude-mfc-wrk-password');
    expect(passwordFileFor('mfcw-pp-01')).toBe('keycloak-mfc-test-workers-password');
    expect(passwordFileFor('mfcw-pp-10@pmart.com')).toBe('keycloak-mfc-test-workers-password');
    expect(passwordFileFor('mfcw-pp-11')).toBeNull(); // PDA 용으로 남긴 계정
    expect(passwordFileFor('claude-dev')).toBeNull();
    expect(passwordFileFor('claude-mfc-sup')).toBeNull();
    expect(passwordFileFor('../keycloak-admin')).toBeNull();
    expect(keycloakUsername('claude-mfc-wrk')).toBe('claude-mfc-wrk@pmart.com');
  });
});

describe('TokenSource', () => {
  it('만료 여유 전에는 다시 받지 않고, 여유 안이면 새로 받는다', async () => {
    let issued = 0;
    const now = { ms: Date.parse('2026-11-16T03:00:00Z') };
    const fake = (async () => {
      issued++;
      return new Response(
        JSON.stringify({ account: 'claude-mfc-wrk', operatorId: 'OP-x', accessToken: `t${issued}`, accessTokenExpiresAt: new Date(now.ms + 15 * 60_000).toISOString() }),
        { status: 200 },
      );
    }) as typeof fetch;
    const ts = new TokenSource('claude-mfc-wrk', 60, fake, () => now.ms);
    expect(await ts.get()).toBe('t1');
    now.ms += 10 * 60_000;
    expect(await ts.get()).toBe('t1');
    now.ms += 4.5 * 60_000; // 만료 30초 전
    expect(await ts.get()).toBe('t2');
    expect(ts.operatorId).toBe('OP-x');
  });

  it('다른 기기(LOOPBACK_ONLY)면 오류 없이 토큰 없이 부르고, 다시 묻지 않는다', async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response(JSON.stringify({ code: 'LOOPBACK_ONLY' }), { status: 403 });
    }) as typeof fetch;
    const ts = new TokenSource('claude-mfc-wrk', 60, fake);
    expect(await ts.get()).toBeNull();
    expect(await ts.get()).toBeNull();
    expect(ts.serverInjected).toBe(true);
    expect(ts.lastError).toBeNull();
    expect(calls).toBe(1);
  });

  it('발급 실패면 null 과 사유', async () => {
    const fake = (async () => new Response(JSON.stringify({ code: 'SECRET_FILE_MISSING' }), { status: 500 })) as typeof fetch;
    const ts = new TokenSource('claude-mfc-wrk', 60, fake);
    expect(await ts.get()).toBeNull();
    expect(ts.lastError).toContain('SECRET_FILE_MISSING');
  });
});
