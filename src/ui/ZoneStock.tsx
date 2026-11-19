// 실서버 구역 재고 — 구역 → 랙 → 단 → 칸(상품·수량). 센터 전체 재고(inventory 0.33.0 stock-units, R-15)를 평면 칸에 맞춰 센다.
// 사용자 2026-11-20 "구역별 랙갯수랑 적치 상품 갯수랑 랙별 상품 갯수랑 단별 적치 제품 및 갯수를 어디서 볼 수 있니"
import { useState } from 'react';
import { useApp } from '../app/context';
import type { TemperatureZone } from '../domain/contract';

export function RealZoneStock({ temp }: { temp: TemperatureZone }) {
  const { sim, controller } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const real = sim.real!;
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
  const stats: [string, string][] = [
    ['랙', racks.length.toLocaleString()],
    ['적치 수량', loaded ? qty.toLocaleString() : '…'],
    ['상품 종류', loaded ? skus.size.toLocaleString() : '…'],
    ['재고 있는 칸', loaded ? `${filled.toLocaleString()}/${cells.toLocaleString()}` : '…'],
  ];
  return (
    <div className="zst">
      <div className="stats four">
        {stats.map(([k, v]) => (
          <div key={k} className="stat">
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
      {real.fullStockError && <div className="note warn">재고를 못 읽음 — 다음 조회에서 다시</div>}
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
                              <button key={`${x.code}:${x.sku}`} className="zst-cell" onClick={() => controller.focusBackendCode(x.code)} title="3D 에서 그 칸으로">
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
