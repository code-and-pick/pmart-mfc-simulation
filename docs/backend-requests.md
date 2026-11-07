# 가상 MFC 현장(시뮬레이터) → pmart-backend 요청 목록

> 시뮬레이터는 `../pmart-backend` 를 **읽기만** 한다. 아래는 실서버 연동에 필요한 백엔드 쪽 변경·결정이다.
> 백엔드 담당에게 전달할 때는 이 문서를 그대로 넘기거나 `pmart-backend/docs/handoff/` 형식으로 옮겨 달라고 요청한다.
> 기준 시점: **2026-11-07 재검토**(최초 2026-10-31). 백엔드 `main` + 미병합 브랜치 `mfc-v2`(ADR-0040 재고 모델 v2·위치 마스터·입고 작업) 기준.
> 계약 버전: mfc-fulfillment 0.1.0(슬라이스 6a 반영), mfc-capacity 0.1.0, mfc-inventory 0.3.0, mfc-inbound 0.3.0.

## 연결 방식 (백엔드가 알아야 할 전제)

시뮬레이터는 최종적으로 실서버에 붙는다. 붙을 때의 모습은 다음과 같다.

- **역할**: 시뮬레이터 한 대가 현장 단말 여러 대를 연기한다 — 점원 PDA(피킹·패킹·입고·적치), 라이더 앱(QR 인계), 센터 운영자 화면(작업·재고·위치 조회).
- **경로**: 브라우저 → Vite 개발 서버 `/api` 프록시 → 게이트웨이(`PMART_GATEWAY`) → 각 서비스 **공개 계약 API**. `/internal/*` 은 부르지 않는다.
- **원칙**: 계약에 있는 API 만 부른다. 응답이 없으면 결과 불명으로 보고 같은 `Idempotency-Key` 로 재전송한다. 서버가 확정한 결과만 화면에 확정으로 그린다.
- **데이터**: 시뮬레이터는 업무 데이터를 저장하지 않는다(실서버 모드에서 정본은 백엔드). 시뮬레이터가 만든 실적은 실제 현장 실적과 구분돼야 한다(R-03).
- **시험 센터**: 시뮬레이터는 시험 센터(현재 `MFC-SEED-01`)에서만 돈다. 아래 요청 중 인증·전체 조회 완화는 시험 센터 한정이면 된다.

## 현재 상태 (2026-11-07 확인한 사실)

| 대상 | 상태 | 근거 |
|---|---|---|
| mfc-fulfillment 작업 접수 | **구현(슬라이스 6a)** — ConfirmOrder 로 출고마다 PICK(READY)·PACK(WAITING) 생성, 거절도 결정으로 기록 | `services/mfc-fulfillment-service/CLAUDE.md`, 커밋 9b11697 |
| mfc-fulfillment 점원 단말 Task·Shipment·포장·인계 fence | 501 (6b 이후) | 같은 곳, `docs/worklog/2026-11-07.md` |
| mfc-capacity 배정·계획 (`/assignments`, `/assignment-plans`) | 501 (CapacityHold·스냅샷만 구현) | `services/mfc-capacity-service/CLAUDE.md` |
| mfc-inventory 센터 재고 상세 `GET /mfcs/{mfcId}/stock?sku=` | 구현(`mfc-v2`, 운영자, SKU 1개 필수) | `QueriesController.getCenterStock` |
| mfc-inventory PICK·PACK·MOVE·인계 | 501 | `services/mfc-inventory-service/CLAUDE.md` |
| mfc-location 위치 목록·등록·적치 후보 | 구현(`mfc-v2`). 코드 문법은 Q-03 미결이라 자유 문자열 | `services/mfc-location-service/CLAUDE.md` |
| mfc-inbound 입고 작업 `GET /inbound-tasks`, 품질검사·적치 | 구현(`mfc-v2`) — **초기 보유 반입 흐름만** | `services/mfc-inbound-service/CLAUDE.md` |
| 작업자 인증 | BR-02 팀 결정 대기(2026-10-24 이후 변화 없음) → `assignee=me` 동작 안 함 | `docs/handoff/2026-10-24-clients-reply-high.md` |
| Delivery 배차·라이더 | 슬라이스 7 미구현 | `docs/business/flows/order-checkout-saga.md` §3 |

그래서 시뮬레이터는 지금 **MOCK 백엔드**(계약 의미를 브라우저 안에서 흉내)로 돌고, 실서버 모드는 연결·인증·501 여부 점검까지만 된다.

## 요청

각 항목의 "재검토" 줄은 2026-11-07 백엔드 상태와 대조한 결과다.

### R-01 이행 슬라이스 6b — 점원 단말 작업 흐름 (선행 조건) — 높음
재검토: 6a(작업 접수)로 **일부 해소**. 남은 것은 6b 범위다.
시뮬레이터가 그대로 부를 API: `GET /tasks`, `GET /tasks/{id}`, `POST /tasks/{id}/starts`, `POST /tasks/{id}/executions`, `GET /shipments/{id}`, `POST /shipments/{id}/packages`, `POST /packages/{id}/handover-authorizations`, `POST /packages/{id}/handover-commits`.
6b 에서 PICK 실행이 mfc-inventory LOT 예약(`reservation_part`)과 어떻게 묶이는지(실행 요청에 `lotId` 가 필요한지)를 계약에 적어 달라 — 시뮬레이터 피킹 화면이 LOT 를 보여야 하는지가 여기에 달렸다.

### R-02 가상 작업자·가상 라이더 인증 (BR-02 와 함께) — 높음
재검토: **변화 없음**. 실서버 연결의 첫 관문이라 우선순위 유지.
시뮬레이터 한 대가 작업자 N명과 라이더 M명을 동시에 연기한다. 다음 중 하나가 필요하다.
- (안 A) 시험 센터 한정으로 작업자/라이더 토큰을 여러 개 발급받는 경로(운영자 승인).
- (안 B) `mfc-simulator` 서비스 신원 + "대행 작업자 ID" 헤더를 시험 센터에서만 허용.
어느 쪽이든 실제 센터에서는 쓸 수 없어야 한다. 센터 운영자 화면 역할(R-04·R-05·R-08)도 같은 방식으로 받을 수 있어야 한다.

### R-03 가상 설비 출처 표시 `source=SIMULATED` — 중간
재검토: **변화 없음**. 슬라이스 6a 계약에도 출처 필드가 없다.
`architecture-design.md` 382행은 실물 설비가 없는 입력에 `source=SIMULATED` 표시를 의무화했지만, 계약에는 TMS 출발(`TruckActuallyDeparted`)에만 필드가 있다.
피킹·패킹 실행, 포장 밀봉, 인계 commit, 입고 수령·품질검사·적치에도 출처를 남길 방법을 정해 달라(본문 필드 또는 `X-Source-System: mfc-simulator` 를 원장에 기록). 지표·정산·향후 수요예측 학습 데이터(R-12)에서 시뮬 실적을 빼려면 필요하다.

### R-04 센터 전체 작업·배정 조회 — 중간
재검토: 계약에 `GET /assignments?mfcId&date[&workerId]`(배정 조회)가 생겼으나 501. **미배정(READY) 작업 목록은 여전히 없음**.
`GET /tasks` 는 `assignee=me` 만 지원한다. 시뮬레이터(또는 센터 관리자 화면)는 센터의 READY/ASSIGNED 작업 전체를 봐야 가상 작업자에게 넘길 수 있다.
센터 권한자에게 `assignee` 생략(= 센터 전체) 조회를 허용하거나, `TaskProgressed`·`AssignmentPublished` 를 구독할 수 있는 읽기 경로(SSE 등)를 열어 달라. `GET /assignments` 를 구현할 때 `workerId` 생략 = 센터 전체로 동작하는지도 계약에 적어 달라.

### R-05 재고 조회 (읽기 전용) — 낮음
재검토: `GET /mfcs/{mfcId}/stock?sku=`(운영자, `mfc-v2`)로 **일부 해소**. SKU 1개씩만 조회돼 센터 전체 화면에는 부족.
시뮬레이터 화면은 H/Q/E/R/A 를 보여 피킹·패킹이 수량을 바꾸지 않고 인계 때 H·E·R 가 함께 줄어드는 것을 확인한다.
`sku` 를 생략하면 센터 전체 요약(SKU 목록, 커서)을 주거나 별도 목록 API 를 열어 달라. `/internal/snapshots` 는 서비스 전용이라 쓸 수 없다.

### R-06 작업 배정 경로 — 중간
재검토: **변화 없음**. 6a 계약도 "작업자 배정·DISPATCH 는 6a 범위 밖"이라 적었다.
MFC WK-02 는 "Q-08 결정 전에는 권한자의 수동 지정만 허용"이라고 하지만, 계약(mfc-capacity)에는 OR-Tools 계획(`POST /assignment-plans`)만 있고 수동 지정 경로가 없다.
`POST /assignments` (taskId, workerId, 사유) 같은 수동 배정 API 또는 백엔드 자동 배정 규칙을 정해 달라.
또한 MFC 1장 운영 원칙(피킹·패킹 같은 작업자)대로 PICK 담당에게 PACK 을 이어서 배정하는지도 정해 달라.
OR-Tools(방식 A, Java 바인딩)로 자동 배정이 들어오면 시뮬레이터는 MOCK 의 FIFO 배정을 끄고 백엔드 배정 결과만 따른다. 이때 배정 계획의 입력(작업자 위치·상태)을 시뮬레이터 가상 작업자가 어떻게 알려야 하는지(작업자 상태 API 유무)도 함께 정해 달라.

### R-07 가상 라이더 배차 (슬라이스 7) — 중간
재검토: **변화 없음**.
인계 fence 는 배정 라이더·배송번호 일치를 검사한다. 시뮬레이터 라이더가 실제 `deliveryId` 와 배정을 받을 수 있어야 인계까지 흐른다.

### R-08 MFC 로케이션 정본 — 낮음
재검토: mfc-location 위치 마스터(`GET /locations?mfcId=`, `mfc-v2`)로 **일부 해소**. 코드 문법(Q-03)은 미결.
시뮬레이터 평면·로케이션 코드는 MFC 문서 8-2 의 **가설** 형식(`B04-02-205`)으로 직접 만든 가정이다. 연결 때는 `GET /locations` 로 받아 배치를 그리도록 바꾼다.
필요한 것: (1) 시험 센터에 시뮬레이터 평면과 맞는 위치 시드를 누가 넣을지(백엔드 시드 / 시뮬레이터가 운영자 권한으로 `POST /locations`), (2) 3D 배치를 그릴 좌표·랙·단 정보를 위치 속성에 둘지(지금 계약은 구역·온도대·동선 순서까지), (3) Q-03 코드 체계 확정.

### R-09 시험 센터 상품·보관 기준정보 — 낮음
재검토: 상품 시드가 367개로 늘었으나 158개는 보관 유형·무게가 없다(`docs/worklog/2026-11-07.md`). 재고 v2 는 보관 유형이 없으면 적치·예약에서 `CONFIG_REQUIRED` 를 낸다.
시험 센터 SKU 의 피킹 위치·온도대(보관 유형)·중량·바코드가 공개 API 로 필요하다. 시뮬레이터가 쓰는 SKU 는 보관 유형·무게가 채워진 것으로 골라 달라.

### R-10 보충 이동(MOV) 작업 API — 중간
재검토: 입고 작업 API(`GET /inbound-tasks`, `POST /inbound-tasks/{id}/inspections`, `POST /inbound-tasks/{id}/putaways`, `mfc-v2`)로 **적치는 일부 해소** — 다만 초기 보유 반입 흐름에서만 생긴다.
남은 것:
- 정기 입고(`/inbound-promises/{trfId}/arrivals`·`receipts`) 수령 뒤에도 같은 INSPECT·PUTAWAY 작업이 생기는지
- 보충 이동 작업: IV-04 자동 보충(C ≤ min)으로 생긴 MOV Task 의 목록·시작·실행 결과 API (소유 서비스 결정 필요, inventory `MOVE` 는 501)
- 피킹 칸 잔량 부족 시 피커가 긴급 보충을 요청하는 경로(현재는 PICK 실행이 422 INSUFFICIENT_STOCK 으로 거절될 뿐)
시뮬레이터는 이 공백 구간을 지금 MOCK 에서 inventory 내부 경로 이름으로 기록하고 API 로그에 "계약 공백 R-10" 으로 표시한다.

### R-11 피킹 칸 한도·최소량 기준정보 — 낮음
재검토: **변화 없음**(Q-07 미결).
IV-04 의 min/target/u 값(Q-07)이 없다. 시뮬레이터는 칸 치수 ÷ 상품 치수로 칸 한도를, 그 30% 를 min 으로 정했다. 기준정보 정본과 조회 API 가 필요하다.

### R-12 OR-Tools 실행 이미지·Chronos-2 런타임 결정 — 낮음 (2026-11-07 추가)
사용자 방향: OR-Tools 는 Java 바인딩(방식 A), Chronos-2 수요예측은 실제 프로젝트에서 연결한다. **백엔드 설계는 이후 추가 예정**이라 아래는 그 설계 때 함께 정할 항목이다. 정리: `docs/optimization-forecast-notes.md`.
- `tech-stack.md:49` 는 "별도 Python 런타임 없음, Python 전용 모델은 3단계 별도 승인"이다. Chronos-2(PyTorch)를 `demand-planning-service` 예측 모델로 붙일 런타임(별도 추론 서비스 / 오프라인 배치 / Java 추론)을 정해 달라.
- 예측 결과는 기존 `ForecastVersionPublished` → `replenishment-service` 경로로 흐르는지, MFC IV-04 가 직접 쓰는 경로도 두는지 정해 달라.
- 운영 이미지가 GraalVM Native 로 가면 OR-Tools(JNI 네이티브 라이브러리)가 동작하는지 검증하거나 `mfc-capacity-service` 는 JVM 이미지로 남길지 정해 달라.
- 예측 학습 데이터에서 시뮬레이터 실적을 빼는 기준(R-03)을 같이 정해 달라.

## 시뮬레이터 쪽 후속 작업 (연결 때 시뮬레이터가 맞출 것 — 백엔드 요청 아님)

| 항목 | 내용 | 계기 |
|---|---|---|
| 계약 동기화 | `src/domain/contract.ts` 를 6a 계약에 맞춘다 — PACK 초기 상태 WAITING, Task `readyAt`·`holdReason`, WorkOrderDecision(ACCEPTED/REJECTED·retryable)·`workVersion` | 커밋 9b11697 |
| 수령 의미 | 재고 v2 에서는 수령 = H 만(PENDING_INSPECTION), 품질검사 → 적치 때 E+. MOCK 의 "수령 = H+E" 를 바꾼다 | ADR-0040, `mfc-v2` |
| LOT | 재고 v2 예약은 LOT 조각(FEFO·최소 잔여일). MOCK 에 LOT 개념이 없다 — R-01 답에 따라 피킹 화면·MOCK 에 반영 | ADR-0040 |
| 입고 작업 | HttpBackend 에 `/inbound-tasks` 계열 호출 추가(계약에 있는 것만) | R-10 |
| 위치 | 평면을 `GET /locations` 결과로 그리는 경로 추가 | R-08 |

## 시뮬레이터가 정한 값 (실서버 동작을 대신하지 않음)

| 값 | 시뮬 값 | 이유 |
|---|---|---|
| 인계 fence 유효시간 | 120초 | 계약은 `fenceExpiresAt` 만 정의 |
| 결품 시 처리 | 고객 사전 선택 "품절 상품만 취소"로 가정, R 해제·E 차감·D 추적 | S2 결품 흐름(order-checkout-saga §2.1) 단순화. 6a 계약에 `outOfStockPreference` 가 생겼으니 연결 때 그 값을 따른다 |
| PICK·PACK 배정 | 대기 작업자 FIFO, PACK 은 같은 작업자 | 배정 정본 mfc-capacity 미구현 (R-06) |
| 포장 단위 | 출하 1건당 온도대별 봉투 1개 | MFC 7-6 "온도 보호·분리" 원칙 |
| 분할 | 총 상품중량 10,000g 초과 시 (확정 정책) — 중량 내림차순 first-fit | 실제 분할은 order-service 이행 계획 |
| 입고 차량 | 2시간마다 + 수동 호출, 차량당 최대 40품목, 목표 = 칸 한도×2 | 실제는 매일 오전 1회, 공급량은 SCM 산식 |
| 수령 | 검수 단계 없이 정상 = H+E (격리 0) | 10-31 mfc-inventory 구현과 같음. **재고 v2(`mfc-v2`)에서는 H 만 → 품질검사 → 적치 때 E+ 로 바뀜** (위 후속 작업) |
| 적치 순서 | 냉동·냉장 먼저, 피킹 칸을 한도까지 채우고 남는 수량은 보충재고 팔레트 | 문서에 적치 규칙 없음. 실서버는 `GET /putaway-candidates`(mfc-location) 후보를 따른다 |
| 칸 한도·최소 | 칸 치수 ÷ 상품 치수 (최대 16), 최소 = 한도의 30% | R-11 |
| 입고 작업 우선순위 | 하차·검수 → 긴급 보충 → 적치 → 일반 보충 | 문서에 없음 |
