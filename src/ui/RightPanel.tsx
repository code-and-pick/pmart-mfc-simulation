import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useApp, useTick, useView } from '../app/context';
import type { RightView } from '../render/controller';
import { fmtClock, fmtDur } from '../sim/metrics';
import { RealOrders, RealStockTable, RealSummary } from './RealPanel';
import { ScanBoard } from './ScanBoard';
import { ScanFocusContext } from './scanFocus';

// 오른쪽 화면은 왼쪽 아이콘 메뉴(Rail)가 고른다 — ViewController.rightView
type Tab = RightView;

function Kpis() {
  const { sim: s } = useApp();
  const m = s.metrics.summary();
  const ib = s.metrics.inbound;
  const busy = s.workers.filter((w) => !w.idle).length;
  const inv = s.mock?.inventory;
  let shelfUnits = 0;
  let shelfCap = 0;
  let low = 0;
  if (inv) {
    for (const k of s.catalog) {
      const b = inv.get(k.sku)!;
      shelfUnits += b.shelf;
      shelfCap += k.shelfCap;
      if (b.shelf <= k.minQty) low++;
    }
  }
  const kpis: [string, string][] = [
    ['주문 유입', `${s.metrics.ordersCreated}`],
    ['출하 준비', `${m.ready}`],
    ['라이더 인계', `${m.handedOver}`],
    ['접수→출하준비 평균', fmtDur(m.leadAvg)],
    ['접수→출하준비 p90', fmtDur(m.leadP90)],
    ['최근 1시간 처리', `${s.metrics.readyLastHour(s.time)}건`],
    ['피킹 평균', fmtDur(m.pickAvg)],
    ['패킹대 대기 평균', fmtDur(m.packQueueAvg)],
    ['작업 중 / 전체', `${busy}/${s.workers.length}`],
    ['선반 충족률', inv ? `${Math.round((100 * shelfUnits) / shelfCap)}%` : '—'],
    ['보충 필요 칸 (≤min)', inv ? `${low}` : '—'],
    ['피킹 중 보충 대기', `${ib.pickWaits}회`],
    ['입고 차량 도착/수령', `${ib.trucksArrived}/${ib.trucksReceived}`],
    ['적치 선반·보충재고', `${ib.putawayShelfUnits}·${ib.putawayReserveUnits}`],
    ['보충 이동 MOV', `${ib.replenishMoves}회 ${ib.replenishUnits}개`],
    ['재고 부족 차단', `${s.metrics.ordersBlockedStock}`],
    ['결품 보고(개)', `${s.metrics.shortageUnits}`],
    ['API 오류', `${s.metrics.apiErrors}`],
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

function Board() {
  const { sim: s } = useApp();
  const b = s.taskBoard();
  const ibb = s.inboundBoard();
  const rows: [string, number | string][] = [
    ['PICK 준비(배정 대기)', b['PICK:READY'] ?? 0],
    ['PICK 배정·진행', (b['PICK:ASSIGNED'] ?? 0) + (b['PICK:IN_PROGRESS'] ?? 0)],
    ['PACK 배정·진행', (b['PACK:ASSIGNED'] ?? 0) + (b['PACK:IN_PROGRESS'] ?? 0) + (b['PACK:READY'] ?? 0)],
    ['출하대기 랙 포장', s.shipRack.all().length],
    ['라이더 오는 중', s.shipmentsWaitingRider() + s.riders.length],
    ['패킹대 대기열', `${s.stations.queueLength}명`],
    ['하차 칸 적치 대기', ibb.putawayLines],
    ['보충 대기·진행', `${ibb.replenishQueued}·${ibb.replenishActive}`],
  ];
  return (
    <div className="board">
      {rows.map(([k, v]) => (
        <div key={k}>
          {k}
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

/** 맨 위 요약 — 흐름 한 줄(주문 → 피킹 → 패킹 → 랙 → 인계) + 핵심 숫자 4개, 나머지는 "숫자 모두"(사용자 2026-11-20 시안) */
function Summary() {
  const { sim: s } = useApp();
  let flow: [string, number, boolean?][];
  let key: [string, string][];
  if (s.real) {
    const real = s.real;
    const c = real.counts();
    const n = (k: string) => c[k] ?? 0;
    const sh = real.shipments();
    const blocked = Object.entries(c).filter(([k]) => k.endsWith(':BLOCKED')).reduce((a, [, v]) => a + v, 0);
    const packWait = n('PACK:WAITING') + n('PACK:READY');
    flow = [
      ['열린 출고', sh.filter((r) => [r.pick, r.pack, r.ret].some((t) => t && !t.closed)).length],
      ['피킹', n('PICK:READY') + n('PICK:WAITING') + n('PICK:ASSIGNED') + n('PICK:IN_PROGRESS')],
      ['패킹', packWait + n('PACK:ASSIGNED') + n('PACK:IN_PROGRESS'), packWait > 0],
      ['랙', sh.filter((r) => r.info?.state === 'READY' && s.onRack(r.shipmentId)).length],
      ['막힘', blocked, blocked > 0],
    ];
    key = [];
  } else {
    const m = s.metrics.summary();
    const b = s.taskBoard();
    const busy = s.workers.filter((w) => !w.idle).length;
    const pickWait = b['PICK:READY'] ?? 0;
    flow = [
      ['주문', s.metrics.ordersCreated],
      ['피킹', pickWait + (b['PICK:ASSIGNED'] ?? 0) + (b['PICK:IN_PROGRESS'] ?? 0), pickWait > 5],
      ['패킹', (b['PACK:ASSIGNED'] ?? 0) + (b['PACK:IN_PROGRESS'] ?? 0) + (b['PACK:READY'] ?? 0)],
      ['랙', s.shipRack.all().length],
      ['인계', m.handedOver],
    ];
    key = [
      ['접수→출하준비 평균', fmtDur(m.leadAvg)],
      ['작업 중 / 전체', `${busy}/${s.workers.length}`],
      ['최근 1시간 처리', `${s.metrics.readyLastHour(s.time)}건`],
      ['재고 부족 차단', `${s.metrics.ordersBlockedStock}`],
    ];
  }
  return (
    <div className="summary">
      <div className="flow">
        {flow.map(([k, v, w]) => (
          <div key={k} className={w ? 'w' : ''}>
            <b>{v}</b>
            <small>{k}</small>
          </div>
        ))}
      </div>
      {key.length > 0 && (
        <div className="kpis four">
          {key.map(([k, v]) => (
            <div className="kpi" key={k}>
              <div className="v">{v}</div>
              <div className="k">{k}</div>
            </div>
          ))}
        </div>
      )}
      <details className="more">
        <summary>숫자 모두</summary>
        {s.real ? (
          <RealSummary />
        ) : (
          <>
            <Kpis />
            <Board />
          </>
        )}
      </details>
    </div>
  );
}

function LogBody({ tab }: { tab: Tab }): ReactNode {
  const { sim: s, controller } = useApp();
  const goto = (sku: string) => controller.select({ kind: 'location', sku });
  if (tab === 'orders') return s.real ? <RealOrders /> : null;
  if (tab === 'scan') return <ScanBoard />;
  if (tab === 'api') {
    return s.apiLog.slice(-150).map((r, i) => {
      const ok = typeof r.status === 'number' && r.status < 400;
      return (
        <div className="row" key={i}>
          <span className="t">{fmtClock(r.at)}</span>
          <span className={`m-${r.method}`}>{r.method}</span>
          <span className={ok ? 's-ok' : 's-bad'}>
            {r.status}
            {r.code ? ` ${r.code}` : ''}
          </span>
          <span>{r.path}</span>
          {r.note && <span className="gap">{r.note}</span>}
        </div>
      );
    });
  }
  if (tab === 'events') {
    return s.events.slice(-150).map((e, i) => (
      <div className="row wrap" key={i}>
        <span className="t">{fmtClock(e.at)}</span>
        <span className="ev">{e.type}</span>
        <span>{e.summary}</span>
      </div>
    ));
  }
  if (tab === 'logs') {
    return s.logs.length ? (
      s.logs.slice(-150).map((l, i) => (
        <div className="row wrap" key={i}>
          <span className="t">{fmtClock(l.at)}</span>
          <span>{l.msg}</span>
        </div>
      ))
    ) : (
      <div className="note">결품·보충 대기·차단·오류 같은 현장 사건이 여기에 쌓입니다.</div>
    );
  }
  if (!s.mock) return s.real ? <RealStockTable /> : null;
  const inv = s.mock.inventory;
  const active = inv
    .all()
    .filter((x) => x.R > 0 || x.picked > 0 || x.packed > 0 || x.D > 0 || x.unstowed > 0 || x.shelf <= (s.skuMap.get(x.sku)?.minQty ?? 0))
    .sort((a, b) => b.R + b.picked + b.unstowed - (a.R + a.picked + a.unstowed))
    .slice(0, 150);
  const tot = inv.all().reduce(
    (a, x) => ({ H: a.H + x.H, E: a.E + x.E, R: a.R + x.R, shelf: a.shelf + x.shelf, reserve: a.reserve + x.reserve, un: a.un + x.unstowed }),
    { H: 0, E: 0, R: 0, shelf: 0, reserve: 0, un: 0 },
  );
  return (
    <>
      <div className="note">
        합계 H {tot.H.toLocaleString()} (선반 {tot.shelf.toLocaleString()} · 보충재고 {tot.reserve.toLocaleString()} · 미적치 {tot.un}) · E {tot.E.toLocaleString()} · R {tot.R} · 불변식 위반{' '}
        {inv.violations.length}건. 행을 누르면 그 로케이션으로 이동합니다.
      </div>
      <table className="inv">
        <thead>
          <tr>
            <th>로케이션</th>
            <th>선반</th>
            <th>보충</th>
            <th>미적치</th>
            <th>H</th>
            <th>R</th>
            <th>A</th>
            <th>피킹</th>
            <th>포장</th>
          </tr>
        </thead>
        <tbody>
          {active.map((x) => {
            const k = s.skuMap.get(x.sku)!;
            return (
              <tr key={x.sku} title={`${k.name} ${x.sku}`} onClick={() => goto(x.sku)}>
                <td>{k.location.code}</td>
                <td>
                  {x.shelf}/{k.shelfCap}
                </td>
                <td>{x.reserve}</td>
                <td>{x.unstowed || ''}</td>
                <td>{x.H}</td>
                <td>{x.R}</td>
                <td>{x.E - x.R}</td>
                <td>{x.picked || ''}</td>
                <td>{x.packed || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Log({ tab }: { tab: Tab }) {
  const { sim: s } = useApp();
  useTick();
  const box = useRef<HTMLDivElement>(null);
  // 바닥에 붙어 있었으면 새 행이 와도 바닥을 따라간다
  const stick = useRef(true);
  const key = `${tab}:${tab === 'orders' || tab === 'scan' ? (s.real?.polls ?? 0) : ''}:${tab === 'scan' || tab === 'orders' ? `${s.real?.skuVersion ?? 0}.${s.real?.orderViewVersion ?? 0}` : ''}:${s.apiLog.length}:${s.apiLog[s.apiLog.length - 1]?.at}:${s.events.length}:${s.events[s.events.length - 1]?.at}:${s.logs.length}:${tab === 'inventory' ? (s.real ? s.real.stockVersion : Math.floor(s.time / 5)) : ''}`;
  // 내용이 바뀔 때만 다시 만든다 (4Hz 갱신마다 150행을 새로 그리지 않게)
  const body = useMemo(() => <LogBody tab={tab} />, [key]);
  const lastTab = useRef(tab);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const tabChanged = lastTab.current !== tab;
    lastTab.current = tab;
    if (tab !== 'inventory' && tab !== 'orders' && tab !== 'scan' && (stick.current || tabChanged)) el.scrollTop = el.scrollHeight;
  }, [key, tab]);
  return (
    <div
      className="log"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
      }}
    >
      {body}
    </div>
  );
}

export function RightPanel() {
  useTick();
  // 고른 출고는 ViewController 에 둔다 — 3D 스캔 말풍선(ScanBubbles)도 같은 값을 본다
  const view = useView();
  const tab = view.rightView;
  const scanShipment = view.scanShipment;
  const focus = useMemo(
    () => ({
      shipmentId: scanShipment,
      // 주문을 골라도 탭은 그대로(사용자 2026-11-18 "주문 눌렀을때 바코드 탭으로 안넘어갔으면") — 3D 말풍선·바코드 탭이 그 주문을 본다
      show: (id: string) => view.setScanShipment(id),
      clear: () => view.setScanShipment(null),
    }),
    [scanShipment, view],
  );
  if (!tab) return null;
  return (
    <ScanFocusContext.Provider value={focus}>
    <div className="panel right">
      <Summary />
      <Log tab={tab} />
    </div>
    </ScanFocusContext.Provider>
  );
}
