// Vite 개발 서버 전용: 백엔드가 만든 인쇄용 바코드 라벨(deploy/lan/seed/labels — 카트·위치, Code128)을 /labels/ 로 보여 준다.
// 읽기만 한다(백엔드 저장소는 읽기 전용). 폴더 밖 경로·HTML/CSS/SVG/PNG 밖 파일은 내주지 않는다. 비밀 정보가 없어 다른 기기에도 보인다.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const LABELS_DIR = process.env.PMART_LABELS_DIR ?? resolve(process.cwd(), '../pmart-backend/deploy/lan/seed/labels');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export function labelsPlugin(): Plugin {
  return {
    name: 'pmart-labels',
    configureServer(server) {
      server.middlewares.use('/labels', (req, res) => {
        let rel: string;
        try {
          rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        } catch {
          res.statusCode = 400;
          return res.end();
        }
        if (rel === '/' || rel === '') rel = '/index.html';
        const file = resolve(LABELS_DIR, `.${rel}`);
        const type = TYPES[extname(file).toLowerCase()];
        const inside = file === LABELS_DIR || file.startsWith(LABELS_DIR + sep);
        if (!inside || !type || req.method !== 'GET' || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.end(`라벨 없음: ${rel} (PMART_LABELS_DIR=${LABELS_DIR})`);
        }
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(file));
      });
    },
  };
}
