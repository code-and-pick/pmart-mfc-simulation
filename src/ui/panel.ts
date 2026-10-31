import { HttpBackend } from '../backend/http/HttpBackend';
import { SPEEDS } from '../config';
import type { TemperatureZone } from '../domain/contract';
import { INBOUND_COLOR, STATE_COLOR, TEMP_COLOR, type Selection, type View3D } from '../render/view3d';
import type { InboundState } from '../sim/inbound';
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
const INBOUND_KO: Record<InboundState, string> = {
  IDLE: '대기',
  RECEIVING: '하차·검수',
  PUTAWAY: '적치',
  REPLENISH: '보충(MOV)',
  RETURNING: '복귀',
  ERROR: '오류',
};
const TEMP_KO: Record<TemperatureZone, string> = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' };

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
    view.onSelect = () => this.refreshDetail();
    view.onZone = (key) => {
      this.q('#zones')
        .querySelectorAll('button')
        .forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.z === key));
      this.refreshZone();
    };
    view.onZone(view.focusedZone);
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  private build() {
    const p = this.sim.params;
    const http = this.settings.http;
    const mock = this.sim.mode === 'mock';
    this.root.innerHTML = `
      <div class="topbar">
        <div class="brand">PMart MFC 가상 현장</div>
        <span class="badge ${this.sim.mode}">${mock ? 'MOCK 백엔드' : '실서버'}</span>
        <div class="clock" id="clock">--:--:--</div>
        <div class="seg" id="speeds">${SPEEDS.map((s) => `<button data-s="${s}">${s === 0 ? '❚❚' : `${s}×`}</button>`).join('')}</div>
        <div class="spacer"></div>
        <div class="seg" id="zones">${this.view.views.map((v) => `<button data-z="${v.key}">${v.label}</button>`).join('')}</div>
        <div class="seg" id="labels" title="랙 번호판은 늘, 칸 번호는 가까이 확대했을 때 보입니다"><button data-l="all" class="on">번호</button><button data-l="rack">랙만</button><button data-l="off">끔</button></div>
        <div class="seg" id="walls"><button data-w="0.32" class="on">벽</button><button data-w="0">벽 숨김</button></div>
      </div>

      <div class="panel left">
        <h3>출고 (실행 중 변경)</h3>
        ${this.slider('orders', '시간당 주문', p.ordersPerHour, 5, 120, 1, '기준안 피크 약 40건/시간, 낙관안 88건 (MFC 7-1 가정)')}
        ${this.slider('workers', '피킹·패킹 작업자', p.workers, 1, 24, 1, '기준안 약 10명, 낙관안 약 22명 (MFC 7-2 가정)')}
        ${this.slider('stations', '가동 패킹대', p.packingStations, 1, 8, 1, '기본 4대 · 최대 8대 (MFC 11장)')}
        ${this.slider('shortage', '결품률 (%)', p.shortageRate * 100, 0, 10, 0.5, '피킹 시 선반 실물 부족 보고 확률 (시뮬 값)')}
        <div class="field">
          <label>피킹 순서</label>
          <select id="seq">
            <option value="DOC_B_A_C" ${p.pickSequence === 'DOC_B_A_C' ? 'selected' : ''}>B→A→C~H (원본 관찰, MFC 8-3)</option>
            <option value="AMBIENT_FIRST" ${p.pickSequence === 'AMBIENT_FIRST' ? 'selected' : ''}>상온 → 냉장 → 냉동</option>
          </select>
        </div>
        ${
          mock
            ? `<h3>입고·적치·보충</h3>
        ${this.slider('inWorkers', '입고 작업자', p.inboundWorkers, 0, 8, 1, '기준 3명 (검수 2 + 이송 1, MFC 10장 가정)')}
        ${this.slider('inInterval', '입고 차량 주기 (시간)', p.inboundIntervalHours, 1, 8, 1, '실제는 매일 오전 1회 [확정] — 적치 과정을 보려고 짧게 [시뮬]')}
        <button class="btn" id="callTruck">입고 차량 지금 부르기</button>
        <div class="probe" id="nextTruck">—</div>`
            : ''
        }

        <h3>색 구분</h3>
        <div class="legend">
          ${(['IDLE', 'TO_CART', 'PICKING', 'WAIT_STATION', 'PACKING', 'TO_SHIP', 'ERROR'] as WorkerState[]).map((s) => `<span><i class="dot" style="background:${hex(STATE_COLOR[s])}"></i>${STATE_KO[s]}</span>`).join('')}
          ${(['RECEIVING', 'PUTAWAY', 'REPLENISH'] as InboundState[]).map((s) => `<span><i class="dot" style="background:${hex(INBOUND_COLOR[s])}"></i>입고 ${INBOUND_KO[s]}</span>`).join('')}
          <span><i class="dot" style="background:#1e88e5;border-radius:2px"></i>파란 조끼 피킹·패킹</span>
          <span><i class="dot" style="background:#ff9800;border-radius:2px"></i>주황 조끼 입고</span>
          <span><i class="dot" style="background:${hex(TEMP_COLOR.AMBIENT)}"></i>상온 상품</span>
          <span><i class="dot" style="background:${hex(TEMP_COLOR.CHILLED)}"></i>냉장 상품</span>
          <span><i class="dot" style="background:${hex(TEMP_COLOR.FROZEN)}"></i>냉동 상품</span>
          <span><i class="dot" style="background:#26c6da"></i>라이더</span>
        </div>
        <p class="note">구역 바닥을 클릭하면 그 구역으로 확대(랙 위 노란 판 = 랙 번호, 가까이 가면 선반 앞단에 칸 번호), 선반 상품을 클릭하면 로케이션 정보, 작업자를 클릭하면 PDA 화면을 봅니다. 드래그 회전 · 우클릭 이동 · 휠 확대.</p>

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
        <button class="btn" id="toHttp">${mock ? '실서버 모드로 재시작' : '실서버 설정 다시 적용'}</button>
        ${mock ? '' : '<button class="btn ghost" id="toMock">MOCK 모드로 돌아가기</button>'}
        <p class="note">2026-10-31 기준 백엔드 이행(슬라이스 6)이 501 이라 실서버 모드는 연결·인증·계약 점검까지만 됩니다. 필요한 백엔드 변경은 docs/backend-requests.md.</p>
      </div>

      <div class="panel right">
        <div class="kpis" id="kpis"></div>
        <div class="board" id="board"></div>
        <div class="tabs" id="tabs">
          <button data-t="api" class="on">API 호출</button>
          <button data-t="events">계약 이벤트</button>
          <button data-t="logs">현장</button>
          <button data-t="inventory">재고</button>
        </div>
        <div class="log" id="log"></div>
      </div>

      <div class="card zonecard" id="zoneCard"></div>
      <div class="pda" id="pda"></div>
    `;

    this.q('#speeds').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.sim.speed = Number(b.dataset.s);
      this.refreshSpeed();
    });
    this.refreshSpeed();
    this.q('#zones').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.z) this.view.focusZone(b.dataset.z);
    });
    this.q('#labels').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const mode = b.dataset.l;
      this.view.labels.rackVisible = mode !== 'off';
      this.view.labels.slotVisible = mode === 'all';
      this.q('#labels').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
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
    this.q('#log').addEventListener('click', (e) => {
      const tr = (e.target as HTMLElement).closest('[data-loc]') as HTMLElement | null;
      if (tr?.dataset.loc) this.view.select({ kind: 'location', sku: tr.dataset.loc });
    });

    this.bindSlider('orders', (v) => (this.sim.params.ordersPerHour = v));
    this.bindSlider('workers', (v) => this.sim.setWorkers(v));
    this.bindSlider('stations', (v) => this.sim.setStations(v));
    this.bindSlider('shortage', (v) => (this.sim.params.shortageRate = v / 100));
    if (mock) {
      this.bindSlider('inWorkers', (v) => this.sim.setInboundWorkers(v));
      this.bindSlider('inInterval', (v) => (this.sim.params.inboundIntervalHours = v));
      this.q('#callTruck').addEventListener('click', () => {
        if (this.sim.callTruck()) this.view.focusZone('RCV');
      });
    }
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

    this.q('#pda').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains('x')) this.view.select(null, false);
      const a = t.closest('[data-loc]') as HTMLElement | null;
      if (a?.dataset.loc) this.view.select({ kind: 'location', sku: a.dataset.loc });
    });
    this.q('#zoneCard').addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-loc]') as HTMLElement | null;
      if (t?.dataset.loc) this.view.select({ kind: 'location', sku: t.dataset.loc });
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

  /** 4Hz 정도로 부른다. */
  refresh() {
    const s = this.sim;
    this.q('#clock').textContent = fmtClock(s.time);
    this.refreshSpeed();
    const m = s.metrics.summary();
    const ib = s.metrics.inbound;
    const busy = s.workers.filter((w) => !w.idle).length;
    const inv = s.mock?.inventory;
    let shelfUnits = 0;
    let shelfCap = 0;
    let low = 0;
    if (inv) {
      for (const k of s.catalog) {
        const b = inv.get(k.sku)!;
        shelfUnits += b.shelf;
        shelfCap += k.shelfCap;
        if (b.shelf <= k.minQty) low++;
      }
    }
    const kpis: [string, string][] = [
      ['주문 유입', `${s.metrics.ordersCreated}`],
      ['출하 준비', `${m.ready}`],
      ['라이더 인계', `${m.handedOver}`],
      ['접수→출하준비 평균', fmtDur(m.leadAvg)],
      ['접수→출하준비 p90', fmtDur(m.leadP90)],
      ['최근 1시간 처리', `${s.metrics.readyLastHour(s.time)}건`],
      ['피킹 평균', fmtDur(m.pickAvg)],
      ['패킹대 대기 평균', fmtDur(m.packQueueAvg)],
      ['작업 중 / 전체', `${busy}/${s.workers.length}`],
      ['선반 충족률', inv ? `${Math.round((100 * shelfUnits) / shelfCap)}%` : '—'],
      ['보충 필요 칸 (≤min)', inv ? `${low}` : '—'],
      ['피킹 중 보충 대기', `${ib.pickWaits}회`],
      ['입고 차량 도착/수령', `${ib.trucksArrived}/${ib.trucksReceived}`],
      ['적치 선반·보충재고', `${ib.putawayShelfUnits}·${ib.putawayReserveUnits}`],
      ['보충 이동 MOV', `${ib.replenishMoves}회 ${ib.replenishUnits}개`],
      ['재고 부족 차단', `${s.metrics.ordersBlockedStock}`],
      ['결품 보고(개)', `${s.metrics.shortageUnits}`],
      ['API 오류', `${s.metrics.apiErrors}`],
    ];
    this.q('#kpis').innerHTML = kpis.map(([k, v]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

    const b = s.taskBoard();
    const ibb = s.inboundBoard();
    const rows: [string, number | string][] = [
      ['PICK 준비(배정 대기)', b['PICK:READY'] ?? 0],
      ['PICK 배정·진행', (b['PICK:ASSIGNED'] ?? 0) + (b['PICK:IN_PROGRESS'] ?? 0)],
      ['PACK 배정·진행', (b['PACK:ASSIGNED'] ?? 0) + (b['PACK:IN_PROGRESS'] ?? 0) + (b['PACK:READY'] ?? 0)],
      ['출하대기 랙 포장', s.shipRack.all().length],
      ['라이더 오는 중', s.shipmentsWaitingRider() + s.riders.length],
      ['패킹대 대기열', `${s.stations.queueLength}명`],
      ['하차 칸 적치 대기', ibb.putawayLines],
      ['보충 대기·진행', `${ibb.replenishQueued}·${ibb.replenishActive}`],
    ];
    this.q('#board').innerHTML = rows.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
    if (s.mock) {
      const nt = this.root.querySelector('#nextTruck');
      if (nt) nt.textContent = `다음 정기 입고 ${fmtClock(ibb.nextTruckAt)} · 입고 작업자 ${s.inboundWorkers.filter((w) => !w.idle).length}/${s.inboundWorkers.length} 작업 중`;
    }
    this.refreshLog(false);
    this.refreshDetail();
    this.refreshZone();
  }

  // ── 구역 카드 ───────────────────────────────────────
  private refreshZone() {
    const card = this.q('#zoneCard');
    const key = this.view.focusedZone;
    const v = this.view.views.find((x) => x.key === key);
    const s = this.sim;
    const inv = s.mock?.inventory;
    if (!v || key === 'ALL') {
      card.classList.remove('show');
      return;
    }
    card.classList.add('show');
    const zone = s.layout.zones.find((z) => z.id === v.zoneId);
    const temp: TemperatureZone | null = key === 'A' ? 'FROZEN' : key === 'B' ? 'CHILLED' : key === 'C-H' ? 'AMBIENT' : null;
    let body = '';
    if (temp) {
      const racks = s.layout.racks.filter((r) => r.temp === temp);
      const locs = s.layout.locationsByTemp[temp].length;
      const skus = s.catalog.filter((k) => k.temp === temp);
      let units = 0;
      let cap = 0;
      let reserve = 0;
      const lows: { sku: string; code: string; shelf: number; min: number; reserve: number }[] = [];
      if (inv) {
        for (const k of skus) {
          const b = inv.get(k.sku)!;
          units += b.shelf;
          cap += k.shelfCap;
          reserve += b.reserve;
          if (b.shelf <= k.minQty) lows.push({ sku: k.sku, code: k.location.code, shelf: b.shelf, min: k.minQty, reserve: b.reserve });
        }
      }
      lows.sort((a, b) => a.shelf - b.shelf);
      const pct = cap ? Math.round((100 * units) / cap) : 0;
      body = `
        <div class="stats">
          <div><b>${racks.length}</b><span>랙</span></div>
          <div><b>${locs.toLocaleString()}</b><span>칸(로케이션)</span></div>
          <div><b>${skus.length.toLocaleString()}</b><span>SKU (칸의 85%)</span></div>
          <div><b>${inv ? units.toLocaleString() : '—'}</b><span>선반 상품</span></div>
          <div><b>${inv ? reserve.toLocaleString() : '—'}</b><span>보충재고</span></div>
          <div><b>${inv ? lows.length : '—'}</b><span>보충 필요 칸</span></div>
        </div>
        ${inv ? `<div class="bar"><i style="width:${pct}%;background:${hex(TEMP_COLOR[temp])}"></i></div><div class="note">선반 충족률 ${pct}% (칸 한도 합 ${cap.toLocaleString()}개 기준)</div>` : ''}
        ${
          lows.length
            ? `<div class="note">보충 필요 칸 (선반/최소) — 누르면 이동</div><div class="lows">${lows
                .slice(0, 8)
                .map((l) => `<div data-loc="${l.sku}"><span>${l.code}</span><span>${l.shelf}/${l.min}</span><span>${l.reserve > 0 ? `보충재고 ${l.reserve}` : '입고 필요'}</span></div>`)
                .join('')}</div>`
            : ''
        }`;
    } else if (key === 'WH') {
      const res = s.layout.reserves.filter((r) => r.temp === 'AMBIENT');
      const units = inv ? s.catalog.filter((k) => k.temp === 'AMBIENT').reduce((a, k) => a + inv.get(k.sku)!.reserve, 0) : 0;
      body = `<div class="stats"><div><b>${res.length}</b><span>바닥 팔레트 자리</span></div><div><b>${inv ? units.toLocaleString() : '—'}</b><span>상온 보충재고</span></div></div>
        <div class="note">입고 수량 중 피킹 칸 한도를 넘는 상온 상품은 이 팔레트에 쌓였다가, 칸이 최소량 이하가 되면 보충(MOV)됩니다. 냉장·냉동 보충재고는 각 저온실 안쪽 팔레트(AR·BR)에 있습니다.</div>`;
    } else if (key === 'RCV') {
      const ibb = s.inboundBoard();
      const st = { APPROACHING: '진입 중', DOCKED: '도착', DONE: '수령 완료', LEAVING: '출발', GONE: '' } as const;
      const trucks = s.trucks
        .map((t) => `<div><span>${t.trfId}</span><span>${t.state === 'UNLOADING' ? `하차 ${t.unloaded}/${t.lines.length}` : st[t.state]}</span><span>${t.lines.length}품목 ${t.lines.reduce((a, l) => a + l.qty, 0)}개</span></div>`)
        .join('');
      body = `<div class="stats"><div><b>${s.trucks.length}</b><span>차량</span></div><div><b>${ibb.putawayLines}</b><span>하차 칸 롤테이너</span></div><div><b>${s.metrics.inbound.receivedUnits.toLocaleString()}</b><span>누적 수령</span></div></div>
        ${trucks ? `<div class="lows">${trucks}</div>` : '<div class="note">입고 차량 없음 — 왼쪽 "입고 차량 지금 부르기"</div>'}
        <div class="note">옅은 색 롤테이너 = 검수 전, 진한 색 = 수령 등록(TIN) 완료·적치 대기. 냉동·냉장부터 적치합니다.</div>`;
    } else if (key === 'PK') {
      const active = s.stations.activeCount;
      const busy = s.layout.stations.filter((st, i) => s.stations.isActive(i) && s.stations.occupant(st.id)).length;
      body = `<div class="stats"><div><b>${busy}/${active}</b><span>사용 중 패킹대</span></div><div><b>${s.stations.queueLength}</b><span>대기열</span></div></div>
        <div class="note">패킹대 1.6×0.8m, 모듈 2.0×2.2m, 4대씩 두 줄 (MFC 7-5).</div>`;
    } else if (key === 'SHIP') {
      body = `<div class="stats"><div><b>${s.shipRack.all().length}</b><span>랙 위 포장</span></div><div><b>${s.riders.length}</b><span>라이더</span></div><div><b>${s.shipRack.overflow}</b><span>랙 초과(바닥)</span></div></div>
        <div class="note">외부 출하대기 랙 2개. 라이더는 안으로 들어오지 않고 QR 스캔으로 인계받습니다 (MFC 5-3).</div>`;
    }
    card.innerHTML = `<div class="hd"><b>${esc(v.label)}</b>${zone?.docPyeong ? `<span class="note">${zone.docPyeong}평</span>` : ''}</div>${body}`;
  }

  // ── PDA / 로케이션 카드 ──────────────────────────────
  private refreshDetail() {
    const box = this.q('#pda');
    const sel: Selection = this.view.selection;
    if (!sel) {
      box.classList.remove('show');
      return;
    }
    box.classList.add('show');
    const row = (k: string, v: string | number | null | undefined, cls = '') => `<dt>${k}</dt><dd class="${cls}">${v ?? '—'}</dd>`;
    if (sel.kind === 'location') {
      const k = this.sim.skuMap.get(sel.sku)!;
      const b = this.sim.mock?.inventory.get(sel.sku);
      const pct = b ? Math.round((100 * b.shelf) / k.shelfCap) : 0;
      box.innerHTML = `
        <div class="hd"><b>로케이션 ${k.location.code}</b><button class="x">✕</button></div>
        <dl>
          ${row('상품', esc(k.name))}
          ${row('SKU · 바코드', `${k.sku} · ${k.barcode}`)}
          ${row('보관', `${TEMP_KO[k.temp]} · ${k.location.level}단 ${k.location.slot}번 칸`)}
        </dl>
        ${
          b
            ? `<div class="bar big"><i style="width:${pct}%;background:${hex(TEMP_COLOR[k.temp])}"></i><em style="left:${(100 * k.minQty) / k.shelfCap}%"></em></div>
        <div class="note">선반 ${b.shelf} / 칸 한도 ${k.shelfCap} · 최소 ${k.minQty} (이하면 자동 보충)</div>
        <dl>
          ${row('보충재고', `${b.reserve}개 @ ${k.reserveId}`)}
          ${row('미적치(하차 칸)', `${b.unstowed}개`)}
          ${row('작업 중', `피킹 ${b.picked} · 포장 ${b.packed}`)}
          ${row('H / E / R / A', `${b.H} / ${b.E} / ${b.R} / ${b.E - b.R}`, 'loc')}
          ${b.D ? row('차이 D (실사 전)', b.D) : ''}
        </dl>
        <div class="note">H = 선반 + 보충재고 + 미적치 + 피킹 + 포장${b.D ? ' + D' : ''}. 적치·보충·피킹은 H 를 바꾸지 않고 위치만 바꿉니다.</div>`
            : '<div class="note">실서버 모드에서는 재고 수량을 볼 수 없습니다 (R-05).</div>'
        }`;
      return;
    }
    if (sel.kind === 'inbound') {
      const w = this.sim.inboundWorkers.find((x) => x.id === sel.id);
      if (!w) {
        box.classList.remove('show');
        return;
      }
      const d = w.pda;
      box.innerHTML = `
        <div class="hd"><b>${w.id} · 입고 PDA</b><span><span class="badge mock" style="background:${hex(INBOUND_COLOR[w.state])};color:#111">${INBOUND_KO[w.state]}</span> <button class="x">✕</button></span></div>
        ${d ? `<div class="note" style="color:#fff;font-weight:700">${esc(d.title)}</div><dl>${d.rows.map(([k, v]) => row(esc(k), esc(v))).join('')}</dl>` : '<div class="note">배정된 작업 없음</div>'}
        <div class="act">${esc(w.activity)}${d ? ` — ${esc(d.step)}` : ''}</div>
        <div class="note">처리 ${w.jobsDone}건 · 이동 ${Math.round(w.distance)}m</div>`;
      return;
    }
    const w = this.sim.workers.find((x) => x.id === sel.id);
    if (!w) {
      box.classList.remove('show');
      return;
    }
    const d = w.pda;
    const locSku = w.currentTarget ? this.sim.catalog.find((k) => k.location === w.currentTarget)?.sku : undefined;
    box.innerHTML = `
      <div class="hd"><b>${w.id} · PDA-${w.id}</b><span><span class="badge mock" style="background:${hex(STATE_COLOR[w.state])};color:#111">${STATE_KO[w.state]}</span> <button class="x">✕</button></span></div>
      ${
        d
          ? `<dl>
        ${row('작업', `${d.taskType === 'PICK' ? '피킹' : '패킹'} ${d.taskId}`)}
        ${row('주문', d.orderId)}
        ${row('진행', d.progress)}
        ${row('현재 로케이션', d.location ? (locSku ? `<a data-loc="${locSku}">${d.location}</a>` : d.location) : null, 'loc')}
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

  private lastLogKey = '';
  private refreshLog(force: boolean) {
    const s = this.sim;
    const box = this.q('#log');
    const key = `${this.tab}:${s.apiLog.length}:${s.apiLog[s.apiLog.length - 1]?.at}:${s.events.length}:${s.events[s.events.length - 1]?.at}:${s.logs.length}:${this.tab === 'inventory' ? Math.floor(s.time / 5) : ''}`;
    if (!force && key === this.lastLogKey) return;
    this.lastLogKey = key;
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    if (this.tab === 'api') {
      box.innerHTML = s.apiLog
        .slice(-150)
        .map((r) => {
          const ok = typeof r.status === 'number' && r.status < 400;
          return `<div class="row"><span class="t">${fmtClock(r.at)}</span><span class="m-${r.method}">${r.method}</span><span class="${ok ? 's-ok' : 's-bad'}">${r.status}${r.code ? ` ${esc(r.code)}` : ''}</span><span>${esc(r.path)}</span>${r.note ? `<span class="gap">${esc(r.note)}</span>` : ''}</div>`;
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
        : '<div class="note">결품·보충 대기·차단·오류 같은 현장 사건이 여기에 쌓입니다.</div>';
    } else {
      if (!s.mock) {
        box.innerHTML = '<div class="note">실서버 모드에서는 재고 스냅샷 API(/internal/snapshots)가 서비스 전용이라 볼 수 없습니다 (backend-requests.md R-05).</div>';
        return;
      }
      const inv = s.mock.inventory;
      const active = inv
        .all()
        .filter((x) => x.R > 0 || x.picked > 0 || x.packed > 0 || x.D > 0 || x.unstowed > 0 || x.shelf <= (s.skuMap.get(x.sku)?.minQty ?? 0))
        .sort((a, b) => b.R + b.picked + b.unstowed - (a.R + a.picked + a.unstowed))
        .slice(0, 150);
      const tot = inv.all().reduce(
        (a, x) => ({ H: a.H + x.H, E: a.E + x.E, R: a.R + x.R, shelf: a.shelf + x.shelf, reserve: a.reserve + x.reserve, un: a.un + x.unstowed }),
        { H: 0, E: 0, R: 0, shelf: 0, reserve: 0, un: 0 },
      );
      box.innerHTML = `<div class="note">합계 H ${tot.H.toLocaleString()} (선반 ${tot.shelf.toLocaleString()} · 보충재고 ${tot.reserve.toLocaleString()} · 미적치 ${tot.un}) · E ${tot.E.toLocaleString()} · R ${tot.R} · 불변식 위반 ${inv.violations.length}건. 행을 누르면 그 로케이션으로 이동합니다.</div>
        <table class="inv"><thead><tr><th>로케이션</th><th>선반</th><th>보충</th><th>미적치</th><th>H</th><th>R</th><th>A</th><th>피킹</th><th>포장</th></tr></thead><tbody>
        ${active
          .map((x) => {
            const k = s.skuMap.get(x.sku)!;
            return `<tr data-loc="${x.sku}" title="${esc(k.name)} ${x.sku}"><td>${k.location.code}</td><td>${x.shelf}/${k.shelfCap}</td><td>${x.reserve}</td><td>${x.unstowed || ''}</td><td>${x.H}</td><td>${x.R}</td><td>${x.E - x.R}</td><td>${x.picked || ''}</td><td>${x.packed || ''}</td></tr>`;
          })
          .join('')}</tbody></table>`;
      return;
    }
    if (stick || force) box.scrollTop = box.scrollHeight;
  }
}
