# 다른 PC 에서 시뮬레이터 화면 보기 (LAN)

> 기준: 2026-11-16, 커밋 `d0dd0b2`(개발 서버 LAN 공개). 같은 공유기(192.168.0.x)에 붙은 PC 에서만 볼 수 있다. 인터넷(밖)에서는 열리지 않는다.

## 주소

**http://192.168.0.32:5180**

- `192.168.0.32` 는 개발 서버를 띄운 PC 의 LAN 주소다(2026-11-16 이더넷). 공유기가 다른 주소를 주면 바뀐다 → 그 PC 에서 `ipconfig` 의 IPv4 주소를 다시 본다.
- `localhost:5180` 은 개발 서버를 띄운 PC 에서만 열린다(`localhost` = 그 기기 자신).

## 어떻게 열려 있나

| 항목 | 내용 |
|---|---|
| 개발 서버 | `vite.config.ts` 의 `server.host: true` — 모든 주소(`0.0.0.0:5180`)에서 받는다 |
| 프로그램 | `C:\Program Files\nodejs\node.exe` |
| 네트워크 | 이더넷이 Windows 에서 "공용(Public)" 네트워크로 잡혀 있음 |
| 방화벽 | 공용 네트워크에서 `node.exe` 로 들어오는 TCP 연결을 허용하는 규칙 있음. 막는 규칙은 `python.exe` 것뿐(node 와 무관) |

## 다른 PC 에서 되는 것·안 되는 것

| 된다 | 안 된다 |
|---|---|
| 3D 화면, MOCK 모드 | 가상 작업자 켜기(왼쪽 패널에 안내만 나옴) |
| 실서버 모드 조회 — 실제 주문·재고·배차 상태 | 실서버에 쓰기 — 쓰기 요청은 403 `LAN_READ_ONLY` |

- 다른 PC 의 브라우저는 토큰을 받지 않는다. 토큰 발급 경로 `/sim-auth/tokens` 는 개발 서버 PC 전용(`LOOPBACK_ONLY`)이다.
- 대신 개발 서버가 다른 PC 의 `/api` 조회(GET·HEAD)에 관찰 계정(`claude-mfc-wrk`) 토큰을 붙여 넘긴다(`server/simAuth.ts`). 그 밖의 요청은 막는다.
- 개발 서버 PC 의 브라우저는 전과 같이 자기 토큰을 쓴다. 가상 작업자도 이 PC 에서만 켤 수 있다.

## 조건

- 개발 서버 PC 에서 `npm run dev` 가 돌고 있어야 한다. 꺼지거나 PC 가 잠들면 다른 PC 에서도 안 열린다.
- 개발 서버 PC 에 LAN 비밀 파일(`../pmart-backend/deploy/lan/.secrets`)이 있어야 실서버 모드가 된다(없으면 MOCK 만).

## 열리지 않을 때

1. 다른 PC 가 같은 망(192.168.0.x)인지 본다. 게스트 와이파이는 기기끼리 막혀 있을 수 있다.
2. 다른 PC 의 PowerShell 에서 연결을 점검한다 — `TcpTestSucceeded : True` 여야 한다.
   ```powershell
   Test-NetConnection 192.168.0.32 -Port 5180
   ```
3. False 면 개발 서버 PC 쪽을 본다.
   - 개발 서버가 떠 있나: `netstat -ano | findstr :5180` 에 `0.0.0.0:5180 … LISTENING`
   - 백신의 자체 방화벽이 막고 있나(Windows 방화벽 밖이라 위 점검으로는 안 보인다)
   - 네트워크 종류가 바뀌어 허용 규칙과 안 맞나: `Get-NetConnectionProfile`(지금 규칙은 공용 네트워크용)

## 확인 상태

- 확인함(2026-11-16): 위 서버·방화벽 설정. 개발 서버 PC 에서 LAN 주소로 부른 결과 — 화면 200, 조회 200, 쓰기 403 `LAN_READ_ONLY`, 토큰 발급 403 `LOOPBACK_ONLY`.
- **미확인: 실제 다른 PC 에서 연 것.** 개발 서버 PC 안에서 LAN 주소로 부르면 방화벽을 거치지 않아 증명이 되지 않는다.
