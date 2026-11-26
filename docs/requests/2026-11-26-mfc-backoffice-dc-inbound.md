# 요청서 — MFC 백오피스 "DC 입고" 목록·기능 + MFC 백엔드 (2026-11-26)

- 보내는 곳: MFC 시뮬레이터(이 저장소) → **MFC 백오피스**(`pmart-clients/web/mfc-backoffice`) · **MFC 백엔드**(mfc-inbound PC3, mfc-inventory, TMS transport-execution)
- 사용자 원문(2026-11-26): "Mfc 백오피스에서도 재고 Dc에서 입고 받은 거 적치하고, 입고받아서 추가되는 재고 추적 되는 목록이랑 기능 만들어. Mfc쪽에 요청서 서."
- 본보기: 시뮬레이터 오른쪽 **"입고 추적"** 탭(커밋 `bb284ca`·`81e314c`·`9de1ded`) — 같은 계약 API 만으로 만들었다. 화면·순서를 그대로 옮겨도 된다.
- 시뮬레이터 쪽 번호: 백엔드 **R-50**(이 문서 B), 클라이언트 **C-4**(이 문서 A) — `docs/backend-requests.md`.

## 지금 상태 (2026-11-26 실서버 LAN, 읽어서 확인)

| 무엇 | 지금 |
|---|---|
| 백오피스 입고 메뉴 | 입고 작업(검사·적치)·초기 보유 수령·회수품 반입·공급 요청은 있음. **입고 예정(TRF) 탭은 "계약만" 안내**(`src/app/nav.ts` apiMissing "입고 예정(TRF) — 계약만"). DC 운행·입고 추적 화면 없음 |
| DC(칠곡) → MFC | CDC 시뮬레이터가 LAN 에 실제 이관(TRF)을 만들고 출차까지 함. 부산진구로 5건(1건 출발, 4건 상차 중) |
| TMS | `GET /mfcs/{mfcId}/inbound-trips` 200 — 운행·정차·도착 예정·상차 박스(LPN) 다 나옴 |
| mfc-inbound 입고 예정 | `GET /inbound-promises?mfcId=` 200 — 그런데 **출발 정보가 안 붙어(departureId null·lines 빈 배열) 수령 불가** → R-49 |
| 시뮬레이터가 해 본 것 | TRF-SIM-MWXA84EQ: TMS 정차 도착 → 입고 도착 등록 → TMS 인계(박스 1, MATCHED) → 정차 출발까지 됨. 수령·검사·적치는 R-49 대기 |

## A. MFC 백오피스 요청 (C-4)

메뉴 **입고** 아래 "입고 예정(TRF)" 탭을 **"DC 입고"** 로 바꿔 실제 목록·기능으로.

### A-1 목록 — DC 입고 (오는 중 · 오늘 받은 것)
한 줄 = 이관(TRF) 하나. 위에 요약 3칸.

- **요약 3칸**: 오늘 받은 재고(보유 +) · 적치 끝(판매 가능 +) · 아직 입고칸(받았는데 적치 전).
- **줄 칸**: 출발 DC(이름 — `CDC01` → "칠곡 DC") · 차량 한 줄(상차 중 / 운행 중 · 도착 예정 HH:MM · 늦음 / 차량 와 있음 / 인계 끝 · 박스 맞음·차이 / 떠남, 기사·박스 수) · **단계 막대**(오는 중 → 도착 → 수령 → 적치 → 끝) · 품목 수·수량 · 받음/예정 · 적치 · 입고칸 · 막힘 사유(한 줄).
- **순서**: 도착·수령·적치 중 → 오는 중(먼저 올 것 위) → 끝.
- **거르기**: 단계, 날짜(도착 예정·수령일), 온도대.
- 시스템 번호(TRF·운행·수령 ID)는 줄에 길게 쓰지 말고 펼침 안 "시스템 번호"에(백오피스 `SystemNumbers` 처럼).
- 데이터(지금 계약으로 됨):
  - 운행: TMS `GET /mfcs/{mfcId}/inbound-trips`(page·size) — 정차(`stops[]` 이 센터 것)·`estimatedArrivalAt`·`delayed`·`transfers[].lpns`·`handover`.
  - 입고 예정: mfc-inbound `GET /inbound-promises?mfcId=`(끝나지 않은 것) + `state=TIN_POSTED`(오늘 수령분).
  - 입고 예정이 아직 없는 운행(출발 전)도 줄로 — "DC 에서 상차 중 · 11/28 05:00 도착 예정", 상품은 출발 뒤.

### A-2 펼침 — 품목별 재고 추적
- 품목마다: 예정 · 받음 · 검사 끝 · 격리 · **적치 끝** · **입고칸 남은 양** · **놓인 칸 × 수량**(예 `A-C1-04-2-02 3개 · R-01 1개`).
- 박스(LPN) 목록과 인계 결과(빠진·더 온·파손 박스), 수령 차이(`receipts[].discrepancies`).
- 시간 줄: DC 출발 → MFC 도착 → 인계 → 수령(재고 반영) → 검사 → 적치 끝.
- 계산(백엔드 B-2 가 생기기 전, 시뮬레이터 방식): 수령 ID 마다 `GET /inbound-tasks?mfcId=&receiptId=` → 검사(INSPECT)·적치(PUTAWAY) `doneQty` 합, 작업 LOT 들로 `GET /mfcs/{mfcId}/stock-units?lotId=`(또는 `/stock?sku=` 의 units) → STORED = 놓인 칸, UNSTOWED = 입고칸, QUARANTINED = 격리. 다른 입고 LOT 은 세지 않는다.
- "재고 이력"(`/stock-ledger?sku=&lotId=`)으로 바로 가기.

### A-3 기능 — 센터 운영자 버튼 (모두 계약 있음)
| 버튼 | 부르는 것 | 메모 |
|---|---|---|
| 차량 도착 | TMS `POST /trips/{tripId}/stops/{seq}/arrivals` + mfc-inbound `POST /inbound-promises/{trfId}/arrivals`(X-Expected-Version) | 둘 다. 앞 정차가 안 떠났으면 409 PREVIOUS_STOP_OPEN |
| 인계(박스 확인) | TMS `POST …/stops/{seq}/handovers` `{transfers[{trfId, receivedLpns, damagedLpns}]}` | **정차마다 한 번**(그 정차 TRF 를 한꺼번에). 박스 바코드 스캔 또는 체크. 결과 MATCHED/MISMATCHED 표시 |
| 수령 | mfc-inbound `POST /inbound-promises/{trfId}/receipts` | 줄마다 정상·격리·보류·입고칸(`toLocationCode` 필수)·차이 사유. TRF 하나에 한 번. 결과 APPLIED/REJECTED/UNKNOWN_RESULT(같은 키로 다시) |
| 검사·적치 | 기존 "입고 작업" 화면 — `receiptId` 로 거른 목록으로 바로 | 지금 화면 그대로 |
| 차량 출발 | TMS `POST …/stops/{seq}/departures` | 인계 뒤에만(409 HANDOVER_REQUIRED) |
| 입고 종결(관리자) | mfc-inbound `POST /inbound-promises/{trfId}/closures`(0.22.0, 사유 필수) | 오지 않은 이관. LAN 아직 0.21(아래 B-4) |

- 실시간: 백오피스에 있는 재고 스트림(`features/stock-stream`)의 TIN·적치(TASK_EXECUTION) 사건이 오면 그 줄 숫자를 다시 읽기.
- 권한: 그 센터 운영자(OPERATOR). 종결만 MFC_SUPERVISOR.

## B. MFC 백엔드 요청 (R-50, R-49 와 함께)

1. **(먼저) R-49 — 입고 예정에 DC 출발 정보 붙이기.** TMS·cdc-outbound 에는 출발 기록이 있는데(운행 TO-20261126-001 DEPARTED, departureId DEP-c5b97d11-…, 출발 검증 ACKNOWLEDGED) mfc-inbound 입고 예정 TRF-SIM-MWXA84EQ 는 `departureId` null·`lines` 빈 배열 → 수령 409. 이게 풀려야 A 의 수령·검사·적치·재고 추적이 돈다.
2. **입고 추적 조회 하나(백오피스 N+1 을 줄이기).** 지금은 수령마다 작업 목록 + LOT 마다 재고 단위를 따로 불러 합친다. mfc-inbound(또는 bff)에 예: "센터·날짜(또는 TRF·수령 ID) → 수령마다 SKU 별 예정·받음·검사·격리·적치·입고칸 남은 양·놓인 칸(locationCode·qty)·마지막 바뀐 시각" 한 번에 주는 조회. 이름·위치는 백엔드가 정함. 생기면 시뮬레이터도 그걸로 바꾼다.
3. **입고 예정 ↔ TMS 정차 잇기.** TMS 1단계는 사건을 내지 않아 입고 예정의 `eta`·`arrivedAt` 이 TMS 정차와 따로 논다(시뮬레이터는 둘 다 부름). 입고 예정에 `tripId`·`stopSeq`·정차 상태·예상 도착을 붙이거나, "차량 도착" 한 번으로 두 쪽이 같이 기록되게 할지 정해 주세요.
4. **0.22.0(입고 종결 CLOSED) LAN 배포** — 지금 `GET /inbound-promises?state=CLOSED` 400.
5. (낮음) 수령 끝난 예정(`TIN_POSTED`)을 **수령일**로 거르기 — 지금 `date` 는 도착 예정일 기준이라 "오늘 받은 것" 목록을 만들기 어렵다.
6. (확인) `GET /mfcs/{mfcId}/inbound-trips` 의 `driverName` 은 사람 이름 — 백오피스(직원) 화면엔 괜찮지만, 다른 기기 관찰 화면엔 안 넘긴다(시뮬레이터 LAN 읽기 허용 목록에 넣지 않음).

## 시뮬레이터가 맞출 것
- B-2 조회가 생기면 입고 추적 계산을 그 값으로 바꾼다.
- R-49 가 풀리면 받은 1건(TRF-SIM-MWXA84EQ, 도착·인계 끝)을 같은 카드의 받기 버튼으로 수령 → 가상 작업자 검사·적치까지 끝까지 돌려 확인한다(실서버 재고가 바뀌므로 사용자 허락 뒤).
