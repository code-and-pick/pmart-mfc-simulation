// Idempotency-Key 길이 맞추기 — 계약 `_common.yaml` IdempotencyKey maxLength 128(넘으면 400 VALIDATION_FAILED, 2026-11-19 실측 165자).
// 같은 입력 → 같은 키(같은 키로 다시 보내기·결과 조회가 그대로 되게). 128자 이하는 그대로, 넘으면 앞부분 + 전체의 64비트 해시.

export const IDEMPOTENCY_KEY_MAX = 128;

/** FNV-1a 64비트(두 32비트로) — 암호용 아님, 키 구분용 */
function fnv64(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function fitIdempotencyKey(key: string, max = IDEMPOTENCY_KEY_MAX): string {
  if (key.length <= max) return key;
  const hash = fnv64(key);
  return `${key.slice(0, max - hash.length - 1)}~${hash}`;
}
