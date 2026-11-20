import react from '@vitejs/plugin-react';
import { Agent } from 'node:http';
import { defineConfig } from 'vitest/config';
import { simAuthPlugin } from './server/simAuth';
import { labelsPlugin } from './server/labels';
import { realOrderPlugin } from './server/realOrder';

// 실서버 모드(HTTP 어댑터)는 브라우저에서 게이트웨이를 직접 부르면 CORS 에 막힐 수 있어
// 개발 서버가 /api 를 게이트웨이로 넘긴다. 주소는 PMART_GATEWAY 로 바꾼다(기본: LAN 게이트웨이).
// 이름(D603-16)은 로컬망 이름 알림(mDNS·LLMNR)으로만 풀려 가끔 ENOTFOUND — 주문 넣기 "응답 없음" 원인(2026-11-20). 같은 PC 의 IP 로(인증 서버와 같은 192.168.0.40)
const gateway = process.env.PMART_GATEWAY ?? 'http://192.168.0.40:8080';

export default defineConfig({
  // simAuthPlugin: 개발 서버가 LAN 시험 계정으로 로그인해 토큰만 브라우저에 준다(SIM-11). 비밀번호 파일은 PMART_SECRETS_DIR
  // labelsPlugin: 백엔드 인쇄용 바코드 라벨(카트·위치)을 /labels/ 로 — 읽기만
  // realOrderPlugin: 실제 주문 넣기 /sim-order(R-21) — 고객 토큰은 개발 서버 안에서만, 이 PC 에서만
  plugins: [react(), simAuthPlugin(), labelsPlugin(), realOrderPlugin(gateway)],
  server: {
    port: 5180,
    // LAN 의 다른 기기에서도 연다(http://<이 PC IP>:5180). 다른 기기는 토큰을 받지 못하고 조회만 된다(server/simAuth.ts).
    host: true,
    proxy: {
      // IPv4 로만 붙는다 — D603-16 이 IPv6 링크 로컬(fe80::…)을 먼저 돌려주면 프록시가 거기에 붙으려다 멈춘다(2026-11-20, 게이트웨이는 정상인데 /api 만 시간 초과)
      '/api': { target: gateway, changeOrigin: true, agent: new Agent({ family: 4, keepAlive: true }) },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500, // three.js + react-three-fiber 한 덩어리
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
