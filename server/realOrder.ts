// Vite 개발 서버 전용: 실제 주문 넣기 POST /sim-order (R-21, 백엔드 알림 2026-11-19 `2026-11-19-simulator-notice-r21-dev-order.md`).
// 고객 토큰은 개발 서버 안에서만 받고 쓴다(브라우저·로그로 보내지 않음). 이 PC(루프백)에서만.
// 고객 경로 그대로: 쇼핑 주소 → 상품 검색 → 장바구니 담기 → 주문 초안 → 결제 진입 → 시험 승인(paymentKey TEST_AUTO_<pgOrderId>) → 주문번호.
// 계약: auth 0.3.0 dev-customer-tokens, customer shopping-context, search /search/products, cart 0.2.2, order drafts·checkouts·delivery-options,
// delivery-capacity /slots, payment 0.2.0 payment-confirmations·/payments/{orderId}. 주문·결제를 서버에 직접 쓰지 않는다(DB 없음).

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { REAL_ORDER } from '../src/config';
import {
  ORDER_MODES,
  orderCandidates,
  randomMode,
  seoulDate,
  selectableSlots,
  slotOrder,
  slotRetryable,
  type OrderMode,
  type OrderModeChoice,
  type ProductHit,
  type RealOrderResult,
  type SlotView,
} from '../src/domain/realOrder';

const AUTH = process.env.PMART_CUSTOMER_AUTH ?? 'http://192.168.0.40:8501';
const SOURCE = 'mfc-simulator';
const DEVICE = 'mfc-simulator';
/** 만료 이만큼 전이면 새로 받는다(초) — 고객 토큰 15분, refresh 없음 */
const REUSE_MARGIN_SEC = 90;

class StepError extends Error {
  constructor(
    readonly step: string,
    readonly code: string,
    detail: string,
    readonly askScheduled = false,
  ) {
    super(detail);
  }
}

interface Json {
  [k: string]: unknown;
}

const tokens = new Map<string, { token: string; exp: number }>();

async function customerToken(accountId: string): Promise<string> {
  const hit = tokens.get(accountId);
  if (hit && hit.exp - Date.now() > REUSE_MARGIN_SEC * 1000) return hit.token;
  const res = await fetch(`${AUTH}/api/v1/internal/dev-customer-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': randomUUID(),
      'X-Source-System': SOURCE,
      'X-Device-Id': DEVICE,
    },
    body: JSON.stringify({ accountId }),
  }).catch(() => null);
  if (!res) throw new StepError('TOKEN', 'AUTH_UNREACHABLE', `${AUTH} 응답 없음`);
  const b = (await res.json().catch(() => ({}))) as { accessToken?: string; accessTokenExpiresAt?: string; code?: string; detail?: string };
  if (!res.ok || !b.accessToken) throw new StepError('TOKEN', b.code ?? `HTTP_${res.status}`, b.detail ?? '고객 토큰 발급 실패');
  tokens.set(accountId, { token: b.accessToken, exp: Date.parse(b.accessTokenExpiresAt ?? '') || Date.now() + 10 * 60_000 });
  return b.accessToken;
}

/** 게이트웨이 호출. 응답 없음 = 결과 불명(ResultUnknown) — 부르는 쪽이 조회로 확인한다 */
class NoResponse extends Error {}

function api(gateway: string, token: string | null) {
  return async <T = Json>(
    step: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opt: { body?: unknown; key?: string; version?: number; ok404?: boolean } = {},
  ): Promise<T> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (method !== 'GET') {
      headers['X-Source-System'] = SOURCE;
      headers['X-Device-Id'] = DEVICE;
      headers['Idempotency-Key'] = opt.key ?? randomUUID();
      if (opt.body !== undefined) headers['Content-Type'] = 'application/json';
      if (opt.version !== undefined) headers['X-Expected-Version'] = String(opt.version);
    }
    // 응답 없음은 결과 불명 — 같은 Idempotency-Key(헤더 그대로)로 다시 보낸다(사용자 2026-11-20 "두건 이상 주문 신청하려니까" GET /me/shopping-context 응답 없음)
    let res: Response | null = null;
    let why = '';
    for (let attempt = 0; attempt < REAL_ORDER.noResponseRetries + 1 && !res; attempt++) {
      if (attempt) await sleep(REAL_ORDER.noResponseRetryMs);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15_000);
      try {
        res = await fetch(`${gateway}/api/v1${path}`, {
          method,
          headers,
          body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
          signal: ctl.signal,
        });
      } catch (e) {
        const c = (e as { cause?: { code?: string; message?: string } }).cause;
        why = (e as Error).name === 'AbortError' ? '15초 안에 응답 없음' : (c?.code ?? c?.message ?? (e as Error).message);
        console.warn(`[sim-order] ${method} ${path.split('?')[0]} 응답 없음(${attempt + 1}번째): ${why}`);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!res) throw new NoResponse(`${method} ${path.split('?')[0]} (${why})`);
    const text = await res.text();
    const json = (text ? (JSON.parse(text) as unknown) : {}) as Json;
    if (!res.ok) {
      if (opt.ok404 && res.status === 404) return null as T;
      throw new StepError(step, String(json.code ?? `HTTP_${res.status}`), String(json.detail ?? json.title ?? ''));
    }
    return json as T;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Cart {
  cartId: string;
  cartVersion: number;
  mfcId?: string;
  minOrderAmount?: number | null;
  items: { cartItemId: string; sku: string; quantity: number; display?: { name?: string; unitPrice?: number; availability?: string; saleState?: string } }[];
}
interface Draft {
  draftId: string;
  version: number;
  status?: string;
  nextAction?: string;
  orderId?: string;
  quote?: { quoteVersion: number; itemAmount?: number; totalAmount?: number; minOrderShortfall?: number };
  blockers?: { code: string; detail?: string }[];
  payment?: { pgOrderId: string; amount: number };
  checkoutFailure?: { step?: string; code?: string; message?: string };
}

async function placeOrder(gateway: string, accountId: string, mfcId: string, choice: OrderModeChoice): Promise<RealOrderResult> {
  const token = await customerToken(accountId);
  const call = api(gateway, token);
  const anon = api(gateway, null);

  // 1) 쇼핑 주소 — 담당 센터가 이 화면 센터와 같아야 한다
  const ctx = await call<{ shoppingAddressId?: string | null; mfcId?: string }>('ADDRESS', 'GET', '/me/shopping-context');
  if (!ctx.shoppingAddressId) throw new StepError('ADDRESS', 'NO_SHOPPING_ADDRESS', '이 고객은 쇼핑 주소가 없습니다');
  if (ctx.mfcId !== mfcId) throw new StepError('ADDRESS', 'MFC_MISMATCH', `이 고객 쇼핑 주소의 담당 센터는 ${ctx.mfcId ?? '없음'} — 화면 센터 ${mfcId} 와 다름`);

  // 2) 배송 방식 — 지금 되는 방식(00:00~08:00 은 한집·알뜰 NIGHT_TIME)
  const opts = await call<{ options?: { mode: OrderMode; availability: string; unavailableReason?: string | null }[] }>(
    'MODE',
    'GET',
    `/delivery-options?mfcId=${encodeURIComponent(mfcId)}`,
  );
  const avail = ORDER_MODES.filter((m) => opts.options?.some((o) => o.mode === m && o.availability === 'AVAILABLE'));
  let mode: OrderMode;
  if (choice === 'RANDOM') {
    const m = randomMode(avail, Math.random);
    if (!m) throw new StepError('MODE', 'NO_MODE_AVAILABLE', '지금 되는 배송 방식이 없습니다');
    mode = m;
  } else {
    mode = choice;
    if (!avail.includes(mode)) {
      const why = opts.options?.find((o) => o.mode === mode)?.unavailableReason ?? 'UNAVAILABLE';
      const night = why === 'NIGHT_TIME' && avail.includes('SCHEDULED');
      throw new StepError('MODE', why, night ? '00:00~08:00 은 한집·알뜰 배송이 없습니다 — 예약으로 넣을까요?' : `${mode} 배송이 지금 안 됩니다`, night);
    }
  }

  // 3) 예약 시간대 — 오늘, 없으면 내일
  let windows: SlotView[] = [];
  if (mode === 'SCHEDULED') {
    for (const d of [0, 1]) {
      const r = await call<{ slots?: SlotView[] }>('SLOT', 'GET', `/slots?mfcId=${encodeURIComponent(mfcId)}&date=${seoulDate(Date.now(), d)}`);
      windows = selectableSlots(r.slots ?? [], Date.now(), REAL_ORDER.slotCutoffMarginMin);
      if (windows.length) break;
    }
    windows = slotOrder(windows, choice === 'RANDOM', REAL_ORDER.randomSlotPool, Math.random).slice(0, 2);
    if (!windows.length) throw new StepError('SLOT', 'NO_SLOT', '오늘·내일 고를 수 있는 예약 시간대가 없습니다 — 주문을 넣지 않았습니다');
  }

  // 4) 장바구니에 담기 — 이미 있는 SKU 는 건드리지 않는다
  const cart0 = await call<Cart>('CART', 'POST', '/carts', { body: {} });
  const min = cart0.minOrderAmount;
  if (typeof min !== 'number') throw new StepError('CART', 'MIN_ORDER_UNKNOWN', '최소 주문 금액을 모릅니다(장바구니 minOrderAmount 없음)');
  const search = await anon<{ items?: ProductHit[] }>('SEARCH', 'GET', `/search/products?mfcId=${encodeURIComponent(mfcId)}&size=200`);
  const cands = orderCandidates(search.items ?? [], new Set(cart0.items.map((i) => i.sku)), { min: REAL_ORDER.priceMin, max: REAL_ORDER.priceMax }, Math.random);
  const mine: { cartItemId: string; sku: string; name: string; price: number }[] = [];
  let version = cart0.cartVersion;
  const cartId = cart0.cartId;
  const cleanup = async () => {
    for (const it of mine) {
      try {
        const r = await call<{ cartVersion?: number; version?: number }>('CART', 'DELETE', `/carts/${encodeURIComponent(cartId)}/items/${encodeURIComponent(it.cartItemId)}`, { version });
        version = r.cartVersion ?? r.version ?? version;
      } catch {
        /* 남아도 주문과 무관 — 장바구니에 담긴 채로 둔다 */
      }
    }
  };
  const addUntil = async (need: number) => {
    let sum = 0;
    while (sum < need && cands.length && mine.length < REAL_ORDER.maxItems) {
      const c = cands.shift()!;
      let r: { cartVersion?: number; version?: number; cartItemId?: string; resultId?: string; cart?: Cart };
      try {
        r = await call('CART', 'POST', `/carts/${encodeURIComponent(cartId)}/items`, { body: { sku: c.sku, quantity: 1, selected: true, expectedVersion: version }, version });
      } catch (e) {
        if (e instanceof StepError && e.code.endsWith('VERSION_CONFLICT')) {
          version = (await call<Cart>('CART', 'GET', `/carts/${encodeURIComponent(cartId)}`)).cartVersion;
        }
        continue; // 판매 안 됨·가용 부족·상한 — 다음 상품
      }
      version = r.cartVersion ?? r.version ?? version;
      const itemId = r.cartItemId ?? r.resultId;
      const line = r.cart?.items.find((i) => i.cartItemId === itemId);
      if (!itemId) continue;
      mine.push({ cartItemId: itemId, sku: c.sku, name: line?.display?.name ?? c.name, price: line?.display?.unitPrice ?? c.price });
      if (line?.display?.availability && line.display.availability !== 'AVAILABLE') {
        // 담기는 됐지만 출하 가능 수량이 모자람 — 빼고 다음
        const it = mine.pop()!;
        try {
          const d = await call<{ cartVersion?: number; version?: number }>('CART', 'DELETE', `/carts/${encodeURIComponent(cartId)}/items/${encodeURIComponent(it.cartItemId)}`, { version });
          version = d.cartVersion ?? d.version ?? version;
        } catch {
          /* 둔다 */
        }
        continue;
      }
      sum += mine[mine.length - 1].price;
    }
    return sum;
  };

  try {
    const got = await addUntil(min);
    if (got < min) throw new StepError('CART', 'NOT_ENOUGH_ITEMS', `담을 수 있는 상품으로 최소 주문 ${min.toLocaleString()}원을 못 채웠습니다(${got.toLocaleString()}원)`);

    // 5) 주문 초안 — 견적 부족액이 남으면 더 담고 다시(할인 뒤 상품액 기준)
    const makeDraft = async (w: SlotView | undefined): Promise<Draft> => {
      for (let round = 0; round < 3; round++) {
        const d = await call<Draft>('DRAFT', 'POST', '/order-drafts', {
          body: {
            purchaseIntentId: randomUUID(),
            items: mine.map((m) => ({ cartItemId: m.cartItemId, sku: m.sku, quantity: 1 })),
            shoppingAddressId: ctx.shoppingAddressId,
            expectedMfcId: mfcId,
            deliveryMode: mode,
            ...(w?.window ? { arrivalWindow: w.window } : {}),
            outOfStockPreference: 'CANCEL_OOS_ONLY',
          },
        });
        const short = d.quote?.minOrderShortfall ?? 0;
        if (short <= 0) return d;
        if ((await addUntil(short)) < short) throw new StepError('DRAFT', 'MIN_ORDER_AMOUNT', `견적이 최소 주문보다 ${short.toLocaleString()}원 모자랍니다`);
      }
      throw new StepError('DRAFT', 'MIN_ORDER_AMOUNT', '견적이 최소 주문을 넘지 못했습니다');
    };

    // 6) 결제 진입 → 결제창 정보(PAY)까지. 예약은 슬롯 문제면 다음 시간대로 한 번만 다시
    let draft: Draft | null = null;
    let used: SlotView | undefined;
    for (let attempt = 0; attempt < Math.max(1, windows.length); attempt++) {
      used = windows[attempt];
      const d = await makeDraft(used);
      if (d.blockers?.length) {
        const b = d.blockers[0];
        if (mode === 'SCHEDULED' && attempt + 1 < windows.length && (b.code === 'SLOT_UNAVAILABLE' || b.code === 'SLOT_REQUIRED')) continue;
        throw new StepError('DRAFT', b.code, b.detail ?? '결제 진입을 막는 사유가 있습니다');
      }
      await call('CHECKOUT', 'POST', `/order-drafts/${encodeURIComponent(d.draftId)}/checkouts`, {
        body: { acceptedQuoteVersion: d.quote?.quoteVersion, paymentMethod: 'TOSS_PAYMENTS' },
        version: d.version,
      });
      const until = Date.now() + REAL_ORDER.checkoutWaitSec * 1000;
      let cur: Draft = d;
      while (Date.now() < until) {
        await sleep(REAL_ORDER.pollMs);
        cur = await call<Draft>('CHECKOUT', 'GET', `/order-drafts/${encodeURIComponent(d.draftId)}`);
        if (cur.nextAction === 'PAY' && cur.payment) break;
        if (cur.nextAction === 'REVIEW' || cur.nextAction === 'EXPIRED' || cur.checkoutFailure) break;
      }
      if (cur.nextAction === 'PAY' && cur.payment) {
        draft = cur;
        break;
      }
      const f = cur.checkoutFailure;
      if (mode === 'SCHEDULED' && attempt + 1 < windows.length && slotRetryable(f?.code)) continue;
      throw new StepError('CHECKOUT', f?.code ?? cur.nextAction ?? 'WAIT_TIMEOUT', f?.message ?? `결제 진입이 ${REAL_ORDER.checkoutWaitSec}초 안에 끝나지 않았습니다(상태 ${cur.status ?? '?'})`);
    }
    if (!draft?.payment) throw new StepError('CHECKOUT', 'NO_PAYMENT', '결제 정보를 받지 못했습니다');
    const ordered = mine.map((m) => ({ sku: m.sku, name: m.name, qty: 1 }));
    mine.length = 0; // 이제 장바구니 품목은 주문이 쓴다 — 지우지 않는다

    // 7) 시험 승인 — 응답을 놓치면 다시 보내지 않고 결제 상태로 확인(payment 계약)
    const pg = draft.payment.pgOrderId;
    let stage: string | undefined;
    try {
      const p = await call<{ stage?: string; failure?: { code?: string; message?: string } }>('PAY', 'POST', '/payment-confirmations', {
        body: { orderId: pg, paymentKey: `TEST_AUTO_${pg}`, amount: draft.payment.amount },
      });
      stage = p.stage;
      if (stage !== 'APPROVED' && p.failure) throw new StepError('PAY', p.failure.code ?? stage ?? 'NOT_APPROVED', p.failure.message ?? '');
    } catch (e) {
      if (!(e instanceof NoResponse)) throw e;
    }
    for (let i = 0; stage !== 'APPROVED' && i < 10; i++) {
      await sleep(REAL_ORDER.pollMs);
      stage = (await call<{ stage?: string }>('PAY', 'GET', `/payments/${encodeURIComponent(pg)}`)).stage;
    }
    if (stage !== 'APPROVED') throw new StepError('PAY', stage ?? 'UNKNOWN', `승인 결과를 아직 모릅니다(결제 ${pg}) — 다시 넣지 말고 실제 주문 탭에서 확인하세요`);

    // 8) 주문번호 — 확정이 조금 늦을 수 있다
    const orderId = draft.orderId ?? '';
    let orderNumber: string | null = null;
    const until = Date.now() + REAL_ORDER.orderNumberWaitSec * 1000;
    while (orderId && !orderNumber && Date.now() < until) {
      const o = await call<{ orderNumber?: string | null } | null>('ORDER', 'GET', `/orders/${encodeURIComponent(orderId)}`, { ok404: true }).catch(() => null);
      orderNumber = o?.orderNumber ?? null;
      if (!orderNumber) await sleep(REAL_ORDER.pollMs);
    }
    return {
      ok: true,
      orderId,
      orderNumber,
      mode,
      window: used?.window ?? null,
      amount: draft.payment.amount,
      items: ordered,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

function isLoopback(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const CHOICES = new Set<string>([...ORDER_MODES, 'RANDOM']);

export function realOrderPlugin(gateway: string): Plugin {
  let busy = false;
  return {
    name: 'pmart-real-order',
    configureServer(server) {
      server.middlewares.use('/sim-order', (req, res) => {
        if (!isLoopback(req)) return send(res, 403, { ok: false, step: 'LOCAL', code: 'LOOPBACK_ONLY', detail: '이 PC 에서만 주문을 넣을 수 있습니다' });
        if (req.method !== 'POST') return send(res, 405, { ok: false, step: 'LOCAL', code: 'METHOD_NOT_ALLOWED', detail: '' });
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString('utf-8')));
        req.on('end', () => {
          let body: { customer?: string; mode?: string; mfcId?: string };
          try {
            body = JSON.parse(raw || '{}');
          } catch {
            return send(res, 400, { ok: false, step: 'LOCAL', code: 'BAD_JSON', detail: '' });
          }
          const cust = REAL_ORDER.customers.find((c) => c.key === body.customer);
          if (!cust) return send(res, 400, { ok: false, step: 'LOCAL', code: 'CUSTOMER_NOT_IN_LIST', detail: '고객 목록에 없음' });
          if (!body.mode || !CHOICES.has(body.mode)) return send(res, 400, { ok: false, step: 'LOCAL', code: 'BAD_MODE', detail: '' });
          if (!body.mfcId) return send(res, 400, { ok: false, step: 'LOCAL', code: 'NO_MFC', detail: '' });
          if (busy) return send(res, 409, { ok: false, step: 'LOCAL', code: 'BUSY', detail: '앞 주문을 넣는 중입니다' });
          busy = true;
          placeOrder(gateway, cust.accountId, body.mfcId, body.mode as OrderModeChoice)
            .then((r) => {
              if (r.ok) server.config.logger.info(`[sim-order] ${cust.key}: 주문 ${r.orderNumber ?? r.orderId} ${r.mode} ${r.amount}원`);
              send(res, 200, r);
            })
            .catch((e: unknown) => {
              const r: RealOrderResult =
                e instanceof StepError
                  ? { ok: false, step: e.step, code: e.code, detail: e.message, askScheduled: e.askScheduled || undefined }
                  : e instanceof NoResponse
                    ? { ok: false, step: 'NETWORK', code: 'NO_RESPONSE', detail: `${e.message} 응답 없음 — 결과 불명, 실제 주문 탭에서 확인하세요` }
                    : { ok: false, step: 'LOCAL', code: 'INTERNAL', detail: (e as Error).message };
              if (!r.ok) server.config.logger.warn(`[sim-order] ${cust.key}: ${r.step} ${r.code}`);
              send(res, 200, r);
            })
            .finally(() => (busy = false));
        });
      });
    },
  };
}
