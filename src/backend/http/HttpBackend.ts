// 게이트웨이(/api/v1) 실호출 어댑터. 계약 mfc-fulfillment-service.yaml·mfc-capacity-service.yaml 그대로 부른다.
// 2026-11-16: 작업 목록·상세·작업자 목록(읽기)은 LAN 실서버로 확인. 쓰기(시작·실적·밀봉·인계)는 아직 실서버 검증 전.
// 토큰은 Vite 개발 서버가 LAN 시험 계정으로 받아 준다(TokenSource, SIM-11).

import {
  ApiProblem,
  ResultUnknown,
  type CapacityWorker,
  type CenterStock,
  type CommandResponse,
  type HandoverAuthorization,
  type HandoverCommitResult,
  type Package,
  type Problem,
  type SealPackageRequest,
  type Shipment,
  type TaskDetail,
  type TaskExecution,
  type TaskExecutionRequest,
  type TaskState,
  type TaskSummary,
} from '../../domain/contract';
import type { ApiListener, FulfillmentPort } from '../port';

export interface HttpOptions {
  /** 기본 '/api/v1' — vite 개발 서버가 게이트웨이로 넘긴다 */
  baseUrl: string;
  /** 작업자 토큰 — TokenSource.get (만료 전에 새로 받는다) */
  token: () => string | null | Promise<string | null>;
  sourceSystem: string;
  now: () => number;
  timeoutMs: number;
}

export class HttpBackend implements FulfillmentPort {
  readonly mode = 'http' as const;
  private readonly listeners: ApiListener[] = [];

  constructor(private readonly opt: HttpOptions) {}

  onApi(l: ApiListener) {
    this.listeners.push(l);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; idempotencyKey?: string; expectedVersion?: number } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = await this.opt.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers['X-Source-System'] = this.opt.sourceSystem;
      if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
      if (init.expectedVersion !== undefined) headers['X-Expected-Version'] = String(init.expectedVersion);
    }
    const t0 = performance.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opt.timeoutMs);
    const log = (status: number | 'ERR', code?: string) => {
      for (const l of this.listeners)
        l({ at: this.opt.now(), method, path, status, code, ms: performance.now() - t0 });
    };
    let res: Response;
    try {
      res = await fetch(`${this.opt.baseUrl}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctl.signal,
      });
    } catch (e) {
      log('ERR', 'NO_RESPONSE');
      // 타임아웃·연결 끊김 = 결과 불명. 실패로 단정하지 않고 같은 키 재전송/원결과 조회로 해소한다.
      throw new ResultUnknown(`${method} ${path}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    const json = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const p = (json ?? {}) as Partial<Problem> & { title?: string };
      const problem: Problem = {
        status: res.status,
        code: p.code ?? (res.status === 501 ? 'UNSUPPORTED_ACTION' : `HTTP_${res.status}`),
        detail: p.detail ?? p.title,
        retryable: p.retryable,
      };
      log(res.status, problem.code);
      throw new ApiProblem(problem);
    }
    log(res.status);
    return json as T;
  }

  /** 센터 작업 목록 — 페이지를 끝까지 따라간다(최대 maxPages). */
  async listTasks(mfcId: string, states: TaskState[], maxPages = 10): Promise<TaskSummary[]> {
    const out: TaskSummary[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < maxPages; i++) {
      const q = new URLSearchParams({ mfcId, pageSize: '100' });
      for (const s of states) q.append('state', s);
      if (cursor) q.set('cursor', cursor);
      const r: { items?: TaskSummary[]; page?: { nextCursor?: string | null } } = await this.request('GET', `/tasks?${q}`);
      out.push(...(r.items ?? []));
      cursor = r.page?.nextCursor ?? null;
      if (!cursor) break;
    }
    return out;
  }

  /** mfc-capacity listWorkers — 담당자 표시 이름용(그 센터 운영자면 읽을 수 있다). */
  async listWorkers(mfcId: string): Promise<CapacityWorker[]> {
    const r = await this.request<{ items?: CapacityWorker[] }>('GET', `/mfcs/${enc(mfcId)}/workers`);
    return r.items ?? [];
  }

  /** mfc-inventory getCenterStock — SKU 하나의 위치·상태별 수량(그 센터 운영자). SKU 마다 한 번씩만 부른다(SIM-5) */
  getCenterStock(mfcId: string, sku: string): Promise<CenterStock> {
    return this.request('GET', `/mfcs/${enc(mfcId)}/stock?${new URLSearchParams({ sku })}`);
  }

  getTask(taskId: string): Promise<TaskDetail> {
    return this.request('GET', `/tasks/${enc(taskId)}`);
  }

  startTask(
    taskId: string,
    body: { workerId: string; assignmentVersion: number; deviceId?: string },
    idempotencyKey: string,
    expectedVersion?: number,
  ): Promise<CommandResponse> {
    return this.request('POST', `/tasks/${enc(taskId)}/starts`, { body, idempotencyKey, expectedVersion });
  }

  recordExecution(taskId: string, body: TaskExecutionRequest, idempotencyKey: string): Promise<CommandResponse> {
    return this.request('POST', `/tasks/${enc(taskId)}/executions`, { body, idempotencyKey });
  }

  getExecution(taskId: string, executionId: string): Promise<TaskExecution> {
    return this.request('GET', `/tasks/${enc(taskId)}/executions/${enc(executionId)}`);
  }

  getShipment(shipmentId: string): Promise<Shipment> {
    return this.request('GET', `/shipments/${enc(shipmentId)}`);
  }

  sealPackage(shipmentId: string, body: SealPackageRequest, idempotencyKey: string): Promise<Package> {
    return this.request('POST', `/shipments/${enc(shipmentId)}/packages`, { body, idempotencyKey });
  }

  authorizeHandover(
    packageId: string,
    body: { riderId: string; deliveryId: string; scannedCode: string; scannedAt?: string },
    idempotencyKey: string,
  ): Promise<HandoverAuthorization> {
    return this.request('POST', `/packages/${enc(packageId)}/handover-authorizations`, { body, idempotencyKey });
  }

  commitHandover(
    packageId: string,
    body: { handoverAuthorizationId: string; fenceVersion: number; riderId: string; handedOverAt?: string },
    idempotencyKey: string,
  ): Promise<HandoverCommitResult> {
    return this.request('POST', `/packages/${enc(packageId)}/handover-commits`, { body, idempotencyKey });
  }

  /** 연결 점검: 게이트웨이 도달·인증·구현 여부를 한 번에 본다. */
  async probe(mfcId: string): Promise<string> {
    try {
      await this.listTasks(mfcId, ['READY', 'ASSIGNED', 'IN_PROGRESS']);
      return '작업 목록 조회 성공';
    } catch (e) {
      if (e instanceof ApiProblem) {
        const p = e.problem;
        if (p.status === 401) return '401 — 토큰 없음/만료 (개발 서버 /sim-auth/tokens 확인)';
        if (p.status === 403) return '403 — 이 센터 권한 없음';
        if (p.status === 501) return '501 — 백엔드 미구현';
        return `${p.status} ${p.code}`;
      }
      return `응답 없음 — 게이트웨이 주소 확인 (${(e as Error).message})`;
    }
  }
}

const enc = encodeURIComponent;
function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}
