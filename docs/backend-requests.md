# 가상 MFC 현장(시뮬레이터) → pmart-backend 요청 목록

> 시뮬레이터는 `../pmart-backend` 를 **읽기만** 한다. 아래는 실서버 연동에 필요한 백엔드 쪽 변경·결정이다.
> 백엔드 회신은 `pmart-backend/docs/handoff/simulator/mfc/` 에 R 번호로 온다(11-16 폴더 나눔)(안내: `docs/backend-handoff.md`).
> 기준 시점: **2026-11-16 재정리**(최초 2026-10-31, 재검토 11-07·11-10). 백엔드 `main` `00845b9f` 기준. 회신 정본: `2026-11-09-simulator-notice-integration-decisions.md`, 연결 결정 SIM-1~11 `docs/simulator/mfc/mfc-simulator-integration.md`.
> 계약 버전: mfc-fulfillment 0.4.11, mfc-capacity 0.14.0, mfc-inventory 0.16.0, mfc-location 0.7.1, mfc-inbound 0.9.0, employee-auth 0.9.0, product 0.1.0.
> 원칙(백엔드 2026-11-09): **백엔드 계약이 정본, 시뮬레이터와 안 맞는 부분은 시뮬레이터가 맞춘다.**

## 연결 방식 (백엔드가 알아야 할 전제)

- **역할**: 시뮬레이터 한 대가 현장 단말 여러 대를 연기한다 — 점원 PDA(피킹·패킹·입고·적치), 라이더 앱(QR 인계, 배송 서비스 구현 뒤), 센터 화면(작업·재고·위치 조회).
- **경로**: 브라우저 → Vite 개발 서버 `/api` 프록시 → 게이트웨이(`PMART_GATEWAY`) → 각 서비스 **공개 계약 API**(SIM-11). 업무 API 는 `/internal/*` 을 부르지 않는다. 예외는 토큰 발급 한 곳(아래 인증, R-14).
- **인증(2026-11-16 바뀜)**: auth-service 운영자 로그인(`POST /auth/operator-logins`)은 11-13 에 없어졌다(ADR-0056, employee-auth). 시뮬레이터는 Vite 개발 서버가 LAN 시험 계정 비밀번호로 Keycloak(`pmart-staff`, 클라이언트 `pmart-dev-cli`)에 로그인한 뒤 employee-auth `POST /api/v1/internal/dev-token-exchange`(LAN 시험 전용)로 직원 토큰을 받는다 — 백엔드 `deploy/lan/checks/staff_auth.py` 와 같은 흐름. 비밀번호는 Vite 서버만 읽고(`deploy/lan/.secrets`, Git 아님), 브라우저에는 토큰만, 토큰은 메모리에만 둔다. 계정은 `docs/operations/lan-test-accounts.md`.
  - 계정: 관찰(읽기) `claude-mfc-wrk`, 가상 작업자 `mfcw-pp-01`~`10`(사용자 결정 2026-11-16). 나머지 `mfcw-*` 는 실제 PDA 용.
  - `staff_auth.py` 의 "비밀번호 파일이 없으면 Keycloak 관리 API 로 비밀번호를 새로 정함"은 쓰지 않는다 — 70명 공용 비밀번호가 깨진다.
- **원칙**: 계약에 있는 API 만 부른다. 응답이 없으면 결과 불명으로 보고 같은 `Idempotency-Key` 로 재전송한다. 서버가 확정한 결과만 화면에 확정으로 그린다.
- **데이터**: 실서버 모드에서 정본은 백엔드. 가짜 실적은 시뮬 센터·시뮬 계정으로 구분한다(SIM-8).
- **시험 센터**: `MFC-SEED-01`. 칸은 이 시뮬레이터 평면(랙 위치·좌표)대로 등록돼 있다(SIM-6 보완 L-1). 칸 수는 2026-11-16 MFC 문서 설계로 바뀜 — 선반 14,559칸(백엔드 `handoff/simulator/mfc/2026-11-16-simulator-notice-layout-v2-slots.md`), 시뮬레이터 `layout.ts` `SLOT_DESIGN` 반영.
- **현장 라벨**(백엔드 `deploy/lan/seed/labels/README.md`, `ece5a2ad` 2026-11-17 확인): 위치 라벨 14,608곳(시뮬레이터 선반 14,559 + 그 밖 49 와 모두 같음), 카트 라벨 4장. 시뮬레이터가 따르는 점:
  - **카트 4대** → 현장에서 동시에 피킹할 수 있는 사람은 4명. 서버는 카트 수를 막지 않는다. 시뮬레이터는 가상 작업자를 10명까지 켤 수 있게 두고(사용자 결정 11-16), 5명 이상이면 왼쪽 패널에 경고만 띄운다.
  - **상품 바코드 299…(GS1 매장 내부용)** 503개는 서버에 등록돼 있지만 인쇄 스티커가 없다 → 실제 PDA 로 상품을 찍을 때는 시뮬레이터 스캔 판(화면 바코드)을 찍는다.
  - **송장(TRF)·입고 박스(BOX) 라벨 없음**(CDC 몫) → 입고 실연결(R-10)을 할 때 필요. 그때 시험 라벨을 누가 만들지 정한다.

## 백엔드에 이미 있는 기능 (2026-11-16 확인)

계약 경로는 `contracts/openapi/*.yaml`, 구현 상태는 `services/mfc-*/CLAUDE.md`. "실측"은 시뮬레이터 PC 에서 `claude-mfc-wrk` 토큰으로 게이트웨이(`192.168.0.40:8080`)를 읽기만 한 결과다.

| 서비스 | 기능 · 경로 | 실측 11-16 | 시뮬레이터 사용 |
|---|---|---|---|
| mfc-fulfillment 0.4.11 | 작업 목록 `GET /tasks?mfcId&state=`(센터 전체, 페이지 cursor) | 200 (열린 작업 0, 전체 71 — E2E 69·실제 주문 1) | **사용** — 실서버 관찰 3초 조회 |
| | 작업 상세 `GET /tasks/{id}`(줄·`picks[]` LOT 조각·위치 후보·`allocatedQty`·`visitSeq`) | 200 | **사용** — 지시 칸·줄 SKU |
| | 시작·실적·내놓기 `POST /tasks/{id}/starts`·`/executions`·`/releases`, 단건 조회 `GET …/starts/{requestId}`·`…/executions/{executionId}` | 쓰기라 미호출 | **사용** — 가상 작업자 시작·집품·복귀 실적(11-16~17) |
| | 출고 `GET /shipments/{id}`, 밀봉 `POST /shipments/{id}/packages`, **배차 요청** `POST /shipments/{id}/dispatch-requests`(0.4.11 — 자동 요청 없음, 점원 요청 MANUAL 만) | 출고 200 | **사용** — 관찰(출고·배차 요청), 가상 작업자 밀봉·패킹 시작 때 배차 요청. MOCK 도 점원 요청만(11-17) |
| | 인계 허가·확정·판정·확인 `POST /packages/{id}/handover-*`, 재포장 | 미호출 | 배송 구현 뒤(SIM-7) |
| mfc-capacity 0.14.0 | 작업자 목록 `GET /mfcs/{mfcId}/workers`(표시 이름·업무·휴게) | 200 (71명) | **사용** — 담당자 이름 |
| | 배정 목록 `GET /assignments`, 수동 배정 `POST /assignments`, 추천 `POST /assignment-plans`(OR-Tools) | 목록 200 (102건) | 관찰 보강 후보 |
| | **다음 작업 받기** `POST /mfcs/{mfcId}/workers/{workerId}/next-tasks`(업무 `workArea`, 품질검사·적치 포함) | 쓰기라 미호출 | **사용** — 가상 작업자, 업무 PICK_PACK → STOCK_MOVE → INSPECTION 순(11-17) |
| | 휴게·근무·업무 변경 `…/workers/{workerId}/breaks`·`shifts`·`duty-changes` 등 | 미호출 | — |
| mfc-inventory 0.16.0 | **센터 재고** `GET /mfcs/{mfcId}/stock?sku=`(SKU 1개, LOT 요약 + 위치·업무 상태·품질별 단위 행) | 200 (`B-00000463`: `A-C1-04-2-02` STORED 8, `PAK-A-01` PACKED 2) | **사용** — 주문 SKU 실제 재고 |
| | 자동 보충 기준 `GET/PUT /mfcs/{mfcId}/replenishment-policies` | 200 (0건) | — |
| | 실사 `/mfcs/{mfcId}/count-sessions…`, 정정 `/stock-corrections`, 출고 불가 LOT `/unshippable-lots`, 취급 `/sku-handlings` | 미호출 | — |
| mfc-location 0.7.1 | 위치 목록 `GET /locations?mfcId&zone&temperatureZone&state`(cursor), 단건·상태 전이, 적치 후보 `GET /putaway-candidates` | 목록 200 (옛 문법 위치가 `CLOSED` 로 남아 있음 — 예 `A-01` "새 문법 위치로 이전(ADR-0042)"), 적치 후보 200 | 평면 대조 후보(`state=ACTIVE`). 적치 후보는 **사용** — 가상 작업자 적치 칸(11-17, 시뮬 값) |
| mfc-inbound 0.9.0 | 입고 작업 `GET /inbound-tasks`(품질검사·적치, 상품명·바코드), 실행 `…/inspections`·`…/putaways` | 목록 200 (500건 — 11-17 READY 0건) | **사용** — 가상 작업자 품질검사(11-18 부터 PDA 판정 기준 — 0.11.0 `minRemainingDays`·`maxDaysSinceManufacture`)·적치(11-17, 실서버 작업이 없어 실제 확인 전) |
| | 이동·보충 `GET/POST /move-orders`, 집기·내려놓기·취소 | 목록 200 (0건) | **사용** — 가상 작업자 보충·이동(집기 → 장바구니 → 내려놓기, 11-17, 실제 확인 전) |
| | 회수 반입 `/return-receipts`, 초기 재고 `/initial-stock-loads` | 미호출 | 회수 반입 자리 표시는 배송 쪽(아래 delivery) 회수 배송으로 |
| | 입고 예정 `/inbound-promises/*` | **501** (미구현) | R-10 남은 질문 |
| product 0.1.0 | SKU `GET /skus/{sku}`(무게·`logistics.storageType`·바코드), 바코드 `GET /barcodes/{barcode}` | 200 (`B-00000463`: 500g·AMBIENT, 바코드 빈 배열) | 필요 시 |
| employee-auth 0.9.0 | 브라우저 로그인 `/employee-auth/logins`→`/tokens`(PKCE), 갱신 `/tokens/refresh`, LAN 시험 교환 `/internal/dev-token-exchange` | 교환 200 | **사용** — Vite 서버 토큰 발급(R-14) |
| 게이트웨이 LAN | `/actuator/health` 200(`D603-16:8080`, `192.168.0.40:8080`) | 200 | Vite 프록시 대상 |
| Delivery 배차·라이더 | 직원 배송 찾기 `GET /deliveries?mfcId=`(요약)·배차 상세 `GET /deliveries/{id}/dispatch` — 11-17 대조: delivery-dispatch 0.5.1·execution 0.13.0, 시뮬레이터가 읽는 상태값·필드 그대로(새 필드 `purpose`·`claimId`·`recovery` 만 추가) | 200 | **사용** — 배차·배송 표시(M-01·M-02), 회수 배송(type RETURN)은 요약만 |

## 열린 요청

### R-15 칸(위치) 단위 재고 조회 — 중간 (2026-11-16 추가)
지금 재고 조회는 `GET /mfcs/{mfcId}/stock?sku=`(SKU 1개)뿐이라 "이 칸에 무엇이 몇 개" 를 물을 수 없다. 그래서 시뮬레이터 실서버 화면은 **열린 주문에 나온 SKU 의 칸만** 실제 수량으로 그리고, 나머지 1만 4천여 칸(11-16 칸 설계 뒤 선반 14,559)은 "수량 모름"(회색)으로 둔다. PDA 앱도 같은 공백이 있다(클라이언트 MB-1 — "칸으로 재고를 찾는 API 가 없어 상품부터 고른다").
- 원하는 것(예): `GET /mfcs/{mfcId}/location-stock?zone=&temperatureZone=&cursor=` 또는 `?locationCode=` — 위치마다 SKU·LOT·업무 상태·품질·수량, 응답 `asOf`. 읽기 전용, 그 센터 운영자.
- 쓰임: 실서버 화면에서 센터 전체 선반을 실제 수량으로 그리기(처음 한 번 + 주기 조회는 SIM-5 대로 바뀐 칸만), PDA 이동·실사의 칸 기준 조회.
- 대안으로 받아들일 수 있는 것: 아래 R-16(SKU 여러 개)만 있어도 시험 센터 SKU 약 500개를 몇 번에 나눠 읽을 수 있다.

### R-16 SKU 여러 개 재고 한 번에 조회 — 낮음 (2026-11-16 추가)
주문 하나에 SKU 가 여러 개라 지금은 SKU 마다 한 번씩 부른다(시뮬레이터는 조회 한 번에 최대 10 SKU 로 제한). 
- 원하는 것(예): `GET /mfcs/{mfcId}/stock?sku=A&sku=B…`(상한 100) — 응답은 지금 `CenterStock` 의 배열.
- R-15 가 생기면 필요 없을 수 있다.

### R-17 작업 실적 목록(마지막 실적 칸) — 중간 (2026-11-16 추가)
SIM-2a 는 "실제 PDA 작업자는 마지막 버튼 기준으로 추적"인데, 계약에는 실적 단건 조회(`GET /tasks/{id}/executions/{executionId}`)만 있고 **작업의 실적 목록이 없다**. 목록·상세의 `lastActivityAt` 는 시각만 있고 칸이 없다. 시뮬레이터는 실적 ID 를 모르니 PDA 가 마지막으로 집은 칸을 알 수 없어, 지금은 "다음에 갈 지시 칸"에 작업자를 세워 보여 준다(실제 위치 아님).
- 원하는 것(예): `GET /tasks/{taskId}/executions`(최근 순, 각 실행의 `fromLocation`·`toLocation`·줄·수량·상태·`recordedAt`·작업자) 또는 작업 상세에 `lastExecution { fromLocation, toLocation, recordedAt }`.
- 같은 공백: 이동 지시(`/move-orders/{id}`)의 마지막 집기·내려놓기 칸 — 응답에 이미 있으면 알려 달라.

### R-18 변화 밀어주기(SSE 등) — 낮음, 지금은 요청 아님 (2026-11-16 기록)
SIM-5 결정대로 주기 조회(3초)로 충분하다. 실서버 관찰에서 화면이 1~3초 늦는 것이 문제가 되면 그때 요청한다. 기록만 남긴다.

### R-10 남은 질문 — 정기 입고 수령 뒤 입고 작업 (낮음)
`/inbound-promises/*` 가 아직 501 이다(11-16 실측). 구현되면 수령(`…/receipts`) 뒤에도 같은 INSPECT·PUTAWAY 입고 작업(`/inbound-tasks`)이 생기는지 알려 달라 — 시뮬레이터 입고 흐름을 실서버로 돌릴 때 쓴다.

### R-19 인계 끝난 출고에도 `Shipment.deliveryId` 가 비어 있음 — 낮음 (2026-11-16 추가)
`GET /shipments/ORD-0e67de38-…-S1`(11-10 실제 주문, `HANDED_OVER`, 배차 MANUAL) → `deliveryId: null`. 같은 주문의 배송은 `GET /deliveries?mfcId=MFC-SEED-01` 에 `DLV-74422b51-…` `COMPLETED` 로 있다(11-16 실측).
- 묻는 것: 계약 `Shipment.deliveryId` 는 언제 채워지나(배송 생성 `DeliveryCreated` 를 fulfillment 가 받아 적는지), 아니면 비워 두는 필드인가.
- 시뮬레이터는 그동안 **배송 찾기의 `orderId` 로 후보를 고르고 배차 상세(`GET /deliveries/{id}/dispatch`)의 `shipmentId` 로 출고에 잇는다**(11-17 — 같은 주문의 재발송 출고 fulfillment 0.5.0 과 섞이지 않게. 실측: 배차 상세에 shipmentId 있음). 채워지면 `deliveryId` 를 먼저 쓴다.

### R-07 가상 라이더 배차 — 바뀜: 라이더는 rider 시뮬레이터 몫 (2026-11-16)
배송 서비스(delivery-dispatch 0.3.3·delivery-execution 0.4.0)가 생겼고(백엔드 `rider_e2e.py` 11-16 첫 끝까지 실행), 실서버의 라이더 API 는 짝 시뮬레이터 `../pmart-rider-simulation` 이 부른다(그쪽 `docs/design.md` §2-1). 이 시뮬레이터는 **배차·배송 상태를 읽어 그리기만** 하고 실서버에서 인계 API 를 부르지 않는다 → 아래 "rider 시뮬레이터 요청". MOCK 의 가상 라이더는 그대로.
- 실측 참고(11-16): 인계가 없으면 포장이 `PAK-A-01` 에 PACKED 로 남는다(11-10 실제 주문 7개). 실행 끝 정리(SIM-9)를 할 때 이 포장의 처리 방법(중지·복귀)을 같이 확인한다.

## 해소·결정된 요청 (기록)

| R | 주제 | 결과 | 근거 |
|---|---|---|---|
| R-01 | 점원 단말 작업 흐름 | 해소 — 작업 목록·상세·시작·실행·포장·인계, LOT 조각 `picks[]`, 결품 한 줄 보고 | fulfillment 6a·6b·6c, 0.4.10 |
| R-02 | 가상 작업자 인증 | 해소 — LAN 시험 계정 70명(`mfcw-*`, 공용 비밀번호) 발급 끝(11-16 확인). 토큰 경로는 R-14 | `docs/operations/lan-test-accounts.md` |
| R-03 | 가상 설비 출처 표시 | 결정 — 시뮬 센터·시뮬 계정으로 구분(SIM-8) | 회신 11-09 |
| R-04 | 센터 전체 작업·배정 조회 | 해소 — `GET /tasks?mfcId&state=`·`GET /assignments`(11-16 실측 200) | 회신 11-09 |
| R-05 | 재고 조회(읽기) | 해소·닫힘 — `GET /mfcs/{mfcId}/stock?sku=` 로 주문 SKU 재고를 그린다(11-16 사용 시작). 센터 전체 목록 API 는 만들지 않음(SIM-5, PC 3 공지 `2026-11-16-simulator-notice-recheck-and-changes.md` §2). 칸 단위·여러 SKU 는 R-15·R-16 | inventory 0.16.0 |
| R-06 | 작업 배정 경로 | 해소 — 수동 배정·추천(OR-Tools)·다음 작업 받기. PICK 담당에게 PACK 이어서(`TaskStore.releasePack`) | capacity 0.14.0 |
| R-08 | MFC 로케이션 정본 | 해소(SIM-6) — 평면대로 등록, 코드 대응 `locationCodes.ts` 6,762칸 일치 → 11-16 칸 설계 변경 후 14,559칸(백엔드 설계 규칙과 대조 테스트) | layout-bins 공지 |
| R-09 | 상품·보관 기준정보 | 해소 — `GET /skus/{sku}` 에 무게·`logistics.storageType`·바코드, product 0.2.0 부터 `dimensions`(추정 503개). 쓰는 SKU 만 조회(SIM-5, PC 3 공지 §2) | product 0.1.0 |
| R-11 | 칸 한도·최소량 | 일부 해소 — `replenishment-policies` 있음, 값은 Q-07 미결(기준 없는 칸은 `CONFIG_REQUIRED`). 칸 용량은 위치 `dimensions` ÷ 상품 `dimensions`(inventory 0.18.0). MOCK 의 "칸 치수 ÷ 상품 치수, min 30%" 는 MOCK 에서만 | inventory 0.14.0~ |
| R-20 | 작업 지시 줄 바코드가 비어 PDA 상품 스캔 "다른 상품" | 해소 — fulfillment 0.7.0(`122f03e3`, PC 3 배포): 조회 때 `barcodes[]`·`barcode`(첫 값) 채움, 이미 만든 작업도. 11-16 실측: 진행 중 PICK 7줄 모두 채워짐. 스캔 판은 첫 값 + 나머지 표시 | fulfillment 0.7.0 |
| R-14 | 시뮬레이터 토큰 발급 경로 | 해소 — `dev-token-exchange` 계속 사용(SIM-11 예외, LAN 전용). 조건: 비밀번호 재설정 금지, 계정 `claude-mfc-wrk`·`mfcw-pp-01~10` 만, 토큰을 다시 받은 뒤에도 401 이면 그 계정 멈춤 → `RealWorker` 반영(11-17) | `…/mfc/2026-11-16-simulator-reply-token-r14.md`(`cb2bf317`) |
| R-13 | PICK 실적 도착지(상온 대기 칸이 없음) | 해소 — fulfillment 0.8.0·inventory 0.19.0(`d5386b2f`, 11-17 PDA 요청 P1~P4): **피킹 도착지 = 장바구니**(구역 CART), 한 출고 = 한 장바구니(409 `CART_MISMATCH`), 밀봉 때 `packingLocation`(패킹대) 필수 — 장바구니 → 패킹대로 옮기며 PACKED. 포장 위치(PACKING)도 계속 받는다. 실서버 가상 작업자는 장바구니로 바꿈(11-17), MOCK 은 예전 흐름(`PAK-C-01`·`PAK-F-01`) 그대로. 카트는 40대(`149e15e1` → 온도 구분 없이 `CRT-A-01~40`, `0cbfecaa`) | `docs/handoff/clients/mfc-app/2026-11-17-reply-pick-to-cart.md` |
| R-12 | OR-Tools·Chronos-2 | 회신 — OR-Tools 는 mfc-capacity(Java, JVM 실행 ADR-0053), Chronos-2 미적용. 시뮬레이터 할 일 없음 | 회신 11-09 |

## 시뮬레이터 쪽 후속 작업 (시뮬레이터가 맞출 것 — 백엔드 요청 아님)

| 항목 | 내용 | 상태 · 계기 |
|---|---|---|
| 계약 동기화 | `contract.ts`·MOCK 을 fulfillment 0.4.10 에 맞춤 | 11-10 완료 |
| 칸 코드 | 시뮬레이터 ↔ 백엔드 코드 대응, 고회전 5칸·회수 반입 자리 표시 | 11-10 완료 (SIM-6, L-1) |
| 로그인 | Vite 서버 `/sim-auth/tokens`(Keycloak → dev-token-exchange), 토큰 메모리만 | **11-16 완료** · R-14 해소(11-17 401 재발 시 계정 멈춤) |
| 실서버 관찰 | 열린 작업 3초 조회, 출고별 PICK·PACK·담당 이름, 진행 중 지시 칸·담당자 표시 | **11-16 완료** (화면 확인 전) |
| 주문 상품 실제 재고 | 주문 SKU 의 선반 STORED·포장 구역 PICKED/PACKED 를 3D 에 | **11-16 완료** (화면 확인 전) · 전체 선반은 R-15 |
| 계약 0.4.11 | 배차 자동 요청 없음 — 가상 작업자·MOCK 작업자 모두 패킹 시작 때 점원 배차 요청, MOCK 라이더는 요청 뒤 출발해 출하대기면 인계 | **11-17 완료** |
| 가상 작업자 | `mfcw-pp-01~10` 각자 토큰, 다음 작업 받기 → 시작 → 피킹 → 패킹 시작 때 배차 요청 → 밀봉 | **11-16 완료** (실주문 확인 전) |
| 실제 작업자 위치 | 마지막 버튼 기준(SIM-2a) — 지금은 다음 지시 칸 | 남음 · R-17 |
| 방문 순서 | 받은 `visitSeq` 순서로 걷기 | 11-10 코드 완료 — 실서버 확인 전 |
| 수령 의미 | 재고 v2: 수령 = H 만, 품질검사 → 적치 때 E+. MOCK 의 "수령 = H+E" 를 바꾼다 | 남음 · ADR-0040 |
| LOT | MOCK 에 LOT 조각(FEFO), 결품 보고 `lotId` | 남음 · R-01 |
| 칸 구조 v2 | 백엔드 MFC 문서 설계(사용자 "칸구조 A로" 11-16) — `SLOT_DESIGN`, 선반 14,559칸, 칸 치수·용량 식 | **11-17 완료**(`ed304fd`·`6c63c89`). 백엔드 도면 README·`layout.json` 도 같은 설계로 바뀜(`06a4effa`) — `test/location-codes.test.ts` 가 랙마다 단·칸 수까지 대조 |
| 위치 | 평면을 `GET /locations`(cursor 끝까지)로 대조 | 11-16 한 번 대조(선반 14,559 일치·좌표 0.5cm 안, 임시 스크립트). 화면이 매번 읽지는 않음 · R-08 |
| 입고·보충 | 가상 작업자가 다음 작업 받기로 품질검사·적치·보충·이동·취소품 복귀까지 | **11-17 코드 완료** — 실서버에 그 작업이 0건이라 실제 확인 전. 입고 예정(트럭)은 R-10 501 |
| 회수 | 회수 배송(고객 반품·오배송 회수 → MFC, delivery-dispatch 0.5.0 type RETURN)을 실제 주문 탭·회수 반입 자리 `RTN-A-01` 에(오는 중·반납) | **11-17 일부** — 배송 찾기 요약만(회수지 좌표 안 읽음). MFC 의 회수 수령·검수(`/return-receipts`)는 남음 |
| 실행 끝 정리 | 열린 작업 중지·복귀, 되돌리는 이동, 인계 안 된 포장 | 남음 · SIM-9, R-07 |
| 다른 기기 보기 | 개발 서버 LAN 공개, 다른 기기는 조회만(개발 서버가 관찰 계정 토큰을 붙임), 11-17 부터 관찰 화면이 읽는 경로만(`src/backend/http/lanAllow.ts` 허용 목록 — 개인정보 경로 차단) | **11-16 완료 · 11-17 경로 좁힘** |
| 복귀(RETURN) 표시 | 실제 PDA 작업자의 취소품 복귀 말풍선(① 출발 위치 → ② 상품 싣기 → "실었어요" → ③ 추천 선반 칸), 바코드 탭 | **11-17 완료** — PDA `return_screen.dart` 순서 |
| 주문 현장 기록 | 고른 주문의 `GET /work-orders?orderId=`(fulfillment 0.10.0) — 작업·담당·시작/끝·결품·포장·인계 | **11-17 완료** — 화면 확인 전 |

## 클라이언트(PDA 앱)에 알릴 것 — 백엔드 요청 아님, 사용자가 전달
`../pmart-clients` 도 읽기만 한다. 시뮬레이터 화면과 맞물리는 PDA 앱 동작 중 고칠 만한 것을 적는다.

| # | 내용 | 근거 | 시뮬레이터 대응 |
|---|---|---|---|
| C-1 | PDA 앱이 상품 스캔을 작업 지시 줄의 **첫 바코드(`barcode`) 하나와만** 비교한다. 계약(fulfillment 0.7.0)은 "`barcodes[]` 중 하나면 같은 상품"이라, 바코드가 둘 이상인 상품은 두 번째 값을 찍으면 "다른 상품"이 된다. 입고·검사·재고 조사·이동 화면은 이미 `barcodes.contains` 로 비교한다. | 클라이언트 `c7498f8`(11-17): `apps/mfc_app/lib/features/tasks/presentation/task_controllers.dart:368`(피킹), `features/packing/presentation/packing_controller.dart:171`(포장) | 스캔 판이 첫 값을 "작업 지시 바코드"로 먼저 보이고, 나머지는 "같은 상품 다른 바코드"로 따로 보인다(앱이 바뀌면 나머지도 맞음) |
| C-2 | **LOT 라벨 전환 시점.** 백엔드 LOT 라벨 = **GS1-128** `(01)GTIN-14(17)소비기한 YYMMDD(10)LOT 번호`(inventory 0.21.0·fulfillment 0.11.0, `45ad5671` — 그 전 0.20.0 의 QR `LOT:{lotId}` 는 예전 라벨 해석용으로만 남음). PDA 는 찍은 값의 (10) 을 피킹 지시 `picks[].lotNo` 와 바로 대조할 수 있다(서버 조회 없이), 찍은 값으로 LOT 찾기 `GET /mfcs/{mfcId}/lot-resolutions?code=`. PDA 앱 main 은 아직 상품 바코드로 비교한다(11-17 13:00 기준 LOT 라벨 처리 없음). LAN 재고에는 라벨이 붙어 있지 않아 처음 쓸 때 재출력(`…/lot-labels?sku=&locationCode=`)으로 뽑아 붙여야 하고, 그 전에 상품 바코드를 막으면 피킹이 멈춘다 — **전환 시점은 사용자가 정함** | 백엔드 `c279d1cb`(0.20.0)·`45ad5671`(0.21.0), `docs/handoff/clients/mfc-app/2026-11-17-reply-lot-label.md`. 클라이언트 origin/main `1dca4c2` | 스캔 판·피킹 말풍선이 상품 바코드 옆에 LOT 라벨(GS1-128, 바코드·QR 전환과 상관없이 늘 1차원)을 같이 보인다. 값은 작업 지시 `picks[].lotNo`·`expiresOn`·줄 `barcodes` 로 만든다(서버 조회 없음, LAN `lot-labels` 의 `gs1` 과 같은 값 확인). LOT 번호가 없으면(0.11.0 전 작업) 그리지 않는다 |

## rider 시뮬레이터 요청 (짝 시뮬레이터 → 이 시뮬레이터)

원문: `../pmart-rider-simulation/docs/mfc-simulator-requests.md`(읽기만 — 그쪽 파일은 그쪽이 고친다). 두 시뮬레이터는 서로 부르지 않고 **백엔드 사건으로만** 이어진다. 실서버에서 라이더 API(수락·가게 도착·인계 허가/확정·완료)는 rider 시뮬레이터만 부른다. MOCK 끼리는 연결하지 않는다.

| M | 내용 | 상태 |
|---|---|---|
| M-01 높음 | 실서버 모드에서 출고마다 배차 상태·배정 라이더 표시(실제 주문 탭 출고 줄, 출하대기 랙 이름표). 출하 대기·배차 중인 출고만 3초 조회 | 권한 확인 끝(11-16: 관찰 계정 `claude-mfc-wrk` 로 `GET /deliveries?mfcId=`·`/deliveries/{id}`·`/deliveries/{id}/dispatch` 모두 200). 출고 `deliveryId` 가 비어 있어 `orderId` 로 잇는다(R-19) · **11-16 반영**(실서버 화면 확인 전) |
| M-02 중간 | 배송 상태 `ARRIVED_AT_STORE` → 앞마당에 라이더, 포장 인계되면 출하대기 랙에서 뺌, `PICKED_UP` → 떠남. 오는 중은 "오는 중 RD-…" 표만 | **11-16 반영**(그리기만, 실서버 라이더 도착으로 확인 전) |
| M-03 확인 | 가상 작업자가 패킹 시작 때 배차 요청 — 반영 시점을 rider 쪽에 알린다 | **11-16 반영·알림**(rider 세션에 메시지)(가상 작업자 `mfcw-pp-01~10`, 기본 0명 — 화면에서 켬). 실주문 끝까지 확인 전 |

## 시뮬레이터가 정한 값 (실서버 동작을 대신하지 않음)

| 값 | 시뮬 값 | 이유 |
|---|---|---|
| 인계 fence 유효시간 | 180초 | 백엔드 설정 기본 3분(D-2, `mfc-fulfillment-service.yml handover-fence-ttl`)에 맞춤. 계약은 `fenceExpiresAt` 만 정의 |
| 결품 시 처리 | 고객 사전 선택 "품절 상품만 취소" 로 가정. 보고 때 E·R −q(H 불변), 작업 BLOCKED → **5초 뒤** MOCK 이 결품 사가(CANCEL_ITEM) 대신 해결 | 실서버는 order-orchestration 결품 사가. MOCK 은 같은 SKU 다른 LOT 재확보가 없어 늘 BLOCKED |
| PICK 도착지(MOCK) | 냉동 `PAK-F-01`, 냉장 `PAK-C-01`, 상온 `PAK-C-01` | MOCK 만 예전 흐름(서버도 PACKING 을 계속 받음). 실서버 가상 작업자는 장바구니 |
| 장바구니 고르기(실서버 가상 작업자) | 출고마다 첫 빈 카트(`CRT-A-01~40`, 온도 구분 없음), 다 쓰면 가장 적게 같이 쓰는 카트. 밀봉 뒤 빔. 409 `CART_MISMATCH` 면 detail 의 카트로 다시 | 서버는 카트 온도대·같이 쓰기를 보지 않는다(회신 P4). 카트 온도 구분 없앰(`0cbfecaa`). 현장 배정 규칙 문서 없음 |
| 밀봉 패킹대(실서버 가상 작업자) | 자기가 잡은 패킹대 `PAK-A-0n` 을 `packingLocation` 으로 | 장바구니로 집품하면 필수(0.8.0) |
| 실제 PDA 작업자 말풍선의 카트·패킹대 | 카트: 서버가 아는 그 출고의 장바구니(PACK `packingLocations` 의 CRT-), 첫 집품 전엔 `CRT-A-01`(안내 — PDA 는 아무 카트나 받음). 패킹대: 서버가 알려 주지 않아 `PAK-A-01` | 포장 조회(Package)에 패킹대 위치가 없다 |
| PICK·PACK 배정(MOCK) | 대기 작업자 FIFO, PACK 은 같은 작업자 | MOCK 화면용 임시 규칙. 실서버는 mfc-capacity |
| 포장 단위 | 출하 1건당 온도대별 봉투 1개 | MFC 7-6 "온도 보호·분리" 원칙 |
| 분할 | 총 상품중량 10,000g 초과 시 (확정 정책) — 중량 내림차순 first-fit | 실제 분할은 order-service 이행 계획 |
| 입고 차량 | 2시간마다 + 수동 호출, 차량당 최대 40품목, 목표 = 칸 한도×2 | 실제는 매일 오전 1회, 공급량은 SCM 산식 |
| 수령 | 검수 단계 없이 정상 = H+E (격리 0) | **재고 v2 에서는 H 만 → 품질검사 → 적치 때 E+** (후속 "수령 의미") |
| 적치 순서 | 냉동·냉장 먼저, 피킹 칸을 한도까지 채우고 남는 수량은 보충재고 팔레트 | 문서에 적치 규칙 없음. 실서버는 `GET /putaway-candidates`(mfc-location) |
| 칸 한도·최소 | 한도 = 백엔드 칸 용량 식 floor(칸 부피 × 0.8 ÷ 상품 부피), 안 들어가면 0(11-17 맞춤, inventory 0.18.0 `UnitSize`). 상품 치수는 MOCK 이 무게로 지어냄. 최소 = 한도의 30%(MOCK 만, Q-07 미결) | R-11 |
| MOCK 상품 수 | 온도대별 상온 189·냉장 137·냉동 177(백엔드 LAN 시험 상품 503종 규모, 11-17). 이전 "칸의 85%" | — |
| 입고 작업 우선순위(MOCK) | 하차·검수 → 긴급 보충 → 적치 → 일반 보충 | 문서에 없음. **실서버는 서버 순서**(다음 작업 받기: 주문 PICK·PACK → 보충·긴급 이동 → 품질검사 → 적치 → 관리자 이동 → 취소품 복귀, capacity 0.14.0) |
| 가상 작업자 업무 순서 | `PICK_PACK` → `STOCK_MOVE` → `INSPECTION`(모두 작업 없음이면 기다림), 권한 없는 업무(422 `WORK_AREA_NOT_ALLOWED`)는 그 작업자에서 다시 묻지 않음 | 현장 작업자는 PDA 에서 업무를 하나 고른다 — 가상 작업자는 주문 먼저 |
| 가상 작업자 품질검사 | 소비기한·제조일·제조 LOT 표기는 상품 대신 서버 LOT 정보(`GET /mfcs/{mfcId}/lot-labels/{lotId}`, inventory 0.20.0)에서 읽고, PDA 와 같은 기준(inbound 0.11.0)으로 판정 — 기준 미설정·기한 모름·제조일 필요한데 없음이면 보내지 않음(오류로 두고 다시 받기), 잔여일 부족·제조 후 경과일 초과면 격리(QUARANTINED), 그 밖은 정상 | 값을 지어내지 않는다. 온도 확인·불량 사진·사유는 PDA 화면 몫이라 보내지 않음(계약 요청 본문에 없음). 11-18 |
| 가상 작업자 적치 칸 | `GET /putaway-candidates`(mfcId·sku·qty) 첫 후보(장바구니·출발 칸 제외), 없으면 하지 않음 | PDA 는 후보 없이 아무 선반이나 찍고 서버가 판정한다 — 시뮬레이터만의 선택 |
| 끝낼 수 없는 작업 | 추천 칸·후보가 없으면 오류로 두고 30초 뒤 다시 받기(같은 작업이 돌아옴) — 작업자가 내놓는 API 없음 | 센터 관리자가 풀어야 함 |
| 회수 배송 찾기 | 15초마다(열린 출고가 없어도), 반납 뒤 60분 표시 | 점원 수령 확인 API 가 없어 반납을 MFC 도착으로 본다(execution 0.5.0 설명과 같음) |
| 실서버 재고 다시 읽기 | 작업 version 이 바뀌면 바로, 아니면 30초마다, 조회 한 번에 최대 10 SKU | SKU 1개씩만 조회 가능(R-15·R-16), SIM-5 "바뀔 때만" |
| 실서버 작업자 표시 위치 | 그 작업의 첫 남은 지시 칸(실제 위치 아님) | 마지막 실적 칸을 읽을 API 없음(R-17) |
| 끝난 작업 화면 유지 | 10분 | 표시용 |
