// 게이트웨이(/api/v1) 실호출 어댑터. 계약 mfc-fulfillment-service.yaml 그대로 부른다.
// 2026-10-31 현재 백엔드 슬라이스 6(이행)이 501 이라 이 어댑터는 계약 기준으로만 작성했고 실서버 검증 전이다.
// 막힌 지점은 docs/backend-requests.md 참조 (작업자 인증 BR-02, 센터 전체 작업 목록, 수동 배정 등).

import {
  ApiProblem,
  ResultUnknown,
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
  /** 작업자/단말 토큰 (BR-02 결정 전에는 발급 경로가 없다) */
  token: () => string | null;
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
    const token = this.opt.token();
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

  async listTasks(mfcId: string, states: TaskState[]): Promise<TaskSummary[]> {
    const q = new URLSearchParams({ mfcId });
    for (const s of states) q.append('state', s);
    const r = await this.request<{ items: TaskSummary[] }>('GET', `/tasks?${q}`);
    return r.items ?? [];
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
        if (p.status === 401) return '401 — 토큰 없음/만료 (작업자 인증 BR-02 결정 대기)';
        if (p.status === 403) return '403 — 이 센터 권한 없음';
        if (p.status === 501) return '501 — 백엔드 이행 슬라이스 6 미구현';
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
