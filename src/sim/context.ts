import type { FulfillmentPort } from '../backend/port';
import type { Sku } from '../domain/catalog';
import type { Package } from '../domain/contract';
import type { Layout } from '../domain/layout';
import type { NavGrid } from '../domain/navgrid';
import type { SimParams } from '../config';
import type { Rng } from '../util/rng';
import type { Metrics } from './metrics';
import type { ShippingRack, StationPool } from './site';

/** 작업자·라이더가 현장에서 쓰는 것들. */
export interface SiteContext {
  runId: string;
  port: FulfillmentPort;
  params: SimParams;
  layout: Layout;
  nav: NavGrid;
  skuMap: Map<string, Sku>;
  rng: Rng;
  metrics: Metrics;
  stations: StationPool;
  shipRack: ShippingRack;
  now(): number;
  log(msg: string): void;
  orderOf(fulfillmentId: string): string | undefined;
  /** PICK 이 끝난 출하의 PACK 작업을 같은 작업자에게 배정받는다. 전량 결품이면 null. */
  awaitPackAssignment(shipmentId: string, workerId: string): Promise<{ taskId: string; assignmentVersion: number } | null>;
  /** 출하대기 랙에 포장을 올렸다 — 배송(라이더) 쪽으로 넘어간다. */
  stagePackages(shipmentId: string, pkgs: Package[]): void;
  /** 피킹 칸 현재 수량 (실서버 모드는 알 수 없어 Infinity) */
  shelfQty(sku: string): number;
  /** 피킹 칸이 모자라 보충을 요청한다 (긴급). */
  requestReplenish(sku: string): void;
}
