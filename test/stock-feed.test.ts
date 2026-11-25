import { describe, expect, it } from 'vitest';
import { SseParser, StockStream } from '../src/backend/http/stockStream';
import { StockFeed, classify } from '../src/sim/stockFeed';
import type { StockStreamEvent } from '../src/domain/contract';

describe('SSE 읽기(재고 실시간 스트림)', () => {
  it('조각으로 와도 빈 줄에서 한 메시지, 주석(: hb)은 메시지 아님, id 기억', () => {
    const p = new SseParser();
    let hb = 0;
    expect(p.push('event: ready\ndata: {"type":"re', () => hb++)).toEqual([]);
    expect(p.push('ady"}\n\n: hb\n\n', () => hb++)).toEqual([{ event: 'ready', id: undefined, data: '{"type":"ready"}' }]);
    expect(hb).toBe(1);
    const m = p.push('id: e-7\r\nevent: stock-changed\r\ndata: {"a":1}\r\n\r\n');
    expect(m).toEqual([{ event: 'stock-changed', id: 'e-7', data: '{"a":1}' }]);
  });

  it('fetch 스트림을 읽어 이벤트를 넘기고, 끊기면 Last-Event-ID 로 다시 붙는다', async () => {
    const seen: string[] = [];
    const headers: Record<string, string>[] = [];
    let calls = 0;
    const enc = new TextEncoder();
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers.push(init.headers as Record<string, string>);
      calls++;
      const body = calls === 1 ? 'id: e1\nevent: stock-changed\ndata: {"type":"stock-changed","eventId":"e1"}\n\n' : 'event: ready\ndata: {"type":"ready","resumed":true}\n\n';
      return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(body)), c.close()) }), { status: 200 });
    }) as typeof fetch;
    const s = new StockStream({ url: '/x', token: async () => 'T', onEvent: (e) => seen.push(e.type), onState: () => {}, fetchImpl });
    s.start();
    await new Promise((r) => setTimeout(r, 1300));
    s.stop();
    expect(seen.slice(0, 2)).toEqual(['stock-changed', 'ready']);
    expect(headers[0].Authorization).toBe('Bearer T');
    expect(headers[0]['Last-Event-ID']).toBeUndefined();
    expect(headers[1]['Last-Event-ID']).toBe('e1');
  });
});

describe('재고 변동 기록', () => {
  const item = (sku: string, version: number, A: number, dA: number, H = 10) => ({ sku, onHandQty: H, quarantinedQty: 0, sellableQty: H, reservedQty: H - A, availableQty: A, availableDelta: dA, version });
  const ev = (o: Partial<StockStreamEvent>): StockStreamEvent => ({ type: 'stock-changed', occurredAt: '2026-11-25T01:00:00Z', ...o });

  it('원인 이름 — 회수 반입(RTN-)과 입고 수령을 가르고, 모르는 값은 그대로', () => {
    expect(classify('TIN', [{ locationCode: 'RTN-A-01' }])[0]).toBe('RETURN_IN');
    expect(classify('TIN', [{ locationCode: 'RCV-A-01' }])[0]).toBe('INBOUND');
    expect(classify('QUALITY_RELEASE', [])[0]).toBe('RETURN_OK');
    expect(classify('MOVE_DROP', [])[0]).toBe('MOVE');
    expect(classify('NEW_THING', [])).toEqual(['OTHER', 'NEW_THING']);
  });

  it('주문 예약 −, 인계는 보유 −(위치 단위 합), 회수 검수 정상 +, 같은 version 은 버림', () => {
    const f = new StockFeed(500, () => 0);
    f.apply(ev({ eventId: '1', cause: 'RESERVE', items: [item('A', 1, 8, -2)] }));
    f.apply(ev({ eventId: '1', cause: 'RESERVE', items: [item('A', 1, 8, -2)] })); // 이어 받기로 다시 옴
    f.apply(ev({ eventId: '2', cause: 'HANDOVER', items: [item('A', 2, 8, 0, 8)], units: [{ sku: 'A', lotId: 'L', locationCode: 'PAK-1', qualityState: 'NORMAL', workState: 'PACKED', delta: -2 }] }));
    f.apply(
      ev({
        eventId: '3',
        cause: 'QUALITY_RELEASE',
        items: [item('A', 3, 9, 1, 9)],
        units: [
          { sku: 'A', lotId: 'L', locationCode: 'RTN-A-01', qualityState: 'QUARANTINED', workState: 'STORED', delta: -1 },
          { sku: 'A', lotId: 'L', locationCode: 'RTN-A-01', qualityState: 'NORMAL', workState: 'STORED', delta: 1 },
        ],
      }),
    );
    expect(f.rows.map((r) => [r.kind, r.availableDelta, r.onHandDelta])).toEqual([
      ['ORDER', -2, 0],
      ['HANDOVER', 0, -2],
      ['RETURN_OK', 1, 0],
    ]);
    expect(f.totals.get('ORDER')).toEqual({ n: 1, units: -2 });
    expect(f.totals.get('HANDOVER')).toEqual({ n: 1, units: -2 });
    expect(f.totals.get('RETURN_OK')).toEqual({ n: 1, units: 1 });
    expect(f.rows[2].after.A).toBe(9);
  });

  it('resync 면 놓친 변동 표시, 오래된 줄은 keep 까지만', () => {
    const f = new StockFeed(2, () => 5);
    for (let i = 1; i <= 3; i++) f.apply(ev({ eventId: `${i}`, cause: 'RESERVE', items: [item('A', i, 1, -1)] }));
    expect(f.rows).toHaveLength(2);
    f.apply({ type: 'resync', reason: 'BACKLOG' });
    expect(f.gapAtMs).toBe(5);
  });
});

describe('전체 재고(스냅샷 + 실시간)', () => {
  const lot = (onHand: number, reserved: number, quarantined = 0) => ({ onHand, quarantined, sellable: onHand - quarantined, reserved, available: onHand - quarantined - reserved });
  it('ready 면 스냅샷을 읽으라 하고, LOT 합으로 채우고, 읽는 사이 스트림이 바꾼 SKU 는 덮지 않는다', () => {
    let t = 100;
    const f = new StockFeed(500, () => t);
    f.apply({ type: 'ready', resumed: false });
    expect(f.needSnapshot).toBe(true);
    expect(f.gapAtMs).toBeNull();
    const started = t;
    t = 200;
    f.apply({ type: 'stock-changed', eventId: '9', cause: 'RESERVE', occurredAt: '2026-11-25T01:00:00Z', items: [{ sku: 'B', onHandQty: 5, quarantinedQty: 0, sellableQty: 5, reservedQty: 1, availableQty: 4, availableDelta: -1, version: 3 }] });
    f.setSnapshot('A', [lot(10, 2), lot(3, 0, 1)], started, '사과');
    f.setSnapshot('B', [lot(5, 0)], started); // 스트림 값이 더 새 것
    expect(f.skus.get('A')).toMatchObject({ name: '사과', H: 13, Q: 1, E: 12, R: 2, A: 10 });
    expect(f.skus.get('B')).toMatchObject({ A: 4, R: 1, lastAvailableDelta: -1, lastLabel: '주문 예약' });
    f.apply({ type: 'resync', reason: 'BACKLOG' });
    expect(f.gapAtMs).toBe(200);
  });
});

describe('MOCK 원장 → 재고 변동(실서버 스트림과 같은 모양)', () => {
  it('예약 −A, 인계 −H, 회수 반입은 RTN 자리 +H, 검수 정상 +A', async () => {
    const { InventoryLedger } = await import('../src/backend/mock/inventory');
    const inv = new InventoryLedger();
    inv.seed('A', 10);
    const got: { cause: string; dA: number; dH: number; loc: string }[] = [];
    inv.onChange = (c) => got.push(...c.items.map((i) => ({ cause: c.cause, dA: i.dA, dH: i.dH, loc: c.loc })));
    inv.reserve('R1', 'O1', [{ sku: 'A', qty: 2 }]);
    inv.commitPick([{ sku: 'A', qty: 2 }]);
    inv.commitPack([{ sku: 'A', qty: 2 }]);
    inv.commitHandover('R1', [{ sku: 'A', qty: 2 }]);
    inv.returnReceipt([{ sku: 'A', qty: 1 }]);
    inv.releaseReturn('A', 1);
    expect(got).toEqual([
      { cause: 'RESERVE', dA: -2, dH: 0, loc: '' },
      { cause: 'HANDOVER', dA: 0, dH: -2, loc: '' },
      { cause: 'TIN', dA: 0, dH: 1, loc: 'RTN-A-01' },
      { cause: 'QUALITY_RELEASE', dA: 1, dH: 0, loc: 'RTN-A-01' },
    ]);
    expect(inv.violations).toEqual([]);
  });
});

describe('셈 시작 합계(큰 숫자 앞 "N개 중")', () => {
  it('첫 스냅샷이 끝날 때 합계, 그 전에 스트림으로 센 양은 되돌려 시작 값으로', () => {
    const f = new StockFeed(500, () => 0);
    f.apply({ type: 'stock-changed', eventId: '1', cause: 'RESERVE', items: [{ sku: 'A', onHandQty: 10, quarantinedQty: 0, sellableQty: 10, reservedQty: 2, availableQty: 8, availableDelta: -2, version: 5 }] });
    f.setSnapshot('B', [{ onHand: 5, quarantined: 0, sellable: 5, reserved: 0, available: 5 }], -1);
    f.snapshotState('done');
    expect(f.base).toEqual({ A: 15, H: 15 });
    f.snapshotState('done'); // 다시 읽어도 시작 값은 그대로
    expect(f.base).toEqual({ A: 15, H: 15 });
  });
});
