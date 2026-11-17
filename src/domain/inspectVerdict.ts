// 가상 작업자 품질검사 판정 — 실제 PDA 앱과 같은 기준(mfc-inbound 0.11.0 InboundTask 판정 기준, BR-52 R18).
// 근거: pmart-clients apps/mfc_app/lib/features/quality/presentation/quality_controllers.dart forcedReason·inspectRowIssues (클라이언트 3f2048f)
// - 최소 잔여일(minRemainingDays)이 없으면 "기준 미설정" — 정상 판정을 막는다(0·무제한으로 보지 않음)
// - 소비기한은 필수, 제조 후 최대 경과일(maxDaysSinceManufacture)이 있으면 제조일도 필수
// - 제조일이 오늘 이후·소비기한 이후면 잘못된 값(서버 400)
// - 잔여일 < 최소 잔여일, 또는 제조 후 경과일 > 최대 경과일이면 격리(정상을 고를 수 없음). 그 밖은 정상
// 소비기한·제조일·제조 LOT 표기는 사람이 상품에서 읽는 값 — 가상 작업자는 서버 LOT 정보(GET /lot-labels/{lotId})를 읽는다(지어내지 않음).
import type { InboundTask, InspectionResult, LotLabel } from './contract';

export type InspectVerdict = { ok: true; result: InspectionResult; reason: 'NORMAL' | 'EXPIRY' | 'MANUFACTURE' } | { ok: false; why: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** yyyy-MM-dd → 그 날 0시(UTC) 일 수 — 날짜끼리 뺄셈만 쓴다 */
const dayNo = (s: string) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000);

/** today = 서울 날짜 yyyy-MM-dd */
export function inspectVerdict(t: Pick<InboundTask, 'minRemainingDays' | 'maxDaysSinceManufacture'>, label: Pick<LotLabel, 'expiryDate' | 'manufactureDate' | 'sourceLotRef'> | null, qty: number, today: string): InspectVerdict {
  const min = t.minRemainingDays ?? null;
  const max = t.maxDaysSinceManufacture ?? null;
  if (min == null) return { ok: false, why: '판정 기준 미설정(minRemainingDays 없음) — PDA 도 정상 판정을 막음' };
  const exp = label?.expiryDate && DATE.test(label.expiryDate) ? label.expiryDate : null;
  const mfg = label?.manufactureDate && DATE.test(label.manufactureDate) ? label.manufactureDate : null;
  if (!exp) return { ok: false, why: '소비기한 모름(LOT 정보에 없음) — PDA 는 소비기한 필수' };
  if (max != null && !mfg) return { ok: false, why: `제조일 모름 — 제조 후 ${max}일 기준 상품은 제조일 필수` };
  const d = dayNo(today);
  if (mfg && (dayNo(mfg) > d || dayNo(mfg) > dayNo(exp))) return { ok: false, why: `제조일 ${mfg} 이 오늘·소비기한 이후` };
  const base: InspectionResult = { qty, resultQuality: 'NORMAL', expiryDate: exp };
  if (mfg) base.manufactureDate = mfg;
  if (label?.sourceLotRef) base.sourceLotRef = label.sourceLotRef;
  if (dayNo(exp) - d < min) return { ok: true, result: { ...base, resultQuality: 'QUARANTINED' }, reason: 'EXPIRY' };
  if (mfg && max != null && d - dayNo(mfg) > max) return { ok: true, result: { ...base, resultQuality: 'QUARANTINED' }, reason: 'MANUFACTURE' };
  return { ok: true, result: base, reason: 'NORMAL' };
}

/** 서울 날짜 yyyy-MM-dd */
export function seoulToday(ms: number): string {
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}
