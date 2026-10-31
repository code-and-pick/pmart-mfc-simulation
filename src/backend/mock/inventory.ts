// mfc-inventory 의미를 흉내 내는 원장. 수량 기호는 MFC 3장: H 현물, Q 격리(⊂H), E 판매적합, R 유효 예약, A = E − R.
// 불변식 0 ≤ R ≤ E ≤ H, 0 ≤ Q ≤ H.
//
// 업무 위치 축(WorkState: UNSTOWED/STORED/PICKED/PACKED)은 총량과 별개로 둔다 — 계약 CommitTaskExecution 설명:
//   PUTAWAY UNSTOWED→STORED, PICK STORED→PICKED, PACK PICKED→PACKED, MOVE 위치 이동.
// STORED 는 위치가 두 종류다: 피킹 전면 선반(shelf)과 보충재고 팔레트(reserve).
// 그래서 H = unstowed + shelf + reserve + picked + packed + D(실사 전 차이) 가 늘 성립해야 한다.
//
// 수량 변화 (MFC 3장)
//   TIN 수령(IV-02)     H+q, E+q, unstowed+q   ※ 현재 백엔드 구현처럼 검수 단계 없이 정상=H+E
//   적치·보충(IV-03/04)  총량 불변, 위치만
//   피킹·패킹(IV-07)     총량 불변, 업무 상태만
//   인계(IV-08)          H−q, E−q, R−q 한 사건
//   결품(IV-09)          H 불변, E−q, R−q, D+q

export interface Balance {
  sku: string;
  H: number;
  Q: number;
  E: number;
  R: number;
  D: number;
  unstowed: number;
  shelf: number;
  reserve: number;
  picked: number;
  packed: number;
}

export interface Reservation {
  reservationId: string;
  orderId: string;
  state: 'HELD' | 'CONFIRMED' | 'CONSUMED' | 'RELEASED';
  lines: { sku: string; qty: number; consumed: number }[];
}

export class InventoryError extends Error {
  constructor(
    readonly code: 'INSUFFICIENT_STOCK' | 'INVALID_STATE',
    msg: string,
  ) {
    super(msg);
  }
}

export class InventoryLedger {
  private readonly balances = new Map<string, Balance>();
  private readonly reservations = new Map<string, Reservation>();
  private commitSeq = 0;
  readonly violations: string[] = [];
  /** 선반 수량이 바뀐 SKU (화면이 다시 그린다) */
  readonly dirty = new Set<string>();

  seed(sku: string, shelf: number, reserve = 0) {
    const h = shelf + reserve;
    this.balances.set(sku, { sku, H: h, Q: 0, E: h, R: 0, D: 0, unstowed: 0, shelf, reserve, picked: 0, packed: 0 });
    this.dirty.add(sku);
  }

  get(sku: string): Balance | undefined {
    return this.balances.get(sku);
  }

  all(): Balance[] {
    return [...this.balances.values()];
  }

  available(sku: string): number {
    const b = this.balances.get(sku);
    return b ? b.E - b.R : 0;
  }

  private must(sku: string): Balance {
    const b = this.balances.get(sku);
    if (!b) throw new InventoryError('INVALID_STATE', `SKU 없음 ${sku}`);
    return b;
  }

  /** ReserveInventory: 전부 또는 전무 (S1-b). */
  reserve(reservationId: string, orderId: string, lines: { sku: string; qty: number }[]): boolean {
    const need = new Map<string, number>();
    for (const l of lines) need.set(l.sku, (need.get(l.sku) ?? 0) + l.qty);
    for (const [sku, q] of need) if (this.available(sku) < q) return false;
    for (const [sku, q] of need) this.must(sku).R += q;
    this.reservations.set(reservationId, {
      reservationId,
      orderId,
      state: 'CONFIRMED', // 시뮬은 결제 승인 뒤 확정된 주문만 다룬다
      lines: [...need].map(([sku, qty]) => ({ sku, qty, consumed: 0 })),
    });
    this.check([...need.keys()]);
    return true;
  }

  // ── 입고 ───────────────────────────────────────────
  /** ConfirmReceipt (TIN): 실제 인수 수량만 H 를 늘린다. */
  receipt(lines: { sku: string; qty: number }[]): string {
    for (const l of lines) {
      const b = this.must(l.sku);
      b.H += l.qty;
      b.E += l.qty;
      b.unstowed += l.qty;
    }
    this.check(lines.map((l) => l.sku));
    return this.commitId();
  }

  /** PUTAWAY: UNSTOWED → STORED(선반 또는 보충재고). */
  putaway(sku: string, qty: number, to: 'shelf' | 'reserve'): string {
    const b = this.must(sku);
    if (b.unstowed < qty) throw new InventoryError('INVALID_STATE', `미적치 수량 부족 ${sku}`);
    b.unstowed -= qty;
    b[to] += qty;
    if (to === 'shelf') this.dirty.add(sku);
    this.check([sku]);
    return this.commitId();
  }

  /** MOVE (자동 보충 MOV, IV-04): 보충재고 → 피킹 전면. */
  move(sku: string, qty: number): string {
    const b = this.must(sku);
    if (b.reserve < qty) throw new InventoryError('INSUFFICIENT_STOCK', `보충재고 부족 ${sku}`);
    b.reserve -= qty;
    b.shelf += qty;
    this.dirty.add(sku);
    this.check([sku]);
    return this.commitId();
  }

  // ── 출고 ───────────────────────────────────────────
  /** 피킹 실행 반영: 총량 불변, 선반 → 작업 중. 선반 잔량이 모자라면 INSUFFICIENT_STOCK. */
  commitPick(lines: { sku: string; qty: number }[]): string {
    for (const l of lines) if (this.must(l.sku).shelf < l.qty) throw new InventoryError('INSUFFICIENT_STOCK', `피킹 위치 잔량 부족 ${l.sku}`);
    for (const l of lines) {
      const b = this.must(l.sku);
      b.shelf -= l.qty;
      b.picked += l.qty;
      this.dirty.add(l.sku);
    }
    this.check(lines.map((l) => l.sku));
    return this.commitId();
  }

  /** 패킹 실행 반영: PICKED→PACKED. */
  commitPack(lines: { sku: string; qty: number }[]): string {
    for (const l of lines) {
      const b = this.must(l.sku);
      b.picked -= l.qty;
      b.packed += l.qty;
    }
    this.check(lines.map((l) => l.sku));
    return this.commitId();
  }

  /**
   * 결품(SHORT) 보고: 장부상 선반에 있어야 할 실물이 없다. H 는 그대로(실사 전), 판매적합 E 에서 빼고 차이 D 로 추적.
   * 고객 사전 선택 "품절 상품만 취소" 로 해당 예약 R 도 해제한다(S2 결품 처리의 단순화).
   */
  commitShortage(reservationId: string, sku: string, qty: number): string {
    const b = this.must(sku);
    const take = Math.min(qty, b.E);
    b.E -= take;
    b.R = Math.max(0, b.R - qty);
    // 장부 위치에서 빠진 만큼을 D 로 옮긴다 (선반 → 보충재고 → 미적치 순)
    let left = qty;
    for (const k of ['shelf', 'reserve', 'unstowed'] as const) {
      const m = Math.min(left, b[k]);
      b[k] -= m;
      left -= m;
    }
    b.D += qty - left;
    this.dirty.add(sku);
    const r = this.reservations.get(reservationId);
    const line = r?.lines.find((l) => l.sku === sku);
    if (line) line.qty -= qty;
    this.check([sku]);
    return this.commitId();
  }

  /** CommitPackageHandover: H−q, E−q, R−q 한 사건 (IV-08). */
  commitHandover(reservationId: string, lines: { sku: string; qty: number }[]): string {
    for (const l of lines) {
      const b = this.must(l.sku);
      b.H -= l.qty;
      b.E -= l.qty;
      b.R -= l.qty;
      b.packed -= l.qty;
      const r = this.reservations.get(reservationId);
      const line = r?.lines.find((x) => x.sku === l.sku);
      if (line) line.consumed += l.qty;
    }
    const r = this.reservations.get(reservationId);
    if (r && r.lines.every((l) => l.consumed >= l.qty)) r.state = 'CONSUMED';
    this.check(lines.map((l) => l.sku));
    return this.commitId();
  }

  private commitId(): string {
    this.commitSeq += 1;
    return `COMMIT-${String(this.commitSeq).padStart(6, '0')}`;
  }

  private check(skus: string[]) {
    if (this.violations.length >= 50) return;
    for (const sku of skus) {
      const b = this.balances.get(sku);
      if (!b) continue;
      const located = b.unstowed + b.shelf + b.reserve + b.picked + b.packed + b.D;
      const ok =
        0 <= b.R && b.R <= b.E && b.E <= b.H && 0 <= b.Q && b.Q <= b.H && located === b.H &&
        b.unstowed >= 0 && b.shelf >= 0 && b.reserve >= 0 && b.picked >= 0 && b.packed >= 0;
      if (!ok) {
        this.violations.push(
          `불변식 위반 ${b.sku}: H${b.H} Q${b.Q} E${b.E} R${b.R} | 미적치${b.unstowed} 선반${b.shelf} 보충${b.reserve} 피킹${b.picked} 포장${b.packed} D${b.D}`,
        );
        if (this.violations.length >= 50) return;
      }
    }
  }
}
