// DC 차량 도착 알림 — DC 시뮬레이터에서 "MFC 도착 보내기"를 누르면(TMS 정차 ARRIVED) 3D 화면 위에 뜬다.
// 하차 방법을 고른다: 가상 작업자(승강기 → 입고칸 → 인계 → 수령 → 검사 → 적치) / PDA 로 직접(PDA 앱 입고 → 하차, 박스 바코드는 바코드 탭)
// (사용자 2026-11-26 "Dc 시뮬레이션에서 mfc 도착보내기 누르면 mfc시뮬레이션에 연동돼서 입고재고 도착했다고 하차 시작 … PDA로 직접 또는 가상작업자 중에 선택")
import { useState } from 'react';
import { useApp, useTick, useView } from '../app/context';
import { cdcName } from '../config';

const TEMP_KO = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' } as const;

export function DcArrivals() {
  const { sim } = useApp();
  const ctl = useView();
  useTick();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ key: string; text: string } | null>(null);
  const list = sim.dcArrivals.filter((a) => a.stop === 'ARRIVED');
  if (!list.length) return null;
  const pick = async (key: string, mode: 'VIRTUAL' | 'PDA') => {
    setBusy(key);
    setErr(null);
    try {
      await sim.startDcUnload(key, mode);
      if (mode === 'PDA' && ctl.rightView !== 'scan') ctl.toggleRight('scan');
    } catch (e) {
      setErr({ key, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="dca">
      {list.map((a) => (
        <div key={a.key} className="dca-c">
          <div className="dca-h">
            <b>🚚 {cdcName(a.cdcId)} 차량 도착</b>
            <span>
              {TEMP_KO[a.tempClass]} · 박스 {a.boxes.length}개{a.driver ? ` · ${a.driver}` : ''}
            </span>
          </div>
          {a.mode === null && (
            <>
              <div className="dca-q">하차를 누가 할까요?</div>
              <div className="dca-a">
                <button disabled={busy === a.key} onClick={() => void pick(a.key, 'VIRTUAL')}>
                  가상 작업자
                </button>
                <button disabled={busy === a.key} onClick={() => void pick(a.key, 'PDA')}>
                  PDA 로 직접
                </button>
              </div>
            </>
          )}
          {a.mode === 'VIRTUAL' && <div className="dca-s">가상 작업자가 하차 중 — 다 내리면 인계 → 수령 → 검사 → 적치</div>}
          {a.mode === 'PDA' && (
            <div className="dca-s">
              PDA 입고 → <b>하차</b>에서 박스 {a.boxes.length}개를 찍어 주세요.{' '}
              <button className="link" onClick={() => ctl.rightView !== 'scan' && ctl.toggleRight('scan')}>
                박스 바코드 보기
              </button>
            </div>
          )}
          {err?.key === a.key && <div className="dca-e">{err.text}</div>}
        </div>
      ))}
    </div>
  );
}
