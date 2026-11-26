// 헤드리스 Chrome(CDP)으로 시뮬레이터 화면을 찍는다 — 사용자가 "캡처해서 보내봐" 할 때(2026-11-25~26 세션이 쓰던 방식).
// 개발 서버(:5180)가 켜져 있어야 한다. 브라우저 확장(Claude in Chrome)은 쓰지 않는다.
//
//   node tools/shot/cdp-shot.mjs <출력폴더> <mock|http> [오른쪽 탭 글자] [화면에서 돌릴 JS 파일]
//   예) node tools/shot/cdp-shot.mjs ./_shots http "입고 추적"
//
// - mode http = 실서버 화면(읽기만 — 화면을 여는 것만으로는 서버에 쓰지 않는다. 버튼·쓰기 함수를 부르는 JS 는 사용자 허락 뒤에만).
// - JS 파일은 페이지 안에서 `(async () => { … })()` 로 돌고, 돌려준 값을 찍는다. window.sim·window.view 를 쓸 수 있다.
// - 찍은 그림: <출력폴더>/shot-1.png(탭 연 뒤), shot-2.png(JS 뒤).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [out = './_shots', mode = 'mock', tab = '', jsFile = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const port = 9351;
const prof = mkdtempSync(join(tmpdir(), 'simshot-'));
const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--window-size=1680,1000', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let tabs;
  for (let i = 0; i < 40; i++) {
    try {
      tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  });
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (e) => {
    const r = await cmd('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    return r.result?.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600) : r.result?.result?.value;
  };
  const shot = async (n) => {
    const r = await cmd('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, n), Buffer.from(r.result.data, 'base64'));
    console.log('saved', join(out, n));
  };
  await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: 'http://localhost:5180/' });
  await sleep(3000);
  await evalJs(`localStorage.setItem('pmart-sim-settings', JSON.stringify({ mode: '${mode}', http: { baseUrl: '/api/v1' }, mfcId: 'MFC-BJG-01' })); 1`);
  await cmd('Page.navigate', { url: 'http://localhost:5180/' });
  await sleep(mode === 'http' ? 15000 : 12000);
  if (tab) console.log('tab', await evalJs(`(() => { const b = [...document.querySelectorAll('.rail button')].find((x) => x.textContent.includes(${JSON.stringify(tab)})); if (!b) return 'no tab'; b.click(); return 'ok'; })()`));
  await sleep(4000);
  await shot('shot-1.png');
  if (jsFile) {
    console.log('js', await evalJs(`(async () => { ${readFileSync(jsFile, 'utf8')} })()`));
    await sleep(3000);
    await shot('shot-2.png');
  }
} finally {
  ws?.close();
  chrome.kill();
}
