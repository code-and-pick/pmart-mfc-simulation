// mfc-inventory 의미를 흉내 내는 원장. 수량 기호는 MFC 3장: H 현물, Q 격리(⊂H), E 판매적합, R 유효 예약, A = E − R.
// 불변식 0 ≤ R ≤ E ≤ H, 0 ≤ Q ≤ H. 피킹·포장은 수량을 바꾸지 않고(IV-07), 인계 때 H·E·R 를 같은 사건에서 줄인다(IV-08).

export interface Balance {
  sku: string;
  H: number;
  Q: number;
  E: number;
  R: number;
  /** 결품 보고로 판매적합에서 뺀 차이(실사 전) — IV-09 의 D */
  D: number;
  /** 업무 위치 축: 선반에서 꺼내 작업 중인 수량 (STORED→PICKED→PACKED). 총량과 별개 */
  picked: number;
  packed: number;
}

export interface Reservation {
  reservationId: string;
  orderId: string;
  state: 'HELD' | 'CONFIRMED' | 'CONSUMED' | 'RELEASED';
  lines: { sku: string; qty: number; consumed: number }[];
}

export class InventoryLedger {
  private readonly balances = new Map<string, Balance>();
  private readonly reservations = new Map<string, Reservation>();
  private commitSeq = 0;
  readonly violations: string[] = [];

  seed(sku: string, qty: number) {
    this.balances.set(sku, { sku, H: qty, Q: 0, E: qty, R: 0, D: 0, picked: 0, packed: 0 });
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

  /** ReserveInventory: 전부 또는 전무 (S1-b). */
  reserve(reservationId: string, orderId: string, lines: { sku: string; qty: number }[]): boolean {
    const need = new Map<string, number>();
    for (const l of lines) need.set(l.sku, (need.get(l.sku) ?? 0) + l.qty);
    for (const [sku, q] of need) if (this.available(sku) < q) return false;
    for (const [sku, q] of need) this.balances.get(sku)!.R += q;
    this.reservations.set(reservationId, {
      reservationId,
      orderId,
      state: 'CONFIRMED', // 시뮬은 결제 승인 뒤 확정된 주문만 다룬다
      lines: [...need].map(([sku, qty]) => ({ sku, qty, consumed: 0 })),
    });
    this.check();
    return true;
  }

  /** 피킹 실행 반영: 총량 불변, 업무 위치만 STORED→PICKED. */
  commitPick(lines: { sku: string; qty: number }[]): string {
    for (const l of lines) this.balances.get(l.sku)!.picked += l.qty;
    return this.commitId();
  }

  /** 패킹 실행 반영: PICKED→PACKED. */
  commitPack(lines: { sku: string; qty: number }[]): string {
    for (const l of lines) {
      const b = this.balances.get(l.sku)!;
      b.picked -= l.qty;
      b.packed += l.qty;
    }
    return this.commitId();
  }

  /**
   * 결품(SHORT) 보고: 현물 H 는 그대로(실사 전), 판매적합 E 에서 빼고 차이 D 로 추적.
   * 고객 사전 선택 "품절 상품만 취소" 로 해당 예약 R 도 해제한다(S2 결품 처리의 단순화).
   */
  commitShortage(reservationId: string, sku: string, qty: number): string {
    const b = this.balances.get(sku)!;
    const take = Math.min(qty, b.E);
    b.E -= take;
    b.D += take;
    b.R = Math.max(0, b.R - qty);
    const r = this.reservations.get(reservationId);
    const line = r?.lines.find((l) => l.sku === sku);
    if (line) line.qty -= qty;
    this.check();
    return this.commitId();
  }

  /** CommitPackageHandover: H−q, E−q, R−q 한 사건 (IV-08). */
  commitHandover(reservationId: string, lines: { sku: string; qty: number }[]): string {
    for (const l of lines) {
      const b = this.balances.get(l.sku)!;
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
    this.check();
    return this.commitId();
  }

  /** TIN 처럼 현물 보충 (시뮬의 자동 보충 — 실제로는 SCM→CDC→TMS→mfc-inbound 경로). */
  receive(sku: string, qty: number) {
    const b = this.balances.get(sku)!;
    b.H += qty;
    b.E += qty;
  }

  private commitId(): string {
    this.commitSeq += 1;
    return `COMMIT-${String(this.commitSeq).padStart(6, '0')}`;
  }

  private check() {
    for (const b of this.balances.values()) {
      if (!(0 <= b.R && b.R <= b.E && b.E <= b.H && 0 <= b.Q && b.Q <= b.H)) {
        const msg = `불변식 위반 ${b.sku}: H${b.H} Q${b.Q} E${b.E} R${b.R}`;
        if (this.violations.length < 50) this.violations.push(msg);
      }
    }
  }
}
