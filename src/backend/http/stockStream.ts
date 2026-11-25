// 재고 실시간 스트림(mfc-inventory 0.46.0 GET /stock-stream, SSE) 읽기 — EventSource 대신 fetch 스트림 + Authorization(계약 설명 그대로).
// 끊기면 마지막 id 를 Last-Event-ID 로 다시 붙는다(서버는 30분마다 닫음). 하트비트(5초) 없이 오래 조용하면 끊긴 것으로 본다.

import type { StockStreamEvent } from '../../domain/contract';

export interface SseMessage {
  event: string;
  id?: string;
  data: string;
}

/** SSE 글 조각 → 메시지. 주석 줄(": hb")은 onComment 로만 */
export class SseParser {
  private buf = '';
  private event = '';
  private id: string | undefined;
  private data: string[] = [];

  push(chunk: string, onComment?: () => void): SseMessage[] {
    this.buf += chunk;
    const out: SseMessage[] = [];
    let nl: number;
    while ((nl = this.buf.search(/\r\n|\n|\r/)) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + (this.buf.startsWith('\r\n', nl) ? 2 : 1));
      if (line === '') {
        if (this.data.length) out.push({ event: this.event || 'message', id: this.id, data: this.data.join('\n') });
        this.event = '';
        this.data = [];
        continue;
      }
      if (line.startsWith(':')) {
        onComment?.();
        continue;
      }
      const c = line.indexOf(':');
      const field = c < 0 ? line : line.slice(0, c);
      let value = c < 0 ? '' : line.slice(c + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') this.event = value;
      else if (field === 'data') this.data.push(value);
      else if (field === 'id') this.id = value;
    }
    return out;
  }
}

export type StreamState = 'connecting' | 'open' | 'retry';

export interface StockStreamOptions {
  /** 예: /api/v1/stock-stream?mfcId=MFC-BJG-01 */
  url: string;
  token: () => Promise<string | null>;
  /** 401 — 토큰을 버리고 다음 접속에 새로 받는다 */
  onUnauthorized?: () => void;
  onEvent: (e: StockStreamEvent) => void;
  onState: (s: StreamState, why?: string) => void;
  /** 이만큼 아무것도 안 오면 끊고 다시(하트비트 5초) */
  idleMs?: number;
  fetchImpl?: typeof fetch;
}

export class StockStream {
  private running = false;
  private lastId: string | undefined;
  private ctl: AbortController | null = null;

  constructor(private readonly opt: StockStreamOptions) {}

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
    this.ctl?.abort();
  }

  private async loop() {
    let wait = 1000;
    while (this.running) {
      const why = await this.once().catch((e: Error) => e.message);
      if (!this.running) break;
      this.opt.onState('retry', why ?? '끊김');
      await new Promise((r) => setTimeout(r, wait));
      // 바로 끊긴 게 되풀이되면 점점 천천히(최대 30초)
      wait = why ? Math.min(30_000, wait * 2) : 1000;
    }
  }

  /** 한 번 접속해 끝날 때까지 읽는다. 정상 종료면 undefined, 아니면 사유 */
  private async once(): Promise<string | undefined> {
    this.opt.onState('connecting');
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const token = await this.opt.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (this.lastId) headers['Last-Event-ID'] = this.lastId;
    const ctl = new AbortController();
    this.ctl = ctl;
    const idleMs = this.opt.idleMs ?? 20_000;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      clearTimeout(idle);
      idle = setTimeout(() => ctl.abort(), idleMs);
    };
    kick();
    try {
      const res = await (this.opt.fetchImpl ?? fetch)(this.opt.url, { headers, signal: ctl.signal });
      if (res.status === 401) this.opt.onUnauthorized?.();
      if (!res.ok || !res.body) return `HTTP ${res.status}`;
      this.opt.onState('open');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const parser = new SseParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return undefined;
        kick();
        for (const m of parser.push(dec.decode(value, { stream: true }))) {
          if (m.id) this.lastId = m.id;
          let e: StockStreamEvent;
          try {
            e = JSON.parse(m.data) as StockStreamEvent;
          } catch {
            continue;
          }
          e.type ??= m.event as StockStreamEvent['type'];
          this.opt.onEvent(e);
        }
      }
    } catch (e) {
      return ctl.signal.aborted && this.running ? '오래 조용함' : (e as Error).message;
    } finally {
      clearTimeout(idle);
    }
  }
}
