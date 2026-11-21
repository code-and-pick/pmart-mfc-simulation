// 실서버 구역 재고 — 구역 → 랙 → 단 → 칸(상품·수량). 센터 전체 재고(inventory 0.33.0 stock-units, R-15)를 평면 칸에 맞춰 센다.
// 사용자 2026-11-20 "구역별 랙갯수랑 적치 상품 갯수랑 랙별 상품 갯수랑 단별 적치 제품 및 갯수를 어디서 볼 수 있니"
import { WORK_SHORT, placeShortName, reserveName } from '../domain/placeName';

const placeShortNameSafe = (code: string) => placeShortName(code);
import { useEffect, useState } from 'react';
import { useApp, useView } from '../app/context';
import type { TemperatureZone } from '../domain/contract';

const QUALITY_KO: Record<string, string> = { NORMAL: '정상', QUARANTINED: '격리', PENDING_INSPECTION: '검수 전', PENDING: '판정 전' };
const WORK_KO: Record<string, string> = WORK_SHORT;

/** 3D 에서 누른 칸 — 칸 코드·위치(랙·단) + 상품마다 이름·SKU·LOT·기한·상태·수량. 보충재고 팔레트도 같은 카드 */
export function CellCard({ code }: { code: string }) {
  const { sim, controller } = useApp();
  const rows = sim.board!.fullStock.filter((u) => u.locationCode === code);
  const loc = sim.backendLocation(code);
  const rack = loc ? sim.layout.racks.find((r) => r.id === loc.rackId) : undefined;
  const total = rows.reduce((a, u) => a + u.qty, 0);
  return (
    <div className="cellcard">
      <div className="cc-h">
        <b>{code}</b>
        <span>
          {rack ? `${rack.group}-${String(rack.rackNo).padStart(2, '0')} · ${loc!.level}단` : (placeShortNameSafe(code))} · {total}개
        </span>
        <button className="place-x" onClick={() => controller.focusCell(null)} aria-label="닫기">
          ✕
        </button>
      </div>
      {rows.length ? (
        rows.map((u) => (
          <div key={`${u.sku}:${u.lotId}`} className="cc-item">
            <div className="nm">{u.productName ?? u.sku}</div>
            <div className="meta">
              <span>{u.sku}</span>
              {u.lotNo && <span>LOT {u.lotNo}</span>}
              {u.expiryDate && <span>기한 {u.expiryDate}</span>}
              <span className={u.qualityState !== 'NORMAL' ? 'bad' : ''}>{QUALITY_KO[u.qualityState] ?? u.qualityState}</span>
              <span>{WORK_KO[u.workState] ?? u.workState}</span>
              <b>{u.qty}개</b>
            </div>
          </div>
        ))
      ) : (
        <div className="zst-none">이 칸은 비어 있습니다</div>
      )}
    </div>
  );
}

export function RealZoneStock({ temp }: { temp: TemperatureZone }) {
  const { sim, controller } = useApp();
  const view = useView();
  const [open, setOpen] = useState<string | null>(null);
  const real = sim.board!;
  // 3D 에서 칸을 누르면 그 랙을 펼친다
  const focusRack = view.cellFocus ? (sim.backendLocation(view.cellFocus)?.rackId ?? null) : null;
  useEffect(() => {
    if (focusRack) setOpen(focusRack);
  }, [focusRack, view.cellFocus]);
  // 3D 노란 번호판과 같은 이름(C02-01)으로, 그 순서대로
  const label = (r: { group: string; rackNo: number }) => `${r.group}-${String(r.rackNo).padStart(2, '0')}`;
  const racks = sim.layout.racks.filter((r) => r.temp === temp).sort((a, b) => label(a).localeCompare(label(b)));
  const cells = sim.layout.locationsByTemp[temp].length;
  const byRack = sim.rackStock();
  let qty = 0;
  let filled = 0;
  const skus = new Set<string>();
  for (const r of racks) {
    const st = byRack.get(r.id);
    if (!st) continue;
    qty += st.qty;
    st.skus.forEach((k) => skus.add(k));
    for (const lv of st.levels.values()) filled += new Set(lv.map((x) => x.code)).size;
  }
  const loaded = real.fullStockVersion > 0;
  // 카테고리별(대분류) 수량·상품 종류 — 이 구역 선반 재고를 상품 카테고리로(사용자 2026-11-20 "카테고리별 상품수량도 보게해줘")
  const cats = new Map<string, { qty: number; skus: Set<string> }>();
  for (const r of racks) {
    const st = byRack.get(r.id);
    if (!st) continue;
    for (const lv of st.levels.values())
      for (const x of lv) {
        const name = real.skuCategory.get(x.sku) ?? '분류 읽는 중';
        const c = cats.get(name) ?? { qty: 0, skus: new Set<string>() };
        c.qty += x.qty;
        c.skus.add(x.sku);
        cats.set(name, c);
      }
  }
  const catRows = [...cats.entries()].sort((a, b) => b[1].qty - a[1].qty);
  const catMax = Math.max(1, ...catRows.map(([, c]) => c.qty));
  const stats: [string, string][] = [
    ['랙', racks.length.toLocaleString()],
    ['적치 수량', loaded ? qty.toLocaleString() : '…'],
    ['상품 종류', loaded ? skus.size.toLocaleString() : '…'],
    ['재고 있는 칸', loaded ? `${filled.toLocaleString()}/${cells.toLocaleString()}` : '…'],
  ];
  return (
    <div className="zst">
      {view.cellFocus && (sim.backendLocation(view.cellFocus) ?? sim.backendReserve(view.cellFocus))?.temp === temp && <CellCard code={view.cellFocus} />}
      <div className="stats four">
        {stats.map(([k, v]) => (
          <div key={k} className="stat">
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
      {real.fullStockError && <div className="note warn">재고를 못 읽음 — 다음 조회에서 다시</div>}
      {/* MOCK 은 카테고리 서버가 없어 "분류 읽는 중"에 머문다 — 실서버만 */}
      {loaded && !sim.mock && catRows.length > 0 && (
        <>
          <div className="zst-h">
            <span>카테고리별</span>
            <span>{catRows.length}개 분류</span>
          </div>
          <div className="zst-cats">
            {catRows.map(([name, c]) => (
              <div key={name} className="zst-cat">
                <span className="nm">{name}</span>
                <span className="bar">
                  <i style={{ width: `${(100 * c.qty) / catMax}%` }} />
                </span>
                <span className="k">{c.skus.size}종</span>
                <b>{c.qty.toLocaleString()}</b>
              </div>
            ))}
          </div>
        </>
      )}
      {temp !== 'AMBIENT' && !sim.mock && <ReservePallets temp={temp} />}
      <div className="zst-h">
        <span>랙별</span>
        <span>{loaded ? `${new Date(real.fullStockReadMs).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })} 기준` : '읽는 중'}</span>
      </div>
      <div className="zst-list">
        {racks.map((r) => {
          const st = byRack.get(r.id);
          const on = open === r.id;
          return (
            <div key={r.id} className={`zst-rack ${on ? 'on' : ''} ${st ? '' : 'empty'}`}>
              <button className="zst-r" onClick={() => setOpen(on ? null : r.id)}>
                <span className="id">{label(r)}</span>
                <span className="k">{st ? `${st.skus.size}종` : '비어 있음'}</span>
                <b>{st ? st.qty.toLocaleString() : 0}</b>
                <span className="chev">{on ? '⌄' : '›'}</span>
              </button>
              {on && (
                <div className="zst-lv">
                  {Array.from({ length: r.levels }, (_, i) => r.levels - i).map((lv) => {
                    const rows = st?.levels.get(lv) ?? [];
                    return (
                      <div key={lv} className="zst-level">
                        <div className="lvh">
                          {lv}단 <span>{rows.reduce((a, x) => a + x.qty, 0)}개</span>
                        </div>
                        {rows.length ? (
                          rows
                            .sort((a, b) => a.code.localeCompare(b.code))
                            .map((x) => (
                              <button
                                key={`${x.code}:${x.sku}`}
                                className={`zst-cell ${view.cellFocus === x.code ? 'on' : ''}`}
                                onClick={() => {
                                  controller.focusBackendCode(x.code);
                                  controller.focusCell(x.code);
                                }}
                                title="3D 에서 그 칸으로"
                              >
                                <span className="code">{x.code}</span>
                                <span className="nm">{x.name}</span>
                                {x.quarantined && <span className="q">격리</span>}
                                <b>{x.qty}</b>
                              </button>
                            ))
                        ) : (
                          <div className="zst-none">비어 있음</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 보충재고 팔레트 목록 — 자리마다 상품 종류·수량, 누르면 그 팔레트 카드(사용자 2026-11-21 "BR-1 WR-16 이런 애들은 클릭해도 수량도 안나오고") */
/**
 * 그 온도대 입고재고·보충재고 수(사용자 2026-11-21 정의):
 * 입고재고 = 들여왔지만 검수 전(품질 PENDING_INSPECTION, 입고칸 RCV-), 보충재고 = 검수 끝·바로 적치 가능(입고칸의 정상 적치 전) + 보충재고 칸 보관.
 * 상품 온도대는 재고 줄 값, 없으면 그 상품이 놓인 선반 칸의 온도대.
 */
export function inboundSplit(sim: ReturnType<typeof useApp>['sim'], temp: TemperatureZone): { incoming: number; reserve: number } {
  const real = sim.board!;
  const skuTemp = new Map<string, TemperatureZone>();
  for (const u of real.fullStock) {
    const z = u.temperatureZone;
    const t = (z === 'AMBIENT' || z === 'CHILLED' || z === 'FROZEN' ? z : null) ?? sim.backendLocation(u.locationCode)?.temp ?? sim.backendReserve(u.locationCode)?.temp;
    if (t && !skuTemp.has(u.sku)) skuTemp.set(u.sku, t);
  }
  let incoming = 0;
  let reserve = 0;
  for (const u of real.fullStock) {
    if (u.qty <= 0 || skuTemp.get(u.sku) !== temp) continue;
    if (u.locationCode.startsWith('RCV-') && u.workState === 'UNSTOWED') {
      if (u.qualityState === 'PENDING_INSPECTION') incoming += u.qty;
      else if (u.qualityState === 'NORMAL') reserve += u.qty;
    } else if (u.workState === 'STORED' && sim.backendReserve(u.locationCode)?.role === 'RESERVE') reserve += u.qty;
  }
  return { incoming, reserve };
}

export function ReservePallets({ temp }: { temp: TemperatureZone }) {
  const { sim, controller } = useApp();
  const view = useView();
  const real = sim.board!;
  const split = inboundSplit(sim, temp);
  const spots = sim.layout.reserves.filter((r) => r.temp === temp && r.role === 'RESERVE');
  const rows = spots.map((rs) => {
    const code = sim.reserveCode(rs) ?? rs.id;
    const units = real.fullStock.filter((u) => u.locationCode === code && u.qty > 0);
    return { code, qty: units.reduce((a, u) => a + u.qty, 0), skus: new Set(units.map((u) => u.sku)).size };
  });
  const used = rows.filter((r) => r.qty > 0);
  const rcv = sim.layout.reserves.find((r) => r.temp === temp && r.role === 'RECEIVING');
  const rcvCode = rcv ? sim.reserveCode(rcv) : temp === 'AMBIENT' ? 'RCV-A-01' : null;
  return (
    <>
      {/* 입고재고(검수 전) · 보충재고(검수 끝·적치 대기 + 보충재고 칸) — 누르면 입고칸 카드 */}
      <div className="zst-split">
        <button className="in" onClick={() => (rcv && rcvCode ? controller.clickCell(rcvCode, 0) : rcvCode && controller.focusBackendCode(rcvCode))} title={rcvCode ?? ''} disabled={!rcvCode}>
          <span>입고재고 · 검수 전</span>
          <b>{split.incoming.toLocaleString()}</b>
        </button>
        <div className="rs">
          <span>보충재고 · 검수 끝</span>
          <b>{split.reserve.toLocaleString()}</b>
        </div>
      </div>
      <div className="zst-h">
        <span>{temp === 'AMBIENT' ? '입고창고 팔레트' : '보충재고 팔레트'}</span>
        <span>
          {used.length}/{rows.length}자리 · {used.reduce((a, r) => a + r.qty, 0).toLocaleString()}개
        </span>
      </div>
      <div className="zst-pallets">
        {rows.map((r) => (
          <button
            key={r.code}
            className={`zst-pal ${r.qty ? '' : 'empty'} ${view.cellFocus === r.code ? 'on' : ''}`}
            onClick={() => controller.clickCell(r.code, 0)}
            title={r.code}
          >
            <span className="nm">{reserveName(r.code) ?? r.code}</span>
            <b>{r.qty ? r.qty.toLocaleString() : '—'}</b>
            {r.qty > 0 && <span className="k">{r.skus}종</span>}
          </button>
        ))}
      </div>
    </>
  );
}

/** 입고창고 구역 패널(실서버) — 상온 보충재고 팔레트 */
export function RealReserveStore() {
  const { sim } = useApp();
  const view = useView();
  const focused = view.cellFocus && sim.backendReserve(view.cellFocus)?.temp === 'AMBIENT' ? view.cellFocus : null;
  return (
    <div className="zst">
      {focused && <CellCard code={focused} />}
      <ReservePallets temp="AMBIENT" />
    </div>
  );
}
