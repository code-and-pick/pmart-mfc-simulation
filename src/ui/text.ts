import type { TemperatureZone } from '../domain/contract';
import type { InboundState } from '../sim/inbound';
import type { WorkerState } from '../sim/worker';

export const STATE_KO: Record<WorkerState, string> = {
  IDLE: '대기',
  TO_CART: '장바구니',
  PICKING: '피킹',
  WAIT_STATION: '패킹대 대기',
  PACKING: '패킹',
  TO_SHIP: '출하대기 이동',
  RETURNING: '복귀',
  ERROR: '오류',
};

export const INBOUND_KO: Record<InboundState, string> = {
  IDLE: '대기',
  RECEIVING: '하차·검수',
  PUTAWAY: '적치',
  REPLENISH: '보충(MOV)',
  RETURN_ITEM: '회수품',
  RETURNING: '복귀',
  ERROR: '오류',
};

export const TEMP_KO: Record<TemperatureZone, string> = { AMBIENT: '상온', CHILLED: '냉장', FROZEN: '냉동' };
