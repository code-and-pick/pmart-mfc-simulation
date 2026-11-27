// PDA 입고 찍을 코드 팝업 — 지금 하는 입고 일의 코드를 PDA 화면 순서대로 하나씩 크게(사용자 2026-11-27 "QR코드 pda작업 흐름에 맞게 팝업창이 뜨고 넘어가면 팝업창도 자동으로 다음 작업으로").
// PDA 안의 스캔(칸·상품 하나하나)은 서버가 모른다 → 한 단계 안에서는 "다음 ›"로 넘기고,
// 서버가 아는 단계 끝(하차 인계·수령 확정·검사·적치 끝·새 작업 받음)이 오면 팝업이 저절로 다음 일의 첫 코드로.
import { useEffect, useMemo, useState } from 'react';
import { useApp, useTick } from '../app/context';
import { inboundJobs, type InboundJob } from '../sim/inboundTrack';
import { Barcode } from './Barcode';
import { TEST_INBOUND } from '../config';

interface Code {
  step: string;
  hint: string;
  value: string;
  caption: string;
}

const kindOf = (v: string) => (/^\d{13}$/.test(v) ? 'ean13' : 'code128');

/** 지금 일하는 입고 건 — PDA 가 받은 검사·적치 → PDA 하차 → PDA 수령 */
function liveJob(jobs: InboundJob[]): InboundJob | null {
  return jobs.find((j) => j.pdaBusy) ?? jobs.find((j) => j.stage === 'UNLOAD' && j.arrival?.mode !== 'VIRTUAL') ?? jobs.find((j) => j.stage === 'RECEIVE' && j.arrival?.mode !== 'VIRTUAL') ?? null;
}

/** 그 건의 지금 단계 코드 — PDA 화면 순서 */
function codesOf(j: InboundJob): { title: string; key: string; codes: Code[] } {
  const a = j.arrival;
  if (j.stage === 'UNLOAD' && a)
    return {
      title: 'PDA 입고 → 하차',
      key: `${j.key}:unload`,
      codes: a.boxes.map((b, i) => ({ step: `하차 박스 ${i + 1}/${a.boxes.length}`, hint: '박스를 다 찍으면 PDA 에서 인계', value: b.lpn, caption: b.lpn })),
    };
  if (j.stage === 'RECEIVE' && a) {
    const boxes = a.boxes.filter((b) => b.trfId === j.trfId);
    return {
      title: 'PDA 입고 → 수령',
      key: `${j.key}:receive`,
      codes: [
        ...(j.trf ? [{ step: '1 송장', hint: '수령 첫 단계', value: j.trf.label, caption: j.trf.label }] : []),
        ...boxes.map((b, i) => ({ step: `2 박스 확인 ${i + 1}/${boxes.length}`, hint: '박스를 다시 찍기', value: b.lpn, caption: b.lpn })),
        // PDA 수령 화면이 온도대마다 입고칸을 찍으라고 함(C-6 반영 — 아무 코드나 받아 서버가 LOCATION_NOT_REGISTERED 로 거절, 사용자 2026-11-27 "상품 수령 등록 안 된다잖아")
        { step: '3 입고칸', hint: `${{ AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' }[a.tempClass]} 입고칸 스캔`, value: TEST_INBOUND.receivingByTemp[a.tempClass], caption: TEST_INBOUND.receivingByTemp[a.tempClass] },
        ...(j.trf?.products ?? []).flatMap((p) => p.barcodes.slice(0, 1).map((v) => ({ step: '4 상품 수량', hint: `${p.name} × ${p.expected}`, value: v, caption: `${p.name} × ${p.expected}` }))),
      ],
    };
  }
  const it = j.open.find((x) => !!x.task.assigneeId);
  if (it) {
    const t = it.task;
    const kind = t.taskType === 'INSPECT' ? '품질검사' : t.taskType === 'PUTAWAY' ? '적치' : '격리 이동';
    const bc = t.barcodes?.[0];
    return {
      title: `PDA ${kind} · ${t.productName ?? t.sku} 남은 ${it.remain}`,
      // 작업이 바뀌거나 수량이 줄면(서버 반영) 처음부터
      key: `${t.taskId}:${t.doneQty}`,
      codes: [
        { step: '1 위치 확인', hint: '출발 칸', value: t.locationCode, caption: t.locationCode },
        ...(bc ? [{ step: t.taskType === 'INSPECT' ? '2 상품' : '2 상품 싣기', hint: `${it.remain}개 찍고 "실었어요"`, value: bc, caption: t.productName ?? t.sku }] : []),
        ...(t.taskType === 'INSPECT' ? [] : it.dest.slice(0, 1).map((d) => ({ step: '3 내려놓기', hint: '"도착 칸 스캔" → 적치했어요', value: d.code, caption: d.code }))),
      ],
    };
  }
  return { title: '', key: '', codes: [] };
}

export function PdaScanPopup() {
  const { sim } = useApp();
  useTick();
  const jobs = inboundJobs(sim.dcArrivals, sim.inboundScan.items, sim.inboundScan.done);
  const job = liveJob(jobs);
  const cur = useMemo(() => (job ? codesOf(job) : null), [job]);
  const key = cur?.key ?? '';
  const [i, setI] = useState(0);
  const [hide, setHide] = useState<string | null>(null);
  const [mini, setMini] = useState(false);
  // 서버가 단계 끝을 알려 오면(키가 바뀜) 처음 코드로 — "자동으로 다음 작업"
  useEffect(() => setI(0), [key]);
  if (!job || !cur || !cur.codes.length || hide === key) return null;
  const n = cur.codes.length;
  const c = cur.codes[Math.min(i, n - 1)];
  const trf = job.trfId ? sim.trfInfo(job.trfId) : null;
  return (
    <div className={`psp${mini ? ' mini' : ''}`} role="dialog" aria-label="PDA 로 찍을 코드">
      <div className="psp-h">
        <b>{trf ? `${trf.short}${trf.waveNumber ? ` · ${trf.waveNumber}` : ''}` : job.label}</b>
        <span>{cur.title}</span>
        <button onClick={() => setMini((m) => !m)} title={mini ? '펼치기' : '접기'}>
          {mini ? '▴' : '▾'}
        </button>
        <button onClick={() => setHide(key)} title="이 일은 닫기(다음 일이 오면 다시 뜸)">
          ✕
        </button>
      </div>
      {!mini && (
        <>
          <div className="psp-step">
            <b>{c.step}</b>
            <span>{c.hint}</span>
          </div>
          <div className="psp-code">
            {/* 값은 그림 아래 한 번만 — 위 설명과 같으면 빼서 두 번 보이던 것 */}
            <Barcode value={c.value} kind={kindOf(c.value)} caption={c.caption !== c.value ? c.caption : undefined} height={70} />
          </div>
          {n > 1 && (
          <div className="psp-nav">
            <button disabled={i === 0} onClick={() => setI((x) => Math.max(0, x - 1))}>
              ‹ 이전
            </button>
            <span>
              {Math.min(i, n - 1) + 1} / {n}
            </span>
            <button disabled={i >= n - 1} onClick={() => setI((x) => Math.min(n - 1, x + 1))}>
              다음 ›
            </button>
          </div>
          )}
          {i >= n - 1 && <div className="psp-wait">이것까지 찍고 PDA 에서 마치면 → 다음 일로 저절로 넘어가요</div>}
        </>
      )}
    </div>
  );
}
