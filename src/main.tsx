import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import type { AppCtx, PersistedSettings } from './app/context';
import { DEFAULT_PARAMS } from './config';
import { SceneRegistry, Ticker, ViewController } from './render/controller';
import { Simulation } from './sim/simulation';
import './ui/styles.css';
import './ui/console.css';

const KEY = 'pmart-sim-settings';

function load(): PersistedSettings {
  const fallback: PersistedSettings = { mode: 'mock', http: { baseUrl: '/api/v1' } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<PersistedSettings>;
    return { mode: s.mode === 'http' ? 'http' : 'mock', http: { baseUrl: s.http?.baseUrl || fallback.http.baseUrl } };
  } catch {
    return fallback;
  }
}

function save(s: PersistedSettings) {
  try {
    // 토큰은 어디에도 저장하지 않는다 — 실서버 모드는 개발 서버가 시험 계정 토큰을 그때그때 준다(SIM-11)
    localStorage.setItem(KEY, JSON.stringify({ mode: s.mode, http: { baseUrl: s.http.baseUrl } }));
  } catch {
    /* 저장소를 못 쓰면 기본값으로 다시 시작한다 */
  }
}

const settings = load();
try {
  sessionStorage.removeItem(`${KEY}-token`); // 예전 판이 넣던 직접 입력 토큰 지우기
} catch {
  /* noop */
}

// 시뮬레이션·화면 상태는 React 바깥에서 한 번만 만든다 (렌더가 다시 돌아도 새로 만들지 않게)
const sim = new Simulation({ ...DEFAULT_PARAMS }, settings.mode, settings.http);
const app: AppCtx = {
  sim,
  controller: new ViewController(sim),
  registry: new SceneRegistry(),
  ticker: new Ticker(),
  settings,
  restart: (next) => {
    save(next);
    location.reload();
  },
};

createRoot(document.getElementById('root')!).render(<App app={app} />);

// 개발 중 콘솔에서 상태를 볼 수 있게
Object.assign(window as unknown as Record<string, unknown>, { sim, view: app.controller });
