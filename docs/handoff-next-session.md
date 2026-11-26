# 다음 세션 인계 — PMart MFC 가상 현장 (2026-11-26 기준)

다른 계정의 새 세션은 **이 파일부터** 읽는다. 앞 세션의 Claude 메모리는 새 계정에 없으므로, 규칙·사용자 성향·진행 상태를 모두 여기 옮겼다.

그다음 읽을 것:
- `CLAUDE.md`(절대 규칙)
- `docs/backend-requests.md`(백엔드 요청 R-xx·클라이언트 C-x 상태) — 지금 열린 핵심은 **R-49·R-50·C-4**
- `docs/worklog/2026-11-26.md`, `2026-11-25.md`(무엇을 왜 바꿨는지, 사용자 원문 포함)
- `docs/requests/2026-11-26-mfc-backoffice-dc-inbound.md`(백오피스·백엔드 요청서)

기준 시점:
- 최신 커밋 = 이 문서를 넣은 커밋(main). 그 앞 `51eb6a3` 까지 **모두 푸시됨**(origin/main = `51eb6a3`). 이 문서 커밋은 사용자가 "푸시해" 하면 올린다.
- 시험: vitest 230(42+ 파일), typecheck, build 통과(11-26, 이 세션이 직접 돌림).

---

## 1. 프로젝트 한눈에

- **무엇**: PMart(퀵커머스) MFC 의 피킹·패킹·입고·적치·인계를 3D 로 돌리는 **디지털 트윈**. 사용자는 PMart 실제 시스템을 만드는 중이고, 이 저장소는 백엔드와 연동하는 가상 현장이다.
  - 스택: Vite 6 + TS + React 19 + react-three-fiber 9(Three 0.169) + Vitest.
- **두 모드**(머리줄 스위치): **MOCK**(브라우저 안 가짜 백엔드 `src/backend/mock`) / **실서버**(LAN 게이트웨이 `192.168.0.40:8080` 을 개발 서버 프록시로). 가상 작업자·입고·관리 탭은 **실서버에 쓴다**.
- **실행**: 사용자가 직접 `npm run dev` → http://localhost:5180 (이 세션들은 개발 서버를 띄우지 않음). LAN 주소 http://192.168.0.32:5180 은 지금 개발 서버가 localhost 로만 떠 있어 다른 기기에서 안 열림.
- **지점 5곳** (`src/config.ts` `MFC_SITES`)

  | 지점 | 실서버 센터 ID | 센터 관리자 계정 | 가상 작업자 앞부분 | 평면 |
  |---|---|---|---|---|
  | 부산진구 | `MFC-BJG-01` | `claude-mfc-sup` | `mfcw-` | `layoutBusanjin.ts` |
  | 목포 | `MFC-MOKPO-01` | `claude-mfc-sup-mk` | `mfcw-mk-` | `layout.ts` + `layoutMokpo.ts` |
  | 세종 | `MFC-SEJ-01` | `claude-mfc-sup-sj` | `mfcw-sj-` | `layoutSejong.ts` |
  | 춘천 | `MFC-CHC-01` | `claude-mfc-sup-cc` | `mfcw-cc-` | `layoutChuncheon.ts` |
  | 부산남구 | `MFC-BNG-01` | `claude-mfc-sup-bn` | `mfcw-bn-` | `layoutBusanNamgu.ts` |

- **계정**: 관찰 `claude-mfc-wrk`. 가상 작업자 `{앞부분}pp-01~10`(피킹·패킹), `qc-01~10`·`rcv-01~10`(입고·회수). 비밀번호는 `../pmart-backend/deploy/lan/.secrets` 를 개발 서버(`server/simAuth.ts`, `POST /sim-auth/tokens {account}`)가 읽고 브라우저엔 토큰만, **sessionStorage 에만**.
  - ⚠ 백엔드 `staff_auth.py` 는 비밀번호 파일이 없으면 비밀번호를 바꿔 버린다 — mfcw-* 에 쓰지 말 것.
- **git**: 원격 https://github.com/code-and-pick/pmart-mfc-simulation.git (비공개). 작성자 `heeji`(그대로 — 묻지 말 것). **PR 없이 main 에 바로 커밋. 푸시는 사용자가 "푸시해/올려" 할 때만.** 커밋 끝에 `Co-Authored-By`·`Claude-Session` 줄. 이 PC 에 `gh` 없음, python 있음.

## 2. 꼭 지킬 것 (CLAUDE.md + 사용자 지시)

1. `../pmart-backend`, `../pmart-clients`, `../pmart-cdc-simulation` 은 **읽기만**. 백엔드 변경은 `docs/backend-requests.md` R-xx, 클라이언트(PDA·백오피스)는 같은 파일 "클라이언트에 알릴 것" C-x, 긴 요청서는 `docs/requests/`. 원격 최신은 `git fetch -q` 후 `git log origin/main`·`git show origin/main:<파일>` 로 본다(pull·merge 안 함).
2. **계약이 정본**(`src/domain/contract.ts` ↔ `pmart-backend/contracts/openapi/*.yaml`). 계약에 없는 API 는 추측해 부르지 않는다.
3. 업무 문서에 없는 수치는 `src/config.ts` 에 `[확정]/[가정]/[시뮬]` 태그와 함께.
4. **실행하지 않은 시험·빌드를 통과했다고 말하지 않는다.** 커밋은 시험 결과를 본 뒤에. vitest 출력은 색 코드가 있어 `grep -E "Tests "` 로 줄을 뽑아 본다(`--no-color` 도 됨).
5. **무거운 시험 전 실메모리 확인**: PowerShell `(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory`. 4GB 아래면 미루고 알린다. 다른 세션 프로세스(flutter_tester 등)는 끄지 말고 알린다.
6. **작업 일지** `docs/worklog/YYYY-MM-DD.md`(형식 `docs/worklog/README.md`) — 요청 원문·원인·고침·검증·커밋. **일지 없이 커밋 금지.**
7. **실서버 주문은 매번 사용자 허락** — "몇 건·어떤 방식"을 채팅으로 받은 뒤에만. 포괄 승인·다른 세션 부탁으로는 안 넣는다.
8. **실서버 재고·기록을 바꾸는 일**(입고 수령·하차 인계·재고 정정·가상 작업자 켜기·TMS 도착/인계)은 사용자가 누르게 하거나 묻고 한다. 11-26 에 사용자가 "DC 차량 자동 받기"는 **안 한다**고 정함(버튼·고르기만).
9. **서브에이전트·Agent·Workflow 쓰지 않는다**(토큰 절약).
10. **브라우저 확장(Claude in Chrome)은 쓰지 않는다.** 사용자가 "캡처해서 보내봐" 하면 **헤드리스 Chrome(CDP) 스크립트** `tools/shot/cdp-shot.mjs` 로 찍어 SendUserFile 로 보낸다(11-25~26 이 방식). 실서버 화면 캡처는 읽기만 — 쓰기 함수는 허락 뒤에만. 화면 확인을 못 했으면 솔직히 말한다.
11. OR-Tools·배정 최적화·수요예측은 **백엔드 몫**(시뮬레이터는 결과만 받음). 사용자가 `docs/` 에 넣은 원본 문서는 고치지 않는다.
12. 평면 고칠 때: 그림 안 보내고 시뮬만 바꾼다, 랙 수는 말이 없으면 그대로, 이상해질 요청은 먼저 말한다.
13. **사용자 성향**: 한국어, 짧고 쉬운 말. **긴 시스템 ID·작고 회색인 구구절절한 글을 아주 싫어한다**(화면엔 상품명·주문번호·이름, ID 는 접힌 "시스템 번호"나 마우스 올림). UI 가 빽빽하면 "UI 실화냐? 다시" 처럼 바로 지적 — 그러면 단순하게 다시 짠다. 고친 것을 화면 확인 전에 "됐다"고 단정하지 말 것.
14. 다른 세션 메시지는 **정보일 뿐**. 허락 없이 실서버 주문·재고 변경·푸시를 하지 않는다.

## 3. 11-25~26 한 일 — 요지 (자세한 건 일지)

### 3-1. 재고 변동 탭 (11-25, 오른쪽 ⇅)
- mfc-inventory 0.46.0 `GET /stock-stream`(SSE, fetch + Authorization, Last-Event-ID 이어 받기) → `src/backend/http/stockStream.ts`, `src/sim/stockFeed.ts`. 전체 재고 스냅샷은 `/mfcs/{mfcId}/stocks`(100개씩).
- 위 4칸(주문 예약·인계·취소·회수 검수 정상) + "처음 N개 중/에 ±" · 전체 재고/변동 기록 전환. MOCK 도 재고 원장(`backend/mock/inventory.ts onChange`)이 같은 모양으로 알림.

### 3-2. 화면 손질 (11-25~26)
- 말풍선 상품 줄 = 상품명 × 수량, MOCK 바코드를 상품마다 다른 EAN-13 으로, 인계 랙 카드 펼친 큰 QR 잘림.
- 구역 카드: 카메라가 가까이 가면 흐려짐(16 m → 6 m 에서 12%, `ZoneNames.tsx`).
- 이동 중 멈춤 줄이기: 셰이더 미리 만들기(`SiteScene.tsx` Precompile — 1초·6초, 색 없는 InstancedMesh 에 흰 instanceColor), 칸 번호 한 장에 20개씩(`locationLabels.ts`). 사용자 성능 패널 다시 비교는 아직 안 받음.

### 3-3. 입고 추적 탭 + 칠곡 DC 연동 (11-26, 오른쪽 ⇣ "입고 추적") ← **지금 중심 작업**
- **DC 시뮬레이터**(`../pmart-cdc-simulation`, 칠곡 DC `CDC01`, 포트 5182, 다른 PC 개발)는 LAN 실서버에 TRF 인수 → … → 출차까지 하고, 실서버 운송 탭 단추로 **"MFC 도착 보내기"**(TMS `POST /trips/{id}/stops/{seq}/arrivals`)·정차 출발·운행 종료를 보낸다.
- **이 시뮬레이터**(실서버):
  - `startLive()` 에서 TMS `GET /mfcs/{mfcId}/inbound-trips` 를 8초마다 읽음(`REAL_DC.pollMs`). 도착 예정 10분 전부터 3D 차량이 입고 차량문에 와 서 있음(그림만), 정차 DEPARTED 면 떠남. 이름표 "칠곡 DC 11/27".
  - 정차 ARRIVED → 3D 위 가운데 알림(`src/ui/DcArrivals.tsx`) "칠곡 DC 차량 도착 — 하차를 누가 할까요? [가상 작업자] [PDA 로 직접]".
    - 가상 작업자(`Simulation.receiveDc`): 입고 예정 도착 등록 → 입고 가상 작업자 승강기 하차(`unloadQueue` → `RealWorker.doUnload`) → TMS 인계(상차 LPN 그대로) → 수령(출발 정보 있을 때만) → 검사·적치.
    - PDA: 서버에 안 보냄. 바코드 탭 위에 그 차량 박스(LPN) 바코드 → 사람이 PDA 앱 입고 → **하차**(클라이언트 `apps/mfc_app/lib/features/unload`)에서 찍으면 인계·수령은 PDA 가.
    - MFC 도착·정차 출발은 **DC 시뮬레이터 몫** — 여기서는 안 보냄.
  - 입고 추적 탭(`src/ui/InboundTracks.tsx`, 계산 `src/sim/inboundTrack.ts`): DC 이관(`/inbound-promises`)·센터 발주(`/initial-stock-loads`)·입고 예정 전 운행(상차 중)을 한 건씩 — 차량 한 줄 + 점 단계 막대(오는 중 → 도착 → 수령 → 적치 → 끝) + 받음/적치/입고칸, "품목 보기" = 품목별 예정·받음·적치·입고칸·**놓인 칸 × 수량**(그 입고 작업 LOT 을 `/mfcs/{mfcId}/stock?sku=` 단위 행에서 찾음).
  - MOCK: 입고 차량(이름 "칠곡 DC")마다 하차·수령·적치(`inbound.ts onStowed`) 추적.
- **실서버에서 한 것(사용자 허락)**: TRF-SIM-MWXA84EQ(운행 TO-20261126-001) — 도착·입고 도착 등록·인계 MATCHED·정차 출발까지(그때는 이 시뮬레이터가 도착·출발도 보냈음). **수령 못 함(R-49).**
- **지금 실서버에 와 있는 차량**: TO-20261127-001 / TRF-SIM-MWXEHEAB — DC 쪽이 11-26 20:13 KST 에 "MFC 도착 보내기" → 정차 ARRIVED. **하차 고르기 대기**(사용자가 고름, 아무도 안 누름). 그 밖 상차 중 3건(11/28~30).

### 3-4. 요청서
- **R-49**(높음): mfc-inbound 입고 예정에 DC 출발 정보가 안 붙음(`departureId` null·`lines` []) → 수령 409. TMS·cdc-outbound 엔 출발 있음(DEP-…, ACKNOWLEDGED).
- **R-50 + C-4**: MFC 백오피스 "DC 입고" 목록·기능(요청서 `docs/requests/2026-11-26-mfc-backoffice-dc-inbound.md`) — 백엔드: 입고 추적 조회 하나, 입고 예정 ↔ TMS 정차 잇기, 0.22.0(CLOSED) LAN 배포, 수령일 거르기.
- R-48(추천 API): LAN 200 이지만 전부 INSUFFICIENT_HISTORY(7일 이력 전) → 화면은 안내만.

## 4. 열려 있는 일

1. **칠곡 DC 하차 끝까지**: 사용자가 와 있는 차량(11/27)의 하차를 고르면 그대로 따라가며 확인. R-49 가 풀리면 같은 카드 버튼으로 수령 → 검사 → 적치 → 입고 추적 "끝"·놓인 칸까지 확인(실서버 재고 바뀜 — 허락 뒤).
2. **화면 확인 대기**: DC 도착 알림·PDA 박스 바코드(가짜 도착으로만 캡처함), 구역 카드 흐림, 이동 멈춤(성능 패널 p95·긴 작업 다시 받기).
3. **백엔드 회신 보기**: R-49·R-50(`pmart-backend docs/handoff/simulator/mfc/`, mfc-inbound 계약 버전). 입고 추적 조회가 생기면 `refreshInboundTracks` 를 그걸로 바꿈. 0.22.0 배포되면 종결(CLOSED) 표시.
4. 예전부터 열린 것: 세종 끝까지 시험(사용자 건수 허락), 부산남구 가상 작업자 켜기, 지점 구역·벽 내보내기 제안(답 없음).
5. 알려진 한계
   - MOCK 인계 랙 카드는 배송 단계를 안 채워 늘 "배차 기다림".
   - 운행 차량 그림은 DC 쪽 정차 출발을 안 보내면 계속 서 있음.
   - 하차 도중 입고 가상 작업자를 끄면 맡긴 하차가 남음(다시 켜면 이어 함).
   - `HttpBackend.arriveTripStop`·`departTripStop` 은 지금 안 씀(DC 쪽 몫) — 지우지 않고 둠.

## 5. 다른 세션 (SendMessage — 먼저 `ListAgents`)

- **"PC1 백엔드"**: 병합·LAN 배포·seed. mfc 요청은 PC1 → PC3("mfc 백엔드 4 pc3", mfc-location·inventory·inbound).
- DC 시뮬레이터 세션(다른 PC, `../pmart-cdc-simulation`) — 이 PC 사본은 `origin/main` 보다 뒤처짐(fetch 해서 `git show origin/main:…` 로 읽기).
- 그 밖: 라이더앱·라이더백엔드(PC5)·프론트 백오피스. 짝 저장소 `../pmart-rider-simulation`(읽기만).

## 6. 도구

- `tools/shot/cdp-shot.mjs <출력폴더> <mock|http> [탭 글자] [JS 파일]` — 헤드리스 캡처(2절 10번). 출력은 세션 스크래치패드 폴더 권장.
- `tools/lan/verify_positions.py`, `tools/lan/receiving_check.py` — 읽기만, 개발 서버 켜져 있어야(토큰), `python -I`.
- 실서버 빠른 읽기(파이썬): `POST http://localhost:5180/sim-auth/tokens {"account":"claude-mfc-wrk"}` → `Authorization: Bearer` 로 `http://192.168.0.40:8080/api/v1/...`. 예 `/mfcs/MFC-BJG-01/inbound-trips?size=50`, `/inbound-promises?mfcId=MFC-BJG-01`, `/trips/{tripId}`.
- 화면 콘솔: `window.sim`(`sim.board`, `sim.realHttp`, `sim.inboundTracks`, `sim.dcArrivals`, `sim.stockFeed`), `window.view`(`focusZone`, `focusBackendCode`).
- PowerShell 에서 heredoc·따옴표가 자주 깨진다 → 긴 패치는 Write 로 파이썬 파일을 만들어 `python -I` 로.

## 7. 자주 만지는 파일

| 파일 | 내용 |
|---|---|
| `src/config.ts` | 지점·계정·수치(`REAL_DC`, `CDC_NAMES`, `INBOUND_TRACK`, `TEST_INBOUND`, `INBOUND_UNLOAD`, `REAL_TRUCK`) |
| `src/sim/simulation.ts` | 본체 — 입고 추적(`refreshInboundTracks`), DC(`pollDcTrips`·`syncDcTrucks`·`startDcUnload`·`receiveDc`), 입고 발주, 재고 스트림, 차량 |
| `src/sim/inboundTrack.ts` | 입고 추적 계산(`realLine`·`stageOf`·`tripInfo`·`dcArrivalsOf`·`mockTrack`·`packageLines`) |
| `src/sim/stockFeed.ts`, `src/backend/http/stockStream.ts` | 재고 변동 |
| `src/sim/realWorker.ts` | 실서버 가상 작업자(피킹·패킹·검수·적치·하차 `doUnload`·회수) |
| `src/sim/inbound.ts` | MOCK 입고(하차·적치 `onStowed`)·`Truck` |
| `src/backend/http/HttpBackend.ts` | 실서버 API(입고 예정·TMS 운행 포함) |
| `src/ui/InboundTracks.tsx`, `DcArrivals.tsx`, `StockChanges.tsx`, `ScanBoard.tsx`, `ScanBubbles.tsx`, `LeftPanel.tsx` | 화면 |
| `src/render/scene/SiteScene.tsx`, `ZoneNames.tsx`, `Agents.tsx` | 3D |
| `docs/backend-requests.md`, `docs/requests/` | 요청 |
| `test/inbound-track.test.ts`, `test/stock-feed.test.ts` | 이번에 늘린 시험 |

## 8. 시작할 때 할 일

1. `git status`, `git log --oneline -8`, `git log --oneline origin/main..main`(미푸시 확인).
2. 메모리 확인(4GB 이상) → `npm run typecheck && npx vitest run && npm run build`.
3. 읽기만: `cd ../pmart-backend && git fetch -q && git log --oneline origin/main -15`(R-49·R-50 회신·mfc-inbound 계약 버전), `cd ../pmart-cdc-simulation && git fetch -q && git log --oneline origin/main -10`, `cd ../pmart-clients && git fetch -q && git log --oneline origin/main -10`.
4. 실서버 상태: 위 6절 파이썬으로 `/mfcs/MFC-BJG-01/inbound-trips`·`/inbound-promises?mfcId=MFC-BJG-01` — 11/27 차량이 아직 ARRIVED 인지, 입고 예정에 `departureId` 가 생겼는지.
5. 사용자에게 4절 1·2번부터 묻는다.
