// 운영 지표. 계약상 "서버 확정" 시점 기준으로 센다: 출하 준비 = ShipmentReady, 인계 = PackageHandedOver(commit 성공).

export interface OrderTrace {
  orderId: string;
  confirmedAt: number;
  pickStartAt?: number;
  pickDoneAt?: number;
  packQueuedAt?: number;
  packStartAt?: number;
  readyAt?: number;
  handedOverAt?: number;
  units: number;
  shipments: number;
}

export class Metrics {
  ordersCreated = 0;
  ordersBlockedStock = 0;
  shortageUnits = 0;
  apiErrors = 0;
  readonly inbound = {
    trucksArrived: 0,
    trucksReceived: 0,
    receivedUnits: 0,
    putawayShelfUnits: 0,
    putawayReserveUnits: 0,
    replenishMoves: 0,
    replenishUnits: 0,
    /** 피킹 칸이 비어 보충을 기다린 횟수·시간 */
    pickWaits: 0,
    pickWaitSec: 0,
  };
  readonly traces = new Map<string, OrderTrace>();
  private readonly readyTimes: number[] = [];
  private readonly handoverTimes: number[] = [];

  trace(orderId: string): OrderTrace | undefined {
    return this.traces.get(orderId);
  }

  markReady(orderId: string, at: number) {
    const t = this.traces.get(orderId);
    if (t && t.readyAt === undefined) {
      t.readyAt = at;
      this.readyTimes.push(at);
    }
  }
  markHandedOver(orderId: string, at: number) {
    const t = this.traces.get(orderId);
    if (t && t.handedOverAt === undefined) {
      t.handedOverAt = at;
      this.handoverTimes.push(at);
    }
  }

  /** 최근 1시간 출하 준비 건수 */
  readyLastHour(now: number): number {
    return this.readyTimes.filter((t) => t > now - 3600).length;
  }

  summary() {
    const done = [...this.traces.values()].filter((t) => t.readyAt !== undefined);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const p90 = (xs: number[]) => {
      if (!xs.length) return NaN;
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
    };
    const lead = done.map((t) => t.readyAt! - t.confirmedAt);
    const pick = done.filter((t) => t.pickStartAt && t.pickDoneAt).map((t) => t.pickDoneAt! - t.pickStartAt!);
    const queue = done.filter((t) => t.packQueuedAt && t.packStartAt).map((t) => t.packStartAt! - t.packQueuedAt!);
    const waitAssign = done.filter((t) => t.pickStartAt).map((t) => t.pickStartAt! - t.confirmedAt);
    const handed = [...this.traces.values()].filter((t) => t.handedOverAt !== undefined);
    return {
      ready: done.length,
      handedOver: handed.length,
      leadAvg: avg(lead),
      leadP90: p90(lead),
      pickAvg: avg(pick),
      packQueueAvg: avg(queue),
      assignWaitAvg: avg(waitAssign),
    };
  }
}

export function fmtDur(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}분 ${String(s).padStart(2, '0')}초` : `${s}초`;
}

export function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
