// 입고 추적 탭 — DC(CDC) 이관 입고·센터 발주 입고를 한 건씩: 오는 중 → 도착·하차 → 수령·검사 → 적치 → 끝,
// 품목마다 예정·받음·적치·입고칸 남은 양·놓인 칸, 위에는 오늘 입고로 늘어난 재고(사용자 2026-11-26 "DC에서 입고 받은 거 적치하고, 입고받아서 추가되는 재고 추적")
import { useEffect, useState } from "react";
import { useApp } from "../app/context";
import {
  STEP_KO,
  sumLines,
  type InboundTrack,
  type TrackStage,
  type TripInfo,
} from "../sim/inboundTrack";

const mdhm = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(ms)}`;
};
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** 운행 한 줄 — 차량이 지금 어디쯤(TMS) */
function tripLine(t: TripInfo): string {
  const who = t.driver
    ? ` · ${t.driver.startsWith("기사") ? t.driver : `기사 ${t.driver}`}`
    : "";
  const box = t.boxes ? ` · 박스 ${t.boxes}개` : "";
  if (t.trip === "SCHEDULED" || t.trip === "CHECKED_IN" || t.trip === "LOADED")
    return `DC 에서 상차 중${t.etaMs ? ` · ${mdhm(t.etaMs)} 도착 예정` : ""}${box}`;
  if (t.stop === "PLANNED") {
    if (!t.etaMs) return `오는 중${who}${box}`;
    return t.etaMs <= Date.now()
      ? `차량 와 있음${who}${box}`
      : `오는 중 · 도착 예정 ${hhmm(t.etaMs)}${t.delayed ? " (늦음)" : ""}${who}${box}`;
  }
  if (t.stop === "ARRIVED") return `차량 도착 · 하차 중${who}${box}`;
  if (t.stop === "HANDED_OVER")
    return `인계 끝(${t.handover === "MISMATCHED" ? "박스 차이 있음" : "박스 맞음"}) · 차량 출발 전`;
  return `인계 끝 · 차량 떠남${t.handover === "MISMATCHED" ? " (박스 차이 있음)" : ""}`;
}

const STEPS: TrackStage[] = [
  "EXPECTED",
  "ARRIVED",
  "RECEIVED",
  "STOWING",
  "DONE",
];

export function InboundTracks() {
  const { sim } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{
    key: string;
    ok: boolean;
    text: string;
  } | null>(null);
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
      return {
        received: a.received + s.received,
        stowed: a.stowed + s.stowed,
        atDock: a.atDock + s.atDock,
        n: a.n + (s.received > 0 ? 1 : 0),
      };
    },
    { received: 0, stowed: 0, atDock: 0, n: 0 },
  );
  const act = async (t: InboundTrack, withVirtual: boolean) => {
    setBusy(t.key);
    setMsg(null);
    try {
      // 운행으로 와 있는 차량이면 하차 고르기와 같은 길(PDA = 서버에 안 보냄, 사람이 PDA 앱 하차)
      const arrival = sim.dcArrivals.find((a) => a.trfIds.includes(t.id) && a.stop === 'ARRIVED');
      if (arrival) {
        await sim.startDcUnload(arrival.key, withVirtual ? 'VIRTUAL' : 'PDA');
        setMsg({ key: t.key, ok: true, text: withVirtual ? '가상 작업자가 하차 중 — 다 내리면 인계 → 수령 → 검사 → 적치' : 'PDA 입고 → 하차에서 박스를 찍어 주세요(박스 바코드는 바코드 탭)' });
        return;
      }
      const res = await sim.receiveDc(t.id, withVirtual);
      setMsg({
        key: t.key,
        ok: true,
        text: `${res.queued ? "가상 작업자가 하차 중 — 다 내리면 인계 → 수령 → 검사 → 적치" : "도착·인계 기록함 — 검사·적치는 PDA"}${res.receiptBlocked ? " (수령은 출발 기록 대기)" : ""}`,
      });
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
        <div className={got.atDock ? "w" : ""}>
          <b>{got.atDock.toLocaleString()}</b>
          <small>아직 입고칸</small>
        </div>
      </div>
      {r.error && <div className="itk-err">읽기 실패 — {r.error}</div>}
      {!items.length && (
        <div className="note">
          {r.loading || r.readAt === null
            ? "읽는 중…"
            : sim.mode === "mock"
              ? '아직 입고 차량이 없습니다. 왼쪽 "입고 차량 지금 부르기"로 부르면 여기서 따라갑니다.'
              : "들어올 입고도, 오늘 받은 입고도 없습니다."}
        </div>
      )}
      {items.map((t) => {
        const s = sumLines(t.lines);
        const at = STEPS.indexOf(t.stage);
        const canReceive =
          sim.mode !== "mock" && !!t.canReceive && !sim.isUnloading(t.id);
        return (
          <div key={t.key} className={`itk-c s-${t.stage}`}>
            <div
              className="itk-h"
              title={t.id}
              onClick={() => setOpen(open === t.key ? null : t.key)}
            >
              <b>
                {t.kind === "DC"
                  ? `DC 입고${t.from ? ` · ${t.from}` : ""}`
                  : "센터 발주 입고"}
              </b>
              <span>
                {t.lines.length
                  ? `${t.lines.length}품목 ${s.expected.toLocaleString()}개`
                  : "상품은 DC 출발 뒤"}
              </span>
            </div>
            {t.trip && (
              <div className={`itk-trip ${t.trip.delayed ? "late" : ""}`}>
                {tripLine(t.trip)}
              </div>
            )}
            {t.stage === "CANCELLED" ? (
              <div className="itk-why">취소·종결됨</div>
            ) : (
              <div className="itk-steps">
                {STEPS.map((k, i) => (
                  <span
                    key={k}
                    className={i < at ? "done" : i === at ? "now" : ""}
                  >
                    <i />
                    {STEP_KO[k]}
                  </span>
                ))}
              </div>
            )}
            {t.lines.length > 0 && (
              <div
                className="itk-q"
                onClick={() => setOpen(open === t.key ? null : t.key)}
              >
                <span>
                  받음 <b>{s.received.toLocaleString()}</b> /{" "}
                  {s.expected.toLocaleString()}
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
                <span className="itk-more">
                  {open === t.key ? "접기" : "품목 보기"}
                </span>
              </div>
            )}
            {t.blockedWhy && <div className="itk-why">{t.blockedWhy}</div>}
            {canReceive && (
              <div className="itk-a">
                <button
                  disabled={busy === t.key}
                  onClick={() => void act(t, true)}
                >
                  가상 작업자로 하차
                </button>
                <button
                  disabled={busy === t.key}
                  onClick={() => void act(t, false)}
                >
                  PDA 로 직접
                </button>
              </div>
            )}
            {msg?.key === t.key && (
              <div className={msg.ok ? "itk-ok" : "itk-err"}>{msg.text}</div>
            )}
            {open === t.key && t.lines.length > 0 && (
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
                        {l.placed.length > 0 && (
                          <div className="loc">
                            {l.placed
                              .map((p) => `${p.loc} ${p.qty}개`)
                              .join(" · ")}
                          </div>
                        )}
                      </td>
                      <td>{l.expected}</td>
                      <td>{l.received}</td>
                      <td className="ok">{l.stowed || ""}</td>
                      <td className="w">{l.atDock || ""}</td>
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
