# PMart MFC 가상 현장 (3D 시뮬레이터)

도심 MFC 한 곳에서 작업자가 **피킹 → 패킹 → 외부 출하대기 랙 적재**를 하고, 라이더가 **QR 스캔으로 인계**받는 과정을 3D로 돌린다.
현장 행동은 모두 `pmart-backend/contracts/openapi/mfc-fulfillment-service.yaml` 의 API 호출로 표현한다. 그래서 백엔드 이행 기능이 구현되면 같은 흐름이 실서버를 상대로 돈다.

## 실행

```bash
npm install
npm run dev            # http://localhost:5180
npm test               # 계약 의미(fence·멱등·결품·재고 불변식) + 화면 없는 2시간 운영
npm run typecheck
npm run build          # dist/
```

실서버 모드의 게이트웨이 주소는 `PMART_GATEWAY` 로 바꾼다. 기본값은 `http://D603-16:8080` 이다.

```bash
PMART_GATEWAY=http://localhost:8080 npm run dev
```

## 화면

- **위**: 시계, 배속(일시정지~120×), 카메라(전체/냉동A/냉장B/상온/패킹/출하대기), 벽 숨김.
- **왼쪽**
  - 운영 조건: 시간당 주문, 작업자 수, 가동 패킹대 1~8, 결품률, 피킹 순서. 실행 중에 바꿀 수 있다.
  - 실서버 연결 점검.
- **오른쪽**
  - 지표: 접수→출하준비 평균·p90, 피킹·패킹대 대기, 가동률 등.
  - 작업 상태판.
  - 로그 탭: API 호출 / 계약 이벤트 / 현장 사건 / 재고 H·E·R·A.
- **작업자 클릭**: PDA 화면과 이동 경로. PDA 화면은 현재·예정 로케이션, 상품, 바코드, 지시수량을 보여 준다(MFC 문서 8-1).

## 모드

| 모드 | 하는 일 |
|---|---|
| MOCK 백엔드 (기본) | 계약 의미를 브라우저 안에서 흉내 낸다. 주문 유입·재고 예약·작업 배정·라이더 배차처럼 다른 서비스가 하는 일도 시뮬레이터가 대신한다. 이 역할 분담은 `src/sim/simulation.ts` 머리 주석에 정리되어 있다. |
| 실서버 | 게이트웨이 `/api/v1` 를 실제로 부른다. 2026-10-31 기준 백엔드 이행 기능(슬라이스 6)이 501이라 연결·인증 점검까지만 된다. 필요한 백엔드 변경은 [docs/backend-requests.md](docs/backend-requests.md)에 있다. |

## 근거와 가정

| 구분 | 내용 | 근거 |
|---|---|---|
| 업무 문서 | 면적 463평, 구역별 평수, 랙 규격 2,100×1,250×450mm | `pmart-backend/docs/business/MFC-business-logic.md` 1장 |
| 업무 문서 | 랙 계획 수 냉동 105·냉장 125·상온 138 | 같은 문서 1장 |
| 업무 문서 | 패킹대 기본 4대·최대 8대, 1.6×0.8m 상판 | 같은 문서 1장 |
| 업무 문서 | 출하대기 외부 랙 2개, 라이더 내부 출입 없음 | 같은 문서 1장 |
| 업무 문서 | 기준 운영값: 주문당 피킹 7분 + 패킹 4분, 피크 40건/시간에 10명 | 같은 문서 7장(가정) |
| 시뮬 가정 | 구역 위치·문·통로 배치 | 문서에 실측 도면이 없음(7-5) |
| 시뮬 가정 | 로케이션 코드 형식 | 문서 8-2 가설 |
| 시뮬 가정 | SKU 900개와 이름 | 실제 상품 마스터가 아님 |
| 시뮬 가정 | fence 유효시간, 라이더 도착 시간 | `src/config.ts` 에 근거 표기와 함께 모아 둠 |
| 재고 규칙 | 피킹·패킹은 H/E/R를 바꾸지 않고, 인계 때 H·E·R가 같은 사건에서 줄어든다(IV-07, IV-08) | `src/backend/mock/inventory.ts` |
| 재고 규칙 | 결품은 H를 그대로 두고 E·R를 줄인 뒤 D로 추적한다(IV-09) | 같은 파일 |

## 구조

```
src/domain/contract.ts        계약 타입 사본 (상태값·필드명 그대로)
src/domain/layout.ts          평면·랙·로케이션·패킹대·출하대기 배치
src/domain/navgrid.ts         보행 격자(0.25m) A* + 경로 다듬기
src/backend/port.ts           FulfillmentPort — 계약 API 1:1
src/backend/mock/             MockBackend(작업·출하·포장·fence) + InventoryLedger(H/Q/E/R)
src/backend/http/             HttpBackend(게이트웨이 실호출, Idempotency-Key·X-Source-System)
src/sim/                      시계·주문 유입·배정·작업자/라이더 스크립트·지표
src/render/view3d.ts          Three.js 장면
src/ui/                       패널·PDA·로그
test/                         vitest
```
