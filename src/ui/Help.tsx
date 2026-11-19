// "?" 도움말 — 패널마다 흩어져 있던 긴 설명을 한 곳에(사용자 2026-11-20 "주절주절 … 해결방안"). 화면에는 값과 할 일만 남긴다.
import { useApp } from '../app/context';
import { REAL_LINK, TEST_INBOUND } from '../config';

function Part({ title, items }: { title: string; items: string[] }) {
  return (
    <details className="sec help" open>
      <summary>
        <h4>{title}</h4>
      </summary>
      <ul>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </details>
  );
}

export function Help() {
  const { sim } = useApp();
  const real = sim.mode === 'http';
  return (
    <>
      <Part
        title="이 화면 읽는 법"
        items={[
          '드래그 회전 · 우클릭(또는 Shift)+드래그 이동 · 휠 확대.',
          '구역 바닥을 누르면 그 구역으로, 선반 상품을 누르면 로케이션 정보, 작업자를 누르면 PDA 화면과 따라가기.',
          '랙 위 노란 판 = 랙 번호. 가까이 가면 선반 앞단에 칸 번호.',
          '작업자 발밑 고리 색 = 상태(색 구분 메뉴). 말풍선 = 지금 찍을 것.',
          '회색 "추정" 칩 = 서버 값이 아니라 화면이 짐작한 값.',
        ]}
      />
      {real && (
        <Part
          title="실서버 모드"
          items={[
            `고객 앱 주문으로 생긴 작업과 PDA 작업자 진행을 ${REAL_LINK.pollSec}초마다 읽어 그립니다. 시계는 실제 시각(1×), 가짜 주문은 없습니다.`,
            '가상 작업자를 켜지 않고 주문·입고 버튼을 누르지 않으면 실서버 재고·작업을 바꾸지 않습니다.',
            '토큰은 개발 서버가 LAN 시험 계정으로 받아 줍니다 — 비밀번호·고객 토큰은 브라우저로 오지 않습니다.',
            '실제 주문 넣기: 출하 가능한 상품을 최소 주문 금액 넘게 담아 시험 결제(TEST_AUTO)로 승인. 배차까지 그대로 흐릅니다. 고객은 허용 목록의 내 계정뿐(시험 고객 R-22 보류).',
            `재고 채우기: 판매 가능이 적은 상품부터 입고 예정(LAN 시험 전용)을 만들고 ${TEST_INBOUND.receivingLocation} 에 수령까지. 품질검사·적치는 다음 작업 받기로 PDA 나 가상 작업자가.`,
            '가상 작업자: mfcw-pp-01~10. 끊긴 작업이 서버에 남은 계정부터 켜고, 실제 PDA 가 쓰는 계정은 건너뜁니다. 줄이면 들고 있는 작업을 마치고 멈춥니다.',
            `출하대기 랙: PDA 가 랙을 찍어 서버에 올린 포장은 서버 랙 그대로. 서버에 안 오면 작업자가 랙에 서고 ${REAL_LINK.rackAutoSec}초 뒤 넘기고, 랙은 "추정".`,
          ]}
        />
      )}
      <Part
        title="시뮬레이터가 정한 값"
        items={[
          '업무 문서에 없는 수치는 src/config.ts 에 [확정]/[가정]/[시뮬] 근거와 함께 있습니다.',
          '백엔드에 요청한 것·흉내 낸 값은 docs/backend-requests.md.',
        ]}
      />
    </>
  );
}
