// 브라우저 쪽 토큰 보관: Vite 개발 서버(/sim-auth/tokens)에서 받아 메모리에만 둔다(저장소에 쓰지 않음).
// 직원 토큰은 15분 — 만료 refreshMarginSec 전이면 새로 받는다.

import type { SimToken } from './accounts';

export class TokenSource {
  private token: SimToken | null = null;
  private inflight: Promise<SimToken> | null = null;
  /** 마지막 실패 사유(화면 표시용) */
  lastError: string | null = null;
  /**
   * 다른 기기에서 연 화면: 개발 서버가 토큰을 주지 않고(LOOPBACK_ONLY) 대신 /api 요청에 관찰 계정 토큰을 붙인다.
   * 이때 브라우저는 토큰 없이 부르고, 조회(GET)만 된다.
   */
  serverInjected = false;

  constructor(
    readonly account: string,
    private readonly refreshMarginSec: number,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  get operatorId(): string | null {
    return this.token?.operatorId ?? null;
  }

  /** 들고 있는 토큰을 버린다 — 다음 get() 이 개발 서버에서 새로 받는다(401 을 받았을 때 한 번) */
  invalidate() {
    this.token = null;
  }

  /** 쓸 수 있는 토큰. 받지 못하면 null (호출 쪽은 401 로 보게 된다). */
  async get(): Promise<string | null> {
    if (this.serverInjected) return null;
    const t = this.token;
    if (t && Date.parse(t.accessTokenExpiresAt) - this.nowMs() > this.refreshMarginSec * 1000) return t.accessToken;
    try {
      this.inflight ??= this.fetchToken().finally(() => (this.inflight = null));
      this.token = await this.inflight;
      this.lastError = null;
      return this.token.accessToken;
    } catch (e) {
      this.lastError = e instanceof ServerInjected ? null : (e as Error).message;
      return null;
    }
  }

  private async fetchToken(): Promise<SimToken> {
    const res = await this.fetchImpl('/sim-auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: this.account }),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<SimToken> & { code?: string; detail?: string };
    if (res.status === 403 && body.code === 'LOOPBACK_ONLY') {
      this.serverInjected = true;
      throw new ServerInjected();
    }
    if (!res.ok || !body.accessToken) throw new Error(`토큰 발급 실패 ${res.status} ${body.code ?? ''} ${body.detail ?? ''}`.trim());
    return body as SimToken;
  }
}

class ServerInjected extends Error {}
