// 다른 기기(LAN) 관찰 화면이 개발 서버를 거쳐 읽을 수 있는 경로 — 화면이 읽는 것만(개인정보 경로 차단)
import { describe, expect, it } from 'vitest';
import { lanReadAllowed } from '../src/backend/http/lanAllow';

describe('LAN 조회 허용 목록', () => {
  it('관찰 화면이 읽는 경로는 넘기고, 그 밖(배송지·고객·입고 등)은 막는다', () => {
    for (const u of [
      '/api/v1/tasks?mfcId=MFC-SEED-01&state=READY',
      '/api/v1/tasks/ORD-1-S1-PICK',
      '/api/v1/mfcs/MFC-SEED-01/workers',
      '/api/v1/mfcs/MFC-SEED-01/stock?sku=B-00000463',
      '/api/v1/skus/B-00000463',
      '/api/v1/shipments/ORD-1-S1',
      '/api/v1/deliveries?mfcId=MFC-SEED-01&size=50',
      '/api/v1/deliveries/DLV-1/dispatch',
    ])
      expect(lanReadAllowed(u), u).toBe(true);
    for (const u of [
      '/api/v1/deliveries/DLV-1',
      '/api/v1/deliveries/DLV-1/drop-info',
      '/api/v1/customers/me',
      '/api/v1/orders/ORD-1',
      '/api/v1/inbound-tasks/IT-1',
      '/api/v1/tasks/../customers/me',
      '/api/v1/tasks/a%2F..%2Fb',
      '/api/v1/internal/dev-token-exchange',
    ])
      expect(lanReadAllowed(u), u).toBe(false);
  });
});
