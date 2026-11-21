// 도움말 — 조작 · 색 구분 · 실서버 모드 · 더 보기. 색 구분 탭을 여기에 합침(사용자 2026-11-20 "색구분은 탭 하나를 차지할 만큼 중요한 건 아니니까 도움말탭이랑 합쳐").
// 한 줄 = 굵은 낱말 + 짧은 설명, 줄 사이를 띄운다("왼쪽표에 글 다 다닥다닥").
import type { ReactNode } from 'react';
import { useApp } from '../app/context';
import { REAL_LINK } from '../config';
import { INBOUND_COLOR, STATE_COLOR, TEMP_COLOR, hex } from '../render/colors';
import type { InboundState } from '../sim/inbound';
import type { WorkerState } from '../sim/worker';
import { INBOUND_KO, STATE_KO } from './text';

function Part({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="sec help" open={open}>
      <summary>
        <h4>{title}</h4>
      </summary>
      {children}
    </details>
  );
}

function Item({ k, children }: { k: string; children: ReactNode }) {
  return (
    <li>
      <b>{k}</b>
      <span>{children}</span>
    </li>
  );
}

/** 조작 한 줄 — 하는 일 + 입력 칩(마우스·키) */
function Ctl({ k, keys }: { k: string; keys: string[] }) {
  return (
    <div className="ctl">
      <b>{k}</b>
      <span className="ctl-k">
        {keys.map((x) => (
          <kbd key={x} className={/끌기|휠/.test(x) ? 'mouse' : ''}>
            {x}
          </kbd>
        ))}
      </span>
    </div>
  );
}

/** 눌러 보기·화면 표시 한 줄 — 대상 → 결과 */
function Tap({ on, children }: { on: ReactNode; children: ReactNode }) {
  return (
    <div className={`ctl tap ${typeof on === 'string' ? '' : 'sw'}`}>
      <b>{on}</b>
      <span>{children}</span>
    </div>
  );
}

const WORKER: WorkerState[] = ['IDLE', 'TO_CART', 'PICKING', 'WAIT_STATION', 'PACKING', 'TO_SHIP', 'ERROR'];
const INBOUND: InboundState[] = ['RECEIVING', 'PUTAWAY', 'REPLENISH'];

function Swatch({ color, square, children }: { color: string; square?: boolean; children: ReactNode }) {
  return (
    <span className="sw">
      <i style={{ background: color, borderRadius: square ? 3 : '50%' }} />
      {children}
    </span>
  );
}

function Colors() {
  return (
    <div className="help-colors">
      <div className="hc-g">
        <em>작업자 발밑 고리</em>
        {WORKER.map((s) => (
          <Swatch key={s} color={hex(STATE_COLOR[s])}>
            {STATE_KO[s]}
          </Swatch>
        ))}
      </div>
      <div className="hc-g">
        <em>입고 작업자</em>
        {INBOUND.map((s) => (
          <Swatch key={s} color={hex(INBOUND_COLOR[s])}>
            {INBOUND_KO[s]}
          </Swatch>
        ))}
      </div>
      <div className="hc-g">
        <em>조끼</em>
        <Swatch color="#1e88e5" square>
          파랑 — 피킹·패킹
        </Swatch>
        <Swatch color="#ff9800" square>
          주황 — 입고
        </Swatch>
        <Swatch color="#26c6da">라이더(청록 재킷)</Swatch>
      </div>
      <div className="hc-g">
        <em>상품 온도</em>
        <Swatch color={hex(TEMP_COLOR.AMBIENT)}>상온</Swatch>
        <Swatch color={hex(TEMP_COLOR.CHILLED)}>냉장</Swatch>
        <Swatch color={hex(TEMP_COLOR.FROZEN)}>냉동</Swatch>
      </div>
    </div>
  );
}

export function Help() {
  const { sim } = useApp();
  const real = sim.mode === 'http';
  return (
    <>
      {/* 조작 — 한 줄 = 하는 일(굵게) + 쓰는 입력(작은 칩, 한 줄로). 누르는 대상은 키 모양이 아니라 글로.
          (사용자 2026-11-21 "도움말에 조작 알려주는 UI가 이게 맞아?" — 키 모양 칩이 "또는"과 함께 세로로 쌓여 어지러웠다) */}
      <Part title="조작">
        <div className="ctl-g">
          <em>화면 움직이기</em>
          <Ctl k="옮기기" keys={['왼쪽 끌기', 'WASD', '방향키']} />
          <Ctl k="돌려 보기" keys={['오른쪽 끌기']} />
          <Ctl k="확대·축소" keys={['휠']} />
          <Ctl k="처음 시야로" keys={['Esc']} />
        </div>
        <div className="ctl-g">
          <em>눌러 보기</em>
          <Tap on="구역 바닥 · 위 구역 칩">그 구역으로 확대</Tap>
          <Tap on="선반 칸 · 팔레트">든 상품·수량</Tap>
          <Tap on="작업자">하는 일, 따라가기</Tap>
          <Tap on="패킹대 · 인계 랙">그 자리 주문</Tap>
          <Tap on="빈 바닥 · 건물 밖">나가기</Tap>
        </div>
        <div className="ctl-g">
          <em>화면 표시</em>
          <Tap on={<span className="ctl-sw plate">B01-01</span>}>랙 번호(가까이 가면 칸 번호)</Tap>
          <Tap on={<span className="ctl-sw bubble">말풍선</span>}>작업자가 지금 찍을 것</Tap>
          <Tap on={<span className="ctl-sw guess">추정</span>}>서버 값이 아니라 화면이 짐작한 값</Tap>
          <Tap on={<span className="ctl-sw pending">회색 바닥</span>}>입고재고(검수 전) 자리</Tap>
        </div>
      </Part>
      <Part title="색 구분">
        <Colors />
      </Part>
      {real && (
        <Part title="실서버 모드">
          <ul className="help-list">
            <Item k="읽기">{REAL_LINK.pollSec}초마다 서버를 읽어 그림. 시계는 실제 시각</Item>
            <Item k="바뀌는 때">가상 작업자를 켜거나, 주문·입고 버튼을 눌렀을 때만 실서버가 바뀜</Item>
            <Item k="실제 주문">내 계정으로 주문 + 시험 결제. 배차까지 그대로 흐름</Item>
            <Item k="재고 채우기">재고 적은 상품을 온도대별 입고칸(검수 전 입고재고 자리)에 수령까지. 검사·적치는 PDA 나 가상 작업자</Item>
            <Item k="가상 작업자">mfcw-pp-01~10. 끊긴 작업 계정부터 켜고, PDA 가 쓰는 계정은 건너뜀</Item>
            <Item k="출하대기 랙">PDA 가 랙을 찍으면 서버 랙, 아니면 {REAL_LINK.rackAutoSec}초 뒤 "추정"</Item>
            <Item k="토큰">개발 서버가 받아 줌 — 비밀번호·고객 토큰은 브라우저로 안 옴</Item>
          </ul>
        </Part>
      )}
      <Part title="더 보기" open={false}>
        <ul className="help-list">
          <Item k="정한 값">src/config.ts ([확정]·[가정]·[시뮬])</Item>
          <Item k="백엔드 요청">docs/backend-requests.md</Item>
        </ul>
      </Part>
    </>
  );
}
