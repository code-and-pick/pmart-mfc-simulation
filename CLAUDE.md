# CLAUDE.md — PMart MFC 가상 현장 (simulation)

PMart MFC의 피킹·패킹·인계를 3D로 돌리는 **가상 현장**이다. 백엔드(`../pmart-backend`)에 대해 현장 단말(점원 PDA·라이더 앱)처럼 계약 API를 부른다.
스택: Vite 6 + TypeScript 5 + React 19 + react-three-fiber 9 (Three.js 0.169) + Vitest. 화면 UI 는 React 컴포넌트(`src/ui`), 3D 장면은 react-three-fiber 컴포넌트(`src/render/scene`)로 만든다(2026-11-07 사용자 결정, 이전엔 바닐라 TS).
- 시뮬레이션 엔진(`src/sim`)·백엔드 어댑터(`src/backend`)·도메인(`src/domain`)은 React 에 의존하지 않는다(테스트가 화면 없이 돈다).
- 매 프레임 바뀌는 값(위치·수량)은 `useFrame` 안에서 three 객체를 직접 바꾸고, React 상태로 올리지 않는다. 패널은 `Ticker`(약 4Hz)·`ViewController` 변경 때만 다시 그린다.

## 절대 규칙
- `../pmart-backend`, `../pmart-clients` 는 **읽기만** 한다. 백엔드에 필요한 변경은 `docs/backend-requests.md` 에 적고 사용자에게 보고한다.
- 계약이 정본이다. `src/domain/contract.ts` 의 이름·상태값은 `pmart-backend/contracts/openapi/mfc-fulfillment-service.yaml` 을 그대로 따른다. 계약에 없는 엔드포인트를 HttpBackend 에서 추측해 부르지 않는다.
- MockBackend 는 계약 의미를 흉내 낼 뿐 실서버 동작을 대신하지 않는다. 흉내 내면서 정한 값(fence 유효시간 등)은 `docs/backend-requests.md` "시뮬레이터가 정한 값"에 적는다.
- 서버가 확정한 결과만 확정으로 그린다. 응답이 없으면 결과 불명으로 보고 같은 Idempotency-Key 로 재전송한다. 실패로 단정하지 않는다.
- 재고 수량 규칙(MFC IV-07/08/09)을 바꾸지 않는다. 피킹·패킹은 H/E/R 불변, 인계는 H·E·R −q, 결품은 H 불변·E·R −q.
- 업무 문서에 없는 수치는 `src/config.ts` 에 근거 태그(`[확정]`/`[가정]`/`[시뮬]`)와 함께 둔다. 다른 파일에 흩어 놓지 않는다.
- 토큰은 localStorage 에 저장하지 않는다(sessionStorage 만).
- 실행하지 않은 테스트·빌드를 통과했다고 보고하지 않는다.
- 무거운 시험(vitest·build 등) 전에 PC 의 남은 실메모리를 본다. 4GB 아래면 미루고 사용자에게 알린다. 다른 세션이 띄운 프로세스(flutter_tester 등)는 끄지 않고 알린다(2026-11-23 사용자 지시: flutter_tester 가 16~24GB 를 잡아 PC1 실메모리 0.1GB).
- 작업 일지를 `docs/worklog/YYYY-MM-DD.md` 에 남긴다(형식·규칙 `docs/worklog/README.md`, 백엔드 일지 형식을 따름). 일지 없이 커밋하지 않고, 백엔드에서 읽어 확인한 사실은 근거와 함께 적는다.

## 명령
```bash
npm run dev        # http://localhost:5180 (실서버 모드는 PMART_GATEWAY 로 프록시)
npm test
npm run typecheck
npm run build
```

## 참고 문서 (백엔드, 읽기 전용)
- MFC 업무: `../pmart-backend/docs/business/MFC-business-logic.md` (1장 시설, 2장 작업, 3장 재고)
- 주문→이행 사가: `../pmart-backend/docs/business/flows/order-checkout-saga.md`
- 취소·인계 경합: `../pmart-backend/docs/business/flows/cancel-vs-handover.md`
- 구현 상태: `../pmart-backend/services/mfc-*/CLAUDE.md`, `../pmart-backend/docs/worklog/`
