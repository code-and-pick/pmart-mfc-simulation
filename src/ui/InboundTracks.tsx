// 입고 추적 탭 — DC(CDC) 이관 입고·센터 발주 입고를 한 건씩: 오는 중 → 도착·하차 → 수령·검사 → 적치 → 끝,
// 품목마다 예정·받음·적치·입고칸 남은 양·놓인 칸, 위에는 오늘 입고로 늘어난 재고(사용자 2026-11-26 "DC에서 입고 받은 거 적치하고, 입고받아서 추가되는 재고 추적")
import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { STEP_KO, sumLines, type InboundTrack, type TrackStage } from '../sim/inboundTrack';

const STEPS: TrackStage[] = ['EXPECTED', 'ARRIVED', 'RECEIVED', 'STOWING', 'DONE'];

export function InboundTracks() {
  const { sim } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; ok: boolean; text: string } | null>(null);
  // 화면이 열려 있는 동안만 읽는다(스스로 간격을 지킨다)
  useEffect(() => {
    void sim.refreshInboundTracks(0);
    const t = setInterval(() => void sim.refreshInboundTracks(), 2000);
    return () => clearInterval(t);
  }, [sim]);
  const r = sim.inboundTracks;
  const items = r.items;
  const got = items.reduce(
    (a, t) => {
      const s = sumLines(t.lines);
      return { received: a.received + s.received, stowed: a.stowed + s.stowed, atDock: a.atDock + s.atDock, n: a.n + (s.received > 0 ? 1 : 0) };
    },
    { received: 0, stowed: 0, atDock: 0, n: 0 },
  );
  const act = async (t: InboundTrack, withVirtual: boolean) => {
    setBusy(t.key);
    setMsg(null);
    try {
      const res = await sim.receiveDc(t.id, withVirtual);
      setMsg({ key: t.key, ok: true, text: res.queued ? `가상 작업자가 하차 중 — 다 내리면 수령 → 검사 → 적치` : `수령 ${res.units}개 — 검사·적치는 PDA` });
      void sim.refreshInboundTracks(0);
    } catch (e) {
      setMsg({ key: t.key, ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="itk">
      <div className="itk-sum">
        <div>
          <b>+{got.received.toLocaleString()}</b>
          <small>받은 재고(보유)</small>
        </div>
        <div className="ok">
          <b>+{got.stowed.toLocaleString()}</b>
          <small>적치 끝(판매 가능)</small>
        </div>
        <div className={got.atDock ? 'w' : ''}>
          <b>{got.atDock.toLocaleString()}</b>
          <small>아직 입고칸</small>
        </div>
      </div>
      {r.error && <div className="itk-err">읽기 실패 — {r.error}</div>}
      {!items.length && <div className="note">{r.loading || r.readAt === null ? '읽는 중…' : sim.mode === 'mock' ? '아직 입고 차량이 없습니다. 왼쪽 "입고 차량 지금 부르기"로 부르면 여기서 따라갑니다.' : '들어올 입고도, 오늘 받은 입고도 없습니다.'}</div>}
      {items.map((t) => {
        const s = sumLines(t.lines);
        const at = STEPS.indexOf(t.stage);
        const canReceive = sim.mode !== 'mock' && t.kind === 'DC' && (t.serverState === 'EXPECTED' || t.serverState === 'RECEIVING') && !t.blockedWhy && t.stage !== 'ARRIVED';
        return (
          <div key={t.key} className={`itk-c s-${t.stage}`}>
            <div className="itk-h" title={t.id} onClick={() => setOpen(open === t.key ? null : t.key)}>
              <b>{t.kind === 'DC' ? `DC 입고${t.from ? ` · ${t.from}` : ''}` : '센터 발주 입고'}</b>
              <span>
                {t.lines.length}품목 {s.expected.toLocaleString()}개
              </span>
            </div>
            {t.stage === 'CANCELLED' ? (
              <div className="itk-why">취소·종결됨</div>
            ) : (
              <div className="itk-steps">
                {STEPS.map((k, i) => (
                  <span key={k} className={i < at ? 'done' : i === at ? 'now' : ''}>
                    <i />
                    {STEP_KO[k]}
                  </span>
                ))}
              </div>
            )}
            <div className="itk-q" onClick={() => setOpen(open === t.key ? null : t.key)}>
              <span>
                받음 <b>{s.received.toLocaleString()}</b> / {s.expected.toLocaleString()}
              </span>
              <span>
                적치 <b className="ok">{s.stowed.toLocaleString()}</b>
              </span>
              {s.atDock > 0 && (
                <span>
                  입고칸 <b className="w">{s.atDock.toLocaleString()}</b>
                </span>
              )}
              {s.quarantined > 0 && (
                <span>
                  격리 <b className="bad">{s.quarantined}</b>
                </span>
              )}
              <span className="itk-more">{open === t.key ? '접기' : '품목 보기'}</span>
            </div>
            {t.blockedWhy && <div className="itk-why">{t.blockedWhy}</div>}
            {canReceive && (
              <div className="itk-a">
                <button disabled={busy === t.key} onClick={() => void act(t, true)}>
                  가상 작업자로 받기
                </button>
                <button disabled={busy === t.key} onClick={() => void act(t, false)}>
                  바로 수령(PDA)
                </button>
              </div>
            )}
            {msg?.key === t.key && <div className={msg.ok ? 'itk-ok' : 'itk-err'}>{msg.text}</div>}
            {open === t.key && (
              <table className="itk-t">
                <thead>
                  <tr>
                    <th>상품</th>
                    <th>예정</th>
                    <th>받음</th>
                    <th>적치</th>
                    <th>입고칸</th>
                  </tr>
                </thead>
                <tbody>
                  {t.lines.map((l) => (
                    <tr key={l.sku}>
                      <td className="nm" title={l.sku}>
                        {l.name ?? l.sku}
                        {l.placed.length > 0 && <div className="loc">{l.placed.map((p) => `${p.loc} ${p.qty}개`).join(' · ')}</div>}
                      </td>
                      <td>{l.expected}</td>
                      <td>{l.received}</td>
                      <td className="ok">{l.stowed || ''}</td>
                      <td className="w">{l.atDock || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
