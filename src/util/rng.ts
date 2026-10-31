/** 재현 가능한 난수 (mulberry32). 같은 seed 면 같은 하루가 나온다. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** 지수분포 (포아송 도착 간격). */
  exp(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }
  /** 가중치 배열에서 인덱스 하나. cumulative 는 누적합(마지막 = 총합). */
  weighted(cumulative: number[]): number {
    const r = this.next() * cumulative[cumulative.length - 1];
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

let seq = 0;
/** 요청·사건 식별자. 실서버 모드에서 Idempotency-Key 로도 쓴다. */
export function newId(prefix: string): string {
  seq += 1;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${rnd}`;
}
