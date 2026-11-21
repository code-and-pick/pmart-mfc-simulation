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

/** 조작 한 줄 — 누를 것(여러 개면 "또는") → 일어나는 일 */
function Ctl({ keys, children }: { keys: string[][]; children: ReactNode }) {
  return (
    <div className="ctl">
      <div className="ctl-k">
        {keys.map((k, i) => (
          <span key={i}>
            {i > 0 && <i>또는</i>}
            <kbd>
              {k.length > 1 && <small>{k[0]}</small>}
              {k[k.length - 1]}
            </kbd>
          </span>
        ))}
      </div>
      <div className="ctl-v">{children}</div>
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
      {/* 조작 — 왼쪽에 누를 것(키·마우스 모양), 오른쪽에 일어나는 일. 사용자 2026-11-21 "도움말에 조작 탭 좀 더 직관적이게" */}
      <Part title="조작">
        <div className="ctl-g">
          <em>화면 움직이기</em>
          <Ctl keys={[['🖱', '왼쪽 끌기'], ['W A S D'], ['← ↑ → ↓']]}>옆으로 옮기기</Ctl>
          <Ctl keys={[['🖱', '오른쪽 끌기']]}>돌려 보기</Ctl>
          <Ctl keys={[['🖱', '휠']]}>확대·축소</Ctl>
          <Ctl keys={[['Esc']]}>처음 시야로</Ctl>
        </div>
        <div className="ctl-g">
          <em>누르면</em>
          <Ctl keys={[['구역 바닥'], ['위 구역 칩']]}>그 구역으로 확대</Ctl>
          <Ctl keys={[['선반 칸']]}>칸에 든 상품·수량</Ctl>
          <Ctl keys={[['작업자']]}>하는 일·따라가기</Ctl>
          <Ctl keys={[['패킹대'], ['출하대기 랙']]}>그 자리 주문</Ctl>
          <Ctl keys={[['빈 바닥'], ['건물 밖']]}>나가기</Ctl>
        </div>
        <div className="ctl-g">
          <em>화면에 보이는 것</em>
          <Ctl keys={[['노란 판']]}>랙 번호 · 가까이 칸 번호</Ctl>
          <Ctl keys={[['말풍선']]}>작업자가 지금 찍을 것</Ctl>
          <Ctl keys={[['회색 칩']]}>화면이 짐작한 값</Ctl>
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
