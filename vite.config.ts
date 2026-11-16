import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { simAuthPlugin } from './server/simAuth';

// 실서버 모드(HTTP 어댑터)는 브라우저에서 게이트웨이를 직접 부르면 CORS 에 막힐 수 있어
// 개발 서버가 /api 를 게이트웨이로 넘긴다. 주소는 PMART_GATEWAY 로 바꾼다(기본: LAN 게이트웨이).
const gateway = process.env.PMART_GATEWAY ?? 'http://D603-16:8080';

export default defineConfig({
  // simAuthPlugin: 개발 서버가 LAN 시험 계정으로 로그인해 토큰만 브라우저에 준다(SIM-11). 비밀번호 파일은 PMART_SECRETS_DIR
  plugins: [react(), simAuthPlugin()],
  server: {
    port: 5180,
    // LAN 의 다른 기기에서도 연다(http://<이 PC IP>:5180). 다른 기기는 토큰을 받지 못하고 조회만 된다(server/simAuth.ts).
    host: true,
    proxy: {
      '/api': { target: gateway, changeOrigin: true },
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
