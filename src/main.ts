import './ui/styles.css';
import { DEFAULT_PARAMS } from './config';
import { View3D } from './render/view3d';
import { Simulation } from './sim/simulation';
import { Panel, type PersistedSettings } from './ui/panel';

const KEY = 'pmart-sim-settings';

function load(): PersistedSettings {
  const fallback: PersistedSettings = { mode: 'mock', http: { baseUrl: '/api/v1', token: '', workerIds: [] } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<PersistedSettings>;
    return { mode: s.mode === 'http' ? 'http' : 'mock', http: { ...fallback.http, ...s.http, token: '' } };
  } catch {
    return fallback;
  }
}

function save(s: PersistedSettings) {
  try {
    // 토큰은 저장하지 않는다 — 비밀값은 브라우저 세션 동안만 둔다
    localStorage.setItem(KEY, JSON.stringify({ ...s, http: { ...s.http, token: '' } }));
    sessionStorage.setItem(`${KEY}-token`, s.http.token);
  } catch {
    /* 저장소를 못 쓰면 기본값으로 다시 시작한다 */
  }
}

const settings = load();
try {
  settings.http.token = sessionStorage.getItem(`${KEY}-token`) ?? '';
} catch {
  /* noop */
}

const sim = new Simulation({ ...DEFAULT_PARAMS }, settings.mode, settings.http);
const view = new View3D(document.getElementById('viewport')!, sim);
const panel = new Panel(document.getElementById('ui')!, sim, view, settings, (next) => {
  save(next);
  location.reload();
});

let last = performance.now();
let lastUi = 0;
let advancing = false;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!advancing) {
    advancing = true;
    sim
      .advance(dt)
      .catch((e) => console.error(e))
      .finally(() => (advancing = false));
  }
  view.render(dt);
  if (now - lastUi > 250) {
    lastUi = now;
    panel.refresh();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 개발 중 콘솔에서 상태를 볼 수 있게
Object.assign(window as unknown as Record<string, unknown>, { sim, panel, view });
