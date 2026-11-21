# 다음 세션 인계 — PMart MFC 가상 현장 (2026-11-21 기준)

새 세션은 이 파일부터 읽는다. 그다음 `CLAUDE.md`(절대 규칙), `docs/backend-requests.md`(백엔드 요청 R-xx 상태), `docs/worklog/2026-11-20.md`·`2026-11-21.md`(무엇을 왜 바꿨는지)를 본다.
최신 커밋: `c8c7ff5`(main, origin 푸시 완료, 작업 트리 깨끗). typecheck·vitest 138·build 통과.

---

## 1. 프로젝트 한눈에

- **무엇**: PMart MFC(부산진구 시험 센터 `MFC-SEED-01`)의 3D 디지털 트윈. Vite 6 + React 19 + react-three-fiber 9(Three 0.169) + Vitest.
- **두 모드**
  - **MOCK**: 브라우저 안 가짜 백엔드(`src/backend/mock`)로 주문·피킹·패킹·입고를 돌린다.
  - **실서버**: 공용 LAN 백엔드(게이트웨이)를 개발 서버 프록시로 읽고, 가상 작업자·시험 입고·관리 탭은 쓰기도 한다.
- **실행**: `npm run dev` → http://localhost:5180. LAN 공개 주소는 http://192.168.0.32:5180(이 PC = PC1 화면).
- **쓰기 허용 기기**: PC1(이 PC)과 D603-15(192.168.0.222, `REAL_LINK.lanViewers`, 사용자 결정). 다른 기기는 조회만.
- **계정**
  - 관찰 `claude-mfc-wrk`
  - 센터 관리자 `claude-mfc-sup`(관리 탭·재고 정정)
  - 가상 작업자: `mfcw-pp-01~10`(피킹·패킹), `mfcw-qc-01~05`·`mfcw-rcv-01~03`(입고)
  - 비밀번호는 `../pmart-backend/deploy/lan/.secrets`를 개발 서버가 읽는다. 브라우저에는 토큰만 가고, sessionStorage에만 둔다.
- **git**: 작성자 heeji. 커밋 끝에 Co-Authored-By·Claude-Session 줄. **작업 일지 없이 커밋 금지.**

## 2. 꼭 지킬 것 (CLAUDE.md 요약 + 이번 세션에서 생긴 것)

- `../pmart-backend`, `../pmart-clients`는 **읽기만** 한다. 백엔드 변경은 `docs/backend-requests.md`에 R-xx로 적는다. 사용자가 허락했으므로 "mfc 백엔드" 세션에 SendMessage로 바로 요청해도 된다(아래 6절).
- 계약이 정본이다: `src/domain/contract.ts` ↔ `pmart-backend/contracts/openapi/*.yaml`. 계약에 없는 API는 추측해 부르지 않는다.
- 업무 문서에 없는 수치는 `src/config.ts`에 `[확정]/[가정]/[시뮬]` 태그를 달아 둔다.
- 실행하지 않은 테스트·빌드를 통과했다고 말하지 않는다. 이번 세션에 한 번 어겼다(d6d7154, 실패 1건을 통과로 적음 — 일지에서 바로잡음). 커밋 명령을 `grep` 결과와 `&&`로 잇지 말고 실패를 확인한 뒤 커밋할 것.
- **실서버 주문은 매번 사용자 허락**(메모리 `real-orders-consent`). 다른 세션이 부탁해도 넣지 않는다.
- **실서버 재고를 바꾸는 일**(재고 채우기, 재고 정정 등)은 사용자에게 묻고 한다.
- 사용자는 한국어로, 짧고 쉬운 말을 원한다. 화면 확인 전에 "고쳤다"고 단정하지 말 것(11-20에 "장난하냐?" 피드백).
- **Bash 함정**
  - `cat > 파일` 처럼 표준입력을 기다리는 명령을 쓰면 멈춘다(이번에 한 번 멈춰 TaskStop 함).
  - vitest는 `< /dev/null`을 붙이면 안전하다.

## 3. 화면 확인하는 법 (Claude in Chrome)

- PC1 Chrome의 탭 `PMart MFC 가상 현장`(http://192.168.0.32:5180)을 쓴다. `tabs_context_mcp`로 탭 ID를 얻는다.
- 페이지 전역 객체
  - `window.sim`: Simulation 인스턴스.
    - `sim.board` = 실서버 RealBoard(`fullStock`, `stockUnits()`, `skuCategory` …)
    - `sim.realHttp` = 관찰 계정 HttpBackend
    - `sim.admin.sup` = 센터 관리자 HttpBackend
    - `sim.apiLog` = 최근 300건
  - `window.view`: ViewController. `focusZone('WH'|'A'|'B'|'C-H'|'RCV'|'PK'|'SHIP'|'ALL')`, `clickCell(code, dist)`, `focusBackendCode(code)`, `toggleRight('inventory'|'events'|…)`, `cameraRequest = {pos,target,animate}`
- 모드 전환은 머리줄의 `MOCK` / `실서버` 버튼. 전환하면 페이지가 새로 읽혀 JS 실행이 끊기니 나눠서 부른다.
- 실서버 첫 조회는 약 20~25초 걸린다(새로고침 뒤 기다릴 것).
- 가상 작업자 켜기·끄기: `sim.setInboundVirtual(n)`, `sim.setVirtualWorkers(n)`. **실서버 쓰기라 목적이 있을 때만 켜고 끝나면 0으로.**
- 창이 가려져도 가상 작업자가 느려지지 않게 고쳤다(11-21, `REAL_WORKERS.catchUpSec`·`backgroundTickSec`).

## 4. 이번 세션(11-20~21)에서 바뀐 것 — 요지

자세한 이유와 사용자 원문은 `docs/worklog/2026-11-21.md`에 있다.

### 4-1. 입고·적치·보충재고 흐름 (가장 큰 줄기)

- **적치 나눠 넣기**(R-30, 백엔드 배포 완료): 서버가 적치 단건에 `suggestedPlacements[{locationCode,qty}]`·`suggestedUnplacedQty`를 준다. `RealWorker.putawaySplit`이 칸마다 putaways를 보낸다. 다 못 넣은 양은 입고칸에 두고 작업을 열어 두며(5분마다 다시), 적치 예외 BLOCKED는 쓰지 않는다. LAN에서 확인 완료.
- **11-20 보류 490개**: 사용자 허락으로 관리자 정정(holdResolutions, approvalRef `LAN-TEST-R30-20261121`)을 보냈다. 다시 생긴 HOLD_FOUND 적치 22건을 가상 작업자로 모두 반영했다. LAN은 정정마다 approvalRef가 필요하다(PC1 pmart-config 몫으로 넘어감).
- **용어 (사용자 정의)**
  - **입고재고** = 들여왔지만 검수 전(품질 `PENDING_INSPECTION`, 입고칸 `RCV-`)
  - **보충재고** = 검수 끝, 바로 적치 가능(입고칸의 NORMAL 적치 전 + 보충재고 칸 보관). 선반이 넘친 양도 여기.
  - 둘 다 그 온도대의 입고 공간에 두되 **자리로 구분**한다.
- **지금 평면** (`src/domain/layout.ts`)

  | 구역 | 보충재고 | 입고재고(검수 전) |
  |---|---|---|
  | 상온 입고창고(구역 카드 이름 "상온 입고창고") | 앞쪽(남쪽) 보충재고 랙 42개(3쌍 × 7, 그룹 R01) | 뒤쪽(북쪽) 바닥 팔레트 줄 WR-01~06 → 서버 `RCV-A-02`(R-32) |
  | 냉동 A | 남쪽 보충재고 랙 12개 | 팔레트 AR-3·4 → `RCV-F-01`(R-31) |
  | 냉장 B | 남쪽 보충재고 랙 12개 | 팔레트 BR-3·4 → `RCV-C-01`(R-31) |
  | 입고·검수 구역 | — | `RCV-A-01`(차량 하차 직후) 그대로 |

  - 보충재고 랙은 적치 랙과 같은 제품(1.25×0.45×2.1 m), **5단 × 3칸(`RESERVE_SLOTS`, [가정])**.
  - `Rack.reserve`·`Location.reserve`로 표시한다. 서버 칸 코드는 `{A|C|F}-R1-NN-단-칸`. 화면 칸 코드는 앞에 온도 글자를 붙인다(`AR01-01-101` 등 — 온도대마다 R01이라 겹치지 않게).
  - 피킹 칸 목록(`locationsByTemp`)·구역 랙 수·MOCK 상품 자리에서는 뺀다.
  - 예전 보충재고 칸 `A/C/F-R1-01-1-01`의 재고(상온 152·냉장 361·냉동 19)는 랙 01 1단 1칸에 그려진다(코드가 같아서).
  - 팔레트(`L.reserves`)는 이제 **입고재고 자리만**이다(`role:'RECEIVING'`). MOCK 보충재고는 `L.reserveRackSpots`(랙마다 한 자리)를 쓴다.
- **화면**
  - 입고재고 자리 바닥 = 중간 회색 `0x9aa0ab`(사용자: 노랑 → 흰색 → 진회색 → "너무 진한데").
  - 검수 전 상자는 누런 골판지 `0xd9a441`, 검수 끝은 온도색(상온 흰색 `0xffffff`, `zoneBoxColor`).
  - 입고칸 이름표: "입고재고 N개 · 보충재고 N개".
  - 구역 패널(냉동·냉장·입고창고, 실서버): 맨 위 "입고재고 · 검수 전 / 보충재고 · 검수 끝" 수(`inboundSplit`), 아래 "보충재고 랙" 격자.
- **재고 채우기**(`Simulation.runTestInbound`): 상품 온도대별로 입고 예정을 따로 만들고 `TEST_INBOUND.receivingByTemp`(A→`RCV-A-02`, C→`RCV-C-01`, F→`RCV-F-01`)로 수령한다. 그 칸이 없어 거절되면 `RCV-A-01`로 받는다. **실서버에서 아직 돌려 보지 않음.**
- **MOCK 입고**: 상품을 하차 칸 대신 그 온도대 입고재고 팔레트에 2×2로 둔다(`placeOnDock`, `DockItem.stand`). 넘치면 하차 칸에 둔다.

### 4-2. 화면·UI

- 재고 탭 **상품 찾기**(이름·SKU → 위치·수량, 누르면 3D로).
- 이벤트 탭: 두 줄(이벤트 이름 / 내용 한 줄).
- 도움말 › 조작: 하는 일 + 입력 칩, 눌러 보기, 화면 표시 견본.
- 이름표 정리(`Overlays.Declutter`)
  - **위로 비키기 없앰.** 겹치면 우선순위 낮은 것을 숨긴다(확대·축소할 때 오가던 것).
  - 구역 판 모서리가 카메라 뒤면 그 판은 빼고 본다(가까이 가면 이름표가 다 숨던 버그).
  - `userData.shrinkFar`: 멀면 작게(16 m, 최소 45%).
- 팔레트·랙 클릭: 3D 클릭 → 칸 카드. 팔레트는 보던 방향 그대로 6~9 m, 55° 이상 내려다봄. 선반 밖 자리는 그 구역 보기 거리로.
- 회수 반입 자리: 화면만 인계 구역(x 30, z 34.3)으로 옮기고 짙은 회색으로. 서버 좌표는 그대로.
- 패킹 구역 유리벽 삭제, 바닥 구역 카드를 크게.
- 인계 랙 옆 재고(취소 주문 재진열 대기)는 봉투로 랙 아래 칸에. 장바구니 거치대 이름표는 재진열 대기와 나란히.
- 격리 구역(냉동·냉장·상온)마다 흰 랙 2개(장식).
- MOCK 작업자 이름: W04 → 피킹4, IB2 → 입고2(`workerShortName`).

### 4-3. 안정성

- **429 RATE_LIMITED 쏟아지던 것**: SKU 조회를 한 줄로 모았다(`RealBoard.skuCall`, 동시 2, 간격 200 ms, 429면 60초 쉼, 카테고리 한 회차 40). SKU→상품 ID는 sessionStorage `pmart-sim:sku-product`에 캐시한다.
  - 남은 것: 모드 전환이나 첫 조회 때 `/tasks/{id}` 상세 몰림으로 429가 몇 건 난다(다음 조회에서 회복).
- `/mfcs/{id}/workers` 403(관찰 계정 권한 없음)은 10분 간격으로만 다시 시도한다.
- MOCK에서 실서버용 패널(팔레트 격자·카테고리)을 숨겼다.

## 5. 지금 열려 있는 일 (다음 세션이 이어 할 것)

1. **사용자 답 대기 — 보충재고·입고재고 크기**(마지막 질문: "보충재고랑 입고재고를 어느정도로 나둬야 하지 랙 갯수가 저게 맞나?"). 내가 드린 답과 권장은 이렇다.
   - 입고재고: 1회 입고 상한 9팔레트 상당(상온 4.5·냉장 2.7·냉동 1.8) 기준이면 상온 6(충분)·냉동 2(맞음)·**냉장 2(1 부족 → 3 권장)**.
   - 보충재고 랙: 상온 42는 문서 보충랙 18평(약 38랙)과 비슷하다. 냉장·냉동 12씩은 물량(2일치 +25% = 냉장 약 1,205·냉동 약 803개)은 담지만 문서 면적(30·46평)보다 훨씬 작다. 저온실이 피킹 랙으로 거의 차 있어서다. **권장: 지금대로.**
   - 문서의 **대형 묶음 바닥 팔레트(입고창고 22평, 약 24자리 — 생수·음료)**가 랙 전환으로 없어졌다. 다시 둘지 사용자 결정 필요(문서는 피킹 랙을 팔레트 적재에 쓰지 말라고 함).
2. **R-33 요청 — 아직 안 보냄**: 보충재고 랙 칸 990개(상온 42·냉동 12·냉장 12랙 × 5단 × 3칸, `{T}-R1-NN-단-칸`, reserveStock)를 서버에 등록하고 위치를 바꾸는 요청이다. 랙 수가 확정되면 "mfc 백엔드" 세션에 보낸다.
   - 지금 서버 보충재고 칸은 팔레트형 `{T}-R1-NN-1-01`뿐이다. 01번은 재고가 있어 코드를 유지해야 한다. 나머지는 닫거나 위치를 바꿔야 한다.
   - 위치 값은 `buildLayout()`의 reserve 랙 `cx/cz/along/face`와 칸 `shelf`에서 뽑는다. 백엔드 `mfc_layout.py`는 시뮬레이터 layout.json을 기준으로 등록한다.
3. **R-31·R-32 반영 대기**: 백엔드 PR #323·#326(서버 코드 변경 없음, LAN seed)은 **PC1이 `mfc_layout.py support r31`을 실행해야** 반영된다.
   - 반영되는 것: `RCV-C-01`·`RCV-F-01`·`RCV-A-02` 등록, 팔레트 칸 10개(C/F-R1-03·04, A-R1-19~24) 닫기.
   - ⚠ **R-32는 다시 고쳐야 한다**: 처음엔 입고창고 *남쪽* 줄(WR-19~24, z 9.65)로 보냈는데, 사용자가 "보충재고 앞, 입고재고 뒤"로 바꿨다 → 지금 입고재고 줄은 **북쪽**(x 38.6~47.7, z 1.0~2.1, 가운데 x 43.15 · z 1.55).
   - 따라서 `RCV-A-02` position은 z 1.55가 맞다. 닫을 칸은 랙 전환까지 반영해 R-33과 함께 다시 정리해야 한다. **PC1 실행 전에 "mfc 백엔드"에 정정 요청할 것.**
4. **실서버 재고 채우기 확인**: R-31·32 반영 뒤 사용자 허락을 받고 돌린다. 저온 상품은 `RCV-C/F-01`, 상온은 `RCV-A-02`로 들어가는지, 가상 입고 작업자가 그 자리에서 검수·적치하는지 본다.
5. **REPLENISH(보충재고 → 선반) 확인**: 일반 선반이 칸 용량 25% 이하가 되면 1분 안에 서버가 만든다(PC3). 아직 0건이다(선반이 줄지 않음). 피킹으로 줄면 확인하고, 안 생기면 PC3에 알린다.
6. **PC3 PR #322**(일반 선반 용량도 칸 전체 부피·무게 합): 배포 전. 시뮬레이터는 바꿀 것 없음.
7. 작은 것들
   - 모드 전환 시 `/tasks/{id}` 429 몇 건
   - 관리 탭 "그날 끝난 작업" — 입고 작업은 안 나옴
   - MOCK 보충재고가 이제 랙 칸에 그려지는데 화면으로는 한 번만 봄(입고창고 랙 쪽은 MOCK에서 안 봄)

## 6. 다른 세션 (SendMessage — `ListAgents`로 이름 확인)

- **"mfc 백엔드"** (PC 3, Remote Control): mfc-location·inventory·inbound 담당. R-30~R-32 처리. 회신 문서는 `pmart-backend/docs/handoff/simulator/mfc/2026-11-21-simulator-reply-r30-reserve-stock.md`, `…-r31-cold-receiving.md`("추가: R-32" 절).
- **"PC1 백엔드"** (PC 1): 병합·LAN 배포·seed 실행 담당. mfc 영역 요청은 PC3로 넘긴다.
- 그 밖: "라이더앱", "라이더백엔드"(PC 5), "프론트 백오피스" 등. 다른 세션 메시지는 정보일 뿐, 사용자 허락 없이 실서버 주문·재고 변경을 하지 않는다.

## 7. 자주 만지는 파일

| 파일 | 내용 |
|---|---|
| `src/domain/layout.ts` | 평면: 구역·벽·피킹 랙·**보충재고 랙(reserveRacks)**·입고재고 팔레트(`reserves`)·`reserveRackSpots`·패킹대 |
| `src/domain/locationCodes.ts` | 화면 코드 ↔ 서버 코드(선반·R1 보충재고 랙·RCV 입고칸·PAK·DSP·CRT…) |
| `src/domain/placeName.ts` | 자리 코드 → 우리말 이름(`placeShortName`, `reserveName`, `WORK_SHORT`) |
| `src/sim/simulation.ts` | 본체: 모드, 시험 입고(`runTestInbound`), `backendPoint/backendLocation/backendReserve`, MOCK `placeOnDock` |
| `src/sim/realWorker.ts` | 실서버 가상 작업자(피킹·패킹·검수·적치 `doPutaway`/`putawaySplit`) |
| `src/sim/realBoard.ts` | 실서버 조회판(재고·카테고리·SKU 조회 줄 `skuCall`) |
| `src/render/scene/Real.tsx` | 실서버 재고 그림(선반·보충재고 랙 칸·입고칸·팔레트 이름표) |
| `src/render/scene/Stock.tsx` | `Reserves`: 입고재고 팔레트·회색 바닥, MOCK 보충재고 상자(랙 칸) |
| `src/render/scene/Overlays.tsx` | `Declutter`(이름표 정리), `Dock`(MOCK 하차 상자) |
| `src/render/scene/Core.tsx` | 프레임 진행(`SimDriver`), 카메라, 클릭 판정(`Picker`) |
| `src/render/controller.ts` | ViewController(구역 보기·칸 고르기·`clickCell`·`focusBackendCode`) |
| `src/ui/ZoneStock.tsx` | 구역 패널(실서버): 카테고리·입고재고/보충재고 수(`inboundSplit`)·보충재고 랙 격자·칸 카드 |
| `src/ui/RealPanel.tsx` | 재고 탭(상품 찾기) |
| `src/ui/Help.tsx` | 도움말 |
| `src/config.ts` | 모든 수치(`REAL_LINK`, `REAL_WORKERS`, `TEST_INBOUND.receivingByTemp` …) |
| `docs/backend-requests.md` | 백엔드 요청 R-xx와 회신·상태 |

## 8. 시작할 때 할 일 (체크리스트)

1. `git status`·`git log --oneline -5`로 `c8c7ff5` 이후 변화를 확인한다(다른 세션이 main에 커밋할 수 있음).
2. `npm run typecheck && npx vitest run < /dev/null && npm run build`
3. 백엔드 쪽 변화: `cd ../pmart-backend && git fetch -q && git log --oneline origin/main -10`(읽기만). PR 상태는 `gh pr view 323 / 326 / 322`.
4. 5절 1번(사용자 답)과 3번(R-32 정정)부터.
