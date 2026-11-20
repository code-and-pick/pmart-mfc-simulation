// Vite 개발 서버 전용: LAN 시험 계정 토큰 발급 경로 POST /sim-auth/tokens (SIM-3·SIM-11).
// 비밀번호 파일을 읽어 Keycloak 비밀번호 로그인(개발 클라이언트 pmart-dev-cli, LAN 전용) → employee-auth-service
// 시험용 토큰 교환(/api/v1/internal/dev-token-exchange)을 하고, 브라우저에는 PMart 직원 토큰만 돌려준다.
// 같은 흐름: pmart-backend deploy/lan/checks/staff_auth.py `_exchange` (2026-11-16 읽음). 토큰·비밀번호는 로그에 남기지 않는다.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fromThisPc, fromViewer } from './thisPc';
import type { Plugin } from 'vite';
import { keycloakUsername, passwordFileFor, type SimToken } from '../src/backend/http/accounts';
import { lanReadAllowed } from '../src/backend/http/lanAllow';
import { REAL_LINK } from '../src/config';

const SECRETS_DIR = process.env.PMART_SECRETS_DIR ?? resolve(process.cwd(), '../pmart-backend/deploy/lan/.secrets');
const KEYCLOAK = process.env.PMART_KEYCLOAK ?? 'http://192.168.0.101:8180';
const EMPLOYEE_AUTH = process.env.PMART_EMPLOYEE_AUTH ?? 'http://192.168.0.101:8511';
const REALM = 'pmart-staff';
/** 만료 이만큼 전이면 새로 받는다(초) */
const REUSE_MARGIN_SEC = 90;

const cache = new Map<string, SimToken>();

class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

async function issue(account: string): Promise<SimToken> {
  const file = passwordFileFor(account);
  if (!file) throw new AuthError(403, 'ACCOUNT_NOT_ALLOWED', `${account} 는 시뮬레이터 계정 목록에 없음`);
  const hit = cache.get(account);
  if (hit && Date.parse(hit.accessTokenExpiresAt) - Date.now() > REUSE_MARGIN_SEC * 1000) return hit;

  let password: string;
  try {
    password = readFileSync(resolve(SECRETS_DIR, file), 'utf-8').trim();
  } catch {
    throw new AuthError(500, 'SECRET_FILE_MISSING', `비밀번호 파일 ${file} 을 ${SECRETS_DIR} 에서 못 읽음 (PMART_SECRETS_DIR)`);
  }

  const kc = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'pmart-dev-cli', username: keycloakUsername(account), password }),
  }).catch(() => null);
  if (!kc) throw new AuthError(502, 'KEYCLOAK_UNREACHABLE', `${KEYCLOAK} 응답 없음`);
  const kcBody = (await kc.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!kc.ok || !kcBody.access_token) throw new AuthError(502, 'KEYCLOAK_LOGIN_FAILED', `Keycloak 로그인 실패 HTTP ${kc.status} ${kcBody.error ?? ''}`);

  const ex = await fetch(`${EMPLOYEE_AUTH}/api/v1/internal/dev-token-exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': randomUUID(),
      'X-Source-System': 'mfc-simulator',
      'X-Device-Id': 'mfc-simulator',
    },
    body: JSON.stringify({ keycloakAccessToken: kcBody.access_token }),
  }).catch(() => null);
  if (!ex) throw new AuthError(502, 'EMPLOYEE_AUTH_UNREACHABLE', `${EMPLOYEE_AUTH} 응답 없음`);
  const exBody = (await ex.json().catch(() => ({}))) as {
    operatorId?: string;
    code?: string;
    tokens?: { accessToken: string; accessTokenExpiresAt: string };
  };
  if (!ex.ok || !exBody.tokens?.accessToken) throw new AuthError(502, 'TOKEN_EXCHANGE_FAILED', `직원 토큰 교환 실패 HTTP ${ex.status} ${exBody.code ?? ''}`);

  const t: SimToken = {
    account,
    operatorId: exBody.operatorId ?? '',
    accessToken: exBody.tokens.accessToken,
    accessTokenExpiresAt: exBody.tokens.accessTokenExpiresAt,
  };
  cache.set(account, t);
  return t;
}

/** 이 PC(PC 1) 또는 같은 권한 기기(REAL_LINK.lanViewers — PC 5) 화면인가 — localhost·이 PC 자기 IP 포함(thisPc.ts) */
function isLoopback(req: IncomingMessage): boolean {
  return fromThisPc(req) || fromViewer(req, REAL_LINK.lanViewers);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** 다른 기기(LAN)에서 온 요청이 백엔드로 넘어가도 되는 방법 — 읽기만 */
const LAN_METHODS = new Set(['GET', 'HEAD']);

export function simAuthPlugin(): Plugin {
  return {
    name: 'pmart-sim-auth',
    configureServer(server) {
      // 다른 기기에서 보는 화면(server.host): 브라우저에 토큰을 주지 않고, 개발 서버가 /api 요청에 관찰 계정 토큰을 붙여 넘긴다.
      // 읽기(GET·HEAD)만, 그것도 관찰 화면이 읽는 경로만(lanAllow.ts 허용 목록 — 개인정보 경로 차단) 넘기고 나머지는 403.
      // 이 PC(루프백) 요청은 건드리지 않는다(브라우저가 /sim-auth/tokens 로 받은 토큰을 직접 붙인다).
      // Vite 프록시보다 먼저 돈다(configureServer 에서 바로 등록한 미들웨어).
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/') || isLoopback(req)) return next();
        if (!LAN_METHODS.has(req.method ?? '')) return send(res, 403, { code: 'LAN_READ_ONLY', detail: '다른 기기에서는 조회만 됩니다' });
        if (!lanReadAllowed(req.url ?? '')) return send(res, 403, { code: 'LAN_PATH_NOT_ALLOWED', detail: '다른 기기에서는 관찰 화면이 읽는 경로만 됩니다' });
        delete req.headers.authorization;
        issue(REAL_LINK.observerAccount)
          .then((t) => {
            req.headers.authorization = `Bearer ${t.accessToken}`;
            next();
          })
          .catch((e: unknown) => {
            const code = e instanceof AuthError ? e.code : 'INTERNAL';
            server.config.logger.warn(`[sim-auth] LAN 조회 토큰: ${code}`);
            send(res, 502, { code });
          });
      });

      server.middlewares.use('/sim-auth/tokens', (req, res) => {
        // 이 PC 의 브라우저만 — --host 로 열어도 다른 PC 는 토큰을 못 받는다
        if (!isLoopback(req)) return send(res, 403, { code: 'LOOPBACK_ONLY' });
        if (req.method !== 'POST') return send(res, 405, { code: 'METHOD_NOT_ALLOWED' });
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString('utf-8')));
        req.on('end', () => {
          let account = '';
          try {
            account = String((JSON.parse(raw || '{}') as { account?: unknown }).account ?? '');
          } catch {
            return send(res, 400, { code: 'BAD_JSON' });
          }
          issue(account)
            .then((t) => send(res, 200, t))
            .catch((e: unknown) => {
              if (e instanceof AuthError) {
                server.config.logger.warn(`[sim-auth] ${account}: ${e.code}`);
                return send(res, e.status, { code: e.code, detail: e.message });
              }
              send(res, 500, { code: 'INTERNAL' });
            });
        });
      });
    },
  };
}
