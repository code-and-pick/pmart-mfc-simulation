// 회수품 흐름 (MOCK) — 사용자 2026-11-22 "넣어"(회수반입 → 검수 → 정상은 선반, 폐기는 온도대 격리 구역).
// 계약(mfc-inbound 0.13~0.17, mfc-quality 0.11.0, 2026-11-20 BR-52 회신)대로:
//   라이더 반납(ReturnDelivered) → 반납 도착 대기 → 점원 반입(RTN-A-01 격리, H+q·Q+q)
//   → 다른 점원 검수: 상온·미개봉 = 재판매(RELEASE → 적치 작업, 선반으로) / 냉장·냉동·개봉·파손 = 폐기(반입한 사람이 온도대 격리 구역으로 격리 이동)
// 폐기 승인·실행은 센터 관리자 일이라 격리 구역에 둔 채로 끝난다.

import type { TemperatureZone } from '../domain/contract';
import type { P } from '../domain/navgrid';
import { getOff, loadAndGetOn, offLot, rideTo, walkOn } from './realRider';
import { Rider } from './rider';
import type { SiteContext } from './context';

export type ReturnStage =
  /** 라이더가 들고 오는 중 */
  | 'ARRIVING'
  /** 반납 도착 대기(회수반입 자리에 놓임, 반입 전) */
  | 'WAITING'
  /** 반입됨(격리) — 검수 대기 */
  | 'RECEIVED'
  /** 검수 재판매 — 적치 대기 */
  | 'RESALE'
  /** 검수 폐기 — 격리 이동 대기(반입한 사람) */
  | 'DISPOSE'
  /** 점원이 들고 감(적치·격리 이동 중) */
  | 'CARRIED'
  /** 격리 구역에 놓임(폐기 승인 대기) */
  | 'QUARANTINED'
  /** 선반에 적치됨 */
  | 'DONE';

export interface ReturnItem {
  id: string;
  arrivalId: string;
  sku: string;
  qty: number;
  temp: TemperatureZone;
  stage: ReturnStage;
  /** 화면 자리 */
  pos: P;
  receivedBy?: string;
  receiptId?: string;
  taskId?: string;
  /** 일을 맡은 작업자가 있음(두 사람이 같은 걸 집지 않게) */
  claimed?: boolean;
  /** 폐기 판정 사유(화면) */
  disposeReason?: 'TEMPERATURE_ZONE' | 'OPENED' | 'DAMAGED';
  /** 격리 구역 칸 코드(QRT-A/C/F-01) */
  quarantineCode?: string;
}

/** 온도대 → 격리 구역(평면 구역 id)·칸 코드. LAN 칸 코드 QRT-A-01·QRT-C-01·QRT-F-01 [확정](BR-52 회신, deploy/lan/seed/mfc_layout.py) */
export const QUARANTINE_OF: Record<TemperatureZone, { zoneId: 'CQ' | 'BQ' | 'AQ'; code: string }> = {
  AMBIENT: { zoneId: 'CQ', code: 'QRT-A-01' },
  CHILLED: { zoneId: 'BQ', code: 'QRT-C-01' },
  FROZEN: { zoneId: 'AQ', code: 'QRT-F-01' },
};

/** 회수품을 들고 와 회수반입 자리(RTN-A-01, 인계 창 밖)에 내려놓고 가는 MOCK 라이더 */
export class ReturnRider extends Rider {
  constructor(
    id: string,
    parking: P,
    ctx: SiteContext,
    private readonly drop: P,
    private readonly onDropped: () => void,
  ) {
    super(id, [], parking, ctx, () => {});
    this.carrying = 1;
  }

  override async run() {
    const { ctx } = this;
    try {
      this.activity = '회수품 반납하러 MFC 도착';
      await rideTo(this, ctx.layout.points.riderEntry);
      await rideTo(this, this.parking);
      await getOff(this);
      await this.wait(4);
      this.activity = '회수반입 자리로';
      await walkOn(this, this.drop);
      this.activity = '회수품 내려놓기';
      await this.wait(5);
      this.carrying = 0;
      this.onDropped();
      this.activity = '출발';
      await walkOn(this, this.parking);
      await this.wait(3);
      await loadAndGetOn(this);
      await rideTo(this, ctx.layout.points.riderEntry);
      await rideTo(this, offLot(ctx.layout.points.riderEntry));
    } catch (e) {
      this.activity = `반납 실패: ${(e as Error).message}`;
      ctx.log(`${this.id} ${this.activity}`);
    }
    this.done = true;
  }
}

/** 회수반입 자리 위 상자 자리(2 × 3 격자, 반입 전후 같은 자리) */
export function returnSlot(base: P, k: number): P {
  const i = k % 6;
  return { x: base.x - 0.35 + (i % 3) * 0.35, z: base.z - 0.2 + Math.floor(i / 3) * 0.4 };
}

/** 격리 구역 안 상자 자리(구역 사각형 안 격자, 넘치면 겹쳐 쌓임) */
export function quarantineSlot(rect: { x0: number; z0: number; x1: number; z1: number }, k: number): P {
  const cols = Math.max(1, Math.floor((rect.x1 - rect.x0 - 0.2) / 0.4));
  const rows = Math.max(1, Math.floor((rect.z1 - rect.z0 - 0.2) / 0.4));
  const i = k % (cols * rows);
  return { x: rect.x0 + 0.3 + (i % cols) * 0.4, z: rect.z0 + 0.3 + Math.floor(i / cols) * 0.4 };
}
