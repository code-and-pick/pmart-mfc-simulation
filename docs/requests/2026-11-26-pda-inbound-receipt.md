# 요청서 — PDA 앱 DC 입고 수령 고치기 2가지 (2026-11-26)

- 보내는 곳: MFC 시뮬레이터(이 저장소) → **MFC PDA 앱**(`pmart-clients/apps/mfc_app`, 입고 `lib/features/inbound/`)
- 시뮬레이터 쪽 번호: 클라이언트 **C-6**(수령 거절)·**C-5**(섞인 박스) — `docs/backend-requests.md` "클라이언트에 알릴 것"
- 사용자 원문(2026-11-26): "상품 박스는 스캔 다 했는데 나머지 2박스는 미도착 처리됐어" → "어찌저찌 정상으로 왔는데 수령등록 거절됐어" → "요청서 적어줘"
- 근거 코드: pmart-clients `origin/main` `a2e0813a`(2026-11-26 저녁 fetch). 계약: pmart-backend `contracts/openapi/mfc-inbound-service.yaml` 0.22.0
- 앱을 다시 만들 필요는 없다. 하차 → 인계 → 송장(TRF) 스캔 → 박스 확인은 실서버에서 됐다. **수령 단계 두 곳만** 고치면 된다.

## 무슨 일이 있었나 (실서버 LAN, 부산진구 MFC-BJG-01)

| 시각(KST) | 무엇 | 서버 기록 |
|---|---|---|
| 21:52 | PDA 하차 — 박스 1개 스캔 → 정차 인계 | TMS 운행 `TO-20261128-001` 정차 1 **HANDED_OVER**, 인계 **MATCHED**(보냄 1·받음 1, 빠진 박스 없음) |
| 21:52 | PDA 수령 — 송장 `TRF:TRF-SIM-MWXELMKQ:3` 스캔, 도착 등록 | 입고 예정 **RECEIVING** |
| 그 뒤 | 박스 확인 화면: **"2박스 미도착"** | (서버엔 미도착 기록 없음) |
| 그 뒤 | 수량 맞춰 수령 등록 → **거절** | 입고 예정 그대로 RECEIVING·version 3·`receipts` 빈 배열 → **저장 전에 거절됨** |

그 송장의 실제 내용(`GET /inbound-promises/TRF-SIM-MWXELMKQ`):

| 상품 | 예정 | 박스(LPN) |
|---|---|---|
| [시험] 3겹 화장지 30롤 (B-00000006, LOT B-00000006-A) | 2 | BOX-MWXH24O3-1 |
| [시험] 3겹 화장지 6롤 (B-00000007, LOT B-00000007-A) | 2 | BOX-MWXH24O3-1 |
| [2개 묶음] 칠성사이다 제로 500ml (B-00000021, LOT B-00000021-A) | 2 | BOX-MWXH24O3-1 |

→ **박스 1개에 상품 3종이 들어 있다.** `packages` 는 상품마다 한 줄이라 같은 LPN 이 3줄.

같은 서버에서 시뮬레이터 가상 작업자가 보낸 수령(TRF-SIM-MWXEHEAB, 21:32)은 **APPLIED** 로 들어갔다. 차이는 아래 1번 `toLocationCode`.

---

## 1. 수령 등록이 거절됨 — 줄에 수령 위치(`toLocationCode`)가 없음 (C-6, 높음)

### 계약
`POST /inbound-promises/{trfId}/receipts` (mfc-inbound 0.16.0~):
- 설명 L182: "줄마다 `toLocationCode`(수령 위치) 필수"
- `RecordReceiptRequest.lines[].toLocationCode` L1528: "(0.16.0) 수령 위치(입고대) — 서버는 필수로 본다(**없으면 400**)"

### 지금 앱
`data/inbound_repository.dart` `recordReceipt`(L88~121)가 줄에 `sku`·`lotId`·`normalQty`·`quarantinedQty`·`pendingQty`·`discrepancyReason` 만 넣는다. **`toLocationCode` 없음** → 400 → `InboundRejected(problem.code)`.

> 사용자 화면에 뜬 문구는 받지 못했다. 같은 요청을 다시 보내 재현하지는 않았다(실서버 쓰기). 계약·코드·서버 기록(저장 전 거절)으로 본 판단이다.

### 부탁
1. 수령 줄마다 `toLocationCode` 를 넣는다. 값은 **상품을 내려놓은 입고칸**(mfc-location 수령 구역).
   - 방법 A(권장): 수령 전에 **입고칸 바코드를 한 번 스캔**(위치 라벨 있음 — 시뮬레이터 "위치 라벨" 인쇄). 온도대가 다른 줄이 섞이면 온도대마다.
   - 방법 B(우선 임시): 센터·온도대별 **기본 입고칸**. 부산진구 LAN 값(시뮬레이터가 쓰는 값, `src/config.ts TEST_INBOUND.receivingByTemp`): 상온 `RCV-A-02` · 냉장 `RCV-C-01` · 냉동 `RCV-F-01`. 지점마다 다르므로 하드코딩보다 위치 조회로.
2. 거절되면 **이유를 보여 준다**: 지금은 `problem.code` 만 남는다(`inbound_controller.dart submit` L488~). `detail` 도 화면에 한 줄로("수령 위치가 없습니다" 등).

### 확인 방법
- TRF-SIM-MWXELMKQ(지금 RECEIVING, 수령 없음)를 다시 수령 → 202 → `GET …/receipts/{receiptId}` `inventoryApplyStatus` APPLIED.
- 서버 확인: 입고 예정 `TIN_POSTED`, 줄 `receivedQty` 2·2·2.

---

## 2. 한 박스에 상품이 여러 개면 박스를 상품 수만큼으로 셈 (C-5, 중간)

### 지금 앱
- `data/inbound_repository.dart` L247~256: `packages` **줄마다** `InboundBox(boxId: lpn, lineKey, unitsPerBox: qty)` 하나 → 같은 LPN 이 3개 생김.
- `domain/inbound.dart` L139 주석 "한 박스엔 한 상품(행)만" — 계약은 그렇게 정하지 않았다(`packages` = `{lpn, parentLpn, sku, lotId, qty}` 줄 목록, 한 LPN 에 여러 줄 가능). DC(칠곡)는 실제로 섞어 싣는다.
- 그래서:
  - **박스 확인**: `arrived` 는 LPN Set(1개) vs `boxList` 3개 → "**2박스 미도착**"(서버 인계는 MATCHED).
  - **박스 열어 세기**: `boxCounts[boxId]` 가 LPN 하나에 계수 하나 → `aggregated`(L182~215)에서 **세 상품 줄이 같은 계수를 나눠 씀**. 박스 입수는 첫 줄 것(`boxById` → `firstOrNull`) = 2개로 보임(실제 박스엔 6개).
  - 이번엔 세 상품이 모두 2개라 2 를 넣으면 우연히 맞는다. 상품마다 수량이 다르거나 박스 전체(6)를 넣으면 **틀린 수량이 수령된다**.

### 부탁
1. **박스 = 고유 LPN.** `boxList` 를 LPN 으로 묶는다: 박스 하나 = `{boxId, 내용물: [(lineKey, qty), …]}`. 박스 수·미도착 수는 고유 LPN 개수로.
2. **섞인 박스를 열면 상품별로 센다**: 박스 안 상품 목록을 보이고(상품명 × 예정 수), 상품 바코드 스캔·± 로 **상품마다** 정상·격리·보류. 한 상품만 든 박스는 지금 화면 그대로.
3. 박스째 파손이면 그 박스 **모든 상품**을 입수만큼 격리(지금 규칙을 상품별로).
4. 하차 인계(`sendHandover` `received`)는 지금처럼 LPN 목록 — 이미 고유 LPN 이라 그대로 맞음.

### 확인 방법
- 섞인 박스 송장(위 TRF 와 같은 모양, DC 시뮬레이터로 새로 만들 수 있음)에서: 박스 확인 "1/1", 박스 열면 상품 3줄, 수령 줄 수량이 상품별로 들어감.
- 목(mock) 시험: `mock_inbound_repository.dart` 에 LPN 하나·상품 둘 이상 박스 하나 추가.

---

## 참고 — 시뮬레이터가 맞춘 것 (앱이 고칠 일 아님)
- 바코드 탭에 PDA 순서대로 보임: ① 하차 박스(LPN, 운행 상차 기준 = 고유) ② 송장 `TRF:{trfId}:{trfVersion ?? version}` ③ 박스 확인 ④ 상품 바코드. 인계 뒤에도 남음.
- 입고 추적 "PDA 로 직접"이 인계 뒤 눌리면 시뮬레이터가 수령을 대신 보내던 버그는 시뮬레이터에서 고침(서버에 안 보냄).
- 섞인 박스를 막을 생각이면 그건 DC(cdc-outbound 포장 규칙) 쪽 결정 — 지금 계약·DC 동작은 섞인 박스를 허용한다.
