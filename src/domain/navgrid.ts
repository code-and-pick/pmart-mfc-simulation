// 보행 격자와 A* 경로 탐색. 셀 0.25m, 8방향(모서리 끼기 금지), 시야선으로 경로 다듬기.
import type { Layout, Rect } from './layout';

export interface P {
  x: number;
  z: number;
}

const CELL = 0.25;
/**
 * 롤테이너를 미는 사람(입고)의 길 — 롤테이너(폭 0.46 m)가 몸 앞 0.47~1.09 m 에 있어 사람 폭(0.12 m)만 보고 낸 길로는
 * 벽·랙·팔레트에 바짝 붙어 롤테이너가 뚫고 지나갔다(사용자 2026-11-24 "입고자 통로 동선 무시하고 장애물 통과하고 길을 개척하던데").
 * 장애물과의 거리가 이보다 가까운 칸은 걸음값을 더 매겨 통로 한가운데로 걷게 한다(좁은 통로는 그래도 지난다) [시뮬]
 */
const CART_CLEAR = 0.75;
/** 장애물에 바로 붙은 칸 한 걸음에 더하는 값(가까울수록 비례해서) [시뮬] */
const CART_NEAR_COST = 4;
/** 롤테이너 길을 다듬을 때 몸·롤테이너 반폭 — 이만큼 양옆이 비어야 곧장 간다 [시뮬] */
const CART_HALF = 0.25;
/** 롤테이너 앞끝까지(사람 가운데에서) — 멈춘 자리에서 롤테이너 놓을 방향을 고를 때 [시뮬] */
const CART_REACH = 1.1;

export interface PathOpts {
  /** 롤테이너를 밀고 간다 — 장애물에서 떨어진 통로 가운데 길 */
  cart?: boolean;
}

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly free: Uint8Array;
  /** 칸 가운데에서 가장 가까운 막힌 칸까지(m) */
  private readonly clear: Float32Array;

  constructor(layout: Layout) {
    const YARD_X = layout.geo.yardX;
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
    this.clear = this.clearance();
  }

  /** 막힌 칸까지 거리(m) — 8방향 거리 변환 두 번 훑기. 막힌 칸 0, 붙은 칸 0.25 */
  private clearance(): Float32Array {
    const { cols, rows } = this;
    const d = new Float32Array(cols * rows);
    for (let i = 0; i < d.length; i++) d[i] = this.free[i] ? 1e6 : 0;
    const D = CELL * Math.SQRT2;
    const pass = (r: number, c: number, dr: number, dc: number, w: number, i: number) => {
      const nr = r + dr, nc = c + dc;
      const v = nr < 0 || nc < 0 || nr >= rows || nc >= cols ? 0 : d[nr * cols + nc];
      if (v + w < d[i]) d[i] = v + w;
    };
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!d[i]) continue;
        pass(r, c, 0, -1, CELL, i), pass(r, c, -1, 0, CELL, i), pass(r, c, -1, -1, D, i), pass(r, c, -1, 1, D, i);
      }
    for (let r = rows - 1; r >= 0; r--)
      for (let c = cols - 1; c >= 0; c--) {
        const i = r * cols + c;
        if (!d[i]) continue;
        pass(r, c, 0, 1, CELL, i), pass(r, c, 1, 0, CELL, i), pass(r, c, 1, 1, D, i), pass(r, c, 1, -1, D, i);
      }
    return d;
  }

  /** 롤테이너 놓을 방향 — 지금 방향(heading)에서 가장 덜 돌려, 몸 앞 CART_REACH 까지 롤테이너 폭이 비는 방향. 없으면 그대로 */
  cartHeading(p: P, heading: number): number {
    for (let k = 0; k <= 8; k++) {
      for (const s of k === 0 || k === 8 ? [1] : [1, -1]) {
        const h = heading + (s * k * Math.PI) / 8;
        const fx = Math.sin(h), fz = Math.cos(h);
        let ok = true;
        for (let d = 0.45; d <= CART_REACH + 1e-6 && ok; d += 0.1) {
          for (const w of [-0.23, 0, 0.23]) {
            if (!this.isFreeAt({ x: p.x + fx * d + fz * w, z: p.z + fz * d - fx * w })) {
              ok = false;
              break;
            }
          }
        }
        if (ok) return h;
      }
    }
    return heading;
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

  /** A* 경로. 찾지 못하면 null. 반환 경로는 출발점 제외, 도착점 포함. cart: 장애물에서 떨어진 통로 가운데 길(롤테이너) */
  findPath(from: P, to: P, opts: PathOpts = {}): P[] | null {
    return this.search(from, to, !!opts.cart);
  }

  private search(from: P, to: P, cart: boolean): P[] | null {
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
        // 롤테이너: 장애물에 가까운 칸일수록 걸음값을 더 — 통로 가운데로
        const ng = g[cur] + cost * (cart ? 1 + CART_NEAR_COST * Math.max(0, 1 - this.clear[ni] / CART_CLEAR) : 1);
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
    if (this.isFreeAt(from)) return this.smooth(from, raw, cart);
    // 막힌 곳에서 출발 — 먼저 가까운 빈 칸으로 나온다(전엔 빈 칸을 기준으로 다듬은 길을 출발점에서 곧장 걸어 장애물을 스쳤다)
    const s = this.center(sc, sr);
    return [s, ...this.smooth(s, raw, cart)];
  }

  isFreeAt(p: P): boolean {
    const [c, r] = this.cellOf(p);
    return this.isFree(c, r);
  }

  /** 두 점 사이가 막힘 없이 보이는지 (0.1m 간격 표본). half: 양옆 반폭, floor: 지나는 곳이 막힌 칸에서 이만큼은 떨어져야(m) */
  lineOfSight(a: P, b: P, half = 0.12, floor = 0): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 0.1);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      // 몸 폭을 고려해 양옆도 본다
      const nx = (-dz / len) * half;
      const nz = (dx / len) * half;
      if (!this.isFreeAt({ x, z }) || !this.isFreeAt({ x: x + nx, z: z + nz }) || !this.isFreeAt({ x: x - nx, z: z - nz }))
        return false;
      if (floor > 0 && this.clearAt({ x, z }) < floor) return false;
    }
    return true;
  }

  /** 그 점의 칸에서 막힌 칸까지(m), 격자 밖·막힌 칸 0 */
  clearAt(p: P): number {
    const [c, r] = this.cellOf(p);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? 0 : this.clear[r * this.cols + c];
  }

  /**
   * 시야선으로 경로 다듬기. cart: 롤테이너 폭(CART_HALF)으로 보고, 건너뛰는 칸들만큼은 장애물에서 떨어져 지나야 곧장 간다
   * — 통로 가운데로 낸 길을 다듬으면서 다시 벽·랙 모서리에 붙지 않게
   */
  private smooth(from: P, pts: P[], cart = false): P[] {
    const out: P[] = [];
    let anchor = from;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      // 건너뛰는 칸들 가운데 가장 장애물에 가까운 거리(앞에서부터 한 번에) — floor[j] = anchor·pts[i..j] 의 최소
      let floor: Float32Array | null = null;
      if (cart) {
        floor = new Float32Array(pts.length);
        let m = Math.min(CART_CLEAR, this.clearAt(anchor));
        for (let k = i; k < pts.length; k++) floor[k] = m = Math.min(m, this.clearAt(pts[k]));
      }
      while (j > i && !this.lineOfSight(anchor, pts[j], cart ? CART_HALF : 0.12, floor ? floor[j] - 1e-3 : 0)) j--;
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
