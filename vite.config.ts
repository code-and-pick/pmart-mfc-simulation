import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 실서버 모드(HTTP 어댑터)는 브라우저에서 게이트웨이를 직접 부르면 CORS 에 막힐 수 있어
// 개발 서버가 /api 를 게이트웨이로 넘긴다. 주소는 PMART_GATEWAY 로 바꾼다(기본: LAN 게이트웨이).
const gateway = process.env.PMART_GATEWAY ?? 'http://D603-16:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
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
