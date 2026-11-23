// 실서버 모드에서 시뮬레이터가 쓰는 LAN 시험 계정과 그 비밀번호 파일 이름.
// 근거: pmart-backend docs/operations/lan-test-accounts.md (2026-11-16 확인). 비밀번호 자체는 Vite 개발 서버만 읽는다(SIM-11).
// 이 파일은 브라우저·Vite 서버·테스트가 같이 쓴다 — node 모듈을 들이지 않는다.

/** Keycloak 아이디 = 사내 메일 전체(ADR-0056 결정 7). 짧게 주면 @pmart.com 을 붙인다. */
export function keycloakUsername(account: string): string {
  return account.includes('@') ? account : `${account}@pmart.com`;
}

/**
 * 시뮬레이터가 토큰을 받아도 되는 계정 → 비밀번호 파일 이름. 목록 밖이면 null(거절).
 * - `claude-mfc-wrk`: 백엔드 문서가 "시뮬레이터 작업자"로 정한 계정 — 실서버 관찰(읽기)에 쓴다.
 * - `claude-mfc-sup`: 센터 관리자(MFC_SUPERVISOR) — 관리 탭 쓰기만(이 PC 화면만, 토큰은 loopback 에만 줌).
 * - `mfcw-pp-01`~`10`: 가상 작업자(사용자 결정 2026-11-16). 70명 공용 비밀번호 파일.
 * 백엔드 staff_auth.py 처럼 "파일이 없으면 비밀번호를 새로 정하는" 동작은 하지 않는다 — 공용 비밀번호가 깨진다.
 */
export function passwordFileFor(account: string): string | null {
  const short = account.replace(/@pmart\.com$/, '');
  if (short === 'claude-mfc-wrk') return 'keycloak-claude-mfc-wrk-password';
  // 관리 탭(재배정·내놓기·인계 확인) — 그 센터 MFC_SUPERVISOR. 사용자 2026-11-20 "API 받아오면 되잖아. 허락 받았어"
  if (short === 'claude-mfc-sup') return 'keycloak-claude-mfc-sup-password';
  if (/^mfcw-pp-(0[1-9]|10)$/.test(short)) return 'keycloak-mfc-test-workers-password';
  // 입고 가상 작업자(사용자 2026-11-20 "피패킹 권한만 있는 가상 작업자가 생겨서 아무도 입고작업을 못하잖아") — 같은 70명 공용 비밀번호(lan-test-accounts.md)
  if (/^mfcw-(qc|rcv)-(0[1-9]|10)$/.test(short)) return 'keycloak-mfc-test-workers-password';
  // 2호점 목포 MFC(사용자 2026-11-22) — 백엔드 R-39 로 요청한 계정(같은 공용 비밀번호 파일, 관리자는 따로) [가정]
  if (/^mfcw-mk-(pp|qc|rcv)-(0[1-9]|10)$/.test(short)) return 'keycloak-mfc-test-workers-password';
  if (short === 'claude-mfc-sup-mk') return 'keycloak-claude-mfc-sup-mk-password';
  // 3호점 세종(R-41, 2026-11-23) — 백엔드 mfc_test_workers.py --center sejong(같은 공용 비밀번호, 관리자 파일은 따로 — .secrets 파일 이름 확인)
  if (/^mfcw-sj-(pp|qc|rcv)-(0[1-9]|10)$/.test(short)) return 'keycloak-mfc-test-workers-password';
  if (short === 'claude-mfc-sup-sj') return 'keycloak-claude-mfc-sup-sj-password';
  // 4호점 춘천(R-42, 2026-11-24) — mfc_test_workers.py --center chuncheon(공용 비밀번호, 관리자 파일 따로 — .secrets 파일 이름 확인)
  if (/^mfcw-cc-(pp|qc|rcv)-(0[1-9]|10)$/.test(short)) return 'keycloak-mfc-test-workers-password';
  if (short === 'claude-mfc-sup-cc') return 'keycloak-claude-mfc-sup-cc-password';
  return null;
}

/** POST /sim-auth/tokens 응답 (Vite 개발 서버 → 브라우저). 토큰만 오고 비밀번호는 오지 않는다. */
export interface SimToken {
  account: string;
  operatorId: string;
  accessToken: string;
  /** ISO 시각 */
  accessTokenExpiresAt: string;
}
