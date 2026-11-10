# 작업 노트 — OR-Tools 배정 · Chronos-2 예측 연결 (시뮬레이터 작업용)

> Claude 가 시뮬레이터 작업 중 참고하려고 정리한 문서다. 업무 정본이 아니다.
> 기준 시점: 2026-11-07. 백엔드 내용은 `../pmart-backend` 를 **읽기만** 해서 옮겼다(백엔드 코드·문서는 고치지 않는다).

## 0. 원본 문서 (수정하지 않음)

사용자가 넣은 아래 두 문서는 원본으로 두고 이 노트에서 인용·정리만 한다.

| 파일 | 내용 | 비고 |
|---|---|---|
| `MFC 시스템 구성안 — Chronos-2 + Google OR-Tools.md` | Chronos-2 + OR-Tools 전체 구성안 | 2026-11-07 사용자 요청으로 98행 인용 표식만 정리(커밋 d488281). 그 뒤로 손대지 않음 |
| `OR-Tools_개념과_바로픽_작업자배정_적용.md` | OR-Tools 개념, 바로픽 배정 적용, 방식 A/B 비교 | 원본 그대로 |

## 1. 사용자 결정 (2026-11-07)

- **OR-Tools: 방식 A** — Spring Boot 서비스 안에 Java 바인딩으로 넣는다. 별도 Python 최적화 서비스는 두지 않는다.
- **Chronos-2: 실제 프로젝트에서 결국 연결한다.** 연결 위치·런타임은 아래 3장 미결.
- 시뮬레이터 작업자(Claude)는 백엔드 코드를 건드리지 않는다. 백엔드에 필요한 것은 `backend-requests.md` 에 적는다.

## 2. 백엔드 현황 (읽어서 확인한 사실)

| 항목 | 내용 | 근거 |
|---|---|---|
| OR-Tools 기술 결정 | Java 바인딩, `transport-routing-service`·`mfc-capacity-service` 에만. 별도 Python 런타임 없음 | `docs/architecture/tech-stack.md:49` |
| OR-Tools 버전 | `ortools = "9.15.6755"`, `com.google.ortools:ortools-java` (카탈로그 등록만) | `gradle/libs.versions.toml:15,91` |
| OR-Tools 실제 사용 | 없음. `mfc-capacity-service/build.gradle.kts` 에 의존성 없음, 솔버 코드 없음 | 직접 확인 |
| 배정 계약 | `POST /assignment-plans` (PROPOSED→COMMITTED, `AssignmentPublished`) 정의됨, 컨트롤러는 501 | `contracts/openapi/mfc-capacity-service.yaml`, `mfc-capacity-service/CLAUDE.md` |
| 이미지 | Jib, `eclipse-temurin:21-jdk`(Ubuntu) linux/amd64. 운영은 GraalVM Native 예정 | `build-logic/.../pmart.container-image.gradle.kts` |
| 예측 담당 서비스 | **`demand-planning-service` (SCM, 2단계, 아직 없음)**. 예측 버전·버킷·신뢰도·품절 구간, 1차는 수동 수요 + 이동평균 | `docs/architecture/service-map.md` §3 |
| 예측 전달 경로 | `ForecastVersionPublished`(forecastVersionId, mfcId, sku, buckets[], basis, confidence) → `replenishment-service` | `docs/architecture/events.md:74` |
| Python 모델 | "Python 전용 모델은 3단계에 별도 승인 후 검토" | `tech-stack.md:49` |

## 3. 원본 문서와 백엔드 설계의 차이 (정리만, 결정은 사용자·백엔드)

| 주제 | 원본 구성안 | 백엔드 설계 | 메모 |
|---|---|---|---|
| OR-Tools 실행 위치 | Java 또는 Python | Java 바인딩만 | 사용자 결정(방식 A)과 백엔드가 일치 |
| 배정 서비스 | "MFC 업무 서버" / "WMS" 하나 | `mfc-capacity-service`(배정·계획 발행), 작업은 `mfc-fulfillment-service`, 재고는 `mfc-inventory-service` | 구현 문서로 쓸 때 이름을 맞춘다 |
| 예측 결과 소비처 | Chronos-2 → MFC IV-04(선반 보충)에 직접 | `demand-planning` → `ForecastVersionPublished` → `replenishment-service`(SCM 보충량) | MFC IV-04 가 예측을 직접 읽는 경로는 백엔드 설계에 없음 |
| Chronos-2 런타임 | Python + PyTorch 서비스 | Python 런타임 없음, 3단계 별도 승인 | **충돌. 백엔드 결정 필요 → `backend-requests.md` R-12** |

Chronos-2 를 붙이는 자연스러운 자리는 `demand-planning-service` 의 "예측 모델" 부분이다(초기 이동평균을 대체·보완). 이벤트 계약(`ForecastVersionPublished`)은 그대로 두고 모델만 바꾸는 형태가 백엔드 경계를 가장 덜 흔든다. 런타임 선택지(백엔드 결정 사항):
- (가) Python 추론 서비스를 따로 두고 `demand-planning` 이 호출 — tech-stack 예외 승인 필요
- (나) 배치(오프라인)로 Python 에서 예측해 `demand-planning` 에 적재 — 운영 서비스는 Java 유지
- (다) Java 에서 ONNX 등으로 추론 — Chronos-2 변환·검증 부담

## 4. 시뮬레이터와의 관계

시뮬레이터는 현장 단말처럼 **계약 API 만** 부른다. OR-Tools·Chronos-2 를 시뮬레이터 안에 넣지 않는다.

| 시점 | 시뮬레이터가 하는 일 |
|---|---|
| 지금 | MOCK 배정 = 대기 작업자 FIFO, PACK 은 같은 작업자 (`backend-requests.md` "시뮬레이터가 정한 값") |
| `mfc-capacity` 배정 구현 후 | 실서버 모드에서 배정 결과(`AssignmentPublished`/작업 목록의 assignee)를 받아 가상 작업자를 움직인다. 계약에 없는 호출은 하지 않는다 (R-04, R-06) |
| 예측 연결 후 | 예측은 SCM 보충량에 영향 → 시뮬레이터에는 입고 차량 품목·수량으로 나타난다(현재 `config.ts` 입고 규칙은 `[시뮬]` 값) |

**OR-Tools 작업(배정 계산·계획·발행)은 백엔드 역할이다. 시뮬레이터는 하지 않는다**(2026-11-07 사용자 정정). 시뮬레이터는 백엔드가 확정한 배정을 받아 수행만 한다.

시뮬레이터가 보탤 수 있는 것(제안, 미결정):
- 가상 판매 이력 내보내기(예측 모델 시험용 입력). 실데이터가 아니라는 표시 필수(R-03 `source=SIMULATED`)

## 5. 미결 (백엔드 문서 기준)

- Q-07 최소·목표 재고·보충 주기, Q-08 OR-Tools 목적함수·제한시간·자동 발행, Q-09 동시 작업·재배정·휴게, Q-14 서비스 간 통신 — `MFC-business-logic.md`
- Chronos-2 런타임·예측 주기·기간·재학습 (R-12)
- 운영 GraalVM Native 이미지에서 OR-Tools(JNI) 사용 가능 여부 — `mfc-capacity-service` 는 JVM 이미지로 남길지 결정 필요 (R-12 에 함께 적음)
