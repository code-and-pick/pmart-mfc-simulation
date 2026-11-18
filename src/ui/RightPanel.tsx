import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useTick, useView } from '../app/context';
import { fmtClock, fmtDur } from '../sim/metrics';
import { RealOrders, RealStockTable, RealSummary } from './RealPanel';
import { ScanBoard } from './ScanBoard';
import { ScanFocusContext } from './scanFocus';

type Tab = 'orders' | 'api' | 'events' | 'logs' | 'inventory' | 'scan';
const REAL_TABS: { t: Tab; text: string }[] = [
  { t: 'orders', text: '실제 주문' },
  { t: 'inventory', text: '주문 상품 재고' },
  { t: 'scan', text: '바코드' },
  { t: 'api', text: 'API 호출' },
];
const TABS: { t: Tab; text: string }[] = [
  { t: 'api', text: 'API 호출' },
  { t: 'events', text: '계약 이벤트' },
  { t: 'logs', text: '현장' },
  { t: 'inventory', text: '재고' },
  { t: 'scan', text: '바코드' },
];

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
  const { sim } = useApp();
  useTick();
  const real = !!sim.real;
  const [tab, setTab] = useState<Tab>(real ? 'orders' : 'api');
  // 고른 출고는 ViewController 에 둔다 — 3D 스캔 말풍선(ScanBubbles)도 같은 값을 본다
  const view = useView();
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
  return (
    <ScanFocusContext.Provider value={focus}>
    <div className="panel right">
      {real ? <RealSummary /> : <Kpis />}
      {!real && <Board />}
      <div className="tabs">
        {(real ? REAL_TABS : TABS).map((x) => (
          <button key={x.t} className={tab === x.t ? 'on' : undefined} onClick={() => setTab(x.t)}>
            {x.text}
          </button>
        ))}
      </div>
      <Log tab={tab} />
    </div>
    </ScanFocusContext.Provider>
  );
}
