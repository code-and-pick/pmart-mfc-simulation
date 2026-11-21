// MOCK 모드 화면용 읽기 — 실서버 화면(실제 주문 카드·구역 재고·바코드·자리 거르기)을 MOCK 에서도 확인하게(사용자 2026-11-20 "목업엔 적용이 안 되는 것 같네. 더미값이라도").
// MockBackend 의 작업·출고를 그대로 읽고, MOCK 에 없는 것(주문번호·가격·배송지·요청사항·LOT·센터 이름·배송)은 [더미] 값을 만든다.
// 실서버 동작을 대신하지 않는다 — 화면 확인용. 만든 값은 docs/backend-requests.md "시뮬레이터가 정한 값"에 적는다.
import { workerShortName } from '../../domain/workerName';
import type { RealReader } from '../../sim/realBoard';
import type {
  CapacityWorker,
  CenterShipment,
  CenterStock,
  DeliveryDispatch,
  DeliveryOrderSummary,
  Shipment,
  SkuBarcodes,
  StaffDeliverySummary,
  StockUnitRow,
  TaskDetail,
  TaskState,
  TaskSummary,
} from '../../domain/contract';
import type { MockBackend } from './MockBackend';

/** MockReader 가 시뮬레이션에서 읽는 것 */
export interface MockWorld {
  workers(): { id: string }[];
  riders(): { id: string; shipmentId: string; deliveryId: string; carrying: number; done: boolean; activity: string }[];
  /** 출고 → 출하대기 랙 코드(DSP-A-0N), 랙 위에 없으면 null */
  rackOf(shipmentId: string): string | null;
  /** 칸마다 선반 수량 — 백엔드 위치 코드·SKU·이름·수량 */
  shelfStock(): { code: string; sku: string; name: string; qty: number }[];
  skuInfo(sku: string): { name: string; barcode: string } | null;
  /** MOCK 시계(ms) */
  nowMs(): number;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** [더미] 화면용 주문번호 8자리 — 주문 ID 에서 늘 같은 값 */
export const mockOrderNumber = (orderId: string) => String(70000000 + (hash(orderId) % 9999999)).padStart(8, '0');
const AREAS = ['부산진구 부전동', '부산진구 전포동', '부산진구 범천동', '동래구 온천동', '연제구 연산동', '남구 대연동'];
const NOTES = [null, '문 앞에 놓아 주세요', null, '벨 누르지 말아 주세요', '경비실에 맡겨 주세요', null];

export class MockReader implements RealReader {
  constructor(
    private readonly be: MockBackend,
    private readonly world: MockWorld,
  ) {}

  private withNo<T extends { orderId?: string | null; orderNumber?: string | null }>(x: T): T {
    return x.orderId ? { ...x, orderNumber: x.orderNumber ?? mockOrderNumber(x.orderId) } : x;
  }

  /** MOCK 작업은 끝나면 시작 기록(activeStart)을 지운다 — 본 시작·끝 시각을 기억해 시간(피킹·패킹 걸린 시간)을 보이게 */
  private readonly started = new Map<string, string>();
  private readonly ended = new Map<string, string>();
  private note(t: { taskId: string; state: TaskState }) {
    if (t.state === 'IN_PROGRESS' && !this.started.has(t.taskId)) {
      const st = this.be.peekTask(t.taskId).activeStart?.startedAt;
      if (st) this.started.set(t.taskId, st);
    }
    if ((t.state === 'COMPLETED' || t.state === 'CLOSED_PARTIAL') && this.started.has(t.taskId) && !this.ended.has(t.taskId))
      this.ended.set(t.taskId, new Date(this.world.nowMs()).toISOString());
  }
  private withTimes<T extends { taskId: string; completedAt?: string | null }>(t: T): T {
    return this.ended.has(t.taskId) ? { ...t, completedAt: t.completedAt ?? this.ended.get(t.taskId)! } : t;
  }

  async listTasks(mfcId: string, states: TaskState[]): Promise<TaskSummary[]> {
    void mfcId;
    const all = this.be.peekTasks(['WAITING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CLOSED_PARTIAL'] as TaskState[]);
    for (const t of all) this.note(t);
    return all.filter((t) => states.includes(t.state)).map((t) => this.withTimes(this.withNo(t)));
  }
  async getTask(taskId: string): Promise<TaskDetail> {
    const d = this.be.peekTask(taskId);
    this.note(d);
    return this.withTimes(this.withNo(d));
  }
  async listWorkers(): Promise<CapacityWorker[]> {
    return this.world.workers().map((w) => ({ mfcId: '', workerId: w.id, displayName: workerShortName(w.id), state: 'ACTIVE' as const }));
  }
  async getCenterStock(_mfcId: string, sku: string): Promise<CenterStock> {
    const units = this.world
      .shelfStock()
      .filter((u) => u.sku === sku)
      .map((u) => ({ locationCode: u.code, lotId: `LOT-${sku}`, qualityState: 'NORMAL' as const, workState: 'STORED' as const, qty: u.qty }));
    const q = units.reduce((a, u) => a + u.qty, 0);
    return { mfcId: '', sku, lots: [{ lotId: `LOT-${sku}`, onHand: q, quarantined: 0, sellable: q, reserved: 0, available: q }], units };
  }
  async getShipment(shipmentId: string): Promise<Shipment> {
    const s = this.withNo(this.be.peekShipment(shipmentId));
    // [더미] 랙에 올린 포장은 stagingLocation(서버 랙처럼), 포장마다 인계 번호는 MOCK 값 그대로
    const rack = this.world.rackOf(shipmentId);
    // [더미] 배송 전에도 주문 요약(품목·가격)을 읽게 배송 ID 자리를 채운다
    return { ...s, ...({ dropAreaLabel: AREAS[hash(shipmentId) % AREAS.length] } as object), deliveryId: s.deliveryId ?? `MOCKDLV:${shipmentId}`, packages: s.packages.map((p) => ({ ...p, orderNumber: s.orderNumber, stagingLocation: rack })) };
  }
  async searchDeliveries(): Promise<StaffDeliverySummary[]> {
    const now = new Date().toISOString();
    return this.world
      .riders()
      .filter((r) => !r.done)
      .map((r) => ({
        deliveryId: r.deliveryId,
        version: 1,
        type: 'FORWARD' as const,
        orderId: null,
        mfcId: null,
        riderId: r.id,
        state: r.carrying > 0 ? ('PICKED_UP' as const) : /QR|랙/.test(r.activity) ? ('ARRIVED_AT_STORE' as const) : ('ASSIGNED' as const),
        assignedAt: now,
        pickedUpAt: null,
        completedAt: null,
        createdAt: now,
      }));
  }
  async getDeliveryDispatch(deliveryId: string): Promise<DeliveryDispatch> {
    const r = this.world.riders().find((x) => x.deliveryId === deliveryId);
    return {
      deliveryId,
      version: 1,
      shipmentId: r?.shipmentId,
      state: r && r.carrying > 0 ? 'PICKED_UP' : 'ASSIGNED',
      assignment: r ? { riderId: r.id, vehicleType: 'MOTORCYCLE', state: r.carrying > 0 ? 'PICKED_UP' : 'ASSIGNED' } : null,
      attempts: [],
      dropAreaLabel: AREAS[hash(deliveryId) % AREAS.length],
    };
  }
  async getSku(sku: string): Promise<SkuBarcodes> {
    const i = this.world.skuInfo(sku);
    return { sku, barcodes: i ? [i.barcode] : [] } as unknown as SkuBarcodes;
  }
  async listCenterShipments(): Promise<CenterShipment[]> {
    const tasks = this.be.peekTasks(['WAITING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CLOSED_PARTIAL'] as TaskState[]);
    const by = new Map<string, CenterShipment>();
    for (const t of tasks) {
      if (!t.shipmentId) continue;
      const c = by.get(t.shipmentId) ?? ({ shipmentId: t.shipmentId, orderId: '', state: '', createdAt: t.createdAt } as CenterShipment);
      const v = { state: t.state, startedAt: this.started.get(t.taskId) ?? null };
      if (t.taskType === 'PICK') c.pick = v;
      if (t.taskType === 'PACK') c.pack = v;
      by.set(t.shipmentId, c);
    }
    return [...by.values()];
  }
  async getDeliveryOrderSummary(deliveryId: string): Promise<DeliveryOrderSummary | null> {
    const sid = deliveryId.startsWith('MOCKDLV:') ? deliveryId.slice(8) : this.world.riders().find((x) => x.deliveryId === deliveryId)?.shipmentId;
    return sid ? this.summaryOf(sid, sid) : null;
  }
  /** [더미] 품목·가격·요청사항 — 출고 PICK 작업 줄로 */
  async summaryOf(shipmentId: string, seed: string): Promise<DeliveryOrderSummary> {
    const tasks = this.be.peekTasks(['WAITING', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'] as TaskState[]);
    const pick = tasks.find((t) => t.shipmentId === shipmentId && t.taskType === 'PICK');
    const d = pick ? this.be.peekTask(pick.taskId) : null;
    const items = (d?.lines ?? []).map((l) => {
      const unit = 1000 + (hash(l.sku) % 60) * 150;
      return { orderLineId: l.orderLineId, name: l.productName ?? this.world.skuInfo(l.sku)?.name ?? l.sku, optionLabel: null, qty: l.plannedQty, lineAmount: unit * l.plannedQty };
    });
    return { items, itemAmount: items.reduce((a, i) => a + i.lineAmount, 0), deliveryNote: NOTES[hash(seed) % NOTES.length] };
  }
  async getCenterName(): Promise<string | null> {
    return '가상 센터';
  }
  async listAllStockUnits(): Promise<StockUnitRow[]> {
    return this.world.shelfStock().map((u) => ({
      locationCode: u.code,
      sku: u.sku,
      productName: u.name,
      lotId: `LOT-${u.sku}`,
      lotNo: `L${(hash(u.sku) % 900000000) + 100000000}`,
      expiryDate: `2027-0${(hash(u.sku) % 9) + 1}-15`,
      qualityState: 'NORMAL',
      workState: 'STORED',
      qty: u.qty,
    }));
  }
}
