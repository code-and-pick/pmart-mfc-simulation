# 계획서 — MFC Chronos-2 수요예측 · OR-Tools CP-SAT 작업자 배정

> 작성 2026-11-07. 입력: 사용자 제공 「MFC AI 수요예측 및 작업자 자동 배정 시스템 구현 명세」(이하 **명세**, 2026-11-07 대화로 전달).
> 이 계획서는 명세 15장 1·2단계(기존 코드 분석·구현 범위 매핑)의 결과와 그 뒤 단계의 실행 계획이다. **아직 아무것도 구현하지 않았다.**
> 백엔드(`../pmart-backend`)는 읽기만 했다. **OR-Tools 배정을 포함한 구현은 모두 백엔드 작업**이고(2026-11-07 사용자 정정), 이 저장소(시뮬레이터)는 현장 단말로서 결과를 받아 수행만 한다.
> 관련: `optimization-forecast-notes.md`(방향 정리), `backend-requests.md`(R-01~R-12).

## 1. 결론 요약

1. **명세의 참고 문서 6개는 이미 백엔드에 통합돼 있다.** `02_작업관리`~`06_미결정사항`은 `pmart-backend/docs/business/MFC-business-logic.md` 2~6장(WK·IV·IF·TC·Q)으로 합쳐졌다(같은 문서 "출처 및 누락 참조"). `PPC_기본규모_최종통합설계_.md`는 저장소에서 찾지 못했다 → 1장(규모·시설)이 대응하는지 확인 필요.
2. **"기존 Spring Boot MFC 업무 서버 하나"는 실제로는 여러 서비스다.** 명세의 기능을 아래 2장처럼 나눠 맡겨야 한다.
3. **계약 골격은 이미 있다.** 배정 계획(`mfc-capacity` `POST /assignment-plans`), 예측(`demand-planning` `/forecast-runs`·`/forecasts`), 예측 이벤트(`ForecastVersionPublished`). 명세 11장의 신규 경로 제안 대신 **기존 계약을 확장**하는 것이 명세("기존 API를 먼저 확인")와 백엔드 규칙에 맞다.
4. **충돌 2건은 결정이 필요하다.** (가) Chronos-2 Python 런타임 vs 백엔드 "Python 런타임 없음", (나) 예측 소비처 MFC IV-04(명세) vs SCM `replenishment-service`(백엔드 설계).
5. **미결 정책 때문에 끝까지 자동으로 도는 흐름은 지금 만들 수 없다.** Q-07 미결 → IV-04 자동 보충 차단, Q-08 미결 → 자동 발행·가중치 차단. 할 수 있는 범위는 "예측 실행·저장·조회"와 "배정 후보 계산(PROPOSED) + 권한자 검토 발행"까지다.
6. **권장 순서: OR-Tools 먼저, Chronos-2 나중.** PICK·PACK 작업이 슬라이스 6a 로 이미 생기고, 명세 최종 목표도 "Chronos-2 를 거치지 않는 PICK 도 같은 배정 경로"를 요구한다. Java 바인딩은 기존 스택과 맞는다.

## 2. 명세 구성요소 → 백엔드 실제 위치

| 명세 표현 | 백엔드 실제 | 근거 |
|---|---|---|
| MFC 업무 서버 — 작업 생성·실행(WK-01·03) | `mfc-fulfillment-service` (PICK/PACK, 6a 구현) / `mfc-inbound-service` (INSPECT·PUTAWAY, `mfc-v2`) | 각 서비스 CLAUDE.md |
| MFC 업무 서버 — 작업자·자격·배정·계획 발행(WK-02·09·10), OR-Tools | `mfc-capacity-service` | `architecture-design.md` 166행, `tech-stack.md:49` |
| 재고 정본 "기존 WMS" | MFC 재고는 `mfc-inventory-service` (H/Q/E/R, LOT v2) | ADR-0040. `WMS-business-logic.md` 는 CDC WMS 다 |
| 위치·잠금 | `mfc-location-service` | `mfc-v2` |
| Chronos-2 예측 모듈 | `demand-planning-service` (SCM, 2단계, **서비스 미생성**) — 계약은 있음 | `service-map.md` §3, `contracts/openapi/demand-planning-service.yaml` |
| 예측 소비 | 설계상 `replenishment-service`(SCM 보충량). MFC IV-04 직접 소비 경로 없음 | `events.md:74` |
| REPLENISH 작업 | 소유 서비스 미정, inventory `MOVE` 501 | `backend-requests.md` R-10 |
| PDA | 점원 단말 Task API (6b, 501) | R-01 |

## 3. 구현 범위 매핑 (명세 15장 2단계)

분류: ✅ 이미 있음 · 🔧 수정·확장 필요 · 🆕 신규 · ⛔ 미결 정책으로 차단 · 📥 데이터 필요

### 3.1 OR-Tools 작업자 배정

| 명세 항목 | 분류 | 현재 상태 / 필요한 것 |
|---|---|---|
| OR-Tools 의존성 | 🔧 | 버전 카탈로그에 `ortools-java 9.15.6755` 만 등록, `mfc-capacity` 에 미적용 |
| 배정 계획 API (명세 11장) | 🔧 | `POST /assignment-plans`·`GET /assignment-plans/{id}` 계약 있음, 501. 명세 대비 부족: 별도 **commit**·**recalculate** 경로 없음(지금은 `mode: PROPOSE_AND_COMMIT` 로 한 번에 확정 가능 — Q-08 "검토 발행" 과 맞지 않음) |
| 계획 상태 (명세 8장) | 🔧 | 계약 enum `PROPOSED·COMMITTED·NO_SOLUTION·STALE·RECOVERY_REQUIRED`. WK-09 의 `INVALID`·`UNDETERMINED` 누락 |
| Solver 원상태 보존 | 🆕 | 계약에 `solverStatus`(OPTIMAL/FEASIBLE/INFEASIBLE/MODEL_INVALID/UNKNOWN)·종료 이유 필드 없음 |
| 미배정 작업·사유 | 🆕 | 계약에 `unassignedTasks` 없음 |
| policyVersion·snapshotId | 🔧 | `inputSnapshotVersion` 만 있음 |
| 배정 조회 `GET /assignments` | 🔧 | 계약 있음, 501 |
| 수동 배정 (WK-10 대안) | 🆕 | 경로 없음 (R-06) |
| 작업자 근무·휴게·자격·장비 (명세 6.2) | 🆕 📥 | `mfc-capacity` 가 소유로 설계됐으나 API·테이블 없음 |
| 작업 예상 소요시간 (명세 6.1) | ⛔ 📥 | 산출 기준 미정(명세 14장 신규). 계약에 PACK `durationSec`(실적)만 있음 |
| 작업 마감·준비 시각 | ✅ 일부 | 6a 에서 Task `readyAt`·`holdReason`, 주문 `arrivalWindow` |
| 작업 선행 관계 | ✅ 일부 | PICK(READY) → PACK(WAITING) |
| 위치 잠금 | ✅ 일부 | `mfc-location` 상태 COUNT_LOCKED 등 (`mfc-v2`) |
| 재고·LOT 실행 가능성 (명세 6.4) | ✅ 일부 | `mfc-inventory` LOT 예약 조각·FEFO (`mfc-v2`). 계획 검증용 공개 조회는 R-05 |
| 목적함수·가중치·시간제한 | ⛔ Q-08 | 임의 값 금지. 정책 미등록 시 `CONFIG_REQUIRED` 로 계산 거절 |
| 자동 발행 | ⛔ Q-08 | 권한자 검토 발행만 |
| 재배정·교대 | ⛔ Q-09 | 적격 단일 작업 배정과 보류 경로만 가능 |
| AssignmentPublished 이벤트 | ✅ 계약 | 발행 구현은 신규 |

### 3.2 Chronos-2 수요예측

| 명세 항목 | 분류 | 현재 상태 / 필요한 것 |
|---|---|---|
| 예측 실행·조회 API (명세 11장) | ✅ 계약 | `POST /forecast-runs`, `GET /forecast-runs/{id}`(RUNNING/PUBLISHED/FAILED), `GET /forecasts` — 명세 제안과 거의 일치. **서비스 미생성** |
| 예측 출력 p10/p50/p90·modelId·modelVersion (명세 4.3) | 🔧 | `ForecastVersionPublished` 버킷은 `forecastQty` 하나 + `basis`·`confidence`. 분위수·모델 필드는 **추가(하위 호환)** 필요 |
| 실행 런타임 (명세 3.2) | ⛔ 결정 | Python/PyTorch vs `tech-stack.md:49`. 아래 5장 D-1 |
| 입력 판매 이력 (명세 4.1) | 📥 | 설계상 구독 `OrderConfirmed`·`OrderLineQuantityChanged`·`PackageHandedOver`·`ProductSaleStateChanged`. 집계 저장소 없음. 실제 이력 양은 미확인 |
| 판매 0 vs 데이터 없음, 품절 구간 (명세 4.2) | 🆕 | 계약에 "품절 구간 플래그" 있음. 품절 사실 원천(mfc-inventory 가용 0 구간) 연결 필요 |
| 기본 통계 예측으로 임의 전환 금지 (명세 4.4) | ⚠ 충돌 | 백엔드 설계는 "1차는 수동 수요 + 이동평균". 명세는 Chronos-2 실패 시 통계 대체 금지 → D-3 |
| 예측 주기·기간 | ⛔ 신규 결정 | 설정값으로만 둠 |
| IV-04 연계 (명세 5장) | ⛔ Q-07 + 결정 D-2 | 예측→min/target 산식 미정. 그 전까지 IV-04 `CONFIG_REQUIRED` 유지 |
| REPLENISH 작업 생성 | ⛔ R-10 | MOV 확정·작업 API 없음 |

## 4. 단계별 계획

각 단계는 "누가 하는지"를 적는다. **백엔드** = 백엔드 작업(이 저장소에서 하지 않음), **시뮬** = 이 저장소.

### 단계 0 — 결정·계약 (백엔드, 선행)
- 5장 결정 D-1~D-5 받기.
- 계약 변경안 작성(하위 호환 추가 위주):
  - `mfc-capacity`: AssignmentPlan 에 `solverStatus`·`terminationReason`·`unassignedTasks[{taskId, reason}]`·`policyVersion`·`snapshotId`, 상태 `INVALID`·`UNDETERMINED` 추가. `POST /assignment-plans/{id}/commits`(검토 발행)·`/recalculations` 추가. `mode: PROPOSE_AND_COMMIT` 은 Q-08 전까지 거절(`CONFIG_REQUIRED`)로 명시. 작업자·근무·자격 조회/등록 API. 수동 배정 `POST /assignments`.
  - `demand-planning`: 결과에 분위수·`modelId`·`modelVersion`·데이터 기준 시각·실패 원인, 이벤트 `ForecastVersionPublished` 에 같은 필드 추가.
- 완료 기준: 계약 PR 승인, `contracts` 검증 통과.

### 단계 1 — OR-Tools 배정 후보 계산 WK-09 (백엔드, `mfc-capacity`)
1. 의존성 추가 + 기동 시험에서 `Loader.loadNativeLibraries()` 성공 확인(Jib 이미지·bootJar 둘 다).
2. 입력 스냅샷 수집기: fulfillment 작업(READY·선행 충족), 작업자 상태, 위치 잠금, 재고 실행 가능성 → `snapshotId`·버전 저장.
3. CP-SAT 모델(명세 7장): `x[j,w]`·`s[j]`·`e[j]`·`u[j]`, 시간 단위 초(정수). 강제 제약 12개는 벌점 없이 제약으로만.
4. 정책 레코드(목적 우선순위·가중치·시간제한)는 **DB 설정**으로 받고, 없으면 `CONFIG_REQUIRED`. 시험용 정책은 시험 코드 안에만 둔다.
5. 결과 저장(Flyway 신규 테이블 — 명세 10장 optimization_* 의 논리 구성): solver 원상태, PROPOSED/NO_SOLUTION/INVALID/UNDETERMINED, 미배정 사유. **작업 담당·재고 변경 없음.**
- 시험: 명세 13장 OR-Tools 항목 중 계산 관련(자격 불일치, 시간 중복, 근무·휴게, 선행, 실행 중·완료 보호, 미배정 유지, 시간초과 시 FEASIBLE≠OPTIMAL, INFEASIBLE≠UNKNOWN, 계산만으로 담당 불변).

### 단계 2 — 계획 발행 WK-10 (백엔드, `mfc-capacity` + `mfc-fulfillment` + `mfc-inventory`)
1. 발행 직전 재검증: 작업 버전·잔량, 작업자 자격·근무, 위치 잠금, 재고·예약, 정책 버전, 발행 권한.
2. 통과 → COMMITTED, 작업 ASSIGNED(`assignmentVersion` 증가), `AssignmentPublished`. 버전 변동 → STALE. 서비스 간 일부 성공 → RECOVERY_REQUIRED(실행 차단, 결과 조회 후 신규 점유만 보상).
3. 응답 유실 시 같은 `Idempotency-Key` 재전송으로 결과 재생(IF-02).
4. PDA `GET /tasks?assignee=me` 는 COMMITTED 계획의 ASSIGNED 작업만 노출(6b 와 함께).
- 시험: STALE, 동시 발행 자원 중복 방지, 중복 발행 방지, PDA 노출.
- 의존: 6b(R-01), 인증(R-02).

### 단계 3 — Chronos-2 예측 (백엔드, `demand-planning`) — D-1 결정 후
1. 서비스 생성(계약 기존). 판매 이력 집계: 센터×SKU 별 시계열, 판매 0 과 데이터 없음 구분, 품절 구간 표시.
2. D-1 에 따른 런타임으로 Chronos-2 실행. 모델 1회 로딩·재사용, 입력 지문·모델 버전 기록(재현성).
3. `forecast_run`·`forecast_result` 저장, 실패 시 마지막 정상 결과와 구분, 데이터 부족 SKU 는 예측 불가 사유.
4. `ForecastVersionPublished` 발행.
- 시험: 명세 13장 Chronos-2 항목 전부. 재고 변경 없음 확인.

### 단계 4 — IV-04 연계·REPLENISH (백엔드) — Q-07·D-2·R-10 결정 후
- 예측 → min/target 변환 정책 등록 전까지 `CONFIG_REQUIRED` 유지(지금 할 수 있는 것은 예측 조회 경로까지).
- 정책 확정 후: IV-04 계산 → 재고 정본에서 MOV·물량·공간 확정 → WK-01 REPLENISH 작업 → 단계 1 배정 후보에 합류. OR-Tools 는 REPLENISH 를 만들지 않는다.

### 단계 5 — 통합 검증 (백엔드 + 시뮬)
- 배정 계산·검토 발행·STALE·RECOVERY_REQUIRED 판정은 백엔드가 한다(OR-Tools 는 백엔드 역할).
- 시뮬레이터는 현장 단말로서 백엔드가 발행한 ASSIGNED 작업을 실행하고(PDA 실행 → 재고 확정), 현장 쪽 장애(작업자 이탈, 응답 유실)를 만들어 백엔드 처리를 관찰한다.
- 기존 회귀: WK-01~05, WK-09~10, IV-03~04, IV-13, IF-02~05, TC 시나리오(백엔드 시험).

## 5. 결정 필요 (사용자·백엔드)

| ID | 결정 | 선택지 | 막는 단계 |
|---|---|---|---|
| D-1 | Chronos-2 런타임 | (가) Python 추론 서비스 별도 — tech-stack 예외 승인 / (나) Python 오프라인 배치가 `demand-planning` 에 적재 / (다) Java 에서 ONNX 추론 | 3 |
| D-2 | 예측 소비처 | SCM `replenishment` 만 / MFC IV-04 도 `ForecastVersionPublished` 구독 | 4 |
| D-3 | 1차 이동평균과 Chronos-2 관계 | 이동평균을 버림 / 별도 모델 ID 로 공존(실패 시 자동 대체는 금지, 명세 4.4) | 3 |
| D-4 | 배정 계획 경로 | 기존 `POST /assignment-plans` 확장(권장) / 명세 제안 `/internal/optimization/...` 신설 | 0 |
| D-5 | 운영 이미지 | `mfc-capacity`·`demand-planning` 은 JVM 이미지 유지 / GraalVM Native 에서 JNI 검증 | 1 출시 |
| D-6 | `PPC_기본규모_최종통합설계_.md` | 파일 제공 / MFC 1장으로 대체 | 0 |
| Q-07·08·09·14 + 명세 14장 신규 4건 | 정책값 | — (임의 결정 금지) | 2·4 자동화 |

## 6. 시뮬레이터 쪽 범위 (이 저장소)

> **2026-11-07 사용자 정정: OR-Tools 작업(배정 계산·계획 상태·발행)은 백엔드 역할이다. 시뮬레이터는 하지 않는다.**
> 그래서 처음 적었던 S-1(MOCK 으로 배정 계획 흐름 흉내)·S-2(계획·solver 상태 화면)·S-4(배정 정책 비교 지표)는 뺐다.

시뮬레이터는 OR-Tools·Chronos-2 를 넣지 않고, 배정 계획을 계산·흉내·발행하지 않는다. 현장 단말(점원 PDA·라이더)로서 **백엔드가 확정한 배정 결과(ASSIGNED 작업)를 받아 수행**만 한다.

| ID | 작업 | 시점 | 비고 |
|---|---|---|---|
| S-1 | 실서버 모드에서 배정된 작업만 수행: `GET /tasks?assignee=me`(계약)로 받은 ASSIGNED 작업을 가상 작업자가 실행 | 백엔드 단계 2·6b 배포 후 | R-01·R-02 선행. 계약에 없는 배정 API 는 부르지 않음 |
| S-2 | 현장 쪽 장애 연출: 작업자 이탈, 응답 유실(같은 Idempotency-Key 재전송) — 백엔드 재배정·STALE 처리를 현장에서 관찰 | S-1 뒤 | 판정은 백엔드가 함 |
| S-3 | 가상 판매 이력 내보내기(예측 시험 입력). `source=SIMULATED` 표시 필수 | 백엔드 단계 3 시험 때, 사용자 확인 후 | R-03, 실데이터와 섞지 않음 |

MOCK 모드의 지금 배정(대기 작업자 FIFO, `backend-requests.md` "시뮬레이터가 정한 값")은 화면을 돌리기 위한 임시 규칙이며 OR-Tools 를 흉내 내는 것이 아니다. 그대로 둔다.

## 7. 지키는 원칙 (명세 16장 + 저장소 규칙)

- 백엔드 코드는 이 저장소 작업에서 고치지 않는다. 필요한 변경은 `backend-requests.md` 에 적는다.
- 미결 정책(Q-07·08·09·14, 명세 14장)은 코드에 운영값으로 넣지 않는다 — 설정 없으면 `CONFIG_REQUIRED`/대기.
- OR-Tools 결과로 바로 담당을 확정하지 않는다(WK-10 경유). 예측 결과로 재고를 바꾸지 않는다.
- 재고 수량 규칙(IV-07/08/09)과 기존 예약을 건드리지 않는다.
- 실패한 계획을 성공으로, UNKNOWN 을 INFEASIBLE 로, FEASIBLE 을 OPTIMAL 로 표시하지 않는다.
- 실행하지 않은 시험을 통과로 보고하지 않는다.

## 8. 명세 15장 6단계 산출물 대응

| 산출물 | 이 계획서에서 | 실제 작성 시점 |
|---|---|---|
| 변경 파일 목록·DB 변경·API 명세·테스트 결과 | — | 각 단계 구현 후 |
| 전체 아키텍처·데이터 흐름·배정 흐름 | 2장·4장 | 단계 0 계약 확정 후 그림으로 보강 |
| 미확정 정책·차단 항목 | 3장 ⛔·5장 | 결정마다 갱신 |
| 실제 구현 범위·미구현 범위 | 3장 | 단계마다 갱신 |
