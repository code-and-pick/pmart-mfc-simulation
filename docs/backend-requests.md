# 가상 MFC 현장(시뮬레이터) → pmart-backend 요청 목록

> 시뮬레이터는 `../pmart-backend` 를 **읽기만** 한다. 아래는 실서버 연동에 필요한 백엔드 쪽 변경·결정이다.
> 백엔드 담당에게 전달할 때는 이 문서를 그대로 넘기거나 `pmart-backend/docs/handoff/` 형식으로 옮겨 달라고 요청한다.
> 기준 시점: 2026-10-31, 계약 `mfc-fulfillment-service.yaml` 0.1.0, 백엔드 worklog 2026-10-31.

## 현재 상태 (확인한 사실)

| 대상 | 상태 | 근거 |
|---|---|---|
| mfc-fulfillment 작업 지시·Task·Shipment·인계 fence | **501 UNSUPPORTED_ACTION** (주문 단위 작업 중지만 구현) | `services/mfc-fulfillment-service/CLAUDE.md` "상태" |
| mfc-capacity 배정·계획 | 501 (CapacityHold·스냅샷만 구현) | `services/mfc-capacity-service/CLAUDE.md` |
| mfc-inventory 작업 실행·인계·스냅샷 | 501 (예약·가용·초기 보유만 구현) | `services/mfc-inventory-service/CLAUDE.md` |
| mfc-location | 501 (전체) | `services/mfc-location-service/CLAUDE.md` |
| 작업자 인증 | BR-02 팀 결정 대기 → `assignee=me` 동작 안 함 | `docs/handoff/2026-10-24-clients-reply-high.md` |
| Delivery 배차·라이더 | 슬라이스 7 미구현 | `docs/business/flows/order-checkout-saga.md` §3 |

그래서 시뮬레이터는 지금 **MOCK 백엔드**(계약 의미를 브라우저 안에서 흉내)로 돌고, 실서버 모드는 연결·인증·501 여부 점검까지만 된다.

## 요청

### R-01 이행 슬라이스 6 구현 (선행 조건) — 높음
ConfirmOrder → PICK/PACK Task → 시작 점유 → 실행 결과(재고 commit) → 포장 밀봉·QR → 인계 fence(Authorize/Commit) 가 계약대로 동작해야 한다.
시뮬레이터는 계약의 다음 API 를 그대로 부른다: `GET /tasks`, `GET /tasks/{id}`, `POST /tasks/{id}/starts`, `POST /tasks/{id}/executions`, `GET /shipments/{id}`, `POST /shipments/{id}/packages`, `POST /packages/{id}/handover-authorizations`, `POST /packages/{id}/handover-commits`.

### R-02 가상 작업자·가상 라이더 인증 (BR-02 와 함께) — 높음
시뮬레이터 한 대가 작업자 N명과 라이더 M명을 동시에 연기한다. 다음 중 하나가 필요하다.
- (안 A) 시험 센터 한정으로 작업자/라이더 토큰을 여러 개 발급받는 경로(운영자 승인).
- (안 B) `mfc-simulator` 서비스 신원 + "대행 작업자 ID" 헤더를 시험 센터에서만 허용.
어느 쪽이든 실제 센터에서는 쓸 수 없어야 한다.

### R-03 가상 설비 출처 표시 `source=SIMULATED` — 중간
`architecture-design.md` 382행은 실물 설비가 없는 입력에 `source=SIMULATED` 표시를 의무화했지만, 계약에는 TMS 출발(`TruckActuallyDeparted`)에만 필드가 있다.
피킹·패킹 실행, 포장 밀봉, 인계 commit 에도 출처를 남길 방법을 정해 달라(본문 필드 또는 `X-Source-System: mfc-simulator` 를 원장에 기록). 지표·정산에서 시뮬 실적을 분리하려면 필요하다.

### R-04 센터 전체 작업 목록 — 중간
`GET /tasks` 는 `assignee=me` 만 지원한다. 시뮬레이터(또는 센터 관리자 화면)는 센터의 READY/ASSIGNED 작업 전체를 봐야 가상 작업자에게 넘길 수 있다.
센터 권한자에게 `assignee` 생략(= 센터 전체) 조회를 허용하거나, `TaskProgressed`·`AssignmentPublished` 를 구독할 수 있는 읽기 경로(SSE 등)를 열어 달라.

### R-05 재고 조회 (읽기 전용) — 낮음
시뮬레이터 화면은 H/Q/E/R/A 를 보여 피킹·패킹이 수량을 바꾸지 않고 인계 때 H·E·R 가 함께 줄어드는 것을 확인한다.
`/internal/snapshots` 는 서비스 전용이라 쓸 수 없다. 센터 운영자용 읽기 API(센터·SKU 목록)가 필요하다.

### R-06 수동 작업 배정 API — 중간
MFC WK-02 는 "Q-08 결정 전에는 권한자의 수동 지정만 허용"이라고 하지만, 계약(mfc-capacity)에는 OR-Tools 계획(`POST /assignment-plans`)만 있고 수동 지정 경로가 없다.
`POST /assignments` (taskId, workerId, 사유) 같은 수동 배정 API 또는 백엔드 자동 배정 규칙을 정해 달라.
또한 MFC 1장 운영 원칙(피킹·패킹 같은 작업자)대로 PICK 담당에게 PACK 을 이어서 배정하는지도 정해 달라.

### R-07 가상 라이더 배차 (슬라이스 7) — 중간
인계 fence 는 배정 라이더·배송번호 일치를 검사한다. 시뮬레이터 라이더가 실제 `deliveryId` 와 배정을 받을 수 있어야 인계까지 흐른다.

### R-08 MFC 로케이션 정본 — 낮음
시뮬레이터 평면·로케이션 코드는 MFC 문서 8-2 의 **가설** 형식(`B04-02-205`)으로 직접 만든 가정이다.
mfc-location 이 구현되면 `GET /locations?mfcId=` 로 받아 배치를 그리도록 바꾼다. 로케이션 코드 체계 확정(문서 Q-03)도 필요하다.

### R-09 시험 센터 상품 투영 — 낮음
피킹 위치·온도대·중량·바코드가 필요하다. 현재 `MFC-SEED-01` 은 SKU 17개 × 10개(초기 보유)이며 온도대·중량·로케이션 정보는 공개 API 로 얻을 수 없다.

### R-10 현장 적치(PUTAWAY)·보충 이동(MOV) 작업 API — 중간
mfc-inbound 계약 머리말은 "RECEIVE/INSPECT/PUTAWAY Task 의 정본"이라 하고 MFC WK-01 은 REPLENISH 작업을 정의하지만,
현장 단말이 부를 작업 API(작업 목록·시작·실행 결과)는 mfc-inbound·mfc-fulfillment 어디에도 없다. 재고 반영 경로는 mfc-inventory 내부
`POST /internal/task-executions`(PUTAWAY·MOVE)뿐이라 단말이 직접 부를 수 없다.
시뮬레이터는 지금 이 내부 경로 이름으로 기록하고 API 로그에 "계약 공백 R-10" 으로 표시한다. 필요한 것:
- 적치 작업: 수령(TIN) 후 미적치(UNSTOWED) 수량을 피킹 칸·보충재고 위치로 옮기는 Task 와 실행 결과 등록 API (mfc-inbound 소유 추정)
- 보충 이동 작업: IV-04 자동 보충(C ≤ min) 으로 생긴 MOV Task 의 목록·시작·실행 결과 API (소유 서비스 결정 필요)
- 피킹 칸 잔량 부족 시 피커가 긴급 보충을 요청하는 경로(현재는 PICK 실행이 422 INSUFFICIENT_STOCK 으로 거절될 뿐)

### R-11 피킹 칸 한도·최소량 기준정보 — 낮음
IV-04 의 min/target/u 값(Q-07)이 없다. 시뮬레이터는 칸 치수 ÷ 상품 치수로 칸 한도를, 그 30% 를 min 으로 정했다. 기준정보 정본과 조회 API 가 필요하다.

## 시뮬레이터가 정한 값 (실서버 동작을 대신하지 않음)

| 값 | 시뮬 값 | 이유 |
|---|---|---|
| 인계 fence 유효시간 | 120초 | 계약은 `fenceExpiresAt` 만 정의 |
| 결품 시 처리 | 고객 사전 선택 "품절 상품만 취소"로 가정, R 해제·E 차감·D 추적 | S2 결품 흐름(order-checkout-saga §2.1) 단순화 |
| PICK·PACK 배정 | 대기 작업자 FIFO, PACK 은 같은 작업자 | 배정 정본 mfc-capacity 미구현 |
| 포장 단위 | 출하 1건당 온도대별 봉투 1개 | MFC 7-6 "온도 보호·분리" 원칙 |
| 분할 | 총 상품중량 10,000g 초과 시 (확정 정책) — 중량 내림차순 first-fit | 실제 분할은 order-service 이행 계획 |
| 입고 차량 | 2시간마다 + 수동 호출, 차량당 최대 40품목, 목표 = 칸 한도×2 | 실제는 매일 오전 1회, 공급량은 SCM 산식 |
| 수령 | 검수 단계 없이 정상 = H+E (격리 0) | 현재 mfc-inventory 구현과 같음 |
| 적치 순서 | 냉동·냉장 먼저, 피킹 칸을 한도까지 채우고 남는 수량은 보충재고 팔레트 | 문서에 적치 규칙 없음 |
| 칸 한도·최소 | 칸 치수 ÷ 상품 치수 (최대 16), 최소 = 한도의 30% | R-11 |
| 입고 작업 우선순위 | 하차·검수 → 긴급 보충 → 적치 → 일반 보충 | 문서에 없음 |
