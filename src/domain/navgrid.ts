// 보행 격자와 A* 경로 탐색. 셀 0.25m, 8방향(모서리 끼기 금지), 시야선으로 경로 다듬기.
import { YARD_X, type Layout, type Rect } from './layout';

export interface P {
  x: number;
  z: number;
}

const CELL = 0.25;

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly free: Uint8Array;

  constructor(layout: Layout) {
    this.cols = Math.ceil(Math.max(layout.width, YARD_X[1] + 0.5) / CELL); // 앞마당이 건물 동쪽 끝보다 넓다(2026-11-21 재배치)
    this.rows = Math.ceil(layout.depth / CELL);
    this.free = new Uint8Array(this.cols * this.rows);
    const BD = layout.buildingDepth;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * CELL;
        const z = (r + 0.5) * CELL;
        const inside = z < BD || (x > YARD_X[0] && x < YARD_X[1]);
        this.free[r * this.cols + c] = inside ? 1 : 0;
      }
    }
    // 벽은 실제보다 두껍게(0.1m씩) 막아 대각선 새어 나감을 막는다
    for (const w of layout.walls) this.block(w.rect, 0.1);
    for (const o of layout.obstacles) this.block(o.rect, 0.05);
    for (const rk of layout.racks) {
      const hx = rk.along === 'x' ? 0.625 : 0.225;
      const hz = rk.along === 'x' ? 0.225 : 0.625;
      this.block({ x0: rk.cx - hx, z0: rk.cz - hz, x1: rk.cx + hx, z1: rk.cz + hz }, 0.02);
    }
  }

  private block(r: Rect, pad: number) {
    const c0 = Math.max(0, Math.floor((r.x0 - pad) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((r.x1 + pad) / CELL));
    const r0 = Math.max(0, Math.floor((r.z0 - pad) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((r.z1 + pad) / CELL));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const x = (cc + 0.5) * CELL;
        const z = (rr + 0.5) * CELL;
        if (x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad) this.free[rr * this.cols + cc] = 0;
      }
    }
  }

  isFree(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.free[r * this.cols + c] === 1;
  }

  cellOf(p: P): [number, number] {
    return [Math.floor(p.x / CELL), Math.floor(p.z / CELL)];
  }

  /** 막힌 지점이면 가장 가까운 빈 셀로. */
  snap(p: P): [number, number] {
    const [c, r] = this.cellOf(p);
    if (this.isFree(c, r)) return [c, r];
    for (let rad = 1; rad < 12; rad++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          if (!this.isFree(c + dc, r + dr)) continue;
          const d = dc * dc + dr * dr;
          if (d < bestD) {
            bestD = d;
            best = [c + dc, r + dr];
          }
        }
      }
      if (best) return best;
    }
    return [c, r];
  }

  private center(c: number, r: number): P {
    return { x: (c + 0.5) * CELL, z: (r + 0.5) * CELL };
  }

  /** A* 경로. 찾지 못하면 null. 반환 경로는 출발점 제외, 도착점 포함. */
  findPath(from: P, to: P): P[] | null {
    const [sc, sr] = this.snap(from);
    const [gc, gr] = this.snap(to);
    // 격자 밖이면 길 찾기를 하지 않는다(null → 곧장 걷기) — 격자 밖 칸 번호로 A* 가 끝나지 않던 것(11-18 라이더 앞길 끝)
    const out = (c: number, r: number) => c < 0 || r < 0 || c >= this.cols || r >= this.rows;
    if (out(sc, sr) || out(gc, gr)) return null;
    const n = this.cols * this.rows;
    const start = sr * this.cols + sc;
    const goal = gr * this.cols + gc;
    if (start === goal) return [to];

    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const h = (i: number) => {
      const dc = Math.abs((i % this.cols) - gc);
      const dr = Math.abs(Math.floor(i / this.cols) - gr);
      return dc + dr + (Math.SQRT2 - 2) * Math.min(dc, dr);
    };
    g[start] = 0;
    heap.push(start, h(start));
    const dirs = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, Math.SQRT2],
      [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2],
      [-1, -1, Math.SQRT2],
    ];
    while (heap.size > 0) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % this.cols;
      const cr = Math.floor(cur / this.cols);
      for (const [dc, dr, cost] of dirs) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (!this.isFree(nc, nr)) continue;
        if (dc !== 0 && dr !== 0 && (!this.isFree(cc + dc, cr) || !this.isFree(cc, cr + dr))) continue;
        const ni = nr * this.cols + nc;
        if (closed[ni]) continue;
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + h(ni));
        }
      }
    }
    if (came[goal] === -1) return null;
    const cells: number[] = [];
    for (let i = goal; i !== start; i = came[i]) cells.push(i);
    cells.reverse();
    const raw = cells.map((i) => this.center(i % this.cols, Math.floor(i / this.cols)));
    raw[raw.length - 1] = this.isFreeAt(to) ? to : raw[raw.length - 1];
    return this.smooth(this.isFreeAt(from) ? from : this.center(sc, sr), raw);
  }

  isFreeAt(p: P): boolean {
    const [c, r] = this.cellOf(p);
    return this.isFree(c, r);
  }

  /** 두 점 사이가 막힘 없이 보이는지 (0.1m 간격 표본). */
  lineOfSight(a: P, b: P): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 0.1);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      // 몸 폭을 고려해 양옆도 본다
      const nx = (-dz / len) * 0.12;
      const nz = (dx / len) * 0.12;
      if (!this.isFreeAt({ x, z }) || !this.isFreeAt({ x: x + nx, z: z + nz }) || !this.isFreeAt({ x: x - nx, z: z - nz }))
        return false;
    }
    return true;
  }

  private smooth(from: P, pts: P[]): P[] {
    const out: P[] = [];
    let anchor = from;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineOfSight(anchor, pts[j])) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastI = this.items.pop()!;
    const lastK = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastI;
      this.keys[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.items.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

export function pathLength(from: P, path: P[]): number {
  let len = 0;
  let prev = from;
  for (const p of path) {
    len += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return len;
}
