import { describe, expect, it } from 'vitest';
import { keycloakUsername, passwordFileFor } from '../src/backend/http/accounts';
import { TokenSource } from '../src/backend/http/tokens';
import type { CapacityWorker, CenterStock, DeliveryDispatch, Shipment, StaffDeliverySummary, TaskDetail, TaskState, TaskSummary } from '../src/domain/contract';
import { RealBoard, dispatchView, type RealReader } from '../src/sim/realBoard';

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
  ships = new Map<string, Shipment>();
  dels: StaffDeliverySummary[] = [];
  disp = new Map<string, DeliveryDispatch>();
  dcalls = { ship: 0, search: 0, dispatch: 0 };
  async getShipment(id: string) {
    this.dcalls.ship++;
    const s = this.ships.get(id);
    if (!s) throw new Error('404');
    return s;
  }
  async searchDeliveries() {
    this.dcalls.search++;
    return this.dels;
  }
  async getSku(sku: string) {
    return { sku, barcodes: [] };
  }
  async getDeliveryDispatch(id: string) {
    this.dcalls.dispatch++;
    const d = this.disp.get(id);
    if (!d) throw new Error('404');
    return d;
  }
}

function ship(p: Partial<Shipment>): Shipment {
  return {
    shipmentId: 'ORD-1-S1',
    fulfillmentId: 'FUL-1',
    orderId: 'ORD-1',
    deliveryId: null,
    version: 1,
    state: 'PREPARING',
    holdReason: null,
    packages: [],
    bagCount: 1,
    weightG: 500,
    readyAt: null,
    dispatchRequest: null,
    ...p,
  };
}

function dl(p: Partial<StaffDeliverySummary>): StaffDeliverySummary {
  return {
    deliveryId: 'DLV-1',
    version: 1,
    type: 'FORWARD',
    orderId: 'ORD-1',
    mfcId: 'MFC-SEED-01',
    riderId: null,
    state: 'UNASSIGNED',
    assignedAt: null,
    pickedUpAt: null,
    completedAt: null,
    createdAt: '2026-11-16T03:05:00Z',
    ...p,
  };
}

const OPEN: TaskState[] = ['WAITING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED'];

function board(r: FakeReader, now: { ms: number }, extra: { backfillSec?: number } = {}) {
  return new RealBoard(
    r,
    'MFC-SEED-01',
    {
      pollSec: 3,
      workerRefreshSec: 60,
      recentKeepSec: 600,
      openStates: OPEN,
      stockRefreshSec: 30,
      maxStockPerPoll: 10,
      shipmentRefreshSec: 3,
      maxShipmentPerPoll: 5,
      handoverKeepSec: 3 * 3600,
      ...extra,
    },
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

  it('칸 하나 집품(부분 실적)은 서버가 version 을 안 올린다 — 완료 수량·마지막 실적 시각이 바뀌면 상세를 다시 읽는다', async () => {
    const r = new FakeReader();
    const pick = summary({ taskId: 'T1', state: 'IN_PROGRESS', version: 3, plannedQty: 2, completedQty: 0, remainingQty: 2, lastActivityAt: '2026-11-18T01:00:00Z' });
    r.list = [pick];
    r.details.set('T1', detail(pick, [{ code: 'X' }]));
    const now = { ms: 0 };
    const b = board(r, now);
    await b.tick();
    expect(r.calls.get).toBe(1);
    // 첫 칸 집품 반영 — version 그대로 3
    const after = { ...pick, completedQty: 1, remainingQty: 1, lastActivityAt: '2026-11-18T01:01:00Z' };
    r.list = [after];
    r.details.set('T1', detail(after, [{ code: 'Y' }], 1));
    now.ms = 3500;
    await b.tick();
    expect(r.calls.get).toBe(2);
    expect(b.pickTargets()[0].locationCode).toBe('Y');
    now.ms = 7000;
    await b.tick(); // 진행이 그대로면 다시 읽지 않는다
    expect(r.calls.get).toBe(2);
  });

  it('새로고침(첫 조회): 끝난 작업이라도 출고가 출하 대기면 불러 둔다 — 인계 끝난 출고·오래된 작업은 안 부름', async () => {
    const r = new FakeReader();
    const at = Date.parse('2026-11-18T01:00:00Z');
    const pk = summary({ taskId: 'A-PACK', taskType: 'PACK', state: 'COMPLETED', shipmentId: 'A-S1', createdAt: '2026-11-18T00:30:00Z' });
    const pc = summary({ taskId: 'A-PICK', state: 'COMPLETED', shipmentId: 'A-S1', createdAt: '2026-11-18T00:30:00Z' });
    const gone = summary({ taskId: 'B-PACK', taskType: 'PACK', state: 'COMPLETED', shipmentId: 'B-S1', createdAt: '2026-11-18T00:40:00Z' });
    const old = summary({ taskId: 'C-PACK', taskType: 'PACK', state: 'COMPLETED', shipmentId: 'C-S1', createdAt: '2026-11-16T00:00:00Z' });
    r.list = [pk, pc, gone, old];
    for (const s of r.list) r.details.set(s.taskId, detail(s, [{ code: 'X' }], 0));
    r.ships.set('A-S1', ship({ shipmentId: 'A-S1', state: 'READY' }));
    r.ships.set('B-S1', ship({ shipmentId: 'B-S1', state: 'HANDED_OVER' }));
    r.ships.set('C-S1', ship({ shipmentId: 'C-S1', state: 'READY' }));
    const now = { ms: at };
    const b = board(r, now, { backfillSec: 24 * 3600 });
    await b.tick();
    expect([...b.tasks.keys()].sort()).toEqual(['A-PACK', 'A-PICK']);
    expect(b.tasks.get('A-PACK')!.closed?.state).toBe('COMPLETED');
    const lists = r.calls.list;
    now.ms = at + 3500;
    await b.tick(); // 한 번만
    expect(r.calls.list).toBe(lists + 1);
    expect(b.tasks.has('A-PACK')).toBe(true); // 출하 대기라 남는다
  });

  it('화면 주문번호(ADR-0070): 출고 조회의 orderNumber, 없으면 작업 요약의 orderNumber, 둘 다 없으면 null', async () => {
    const r = new FakeReader();
    const pick = summary({ taskId: 'T1', state: 'READY', orderNumber: '74939255' });
    r.list = [pick];
    r.details.set('T1', detail(pick, [{ code: 'X' }]));
    const b = board(r, { ms: 0 });
    await b.tick();
    expect(b.orderNumberOf('ORD-1-S1')).toBe('74939255');
    expect(b.orderNumberOf('ORD-9-S1')).toBeNull();
  });

  it('MFC 반납 인증번호: 회수 배송 간격마다 읽고, 못 읽으면 이유만 남긴다', async () => {
    const r = new FakeReader();
    let n = 0;
    (r as unknown as { listReturnHandovers: () => Promise<unknown[]> }).listReturnHandovers = async () => {
      n++;
      if (n === 2) throw new Error('503');
      return [{ deliveryId: 'DLV-1', deliveryNumber: '74939255-2', purpose: 'CLAIM_RETURN', state: 'RETURN_PICKED_UP', code: '4821', failedAttempts: 0, locked: false, issuedAt: 'x' }];
    };
    const now = { ms: 0 };
    const b = new RealBoard(r, 'MFC-SEED-01', { pollSec: 3, workerRefreshSec: 60, recentKeepSec: 600, openStates: OPEN, stockRefreshSec: 30, maxStockPerPoll: 10, shipmentRefreshSec: 3, maxShipmentPerPoll: 5, handoverKeepSec: 3600, returnPickupRefreshSec: 15 }, () => now.ms);
    await b.tick();
    expect(b.returnHandovers.map((h) => h.code)).toEqual(['4821']);
    now.ms = 4000;
    await b.tick(); // 15초 전 — 안 읽음
    expect(n).toBe(1);
    now.ms = 16000;
    await b.tick();
    expect(b.returnHandoverError).toMatch(/503/);
    expect(b.returnHandovers).toHaveLength(1); // 들고 있던 것은 그대로
  });

  it('작업자 표시(ADR-0070): hr 이름·사번, 못 읽으면 capacity 사번, 둘 다 없으면 "작업자 확인 중" — OP-… 를 내지 않음', async () => {
    const r = new FakeReader();
    const asked: string[][] = [];
    (r as unknown as { getEmployeeLabels: (ids: string[]) => Promise<unknown[]> }).getEmployeeLabels = async (ids) => {
      asked.push(ids);
      return [{ operatorId: 'OP-a', name: '김현장', employeeNo: 'P2026-00011' }];
    };
    const b = board(r, { ms: 0 });
    await b.tick();
    expect(asked).toEqual([['OP-a']]);
    expect(b.workerName('OP-a')).toBe('김현장 · P2026-00011');
    expect(b.workerName('OP-12345678-zzzz')).toBe('작업자 확인 중'); // ID 끝자리도 내지 않음(2026-11-20)

    const r2 = new FakeReader();
    (r2 as unknown as { getEmployeeLabels: () => Promise<unknown[]> }).getEmployeeLabels = async () => {
      throw new Error('403');
    };
    const b2 = board(r2, { ms: 0 });
    await b2.tick();
    expect(b2.workerName('OP-a')).toBe('MFC시험 피킹포장 11'); // capacity displayName
  });

  it('작업자 속도 배율(speedFactor): 서버 값, 없으면 1, 0.5~2.0 으로 자름', async () => {
    const r = new FakeReader();
    r.listWorkers = async () => [
      { mfcId: 'MFC-SEED-01', workerId: 'OP-a', displayName: 'A', state: 'ACTIVE', speedFactor: 1.24 },
      { mfcId: 'MFC-SEED-01', workerId: 'OP-b', displayName: 'B', state: 'ACTIVE' },
      { mfcId: 'MFC-SEED-01', workerId: 'OP-c', displayName: 'C', state: 'ACTIVE', speedFactor: 9 },
    ];
    const b = board(r, { ms: 0 });
    await b.tick();
    expect([b.speedFactor('OP-a'), b.speedFactor('OP-b'), b.speedFactor('OP-c'), b.speedFactor('OP-x'), b.speedFactor(null)]).toEqual([1.24, 1, 2, 1, 1]);
  });

  it('서버가 다 집은 조각을 상세에서 빼도 본 조각은 출고별로 남긴다(바코드 판 — 패킹까지)', async () => {
    const r = new FakeReader();
    const pick = summary({ taskId: 'T1', state: 'IN_PROGRESS', version: 3, lastActivityAt: 'a' });
    r.list = [pick];
    r.details.set('T1', detail(pick, [{ code: 'X' }]));
    const now = { ms: 0 };
    const b = board(r, now);
    await b.tick();
    expect(b.picksOf('ORD-1-S1').map((x) => [x.loc, x.gone])).toEqual([['X', false]]);
    const after = { ...pick, completedQty: 2, remainingQty: 0, lastActivityAt: 'b' };
    r.list = [after];
    const d = detail(after, [{ code: 'X' }], 0);
    d.lines[0].picks = []; // 서버: remaining <= 0 조각은 빼고 준다
    r.details.set('T1', d);
    now.ms = 3500;
    await b.tick();
    expect(b.picksOf('ORD-1-S1').map((x) => [x.loc, x.gone, x.pick.lotId])).toEqual([['X', true, 'LOT-1']]);
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
  it('관찰 계정·센터 관리자(관리 탭)·가상 작업자 pp-01~10 만 허용한다', () => {
    expect(passwordFileFor('claude-mfc-wrk')).toBe('keycloak-claude-mfc-wrk-password');
    expect(passwordFileFor('mfcw-pp-01')).toBe('keycloak-mfc-test-workers-password');
    expect(passwordFileFor('mfcw-pp-10@pmart.com')).toBe('keycloak-mfc-test-workers-password');
    expect(passwordFileFor('mfcw-pp-11')).toBeNull(); // PDA 용으로 남긴 계정
    expect(passwordFileFor('claude-dev')).toBeNull();
    // 관리 탭(재배정·내놓기·인계 확인) — 사용자 허락 2026-11-20
    expect(passwordFileFor('claude-mfc-sup')).toBe('keycloak-claude-mfc-sup-password');
    expect(passwordFileFor('test-cs-rider@pmart.com')).toBeNull();
    expect(passwordFileFor('../keycloak-admin')).toBeNull();
    expect(keycloakUsername('claude-mfc-wrk')).toBe('claude-mfc-wrk@pmart.com');
  });
});

describe('RealBoard — 배차·배송 표시(rider 시뮬레이터 요청 M-01)', () => {
  it('배차 요청 전 → 요청됨 → 배차 중(반경) → 배정 → 가게 도착 → 픽업, 인계 전에는 작업이 끝나도 남는다', async () => {
    const r = new FakeReader();
    const pack = summary({ taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'IN_PROGRESS', version: 2 });
    r.list = [pack];
    r.details.set(pack.taskId, detail(pack, []));
    r.ships.set('ORD-1-S1', ship({}));
    const now = { ms: 0 };
    const b = board(r, now);
    await b.poll();
    expect(dispatchView(b.shipments()[0]).stage).toBe('NOT_REQUESTED');
    expect(r.dcalls.search).toBe(0); // 배차 요청된 출고가 없으면 배송을 찾지 않는다

    // 점원(PDA)이 배차 요청 — 배송은 아직 안 보임
    r.ships.set('ORD-1-S1', ship({ version: 2, dispatchRequest: { shipmentId: 'ORD-1-S1', trigger: 'MANUAL', estimatedReadyAt: '2026-11-16T03:10:00Z', requestedAt: '2026-11-16T03:05:00Z' } }));
    now.ms = 3500;
    await b.poll();
    expect(dispatchView(b.shipments()[0]).stage).toBe('REQUESTED');

    // 배송 생김(주문 ID 로 잇는다 — 출고 deliveryId 는 비어 있음, R-19), 배차 중 반경 2km
    r.dels = [dl({ orderId: 'ORD-OTHER', deliveryId: 'DLV-X' }), dl({})];
    r.disp.set('DLV-1', { deliveryId: 'DLV-1', version: 1, state: 'DISPATCHING', attempts: [{ attemptId: 'A1', state: 'OFFERING', currentRadiusKm: 2, retryCount: 0 }] });
    now.ms = 7000;
    await b.poll();
    let v = dispatchView(b.shipments()[0]);
    expect(v.stage).toBe('DISPATCHING');
    expect(v.radiusKm).toBe(2);
    expect(b.shipments()[0].delivery?.deliveryId).toBe('DLV-1');

    // 포장 끝 → PACK 이 목록에서 빠짐, 출고 READY. 라이더 배정
    r.list = [];
    r.details.set(pack.taskId, { ...detail(pack, []), state: 'COMPLETED', version: 3 });
    r.ships.set('ORD-1-S1', ship({ version: 3, state: 'READY', dispatchRequest: { shipmentId: 'ORD-1-S1', trigger: 'MANUAL', estimatedReadyAt: '2026-11-16T03:10:00Z', requestedAt: '2026-11-16T03:05:00Z' } }));
    r.dels = [dl({ version: 2, state: 'ASSIGNED', riderId: 'RD-sim-1' })];
    r.disp.set('DLV-1', { deliveryId: 'DLV-1', version: 2, state: 'ASSIGNED', assignment: { riderId: 'RD-sim-1', state: 'ASSIGNED' } });
    now.ms = 10_500;
    await b.poll();
    v = dispatchView(b.shipments()[0]);
    expect(v.stage).toBe('ASSIGNED');
    expect(v.riderId).toBe('RD-sim-1');
    expect(v.dispatchState).toBe('ASSIGNED');
    expect(v.execState).toBe('ASSIGNED');

    // 작업이 끝난 지 recentKeepSec(10분)이 넘어도 인계 전이면 남는다
    r.dels = [dl({ version: 3, state: 'ARRIVED_AT_STORE', riderId: 'RD-sim-1' })];
    now.ms = 10_500 + 700_000;
    await b.poll();
    expect(b.shipments()).toHaveLength(1);
    expect(dispatchView(b.shipments()[0]).stage).toBe('AT_STORE');

    // 인계 확정 → 출고 HANDED_OVER, 배송 PICKED_UP → 이제 recentKeepSec 기준으로 빠진다
    r.ships.set('ORD-1-S1', ship({ version: 4, state: 'HANDED_OVER', dispatchRequest: { shipmentId: 'ORD-1-S1', trigger: 'MANUAL', estimatedReadyAt: '2026-11-16T03:10:00Z', requestedAt: '2026-11-16T03:05:00Z' } }));
    r.dels = [dl({ version: 4, state: 'PICKED_UP', riderId: 'RD-sim-1' })];
    now.ms += 3500;
    await b.poll(); // 인계 전 출고라 다시 읽음 → HANDED_OVER
    expect(dispatchView(b.shipments()[0]).stage).toBe('OUT_FOR_DELIVERY');
    now.ms += 3500;
    await b.poll();
    expect(b.shipments()).toHaveLength(0);
  });

  it('같은 주문의 재발송 출고(fulfillment 0.5.0)는 배차 상세의 shipmentId 로 잇는다 — 원래 출고와 섞이지 않음', async () => {
    const r = new FakeReader();
    const req = (sid: string) => ({ shipmentId: sid, trigger: 'MANUAL' as const, estimatedReadyAt: '2026-11-16T03:10:00Z', requestedAt: '2026-11-16T03:05:00Z' });
    const p1 = summary({ taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'IN_PROGRESS', version: 2 });
    const p2 = summary({ taskId: 'ORD-1-S2-PACK', taskType: 'PACK', state: 'IN_PROGRESS', version: 2, shipmentId: 'ORD-1-S2' });
    r.list = [p1, p2];
    r.details.set(p1.taskId, detail(p1, []));
    r.details.set(p2.taskId, detail(p2, []));
    r.ships.set('ORD-1-S1', ship({ state: 'HANDED_OVER', dispatchRequest: req('ORD-1-S1') }));
    r.ships.set('ORD-1-S2', ship({ shipmentId: 'ORD-1-S2', fulfillmentId: 'FUL-1R', dispatchRequest: req('ORD-1-S2') }));
    // 최신순: 재발송 배송이 먼저
    r.dels = [dl({ deliveryId: 'DLV-2', type: 'RESHIPMENT', state: 'ASSIGNED', riderId: 'RD-2' }), dl({ deliveryId: 'DLV-1', state: 'COMPLETED', riderId: 'RD-1' })];
    r.disp.set('DLV-1', { deliveryId: 'DLV-1', version: 1, shipmentId: 'ORD-1-S1', state: 'ASSIGNED', assignment: { riderId: 'RD-1', state: 'COMPLETED' } });
    r.disp.set('DLV-2', { deliveryId: 'DLV-2', version: 1, shipmentId: 'ORD-1-S2', state: 'ASSIGNED', assignment: { riderId: 'RD-2', state: 'ASSIGNED' } });
    const b = board(r, { ms: 0 });
    await b.poll();
    const by = new Map(b.shipments().map((g) => [g.shipmentId, g]));
    expect(by.get('ORD-1-S1')?.delivery?.deliveryId).toBe('DLV-1');
    expect(by.get('ORD-1-S2')?.delivery?.deliveryId).toBe('DLV-2');
    expect(dispatchView(by.get('ORD-1-S2')!).riderId).toBe('RD-2');
  });

  it('배차 상세에 shipmentId 가 없고 그 주문 출고가 둘이면 잇지 않는다(추측하지 않음)', async () => {
    const r = new FakeReader();
    const req = (sid: string) => ({ shipmentId: sid, trigger: 'MANUAL' as const, estimatedReadyAt: '2026-11-16T03:10:00Z', requestedAt: '2026-11-16T03:05:00Z' });
    const p1 = summary({ taskId: 'ORD-1-S1-PACK', taskType: 'PACK', state: 'IN_PROGRESS', version: 2 });
    const p2 = summary({ taskId: 'ORD-1-S2-PACK', taskType: 'PACK', state: 'IN_PROGRESS', version: 2, shipmentId: 'ORD-1-S2' });
    r.list = [p1, p2];
    r.details.set(p1.taskId, detail(p1, []));
    r.details.set(p2.taskId, detail(p2, []));
    r.ships.set('ORD-1-S1', ship({ dispatchRequest: req('ORD-1-S1') }));
    r.ships.set('ORD-1-S2', ship({ shipmentId: 'ORD-1-S2', dispatchRequest: req('ORD-1-S2') }));
    r.dels = [dl({})];
    r.disp.set('DLV-1', { deliveryId: 'DLV-1', version: 1, state: 'DISPATCHING' });
    const b = board(r, { ms: 0 });
    await b.poll();
    expect(b.shipments().every((g) => !g.delivery)).toBe(true);
  });

  it('회수 배송(type RETURN): 열린 출고가 없어도 간격마다 찾고, 진행 중 + 반납 뒤 정해진 시간만 둔다. 배차 상세는 읽지 않는다', async () => {
    const r = new FakeReader();
    const now = { ms: Date.parse('2026-11-17T07:00:00Z') };
    const b = new RealBoard(
      r,
      'MFC-SEED-01',
      { pollSec: 3, workerRefreshSec: 60, recentKeepSec: 600, openStates: OPEN, stockRefreshSec: 30, maxStockPerPoll: 10, shipmentRefreshSec: 3, maxShipmentPerPoll: 5, handoverKeepSec: 3600, returnPickupRefreshSec: 15, returnShownMin: 60 },
      () => now.ms,
    );
    r.dels = [
      dl({ deliveryId: 'DLV-R1', type: 'RETURN', state: 'RETURN_PICKED_UP', riderId: 'RD-1' }),
      dl({ deliveryId: 'DLV-R2', type: 'RETURN', state: 'RETURNED_TO_STORE', completedAt: '2026-11-17T06:30:00Z' }),
      dl({ deliveryId: 'DLV-R3', type: 'RETURN', state: 'RETURNED_TO_STORE', completedAt: '2026-11-17T05:00:00Z' }), // 2시간 전 — 뺌
      dl({ deliveryId: 'DLV-R4', type: 'RETURN', state: 'CANCELLED' }),
      dl({ deliveryId: 'DLV-F1', type: 'FORWARD', state: 'COMPLETED' }),
    ];
    await b.poll();
    expect(b.returnPickups.map((d) => d.deliveryId)).toEqual(['DLV-R1', 'DLV-R2']);
    expect(r.dcalls.search).toBe(1);
    expect(r.dcalls.dispatch).toBe(0); // 회수지(고객 집) 좌표가 오는 배차 상세는 읽지 않는다
    now.ms += 5_000;
    await b.poll();
    expect(r.dcalls.search).toBe(1); // 15초 간격 전
    now.ms += 15_000;
    await b.poll();
    expect(r.dcalls.search).toBe(2);
  });

  it('출고 조회 전이면 UNKNOWN, 출고 취소면 SHIPMENT_CANCELLED', () => {
    expect(dispatchView({ shipmentId: 'S', fulfillmentId: 'F', createdAt: '' }).stage).toBe('UNKNOWN');
    expect(dispatchView({ shipmentId: 'S', fulfillmentId: 'F', createdAt: '', info: ship({ state: 'CANCELLED' }) }).stage).toBe('SHIPMENT_CANCELLED');
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
