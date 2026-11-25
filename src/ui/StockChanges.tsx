// 재고 변동 탭 — 재고 실시간 스트림으로 주문 예약·인계 차감·취소 해제·회수 검수 정상 증가를 바로 본다(사용자 2026-11-25)
import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import type { FeedKind, FeedRow, SkuNow, StockFeed } from '../sim/stockFeed';

const GROUPS: [string, string, FeedKind[] | null][] = [
  ['all', '전체', null],
  ['out', '주문·인계', ['ORDER', 'HANDOVER', 'CANCEL']],
  ['back', '회수·복귀', ['RETURN_IN', 'RETURN_OK', 'CANCEL_RETURN']],
  ['in', '입고', ['INBOUND']],
  ['etc', '그 밖', ['OTHER', 'MOVE']],
];

/** 위 큰 숫자 4개 — 연결 뒤 합계 */
const TILES: [FeedKind, string, string][] = [
  ['ORDER', '주문 예약', '판매 가능에서 빠짐'],
  ['HANDOVER', '라이더 인계', '보유에서 빠짐'],
  ['CANCEL', '주문 취소', '판매 가능으로 돌아옴'],
  ['RETURN_OK', '회수 검수 정상', '판매 가능으로 늘어남'],
];

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour12: false });

export function StockChanges() {
  const { sim } = useApp();
  const feed = sim.stockFeed;
  const [group, setGroup] = useState('all');
  const [moves, setMoves] = useState(false);
  // 전체 재고(지금 값, 바뀐 상품이 위·반짝) | 변동 기록(한 줄씩) — 사용자 2026-11-25 "전체 재고에서 바뀌는 것도 보여야지"
  const [view, setView] = useState<'all' | 'log'>('all');
  const [q, setQ] = useState('');
  const real = sim.board;
  const fullVer = real?.fullStockVersion ?? 0;
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of real?.fullStock ?? []) if (u.productName && !m.has(u.sku)) m.set(u.sku, u.productName);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, fullVer]);
  if (!feed) return <div className="note">실서버 화면에서만 봅니다(재고 실시간 스트림).</div>;
  const nameOf = (sku: string) => names.get(sku) ?? sim.productName(sku);
  const kinds = GROUPS.find((g) => g[0] === group)?.[2] ?? null;
  // 수량이 그대로인 줄(위치·작업 상태만 바뀜)은 "위치 이동도"를 켤 때만
  const shown: FeedRow[] = [];
  for (let i = feed.rows.length - 1; i >= 0 && shown.length < 200; i--) {
    const r = feed.rows[i];
    if (kinds && !kinds.includes(r.kind)) continue;
    if (!moves && r.availableDelta === 0 && r.onHandDelta === 0) continue;
    shown.push(r);
  }
  const st =
    feed.state === 'open'
      ? ['ok', '● 실시간 연결됨']
      : feed.state === 'connecting'
        ? ['wait', '○ 연결 중…']
        : feed.state === 'retry'
          ? ['bad', `○ 끊김 — 다시 붙는 중${feed.stateWhy ? ` (${feed.stateWhy})` : ''}`]
          : ['wait', '○ 아직 연결 안 함'];
  return (
    <div className="sfd">
      <div className={`sfd-st ${st[0]}`}>
        {st[1]}
        {feed.sinceMs && <span> · {hhmmss(feed.sinceMs)}부터 셈</span>}
        {feed.gapAtMs && <span className="gap"> · {hhmmss(feed.gapAtMs)}에 놓친 변동이 있을 수 있음</span>}
      </div>
      <div className="sfd-tiles">
        {TILES.map(([k, t, sub]) => {
          const v = feed.totals.get(k);
          return (
            <div key={k} className={`sfd-tile k-${k}`}>
              <b>{v ? sign(v.units) : '0'}</b>
              <span>{t}</span>
              <small>
                {v?.n ?? 0}번 · {sub}
              </small>
            </div>
          );
        })}
      </div>
      <div className="sfd-v">
        <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>
          전체 재고
        </button>
        <button className={view === 'log' ? 'on' : ''} onClick={() => setView('log')}>
          변동 기록
        </button>
      </div>
      {view === 'all' ? <AllStock feed={feed} q={q} setQ={setQ} nameOf={nameOf} /> : (
      <>
      <div className="sfd-f">
        {GROUPS.map(([k, t]) => (
          <button key={k} className={group === k ? 'on' : ''} onClick={() => setGroup(k)}>
            {t}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={moves} onChange={(e) => setMoves(e.target.checked)} /> 위치 이동도
        </label>
      </div>
      {shown.length === 0 && (
        <div className="note">{feed.state === 'open' ? '아직 바뀐 재고가 없습니다. 주문이 들어오거나 인계·회수가 되면 여기에 바로 뜹니다.' : '연결되면 바뀐 재고가 여기에 뜹니다.'}</div>
      )}
      {shown.map((r) => {
        // 인계·입고·회수 반입은 보유가 바뀌는 게 뜻이고, 나머지는 판매 가능
        const byHand = r.kind === 'HANDOVER' || r.kind === 'INBOUND' || r.kind === 'RETURN_IN';
        const main = byHand ? r.onHandDelta : r.availableDelta;
        return (
          <div key={r.key} className={`sfd-r k-${r.kind}`} title={`${r.sku} · ${r.cause}`}>
            <div className="sfd-r1">
              <span className="sfd-t">{hhmmss(r.atMs)}</span>
              <span className="sfd-c">{r.label}</span>
              <span className={`sfd-d ${main > 0 ? 'up' : main < 0 ? 'dn' : ''}`}>
                <small>{byHand ? '보유' : '판매 가능'}</small> {main === 0 ? '±0' : sign(main)}
              </span>
            </div>
            <div className="sfd-r2">
              <span className="nm">{nameOf(r.sku)}</span>
              <span className="now">
                지금 판매 가능 <b>{r.after.A}</b> · 보유 {r.after.H}
                {r.after.R ? ` · 예약 ${r.after.R}` : ''}
                {r.after.Q ? ` · 격리 ${r.after.Q}` : ''}
              </span>
            </div>
          </div>
        );
      })}
      </>
      )}
    </div>
  );
}

/** 막 바뀐 상품을 몇 초 동안 반짝 */
const FRESH_MS = 60_000;

/** 전체 재고 — 센터 합계 + 상품마다 지금 값. 최근 바뀐 상품이 위(바뀐 양·원인), 나머지는 이름 순 */
function AllStock({ feed, q, setQ, nameOf }: { feed: StockFeed; q: string; setQ: (v: string) => void; nameOf: (sku: string) => string }) {
  const now = Date.now();
  const all = [...feed.skus.values()];
  const tot = all.reduce((a, x) => ({ H: a.H + x.H, A: a.A + x.A, R: a.R + x.R, Q: a.Q + x.Q, out: a.out + (x.A <= 0 ? 1 : 0) }), { H: 0, A: 0, R: 0, Q: 0, out: 0 });
  const needle = q.trim().toLowerCase();
  const name = (x: SkuNow) => x.name ?? nameOf(x.sku);
  const list = (needle ? all.filter((x) => name(x).toLowerCase().includes(needle) || x.sku.toLowerCase().includes(needle)) : all).sort(
    (a, b) => (b.changedAtMs ?? 0) - (a.changedAtMs ?? 0) || name(a).localeCompare(name(b)),
  );
  const shown = list.slice(0, 300);
  const snap = feed.snapshot;
  return (
    <>
      <div className="sfd-sum">
        <div>
          <b>{tot.A.toLocaleString()}</b>
          <small>판매 가능</small>
        </div>
        <div>
          <b>{tot.H.toLocaleString()}</b>
          <small>보유</small>
        </div>
        <div>
          <b>{tot.R.toLocaleString()}</b>
          <small>예약</small>
        </div>
        <div>
          <b>{tot.Q.toLocaleString()}</b>
          <small>격리</small>
        </div>
        <div className={tot.out ? 'w' : ''}>
          <b>{tot.out}</b>
          <small>품절 상품</small>
        </div>
      </div>
      <div className="sfd-snap">
        {all.length}개 상품
        {snap?.state === 'busy' && ' · 센터 재고 읽는 중…'}
        {snap?.state === 'done' && ` · ${hhmmss(snap.atMs)}에 읽은 뒤 실시간`}
        {snap?.state === 'error' && <span className="bad"> · 센터 재고 읽기 실패({snap.why}) — 바뀐 상품만 보임</span>}
      </div>
      <input className="stk-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="상품 찾기 — 이름 또는 SKU" />
      <table className="sfd-tbl">
        <thead>
          <tr>
            <th>상품</th>
            <th>판매 가능</th>
            <th>보유</th>
            <th>예약</th>
            <th>격리</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((x) => {
            const fresh = x.changedAtMs !== undefined && now - x.changedAtMs < FRESH_MS;
            const dA = x.lastAvailableDelta ?? 0;
            const dH = x.lastOnHandDelta ?? 0;
            return (
              <tr key={x.sku} className={`${fresh ? 'fresh' : ''} ${x.A <= 0 ? 'out' : ''}`} title={x.sku}>
                <td>
                  <div className="nm">{name(x)}</div>
                  {x.changedAtMs !== undefined && (
                    <div className="chg">
                      {hhmmss(x.changedAtMs)} {x.lastLabel}
                    </div>
                  )}
                </td>
                <td className="n">
                  <b>{x.A}</b>
                  {x.changedAtMs !== undefined && dA !== 0 && <span className={dA > 0 ? 'up' : 'dn'}>{sign(dA)}</span>}
                </td>
                <td className="n">
                  {x.H}
                  {x.changedAtMs !== undefined && dH !== 0 && <span className={dH > 0 ? 'up' : 'dn'}>{sign(dH)}</span>}
                </td>
                <td className="n">{x.R || ''}</td>
                <td className="n">{x.Q || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.length > shown.length && <div className="note">앞 {shown.length}개만 — 상품 찾기로 좁히세요.</div>}
    </>
  );
}
