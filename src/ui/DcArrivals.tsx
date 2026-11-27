// DC 차량 도착 알림 — DC 시뮬레이터에서 "MFC 도착 보내기"를 누르면(TMS 정차 ARRIVED) 3D 화면 위에 뜬다.
// 하차 방법을 고른다: 가상 작업자(승강기 → 입고칸 → 인계 → 수령 → 검사 → 적치) / PDA 로 직접(PDA 앱 입고 → 하차, 박스 바코드는 바코드 탭)
// (사용자 2026-11-26 "Dc 시뮬레이션에서 mfc 도착보내기 누르면 mfc시뮬레이션에 연동돼서 입고재고 도착했다고 하차 시작 … PDA로 직접 또는 가상작업자 중에 선택")
import { useState } from 'react';
import { useApp, useTick, useView } from '../app/context';
import { cdcName, TEST_INBOUND } from '../config';
import { TrfRef } from './TrfRef';

const TEMP_KO = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' } as const;

export function DcArrivals() {
  const { sim } = useApp();
  const ctl = useView();
  useTick();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ key: string; text: string } | null>(null);
  // 도착한 차량 + PDA 로 인계까지 한 차량(수령 전) — 인계 뒤 알림이 사라져 다음 할 일(송장 찍기)을 놓치던 것(사용자 2026-11-27 "화면 넘어감이랑 알림은 완벽해?")
  const notReceived = (a: (typeof sim.dcArrivals)[number]) => !a.trfs || a.trfs.some((t) => t.state !== 'TIN_POSTED' && t.state !== 'CLOSED');
  const list = sim.dcArrivals.filter((a) => a.stop === 'ARRIVED' || (a.mode !== 'VIRTUAL' && notReceived(a)));
  if (!list.length) return null;
  const pick = async (key: string, mode: 'VIRTUAL' | 'PDA') => {
    setBusy(key);
    setErr(null);
    try {
      await sim.startDcUnload(key, mode);
      // PDA = 찍을 바코드 탭, 가상 작업자 = 입고 추적 탭(하차 → 인계 → 수령 → 검사 → 적치를 따라감)
      const to = mode === 'PDA' ? 'scan' : 'inbound';
      if (ctl.rightView !== to) ctl.toggleRight(to);
    } catch (e) {
      setErr({ key, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="dca">
      {list.map((a) => (
        <div key={a.key} className={`dca-c${a.stop === 'ARRIVED' ? ' arrived' : ''}`}>
          <div className="dca-h">
            <b>🚚 {cdcName(a.cdcId)} 차량 {a.stop === 'ARRIVED' ? '도착' : a.stop === 'DEPARTED' ? '떠남' : '인계 끝'}</b>
            <span className={`dca-chip ${a.stop === 'ARRIVED' ? 'act' : 'run'}`}>{a.stop === 'ARRIVED' ? '하차' : '수령 전'}</span>
          </div>
          {/* 이름표·값 두 칸 — 번호는 줄 하나에 하나(사용자 2026-11-27 "이건 UI 왜 이런데") */}
          <dl className="dca-kv">
            <div>
              <dt>운행</dt>
              <dd>
                {a.tripId} · 정차 {a.seq}
              </dd>
            </div>
            {a.trfIds.map((id) => (
              <div key={id}>
                <dt>송장</dt>
                <dd>
                  <TrfRef trfId={id} cdcId={a.cdcId} />
                </dd>
              </div>
            ))}
            {(a.trfs ?? []).flatMap((t) => t.products).map((p) => (
              <div key={p.sku}>
                <dt>상품</dt>
                <dd>
                  {p.name} <b>× {p.expected}</b>
                </dd>
              </div>
            ))}
            <div>
              <dt>차량</dt>
              <dd>
                {TEMP_KO[a.tempClass]} · 박스 {a.boxes.length}개{a.driver ? ` · ${a.driver}` : ''}
                {a.handover ? ` · 인계 ${a.handover === 'MATCHED' ? '박스 맞음' : '박스 차이'}` : ''}
              </dd>
            </div>
          </dl>
          {(a.trfs ?? []).filter((t) => t.rejected).map((t) => (
            <div key={t.trfId} className="dca-warn">
              수령 거절 — {/LOCATION_NOT_REGISTERED|LOCATION_CLOSED/.test(t.rejected ?? '') ? `입고칸이 잘못 찍혔어요. PDA 수령에서 ${TEMP_KO[a.tempClass]} 입고칸을 "변경" → ${TEST_INBOUND.receivingByTemp[a.tempClass]} 를 찍고 다시 등록` : t.rejected}
            </div>
          ))}
          {a.stop !== 'ARRIVED' && (
            <div className="dca-next">
              <span>
                다음 · PDA 입고 → <b>수령</b>: 송장 → 박스 확인 → 입고칸 {TEST_INBOUND.receivingByTemp[a.tempClass]} → 상품 수량
              </span>
              <button className="link" onClick={() => ctl.rightView !== 'scan' && ctl.toggleRight('scan')}>
                바코드 ›
              </button>
            </div>
          )}
          {a.stop === 'ARRIVED' && !notReceived(a) && <div className="dca-s">송장은 이미 수령됨(재고 반영) — 하차 인계만 남았어요</div>}
          {a.stop === 'ARRIVED' && a.mode === null && (
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
          {a.stop === 'ARRIVED' && a.mode === 'VIRTUAL' && <div className="dca-s">가상 작업자가 하차 중 — 다 내리면 인계 → 수령 → 검사 → 적치</div>}
          {a.stop === 'ARRIVED' && a.mode === 'PDA' && (
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
