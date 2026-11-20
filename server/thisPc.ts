// 요청이 시뮬레이터를 띄운 이 PC(PC 1)에서 왔나 — localhost 뿐 아니라 이 PC 자기 IP(예 192.168.0.32)로 연 화면도 이 PC 로 본다.
// (사용자 2026-11-20 "PC1에서만" — PC 1 = 192.168.0.32, 백엔드 docs/operations/2026-11-09-rag-container-restarts.md.
//  이 PC 를 자기 IP 주소로 열면 다른 기기로 잘못 판단해 주문 넣기·재고 채우기·가상 작업자·관리 조치가 숨겨졌다.)
// 다른 PC 는 그대로 막는다(토큰·쓰기는 이 PC 화면만).
import { networkInterfaces } from 'node:os';
import type { IncomingMessage } from 'node:http';

function strip(a: string): string {
  return a.startsWith('::ffff:') ? a.slice(7) : a;
}

/** 이 PC 의 모든 주소(루프백 포함) — 망 연결이 바뀌어도 맞도록 부를 때마다 읽는다 */
function ownAddresses(): Set<string> {
  const out = new Set<string>(['127.0.0.1', '::1']);
  for (const list of Object.values(networkInterfaces())) for (const n of list ?? []) out.add(strip(n.address).split('%')[0]);
  return out;
}

export function fromThisPc(req: IncomingMessage): boolean {
  const a = strip(req.socket.remoteAddress ?? '').split('%')[0];
  return a !== '' && ownAddresses().has(a);
}
