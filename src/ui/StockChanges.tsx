// 재고 변동 탭 — 재고 실시간 스트림으로 주문 예약·인계 차감·취소 해제·회수 검수 정상 증가를 바로 본다(사용자 2026-11-25)
import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import type { FeedKind, FeedRow } from '../sim/stockFeed';

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
    </div>
  );
}
