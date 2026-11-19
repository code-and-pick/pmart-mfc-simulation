// 다른 기기(LAN)에서 연 관찰 화면이 개발 서버를 거쳐 읽을 수 있는 실서버 경로 — 화면이 실제로 읽는 것만(허용 목록).
// 개발 서버가 관찰 계정 토큰을 대신 붙이므로, 화면에 필요 없는 조회(고객 배송지·연락처가 담긴 경로 등)는 막는다(개인정보).
// 이 PC(루프백) 요청에는 쓰지 않는다 — 그쪽은 브라우저가 받은 토큰으로 직접 부른다.
// 경로를 늘리면 화면 코드(HttpBackend 의 GET)와 같이 고친다. 배차 상세(/deliveries/{id}/dispatch)는 회수 배송이면 회수지 좌표가 오지만
// 화면은 정방향·재발송 배송만 상세를 읽는다(realBoard) — 경로 단위로는 가를 수 없어 둔다.

const ID = '[A-Za-z0-9._:-]+';

const ALLOWED: RegExp[] = [
  new RegExp(`^/api/v1/tasks$`), // 작업 목록(?mfcId&state)
  new RegExp(`^/api/v1/tasks/${ID}$`), // 작업 상세
  new RegExp(`^/api/v1/mfcs/${ID}/workers$`), // 작업자 이름
  new RegExp(`^/api/v1/mfcs/${ID}/stock$`), // 주문 SKU 재고(?sku)
  new RegExp(`^/api/v1/skus/${ID}$`), // 상품 바코드
  new RegExp(`^/api/v1/shipments/${ID}$`), // 출고(포장·배차 요청)
  new RegExp(`^/api/v1/centers/${ID}$`), // 센터 이름(center-master) — 사업장 정보, 개인정보 없음
  new RegExp(`^/api/v1/shipments$`), // 센터 출고 목록(?mfcId) — 피킹·패킹 시작 시각, 개인정보 없음(fulfillment 0.15.0)
  new RegExp(`^/api/v1/deliveries$`), // 직원 배송 찾기(?mfcId) — 요약, 개인정보 없음
  new RegExp(`^/api/v1/deliveries/${ID}/dispatch$`), // 배차 상태·시도
  new RegExp(`^/api/v1/work-orders$`), // 주문 번호로 현장 상태(?orderId) — 개인정보 없음(fulfillment 0.10.0)
];

/** LAN 관찰 화면이 이 GET 을 넘겨도 되나. url 은 쿼리 포함 요청 경로 */
export function lanReadAllowed(url: string): boolean {
  const path = url.split('?')[0];
  if (path.includes('..') || path.includes('%2e') || path.includes('%2E') || path.includes('%2f') || path.includes('%2F')) return false;
  return ALLOWED.some((r) => r.test(path));
}
