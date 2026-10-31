import { HttpBackend } from '../backend/http/HttpBackend';
import { SPEEDS } from '../config';
import { CAMERA_PRESETS, STATE_COLOR, TEMP_COLOR, type View3D } from '../render/view3d';
import { fmtClock, fmtDur } from '../sim/metrics';
import type { HttpSettings, Simulation } from '../sim/simulation';
import type { WorkerState } from '../sim/worker';

const STATE_KO: Record<WorkerState, string> = {
  IDLE: '대기',
  TO_CART: '장바구니',
  PICKING: '피킹',
  WAIT_STATION: '패킹대 대기',
  PACKING: '패킹',
  TO_SHIP: '출하대기 이동',
  RETURNING: '복귀',
  ERROR: '오류',
};

type Tab = 'api' | 'events' | 'logs' | 'inventory';

export interface PersistedSettings {
  mode: 'mock' | 'http';
  http: HttpSettings;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Panel {
  private tab: Tab = 'api';
  private readonly root: HTMLElement;

  constructor(
    host: HTMLElement,
    private readonly sim: Simulation,
    private readonly view: View3D,
    private readonly settings: PersistedSettings,
    private readonly restart: (s: PersistedSettings) => void,
  ) {
    this.root = host;
    this.build();
    view.onSelect = (id) => this.select(id);
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  private build() {
    const p = this.sim.params;
    const http = this.settings.http;
    this.root.innerHTML = `
      <div class="topbar">
        <div class="brand">PMart MFC 가상 현장</div>
        <span class="badge ${this.sim.mode}">${this.sim.mode === 'mock' ? 'MOCK 백엔드' : '실서버'}</span>
        <span class="note">${esc(p.mfcId)}</span>
        <div class="clock" id="clock">--:--:--</div>
        <div class="seg" id="speeds">${SPEEDS.map((s) => `<button data-s="${s}">${s === 0 ? '❚❚' : `${s}×`}</button>`).join('')}</div>
        <div class="spacer"></div>
        <div class="seg" id="cams">${Object.keys(CAMERA_PRESETS).map((k) => `<button data-c="${k}">${k}</button>`).join('')}</div>
        <div class="seg" id="walls"><button data-w="0.32" class="on">벽</button><button data-w="0">벽 숨김</button></div>
      </div>

      <div class="panel left">
        <h3>운영 조건 (실행 중 변경)</h3>
        ${this.slider('orders', '시간당 주문', p.ordersPerHour, 5, 120, 1, '기준안 피크 약 40건/시간, 낙관안 88건 (MFC 7-1 가정)')}
        ${this.slider('workers', '작업자 (피킹·패킹 겸업)', p.workers, 1, 24, 1, '기준안 약 10명, 낙관안 약 22명 (MFC 7-2 가정)')}
        ${this.slider('stations', '가동 패킹대', p.packingStations, 1, 8, 1, '기본 4대 · 최대 8대 (MFC 11장)')}
        ${this.slider('shortage', '결품률 (%)', p.shortageRate * 100, 0, 10, 0.5, '피킹 시 선반 실물 부족 보고 확률 (시뮬 값)')}
        <div class="field">
          <label>피킹 순서</label>
          <select id="seq">
            <option value="DOC_B_A_C" ${p.pickSequence === 'DOC_B_A_C' ? 'selected' : ''}>B→A→C~H (원본 관찰, MFC 8-3)</option>
            <option value="AMBIENT_FIRST" ${p.pickSequence === 'AMBIENT_FIRST' ? 'selected' : ''}>상온 → 냉장 → 냉동</option>
          </select>
        </div>

        <h3>색 구분</h3>
        <div class="legend">
          ${(Object.keys(STATE_KO) as WorkerState[]).filter((s) => s !== 'RETURNING').map((s) => `<span><i class="dot" style="background:${hex(STATE_COLOR[s])}"></i>${STATE_KO[s]}</span>`).join('')}
          <span><i class="dot" style="background:${hex(TEMP_COLOR.AMBIENT)}"></i>상온 상품</span>
          <span><i class="dot" style="background:${hex(TEMP_COLOR.CHILLED)}"></i>냉장 상품</span>
          <span><i class="dot" style="background:${hex(TEMP_COLOR.FROZEN)}"></i>냉동 상품</span>
          <span><i class="dot" style="background:#26c6da"></i>라이더</span>
        </div>
        <p class="note">작업자를 클릭하면 PDA 화면과 이동 경로를 봅니다. 드래그 회전 · 우클릭 이동 · 휠 확대.</p>

        <h3>백엔드 연동</h3>
        <div class="field">
          <label>게이트웨이 경로</label>
          <input type="text" id="baseUrl" value="${esc(http.baseUrl)}" />
          <small>개발 서버가 /api 를 PMART_GATEWAY(기본 http://D603-16:8080)로 넘깁니다.</small>
        </div>
        <div class="field">
          <label>작업자 토큰 (Bearer)</label>
          <input type="password" id="token" value="${esc(http.token)}" placeholder="BR-02 결정 전에는 발급 경로 없음" />
        </div>
        <div class="field">
          <label>가상 작업자 ID (쉼표)</label>
          <input type="text" id="workerIds" value="${esc(http.workerIds.join(','))}" placeholder="mfc-capacity 에 등록된 작업자" />
        </div>
        <button class="btn ghost" id="probe">연결 점검</button>
        <div class="probe" id="probeOut">—</div>
        <button class="btn" id="toHttp">${this.sim.mode === 'http' ? '실서버 설정 다시 적용' : '실서버 모드로 재시작'}</button>
        ${this.sim.mode === 'http' ? '<button class="btn ghost" id="toMock">MOCK 모드로 돌아가기</button>' : ''}
        <p class="note">2026-10-31 기준 백엔드 이행(슬라이스 6: 작업 지시·피킹·패킹·인계)이 501 이라, 실서버 모드는 연결·인증·계약 점검까지만 됩니다. 필요한 백엔드 변경은 docs/backend-requests.md.</p>
      </div>

      <div class="panel right">
        <div class="kpis" id="kpis"></div>
        <div class="board" id="board"></div>
        <div class="tabs" id="tabs">
          <button data-t="api" class="on">API 호출</button>
          <button data-t="events">계약 이벤트</button>
          <button data-t="logs">현장</button>
          <button data-t="inventory">재고 H/E/R/A</button>
        </div>
        <div class="log" id="log"></div>
      </div>

      <div class="pda" id="pda"></div>
      <div class="toast" id="toast"></div>
    `;

    this.q('#speeds').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.sim.speed = Number(b.dataset.s);
      this.refreshSpeed();
    });
    this.refreshSpeed();
    this.q('#cams').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.c) this.view.setPreset(b.dataset.c);
    });
    this.q('#walls').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.view.setWallOpacity(Number(b.dataset.w));
      this.q('#walls').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    this.q('#tabs').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.tab = b.dataset.t as Tab;
      this.q('#tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.refreshLog(true);
    });

    this.bindSlider('orders', (v) => (this.sim.params.ordersPerHour = v));
    this.bindSlider('workers', (v) => this.sim.setWorkers(v));
    this.bindSlider('stations', (v) => this.sim.setStations(v));
    this.bindSlider('shortage', (v) => (this.sim.params.shortageRate = v / 100));
    this.q<HTMLSelectElement>('#seq').addEventListener('change', (e) => {
      this.sim.params.pickSequence = (e.target as HTMLSelectElement).value as 'DOC_B_A_C' | 'AMBIENT_FIRST';
    });

    const readHttp = (): HttpSettings => ({
      baseUrl: this.q<HTMLInputElement>('#baseUrl').value.trim() || '/api/v1',
      token: this.q<HTMLInputElement>('#token').value.trim(),
      workerIds: this.q<HTMLInputElement>('#workerIds')
        .value.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    this.q('#probe').addEventListener('click', async () => {
      const out = this.q('#probeOut');
      out.textContent = '확인 중…';
      const h = readHttp();
      const be = new HttpBackend({ baseUrl: h.baseUrl, token: () => h.token || null, sourceSystem: 'mfc-simulator', now: () => this.sim.time, timeoutMs: 6000 });
      be.onApi((r) => this.sim.apiLog.push(r));
      out.textContent = await be.probe(this.sim.params.mfcId);
    });
    this.q('#toHttp').addEventListener('click', () => this.restart({ mode: 'http', http: readHttp() }));
    this.root.querySelector('#toMock')?.addEventListener('click', () => this.restart({ mode: 'mock', http: readHttp() }));

    this.root.querySelector('#pda')!.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('x')) this.select(null);
    });
  }

  private slider(id: string, name: string, v: number, min: number, max: number, step: number, hint: string) {
    return `<div class="field"><label>${name}<b id="${id}V">${v}</b></label>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}" /><small>${hint}</small></div>`;
  }
  private bindSlider(id: string, apply: (v: number) => void) {
    const input = this.q<HTMLInputElement>(`#${id}`);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      this.q(`#${id}V`).textContent = String(v);
      apply(v);
    });
  }

  private refreshSpeed() {
    this.q('#speeds')
      .querySelectorAll('button')
      .forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.s) === this.sim.speed));
  }

  select(id: string | null) {
    this.view.selectedId = id;
    if (id) this.view.focusWorker(id);
    this.refreshPda();
  }

  /** 4Hz 정도로 부른다. */
  refresh() {
    const s = this.sim;
    this.q('#clock').textContent = fmtClock(s.time);
    this.refreshSpeed();
    const m = s.metrics.summary();
    const util = s.workers.length
      ? s.workers.filter((w) => w.state !== 'IDLE').length / s.workers.length
      : 0;
    const inPicking = s.workers.filter((w) => w.state === 'PICKING' || w.state === 'TO_CART').length;
    const inPacking = s.workers.filter((w) => w.state === 'PACKING').length;
    const kpis: [string, string][] = [
      ['주문 유입', `${s.metrics.ordersCreated}`],
      ['출하 준비', `${m.ready}`],
      ['라이더 인계', `${m.handedOver}`],
      ['접수→출하준비 평균', fmtDur(m.leadAvg)],
      ['접수→출하준비 p90', fmtDur(m.leadP90)],
      ['최근 1시간 처리', `${s.metrics.readyLastHour(s.time)}건`],
      ['피킹 평균', fmtDur(m.pickAvg)],
      ['패킹대 대기 평균', fmtDur(m.packQueueAvg)],
      ['배정 대기 평균', fmtDur(m.assignWaitAvg)],
      ['작업 중 / 전체', `${Math.round(util * 100)}% (${s.workers.length - s.workers.filter((w) => w.idle).length}/${s.workers.length})`],
      ['피킹 · 패킹 중', `${inPicking} · ${inPacking}`],
      ['패킹대 대기열', `${s.stations.queueLength}명`],
      ['재고 부족 차단', `${s.metrics.ordersBlockedStock}`],
      ['결품 보고(개)', `${s.metrics.shortageUnits}`],
      ['API 오류', `${s.metrics.apiErrors}`],
    ];
    this.q('#kpis').innerHTML = kpis.map(([k, v]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

    const b = s.taskBoard();
    const rows: [string, number][] = [
      ['PICK 준비(배정 대기)', b['PICK:READY'] ?? 0],
      ['PICK 배정·진행', (b['PICK:ASSIGNED'] ?? 0) + (b['PICK:IN_PROGRESS'] ?? 0)],
      ['PACK 대기(선행 PICK)', b['PACK:WAITING'] ?? 0],
      ['PACK 배정·진행', (b['PACK:ASSIGNED'] ?? 0) + (b['PACK:IN_PROGRESS'] ?? 0) + (b['PACK:READY'] ?? 0)],
      ['출하대기 랙 포장', s.shipRack.all().length],
      ['라이더 오는 중', s.shipmentsWaitingRider() + s.riders.length],
    ];
    this.q('#board').innerHTML = rows.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
    this.refreshLog(false);
    this.refreshPda();
  }

  private lastLogKey = '';
  private refreshLog(force: boolean) {
    const s = this.sim;
    const box = this.q('#log');
    const key = `${this.tab}:${s.apiLog.length}:${s.events.length}:${s.logs.length}:${this.tab === 'inventory' ? Math.floor(s.time / 5) : ''}`;
    if (!force && key === this.lastLogKey) return;
    this.lastLogKey = key;
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    if (this.tab === 'api') {
      box.innerHTML = s.apiLog
        .slice(-150)
        .map((r) => {
          const ok = typeof r.status === 'number' && r.status < 400;
          return `<div class="row"><span class="t">${fmtClock(r.at)}</span><span class="m-${r.method}">${r.method}</span><span class="${ok ? 's-ok' : 's-bad'}">${r.status}${r.code ? ` ${esc(r.code)}` : ''}</span><span>${esc(r.path)}</span></div>`;
        })
        .join('');
    } else if (this.tab === 'events') {
      box.innerHTML = s.events
        .slice(-150)
        .map((e) => `<div class="row wrap"><span class="t">${fmtClock(e.at)}</span><span class="ev">${esc(e.type)}</span><span>${esc(e.summary)}</span></div>`)
        .join('');
    } else if (this.tab === 'logs') {
      box.innerHTML = s.logs.length
        ? s.logs.slice(-150).map((l) => `<div class="row wrap"><span class="t">${fmtClock(l.at)}</span><span>${esc(l.msg)}</span></div>`).join('')
        : '<div class="note">결품·차단·오류 같은 현장 사건이 여기에 쌓입니다.</div>';
    } else {
      if (!s.mock) {
        box.innerHTML = '<div class="note">실서버 모드에서는 재고 스냅샷 API(/internal/snapshots)가 서비스 전용이라 볼 수 없습니다 (backend-requests.md R-05).</div>';
        return;
      }
      const inv = s.mock.inventory;
      const active = inv
        .all()
        .filter((x) => x.R > 0 || x.picked > 0 || x.packed > 0 || x.D > 0 || x.H < s.params.initialStockPerSku)
        .sort((a, b) => b.R + b.picked - (a.R + a.picked))
        .slice(0, 120);
      const tot = inv.all().reduce((a, x) => ({ H: a.H + x.H, E: a.E + x.E, R: a.R + x.R }), { H: 0, E: 0, R: 0 });
      box.innerHTML = `<div class="note">합계 H ${tot.H} · E ${tot.E} · R ${tot.R} · A ${tot.E - tot.R} — 피킹·패킹은 H/E/R 를 바꾸지 않고(작업 위치만), 인계 때 H·E·R 가 같이 줄어듭니다. 불변식 위반 ${inv.violations.length}건</div>
        <table class="inv"><thead><tr><th>SKU</th><th>H</th><th>E</th><th>R</th><th>A</th><th>피킹</th><th>포장</th><th>D</th></tr></thead><tbody>
        ${active
          .map((x) => `<tr><td title="${esc(s.skuMap.get(x.sku)?.name ?? '')}">${x.sku}</td><td>${x.H}</td><td>${x.E}</td><td>${x.R}</td><td>${x.E - x.R}</td><td>${x.picked}</td><td>${x.packed}</td><td>${x.D || ''}</td></tr>`)
          .join('')}</tbody></table>`;
      return;
    }
    if (stick || force) box.scrollTop = box.scrollHeight;
  }

  private refreshPda() {
    const box = this.q('#pda');
    const w = this.sim.workers.find((x) => x.id === this.view.selectedId);
    if (!w) {
      box.classList.remove('show');
      return;
    }
    box.classList.add('show');
    const d = w.pda;
    const row = (k: string, v: string | number | null | undefined, cls = '') => `<dt>${k}</dt><dd class="${cls}">${v ?? '—'}</dd>`;
    box.innerHTML = `
      <div class="hd"><b>${w.id} · PDA-${w.id}</b><span><span class="badge mock" style="background:${hex(STATE_COLOR[w.state])};color:#111">${STATE_KO[w.state]}</span> <button class="x">✕</button></span></div>
      ${
        d
          ? `<dl>
        ${row('작업', `${d.taskType === 'PICK' ? '피킹' : '패킹'} ${d.taskId}`)}
        ${row('주문', d.orderId)}
        ${row('진행', d.progress)}
        ${row('현재 로케이션', d.location, 'loc')}
        ${row('예정 로케이션', d.nextLocation)}
        ${row('보관방법', d.temp)}
        ${row('상품', d.productName)}
        ${row('바코드', d.barcode)}
        ${row('지시수량', d.plannedQty)}
        ${row('피킹수량', d.pickedQty)}
      </dl>`
          : '<div class="note">배정된 작업 없음</div>'
      }
      <div class="act">${esc(w.activity)}${d ? ` — ${esc(d.step)}` : ''}</div>
      <div class="note">처리 ${w.ordersDone}건 · 이동 ${Math.round(w.distance)}m</div>`;
  }
}
