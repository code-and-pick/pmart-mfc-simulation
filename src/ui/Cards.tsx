// 확대한 구역 요약 카드, 선택한 작업자 PDA / 로케이션 카드.
import { isInboundAccount, workerShortName, workerRoleName } from '../domain/workerName';
import { orderText } from './OrderNo';
import { useEffect, type ReactNode } from 'react';
import { useApp, useTick, useView } from '../app/context';
import type { TemperatureZone } from '../domain/contract';
import { INBOUND_COLOR, STATE_COLOR, TEMP_COLOR, hex } from '../render/colors';
import { INBOUND_KO, STATE_KO, TEMP_KO } from './text';
import { Barcode } from './Barcode';
import { RealReserveStore, RealZoneStock } from './ZoneStock';
import { BACKEND_FACTS } from '../config';

function Stat({ v, k }: { v: ReactNode; k: string }) {
  return (
    <div>
      <b>{v}</b>
      <span>{k}</span>
    </div>
  );
}

export function ZoneBody({ zoneKey }: { zoneKey: string }) {
  const { sim: s, controller } = useApp();
  const inv = s.mock?.inventory;
  const goto = (sku: string) => controller.select({ kind: 'location', sku });
  const temp: TemperatureZone | null = zoneKey === 'A' ? 'FROZEN' : zoneKey === 'B' ? 'CHILLED' : zoneKey === 'C-H' ? 'AMBIENT' : null;
  // 실서버: 센터 전체 재고로 구역 → 랙 → 단 → 칸
  if (temp && s.board) return <RealZoneStock temp={temp} />;
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
          <Stat v={skus.length.toLocaleString()} k="SKU" />
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
  // 실서버만 — MOCK 보충재고는 칸 단위 재고(fullStock)에 없어 아래 MOCK 요약으로
  if (zoneKey === 'WH' && s.board && !s.mock) return <RealReserveStore />;
  if (zoneKey === 'WH') {
    const res = s.layout.reserves.filter((r) => r.temp === 'AMBIENT');
    const units = inv ? s.catalog.filter((k) => k.temp === 'AMBIENT').reduce((a, k) => a + inv.get(k.sku)!.reserve, 0) : 0;
    return (
      <>
        <div className="stats">
          <Stat v={res.length} k="바닥 팔레트 자리" />
          <Stat v={inv ? units.toLocaleString() : '—'} k="상온 보충재고" />
        </div>
      </>
    );
  }
  if (zoneKey === 'RCV' && s.board) return <RealInboundCard />;
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
          <div className="note">입고 차량 없음</div>
        )}
        {/* 입고 버튼은 설정 탭 한 곳에만(사용자 2026-11-20 "입고예정이랑 가상작업자로 작업하기 버튼은 왜 또 중복으로 뜨고") */}
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
      </>
    );
  }
  return null;
}


/** PDA 카드의 작업 종류 이름 */
const TASK_KO: Record<string, string> = { PICK: '피킹', PACK: '패킹', RETURN: '취소품 복귀', PUTAWAY: '적치', REPLENISH: '보충', MOVE: '재고 이동', INSPECT: '품질검사' };
/** 왼쪽 패널 "구역" — 구역 고르기 칩 + 고른 구역 정보(구역 카드는 떠 있지 않고 여기 고정) */
/**
 * 실서버 입고·검수 카드 — 서버 입고 작업(mfc-inbound GET /inbound-tasks) 그대로: 검사·적치 대기/진행, 상품·수량·위치·담당, 오늘 끝난 수,
 * 입고 차량(그림)·입고 가상 작업자 지금 하는 일. MOCK 숫자(롤테이너·누적 수령)는 실서버에 없어 쓰지 않는다(사용자 2026-11-20 "횡하니 별거 없어").
 */
function RealInboundCard() {
  const { sim: s, controller } = useApp();
  useTick();
  useEffect(() => {
    void s.refreshRealInbound(0);
    const id = setInterval(() => void s.refreshRealInbound(), 5000);
    return () => clearInterval(id);
  }, [s]);
  const r = s.realInbound;
  const real = s.board!;
  const inspect = r.ready.filter((t) => t.taskType === 'INSPECT');
  const put = r.ready.filter((t) => t.taskType === 'PUTAWAY');
  const working = r.ready.filter((t) => t.assigneeId);
  const doneUnits = r.doneToday.reduce((a, t) => a + t.doneQty, 0);
  const rows = [...r.ready].sort((a, b) => Number(!!b.assigneeId) - Number(!!a.assigneeId) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const MAX = 30;
  const name = (id?: string | null) => {
    if (!id) return null;
    // 이 화면의 가상 작업자면 계정 이름(검사 qc-01 등), 아니면 인사 이름, 그것도 모르면 ID 끝
    const v = s.virtualWorkers.find((w) => w.workerId === id);
    if (v) return `${v.account.includes('-qc-') ? '검사' : v.account.includes('-rcv-') ? '적치' : ''} ${v.account.replace('mfcw-', '')}`.trim();
    const n = real.workerName(id);
    return n === '작업자 확인 중' ? `작업자 ${id.slice(-4)}` : n.split(' · ')[0];
  };
  const inb = s.inboundVirtual();
  const st: Record<string, string> = { APPROACHING: '진입 중', DOCKED: '도착', UNLOADING: '하차 중', DONE: '수령 완료', LEAVING: '출발', GONE: '' };
  return (
    <>
      <div className="stats">
        <Stat v={inspect.length} k="품질검사 대기" />
        <Stat v={put.length} k="적치 대기" />
        <Stat v={working.length} k="담당 있음(진행)" />
        <Stat v={`${r.doneToday.length}건 · ${doneUnits.toLocaleString()}개`} k="오늘 끝남" />
      </div>
      {s.trucks.length > 0 && (
        <div className="lows">
          {s.trucks.map((t) => (
            <div key={t.trfId}>
              <span>🚚 {t.trfId}</span>
              <span>{st[t.state]}</span>
              <span>{t.lines.length}품목 {t.lines.reduce((a, l) => a + l.qty, 0)}개</span>
            </div>
          ))}
        </div>
      )}
      {inb.length > 0 && (
        <div className="rin-ws">
          {inb.map((w) => (
            <div key={w.account} className={w.lastProblem ? 'bad' : ''}>
              <b>{w.account.includes('-qc-') ? '검사' : '적치'} {w.account.replace('mfcw-', '')}</b> {w.activity}
              {w.lastProblem && <span> · {w.lastProblem}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="rin-h">
        <b>입고 작업</b>
        <span className="muted">{r.readAt ? `${new Date(r.readAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit' })} 읽음` : '읽는 중…'}</span>
      </div>
      {r.error && <div className="note warn">읽지 못함: {r.error}</div>}
      {!rows.length && r.readAt && !r.error && <div className="scan-empty">남은 입고 작업이 없습니다. 설정 → 재고 채우기로 입고를 넣으면 여기에 품질검사·적치 작업이 생깁니다.</div>}
      <div className="rin-list">
        {rows.slice(0, MAX).map((t) => {
          const who = name(t.assigneeId);
          return (
            <button key={t.taskId} className={`rin-row ${t.assigneeId ? 'on' : ''}`} onClick={() => controller.focusBackendCode?.(t.locationCode)} title={t.taskId}>
              <span className={`rin-k ${t.taskType === 'INSPECT' ? 'qc' : 'put'}`}>{t.taskType === 'INSPECT' ? '검사' : '적치'}</span>
              <span className="rin-n">{t.productName ?? t.sku}</span>
              <span className="rin-q">
                {t.doneQty}/{t.plannedQty}
              </span>
              <span className={`rin-w ${who ? '' : 'muted'}`}>{who ?? '대기'}</span>
            </button>
          );
        })}
      </div>
      {rows.length > MAX && <div className="note">외 {rows.length - MAX}건</div>}
    </>
  );
}

export function ZonePanel() {
  const { sim } = useApp();
  const view = useView();
  useTick();
  const key = view.focusedZone;
  const v = view.views.find((x) => x.key === key);
  const zone = v ? sim.layout.zones.find((z) => z.id === v.zoneId) : undefined;
  return (
    <section className="sec zone-panel">
      <div className="chips zone-chips">
        {view.views
          .filter((x) => x.key !== 'ALL')
          .map((x) => (
            <button key={x.key} className={x.key === key ? 'on' : ''} onClick={() => view.focusZone(x.key)}>
              {x.label}
            </button>
          ))}
      </div>
      {v && key !== 'ALL' ? (
        <>
          <h4 className="zone-h">
            {v.label}
            {zone?.docPyeong ? <span>{zone.docPyeong}평</span> : null}
          </h4>
          <ZoneBody zoneKey={key} />
        </>
      ) : (
        <div className="scan-empty">구역을 고르면(위 칩 또는 3D 바닥) 랙 수·적치 수량·랙별·단별 재고가 여기에 나옵니다.</div>
      )}
    </section>
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
  const following = controller.follow !== null && controller.follow === (sel.kind === 'location' ? null : sel.id);
  const follow = (
    <button className={`follow ${following ? 'on' : ''}`} title="카메라가 이 사람을 따라갑니다(왼쪽 끌기로 화면을 옮기면 꺼짐)" onClick={() => controller.setFollow(!following)}>
      {following ? '따라가는 중' : '따라가기'}
    </button>
  );
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
        {sim.codes.toBackend(k.location.code) && <Barcode value={sim.codes.toBackend(k.location.code)!} caption="위치 바코드 (PDA 스캔 값)" height={48} />}
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
          <b>{workerShortName(w.id)} · 입고 PDA</b>
          <span>
            <StateBadge color={INBOUND_COLOR[w.state]} text={INBOUND_KO[w.state]} /> {follow} {close}
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
  const inb = isInboundAccount(w.id);
  const locSku = w.currentTarget ? sim.catalog.find((k) => k.location === w.currentTarget)?.sku : undefined;
  return (
    <>
      <div className="hd">
        <b title={w.id}>{workerRoleName(w.id, w.state)}</b>
        <span>
          <StateBadge color={STATE_COLOR[w.state]} text={STATE_KO[w.state]} /> {follow} {close}
        </span>
      </div>
      {d ? (
        <dl>
          {/* 작업 ID(긴 시스템 ID)는 겉에 내지 않는다 — ADR-0070 */}
          <Row k="작업" v={TASK_KO[d.taskType] ?? d.taskType} />
          {inb ? null : <Row k="주문" v={d.shipmentId && sim.board ? orderText(sim.board.orderNumberOf(d.shipmentId), d.shipmentId) : d.orderId && d.orderId.length > 12 ? orderText(null, d.orderId) : d.orderId} />}
          {inb ? null : <Row k="진행" v={d.progress} />}
          <Row
            k={inb ? '지금 위치' : '현재 로케이션'}
            v={d.location ? locSku ? <a onClick={() => goto(locSku)}>{d.location}</a> : d.location : null}
            cls="loc"
          />
          <Row k={inb ? '보낼 곳' : '예정 로케이션'} v={inb && d.location ? (d.nextLocation ?? d.location) : d.nextLocation} />
          <Row k="보관방법" v={d.temp} />
          <Row k="상품" v={d.productName} />
          <Row k="바코드" v={d.barcode} />
          <Row k="지시수량" v={d.plannedQty} />
          <Row k={inb ? '끝낸 수량' : '피킹수량'} v={d.pickedQty} />
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
  // 실서버에서 점원을 누르면 오른쪽 실제 주문이 그 점원 주문을 보인다 — 떠 있는 점원 카드는 띄우지 않는다(사용자 2026-11-20 "팝업창이 왜 계속 남아있어")
  const exists =
    !!sel &&
    !(sel.kind === 'worker' && sim.board) &&
    (sel.kind === 'location' ||
      (sel.kind === 'inbound' ? sim.inboundWorkers.some((x) => x.id === sel.id) : sim.siteWorkers().some((x) => x.id === sel.id)));
  return <div className={`pda${exists ? ' show' : ''}`}>{exists && <DetailBody />}</div>;
}
