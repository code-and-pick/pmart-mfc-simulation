// 확대한 구역 요약 카드, 선택한 작업자 PDA / 로케이션 카드.
import type { ReactNode } from 'react';
import { useApp, useTick, useView } from '../app/context';
import type { TemperatureZone } from '../domain/contract';
import { INBOUND_COLOR, STATE_COLOR, TEMP_COLOR, hex } from '../render/colors';
import { INBOUND_KO, STATE_KO, TEMP_KO } from './text';
import { BACKEND_FACTS } from '../config';

function Stat({ v, k }: { v: ReactNode; k: string }) {
  return (
    <div>
      <b>{v}</b>
      <span>{k}</span>
    </div>
  );
}

function ZoneBody({ zoneKey }: { zoneKey: string }) {
  const { sim: s, controller } = useApp();
  const inv = s.mock?.inventory;
  const goto = (sku: string) => controller.select({ kind: 'location', sku });
  const temp: TemperatureZone | null = zoneKey === 'A' ? 'FROZEN' : zoneKey === 'B' ? 'CHILLED' : zoneKey === 'C-H' ? 'AMBIENT' : null;
  if (temp) {
    const racks = s.layout.racks.filter((r) => r.temp === temp);
    const locs = s.layout.locationsByTemp[temp].length;
    const skus = s.catalog.filter((k) => k.temp === temp);
    let units = 0;
    let cap = 0;
    let reserve = 0;
    const lows: { sku: string; code: string; shelf: number; min: number; reserve: number }[] = [];
    if (inv) {
      for (const k of skus) {
        const b = inv.get(k.sku)!;
        units += b.shelf;
        cap += k.shelfCap;
        reserve += b.reserve;
        if (b.shelf <= k.minQty) lows.push({ sku: k.sku, code: k.location.code, shelf: b.shelf, min: k.minQty, reserve: b.reserve });
      }
    }
    lows.sort((a, b) => a.shelf - b.shelf);
    const pct = cap ? Math.round((100 * units) / cap) : 0;
    return (
      <>
        <div className="stats">
          <Stat v={racks.length} k="랙" />
          <Stat v={locs.toLocaleString()} k="칸(로케이션)" />
          <Stat v={skus.length.toLocaleString()} k="SKU (칸의 85%)" />
          <Stat v={inv ? units.toLocaleString() : '—'} k="선반 상품" />
          <Stat v={inv ? reserve.toLocaleString() : '—'} k="보충재고" />
          <Stat v={inv ? lows.length : '—'} k="보충 필요 칸" />
        </div>
        {inv && (
          <>
            <div className="bar">
              <i style={{ width: `${pct}%`, background: hex(TEMP_COLOR[temp]) }} />
            </div>
            <div className="note">
              선반 충족률 {pct}% (칸 한도 합 {cap.toLocaleString()}개 기준)
            </div>
          </>
        )}
        {lows.length > 0 && (
          <>
            <div className="note">보충 필요 칸 (선반/최소) — 누르면 이동</div>
            <div className="lows">
              {lows.slice(0, 8).map((l) => (
                <div key={l.sku} onClick={() => goto(l.sku)}>
                  <span>{l.code}</span>
                  <span>
                    {l.shelf}/{l.min}
                  </span>
                  <span>{l.reserve > 0 ? `보충재고 ${l.reserve}` : '입고 필요'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </>
    );
  }
  if (zoneKey === 'WH') {
    const res = s.layout.reserves.filter((r) => r.temp === 'AMBIENT');
    const units = inv ? s.catalog.filter((k) => k.temp === 'AMBIENT').reduce((a, k) => a + inv.get(k.sku)!.reserve, 0) : 0;
    return (
      <>
        <div className="stats">
          <Stat v={res.length} k="바닥 팔레트 자리" />
          <Stat v={inv ? units.toLocaleString() : '—'} k="상온 보충재고" />
        </div>
        <div className="note">
          입고 수량 중 피킹 칸 한도를 넘는 상온 상품은 이 팔레트에 쌓였다가, 칸이 최소량 이하가 되면 보충(MOV)됩니다. 냉장·냉동 보충재고는 각 저온실 안쪽 팔레트(AR·BR)에 있습니다.
        </div>
      </>
    );
  }
  if (zoneKey === 'RCV') {
    const ibb = s.inboundBoard();
    const st = { APPROACHING: '진입 중', DOCKED: '도착', DONE: '수령 완료', LEAVING: '출발', GONE: '' } as const;
    return (
      <>
        <div className="stats">
          <Stat v={s.trucks.length} k="차량" />
          <Stat v={ibb.putawayLines} k="하차 칸 롤테이너" />
          <Stat v={s.metrics.inbound.receivedUnits.toLocaleString()} k="누적 수령" />
        </div>
        {s.trucks.length ? (
          <div className="lows">
            {s.trucks.map((t) => (
              <div key={t.trfId}>
                <span>{t.trfId}</span>
                <span>{t.state === 'UNLOADING' ? `하차 ${t.unloaded}/${t.lines.length}` : st[t.state]}</span>
                <span>
                  {t.lines.length}품목 {t.lines.reduce((a, l) => a + l.qty, 0)}개
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="note">입고 차량 없음 — 왼쪽 "입고 차량 지금 부르기"</div>
        )}
        <div className="note">옅은 색 롤테이너 = 검수 전, 진한 색 = 수령 등록(TIN) 완료·적치 대기. 냉동·냉장부터 적치합니다.</div>
      </>
    );
  }
  if (zoneKey === 'PK') {
    const active = s.stations.activeCount;
    const busy = s.layout.stations.filter((st, i) => s.stations.isActive(i) && s.stations.occupant(st.id)).length;
    return (
      <>
        <div className="stats">
          <Stat v={`${busy}/${active}`} k="사용 중 패킹대" />
          <Stat v={s.stations.queueLength} k="대기열" />
        </div>
        <div className="note">패킹대 1.6×0.8m, 모듈 2.0×2.2m, 4대씩 두 줄 (MFC 7-5).</div>
      </>
    );
  }
  if (zoneKey === 'SHIP') {
    return (
      <>
        <div className="stats">
          <Stat v={s.shipRack.all().length} k="랙 위 포장" />
          <Stat v={s.riders.length} k="라이더" />
          <Stat v={s.shipRack.overflow} k="랙 초과(바닥)" />
        </div>
        <div className="note">외부 출하대기 랙 2개. 라이더는 안으로 들어오지 않고 QR 스캔으로 인계받습니다 (MFC 5-3).</div>
      </>
    );
  }
  return null;
}

export function ZoneCard() {
  const { sim } = useApp();
  const view = useView();
  useTick();
  const key = view.focusedZone;
  const v = view.views.find((x) => x.key === key);
  const show = !!v && key !== 'ALL';
  const zone = v ? sim.layout.zones.find((z) => z.id === v.zoneId) : undefined;
  return (
    <div className={`card zonecard${show ? ' show' : ''}`}>
      {show && v && (
        <>
          <div className="hd">
            <b>{v.label}</b>
            {zone?.docPyeong ? <span className="note">{zone.docPyeong}평</span> : null}
          </div>
          <ZoneBody zoneKey={key} />
        </>
      )}
    </div>
  );
}

function Row({ k, v, cls = '' }: { k: string; v: ReactNode; cls?: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className={cls}>{v ?? '—'}</dd>
    </>
  );
}

function StateBadge({ color, text }: { color: number; text: string }) {
  return (
    <span className="badge mock" style={{ background: hex(color), color: '#111' }}>
      {text}
    </span>
  );
}

function DetailBody() {
  const { sim, controller } = useApp();
  const sel = controller.selection;
  const close = (
    <button className="x" onClick={() => controller.select(null, false)}>
      ✕
    </button>
  );
  const goto = (sku: string) => controller.select({ kind: 'location', sku });
  if (!sel) return null;
  if (sel.kind === 'location') {
    const k = sim.skuMap.get(sel.sku)!;
    const b = sim.mock?.inventory.get(sel.sku);
    const pct = b ? Math.round((100 * b.shelf) / k.shelfCap) : 0;
    return (
      <>
        <div className="hd">
          <b>로케이션 {k.location.code}</b>
          {close}
        </div>
        <dl>
          <Row k="상품" v={k.name} />
          <Row k="SKU · 바코드" v={`${k.sku} · ${k.barcode}`} />
          <Row k="보관" v={`${TEMP_KO[k.temp]} · ${k.location.level}단 ${k.location.slot}번 칸`} />
          <Row k="백엔드 위치 코드" v={sim.codes.toBackend(k.location.code) ?? '—'} />
          <Row k="칸 종류" v={(BACKEND_FACTS.highTurnoverBins as readonly string[]).includes(k.location.code) ? '고회전(시험용)' : '일반 선반'} />
        </dl>
        {b ? (
          <>
            <div className="bar big">
              <i style={{ width: `${pct}%`, background: hex(TEMP_COLOR[k.temp]) }} />
              <em style={{ left: `${(100 * k.minQty) / k.shelfCap}%` }} />
            </div>
            <div className="note">
              선반 {b.shelf} / 칸 한도 {k.shelfCap} · 최소 {k.minQty} (이하면 자동 보충)
            </div>
            <dl>
              <Row k="보충재고" v={`${b.reserve}개 @ ${k.reserveId}`} />
              <Row k="미적치(하차 칸)" v={`${b.unstowed}개`} />
              <Row k="작업 중" v={`피킹 ${b.picked} · 포장 ${b.packed}`} />
              <Row k="H / E / R / A" v={`${b.H} / ${b.E} / ${b.R} / ${b.E - b.R}`} cls="loc" />
              {b.D ? <Row k="차이 D (실사 전)" v={b.D} /> : null}
            </dl>
            <div className="note">H = 선반 + 보충재고 + 미적치 + 피킹 + 포장{b.D ? ' + D' : ''}. 적치·보충·피킹은 H 를 바꾸지 않고 위치만 바꿉니다.</div>
          </>
        ) : (
          <div className="note">실서버 모드에서는 재고 수량을 볼 수 없습니다 (R-05).</div>
        )}
      </>
    );
  }
  if (sel.kind === 'inbound') {
    const w = sim.inboundWorkers.find((x) => x.id === sel.id);
    if (!w) return null;
    const d = w.pda;
    return (
      <>
        <div className="hd">
          <b>{w.id} · 입고 PDA</b>
          <span>
            <StateBadge color={INBOUND_COLOR[w.state]} text={INBOUND_KO[w.state]} /> {close}
          </span>
        </div>
        {d ? (
          <>
            <div className="note" style={{ color: '#fff', fontWeight: 700 }}>
              {d.title}
            </div>
            <dl>
              {d.rows.map(([k, v], i) => (
                <Row key={i} k={k} v={v} />
              ))}
            </dl>
          </>
        ) : (
          <div className="note">배정된 작업 없음</div>
        )}
        <div className="act">
          {w.activity}
          {d ? ` — ${d.step}` : ''}
        </div>
        <div className="note">
          처리 {w.jobsDone}건 · 이동 {Math.round(w.distance)}m
        </div>
      </>
    );
  }
  const w = sim.siteWorkers().find((x) => x.id === sel.id);
  if (!w) return null;
  const d = w.pda;
  const locSku = w.currentTarget ? sim.catalog.find((k) => k.location === w.currentTarget)?.sku : undefined;
  return (
    <>
      <div className="hd">
        <b>
          {w.id} · PDA-{w.id}
        </b>
        <span>
          <StateBadge color={STATE_COLOR[w.state]} text={STATE_KO[w.state]} /> {close}
        </span>
      </div>
      {d ? (
        <dl>
          <Row k="작업" v={`${d.taskType === 'PICK' ? '피킹' : '패킹'} ${d.taskId}`} />
          <Row k="주문" v={d.orderId} />
          <Row k="진행" v={d.progress} />
          <Row
            k="현재 로케이션"
            v={d.location ? locSku ? <a onClick={() => goto(locSku)}>{d.location}</a> : d.location : null}
            cls="loc"
          />
          <Row k="예정 로케이션" v={d.nextLocation} />
          <Row k="보관방법" v={d.temp} />
          <Row k="상품" v={d.productName} />
          <Row k="바코드" v={d.barcode} />
          <Row k="지시수량" v={d.plannedQty} />
          <Row k="피킹수량" v={d.pickedQty} />
        </dl>
      ) : (
        <div className="note">배정된 작업 없음</div>
      )}
      <div className="act">
        {w.activity}
        {d ? ` — ${d.step}` : ''}
      </div>
      <div className="note">
        처리 {w.ordersDone}건 · 이동 {Math.round(w.distance)}m
      </div>
    </>
  );
}

export function DetailCard() {
  const { sim } = useApp();
  const view = useView();
  useTick();
  const sel = view.selection;
  // 선택한 사람이 사라졌으면(인원 축소) 카드를 닫는다
  const exists =
    !!sel &&
    (sel.kind === 'location' ||
      (sel.kind === 'inbound' ? sim.inboundWorkers.some((x) => x.id === sel.id) : sim.siteWorkers().some((x) => x.id === sel.id)));
  return <div className={`pda${exists ? ' show' : ''}`}>{exists && <DetailBody />}</div>;
}
