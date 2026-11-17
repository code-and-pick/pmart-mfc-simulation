import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/backend/mock/MockBackend';
import { ApiProblem } from '../src/domain/contract';

const PAK = 'PACK-QUEUE';

function setup() {
  let now = 9 * 3600;
  const be = new MockBackend({ mfcId: 'MFC-T', now: () => now, baseDate: '2026-11-02', fenceTtlSec: 120 });
  be.inventory.seed('E-00000001', 10);
  be.inventory.seed('E-00000002', 10);
  expect(
    be.inventory.reserve('RSV-1', 'ORD-1', [
      { sku: 'E-00000001', qty: 2 },
      { sku: 'E-00000002', qty: 1 },
    ]),
  ).toBe(true);
  const temps = new Map<string, 'AMBIENT'>([
    ['E-00000001', 'AMBIENT'],
    ['E-00000002', 'AMBIENT'],
  ]);
  const meta = new Map([
    ['E-00000001', { code: 'C01-01-101', name: 'a', barcode: '1' }],
    ['E-00000002', { code: 'C01-01-102', name: 'b', barcode: '2' }],
  ]);
  const req = {
    orderId: 'ORD-1',
    mfcId: 'MFC-T',
    reservationId: 'RSV-1',
    shipments: [
      {
        shipmentId: 'SHP-1',
        lines: [
          { orderLineId: 'L1', sku: 'E-00000001', qty: 2 },
          { orderLineId: 'L2', sku: 'E-00000002', qty: 1 },
        ],
      },
    ],
  };
  const decision = be.orchestrationConfirmOrder(req, temps, meta);
  const tasks = be.allTasks();
  const pick = tasks.find((t) => t.taskType === 'PICK')!;
  const pack = tasks.find((t) => t.taskType === 'PACK')!;
  return { be, pick, pack, decision, again: () => be.orchestrationConfirmOrder(req, temps, meta), advance: (s: number) => (now += s) };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof ApiProblem ? e.problem.code : String(e);
  }
}

const pickAll = (be: MockBackend, taskId: string, key: string) =>
  be.recordExecution(
    taskId,
    {
      executionType: 'PICK',
      workerId: 'W1',
      fromLocation: 'C01-01-101',
      toLocation: PAK,
      lines: [
        { orderLineId: 'L1', sku: 'E-00000001', pickedQty: 2 },
        { orderLineId: 'L2', sku: 'E-00000002', pickedQty: 1 },
      ],
    },
    key,
  );

const contentsAll = [
  { orderLineId: 'L1', sku: 'E-00000001', qty: 2 },
  { orderLineId: 'L2', sku: 'E-00000002', qty: 1 },
];

describe('MockBackend — 계약 의미 (mfc-fulfillment 0.4.10)', () => {
  it('ConfirmOrder 는 WorkOrderDecision 을 주고, 같은 작업 버전 재전달은 같은 결정이다', () => {
    const { decision, again, pick, pack } = setup();
    expect(decision).toMatchObject({ decision: 'ACCEPTED', orderId: 'ORD-1', workVersion: 1, shipmentIds: ['SHP-1'] });
    expect(decision.taskIds).toEqual(['SHP-1-PICK', 'SHP-1-PACK']);
    expect(pick.state).toBe('READY');
    expect(pack.state).toBe('WAITING');
    expect(again().fulfillmentId).toBe(decision.fulfillmentId);
  });

  it('예약은 R 만 늘리고 피킹·포장은 수량을 바꾸지 않으며, 인계 때 H·E·R 가 함께 준다', async () => {
    const { be, pick, pack } = setup();
    const b1 = () => be.inventory.get('E-00000001')!;
    expect(b1()).toMatchObject({ H: 10, E: 10, R: 2 });

    const v = be.capacityAssign(pick.taskId, 'W1');
    await be.startTask(pick.taskId, { workerId: 'W1', assignmentVersion: v }, 'k-start');
    await pickAll(be, pick.taskId, 'k-pick');
    expect(b1()).toMatchObject({ H: 10, E: 10, R: 2, picked: 2 });
    expect((await be.getTask(pick.taskId)).state).toBe('COMPLETED');
    expect((await be.getTask(pack.taskId)).packingLocations).toEqual([PAK]);

    const pv = be.capacityAssign(pack.taskId, 'W1');
    await be.startTask(pack.taskId, { workerId: 'W1', assignmentVersion: pv }, 'k-start-pack');
    const pkg = await be.sealPackage('SHP-1', { contents: contentsAll, bagCount: 1, packedBy: 'W1' }, 'k-seal');
    expect(b1()).toMatchObject({ H: 10, E: 10, R: 2, packed: 2 });
    expect((await be.getTask(pack.taskId)).state).toBe('COMPLETED');
    expect((await be.getShipment('SHP-1')).state).toBe('READY');

    const deliveryId = be.deliveryAssign('SHP-1', 'R1');
    const auth = await be.authorizeHandover(pkg.packageId, { riderId: 'R1', deliveryId, scannedCode: pkg.qrCode }, 'k-auth');
    await be.commitHandover(
      pkg.packageId,
      { handoverAuthorizationId: auth.handoverAuthorizationId, fenceVersion: auth.fenceVersion, riderId: 'R1' },
      'k-commit',
    );
    expect(b1()).toMatchObject({ H: 8, E: 8, R: 0, packed: 0 });
    expect((await be.getShipment('SHP-1')).state).toBe('HANDED_OVER');
    expect(be.inventory.violations).toEqual([]);
  });

  it('PACK 실적 등록은 422, 포장 밀봉은 PACK 을 시작해야 하고 집품량을 넘지 못한다', async () => {
    const { be, pick, pack } = setup();
    const v = be.capacityAssign(pick.taskId, 'W1');
    await be.startTask(pick.taskId, { workerId: 'W1', assignmentVersion: v }, 's');
    await pickAll(be, pick.taskId, 'p');
    const pv = be.capacityAssign(pack.taskId, 'W1');
    expect(await code(be.sealPackage('SHP-1', { contents: contentsAll, bagCount: 1 }, 'early'))).toBe('INVALID_STATE');
    await be.startTask(pack.taskId, { workerId: 'W1', assignmentVersion: pv }, 's2');
    expect(
      await code(
        be.recordExecution(pack.taskId, { executionType: 'PACK', workerId: 'W1', lines: [{ orderLineId: 'L1', sku: 'E-00000001', pickedQty: 2 }] }, 'k'),
      ),
    ).toBe('UNSUPPORTED_EXECUTION');
    expect(await code(be.sealPackage('SHP-1', { contents: [{ orderLineId: 'L1', sku: 'E-00000001', qty: 3 }], bagCount: 1 }, 'over'))).toBe(
      'CONTENT_MISMATCH',
    );
    expect(await code(be.sealPackage('SHP-1', { contents: contentsAll, bagCount: 1, packedBy: 'W9' }, 'other'))).toBe('NOT_ASSIGNEE');
    // 나눠 밀봉: 첫 포장 뒤에는 PACK 이 아직 진행 중
    await be.sealPackage('SHP-1', { contents: [contentsAll[0]], bagCount: 1 }, 'a');
    expect((await be.getTask(pack.taskId)).state).toBe('IN_PROGRESS');
    await be.sealPackage('SHP-1', { contents: [contentsAll[1]], bagCount: 1 }, 'b');
    expect((await be.getTask(pack.taskId)).state).toBe('COMPLETED');
  });

  it('PACK 은 PICK 완료 전 시작할 수 없고, 시작 점유는 한 요청만 성공한다', async () => {
    const { be, pick, pack } = setup();
    expect(() => be.capacityAssign(pack.taskId, 'W1')).toThrow(); // WAITING 은 배정 불가
    const v = be.capacityAssign(pick.taskId, 'W1');
    expect(await code(be.startTask(pick.taskId, { workerId: 'W2', assignmentVersion: v }, 'a'))).toBe('NOT_ASSIGNEE');
    expect(await code(be.startTask(pick.taskId, { workerId: 'W1', assignmentVersion: v }, 'b'))).toBe('OK');
    // 같은 키 재전송 = 기존 판정
    expect(await code(be.startTask(pick.taskId, { workerId: 'W1', assignmentVersion: v }, 'b'))).toBe('OK');
    // 새 키로 다시 시작 = ALREADY_STARTED
    expect(await code(be.startTask(pick.taskId, { workerId: 'W1', assignmentVersion: v }, 'c'))).toBe('ALREADY_STARTED');
    // 같은 키 다른 본문 = 충돌
    expect(await code(be.startTask(pick.taskId, { workerId: 'W1', assignmentVersion: v + 1 }, 'b'))).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('집품은 선반·포장 위치가 필요하고, 결품 보고는 집품과 섞지 않은 한 줄이다', async () => {
    const { be, pick } = setup();
    const v = be.capacityAssign(pick.taskId, 'W1');
    await be.startTask(pick.taskId, { workerId: 'W1', assignmentVersion: v }, 's');
    const line = { orderLineId: 'L1', sku: 'E-00000001', pickedQty: 1 };
    expect(await code(be.recordExecution(pick.taskId, { executionType: 'PICK', workerId: 'W1', fromLocation: 'C01-01-101', lines: [line] }, 'x'))).toBe(
      'TO_LOCATION_REQUIRED', // fulfillment 0.8.0
    );
    expect(
      await code(
        be.recordExecution(
          pick.taskId,
          { executionType: 'PICK', workerId: 'W1', fromLocation: 'C01-01-101', toLocation: PAK, lines: [{ ...line, shortage: { qty: 1, reason: 'SHORT' } }] },
          'y',
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await code(
        be.recordExecution(pick.taskId, { executionType: 'PICK', workerId: 'W1', fromLocation: 'C01-01-101', toLocation: PAK, lines: [{ ...line, pickedQty: 3 }] }, 'z'),
      ),
    ).toBe('QTY_EXCEEDS_REMAINING');
  });

  it('결품은 H 를 그대로 두고 E·R 를 줄이며, 작업은 BLOCKED → 결품 사가 해결 뒤 이어지고 PACK 에서 빠진다', async () => {
    const { be, pick, pack } = setup();
    const v = be.capacityAssign(pick.taskId, 'W1');
    await be.startTask(pick.taskId, { workerId: 'W1', assignmentVersion: v }, 's');
    const base = { executionType: 'PICK' as const, workerId: 'W1', fromLocation: 'C01-01-101' };
    await be.recordExecution(pick.taskId, { ...base, toLocation: PAK, lines: [{ orderLineId: 'L1', sku: 'E-00000001', pickedQty: 1 }] }, 'p1');
    await be.recordExecution(
      pick.taskId,
      { ...base, lines: [{ orderLineId: 'L1', sku: 'E-00000001', pickedQty: 0, shortage: { qty: 1, reason: 'SHORT' } }] },
      'p1-short',
    );
    expect(be.inventory.get('E-00000001')).toMatchObject({ H: 10, E: 9, R: 1, D: 1 });
    expect((await be.getTask(pick.taskId)).state).toBe('BLOCKED');
    expect(be.blockedForShortage()).toEqual([pick.taskId]);
    // 해결 전에는 다음 실적을 받지 않는다
    expect(
      await code(be.recordExecution(pick.taskId, { ...base, toLocation: PAK, lines: [{ orderLineId: 'L2', sku: 'E-00000002', pickedQty: 1 }] }, 'p2')),
    ).toBe('INVALID_STATE');
    expect(be.orchestrationResolveShortages(pick.taskId)).toBe(1);
    const t = await be.getTask(pick.taskId);
    expect(t.state).toBe('IN_PROGRESS');
    expect(t.lines.find((l) => l.orderLineId === 'L1')).toMatchObject({ completedQty: 1, cancelledQty: 1, remainingQty: 0 });
    await be.recordExecution(pick.taskId, { ...base, toLocation: PAK, lines: [{ orderLineId: 'L2', sku: 'E-00000002', pickedQty: 1 }] }, 'p2b');
    expect((await be.getTask(pick.taskId)).state).toBe('COMPLETED');
    const p = await be.getTask(pack.taskId);
    expect(p.state).toBe('READY');
    expect(p.remainingQty).toBe(2);
    expect(p.lines.find((l) => l.orderLineId === 'L1')).toMatchObject({ cancelledQty: 1, remainingQty: 1 });
  });

  it('인계 fence: 다른 승인 진행 중이면 FENCE_ACTIVE, 버전이 다르면 거절, 만료 후 commit 은 INVALID_STATE', async () => {
    const { be, pick, pack, advance } = setup();
    const v = be.capacityAssign(pick.taskId, 'W1');
    await be.startTask(pick.taskId, { workerId: 'W1', assignmentVersion: v }, 's');
    await pickAll(be, pick.taskId, 'p');
    const pv = be.capacityAssign(pack.taskId, 'W1');
    await be.startTask(pack.taskId, { workerId: 'W1', assignmentVersion: pv }, 's2');
    const pkg = await be.sealPackage('SHP-1', { contents: contentsAll, bagCount: 1 }, 'seal');
    // 포장할 수 있는 양을 넘는 밀봉은 거절(PACK 이 이미 끝남)
    expect(await code(be.sealPackage('SHP-1', { contents: [{ orderLineId: 'L1', sku: 'E-00000001', qty: 1 }], bagCount: 1 }, 'seal2'))).toBe(
      'INVALID_STATE',
    );
    const d = be.deliveryAssign('SHP-1', 'R1');
    expect(await code(be.authorizeHandover(pkg.packageId, { riderId: 'R9', deliveryId: d, scannedCode: pkg.qrCode }, 'x'))).toBe('FORBIDDEN');
    expect(await code(be.authorizeHandover(pkg.packageId, { riderId: 'R1', deliveryId: d, scannedCode: 'OLD:0' }, 'y'))).toBe(
      'PACKAGE_INVALIDATED',
    );
    const a = await be.authorizeHandover(pkg.packageId, { riderId: 'R1', deliveryId: d, scannedCode: pkg.qrCode }, 'a1');
    expect(await code(be.authorizeHandover(pkg.packageId, { riderId: 'R1', deliveryId: d, scannedCode: pkg.qrCode }, 'a2'))).toBe('FENCE_ACTIVE');
    expect(
      await code(be.commitHandover(pkg.packageId, { handoverAuthorizationId: a.handoverAuthorizationId, fenceVersion: 99, riderId: 'R1' }, 'c0')),
    ).toBe('FENCE_VERSION_MISMATCH');
    advance(121);
    expect(
      await code(
        be.commitHandover(pkg.packageId, { handoverAuthorizationId: a.handoverAuthorizationId, fenceVersion: a.fenceVersion, riderId: 'R1' }, 'c1'),
      ),
    ).toBe('INVALID_STATE');
    // 만료 ≠ 취소 성공: 재고는 그대로, 재스캔하면 새 fence
    expect(be.inventory.get('E-00000001')).toMatchObject({ H: 10, R: 2 });
    const a2 = await be.authorizeHandover(pkg.packageId, { riderId: 'R1', deliveryId: d, scannedCode: pkg.qrCode }, 'a3');
    expect(a2.fenceVersion).toBe(a.fenceVersion + 1);
  });
});
