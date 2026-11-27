// 송장·Wave 짧은 번호 — 백오피스와 같게 "T286575 W6307", 누르면 DC 백오피스 그 화면(새 창).
// 화면 번호는 cdc-outbound 것(ADR-0070·0085). MFC 계정이 읽는 응답엔 아직 없어(요청 R-52) 그 전엔 "TRF …끝6자리", 시스템 ID 는 마우스 올리면.
// (사용자 2026-11-27 "TRF 식별값이랑 WAVE 식별값 백오피스에서 짧게 정했으니까 T286575 W6307 이렇게 뜨게 해")
import { useApp } from '../app/context';
import { CDC_BACKOFFICE } from '../config';

export function TrfRef({ trfId, cdcId = 'CDC01', wave = true }: { trfId: string; cdcId?: string; wave?: boolean }) {
  const { sim } = useApp();
  const x = sim.trfInfo(trfId);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <span className="trf-ref">
      <a href={CDC_BACKOFFICE.base + CDC_BACKOFFICE.trfPath(cdcId, trfId)} target="_blank" rel="noreferrer" title={`${trfId} — DC 백오피스에서 열기`} onClick={stop}>
        {x.short}
      </a>
      {wave && x.waveId && (
        <>
          {' '}
          <a href={CDC_BACKOFFICE.base + CDC_BACKOFFICE.wavePath(cdcId, x.waveId)} target="_blank" rel="noreferrer" title={`${x.waveId} — DC 백오피스에서 열기`} onClick={stop}>
            {x.waveNumber ?? `W…${x.waveId.slice(-4)}`}
          </a>
        </>
      )}
    </span>
  );
}
