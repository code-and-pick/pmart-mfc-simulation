// 시뮬레이션용 SKU 목록. 실제 상품 마스터(product-service)가 아니다.
// SKU 형식만 계약을 따른다: ^[EB]-[0-9]{8}$ (전역 공통 8자리, E=낱개 / B=묶음).
import type { TemperatureZone } from './contract';
import type { Layout, Location } from './layout';
import { Rng } from '../util/rng';

export interface Sku {
  sku: string;
  name: string;
  temp: TemperatureZone;
  barcode: string;
  weightG: number;
  /** 피킹 위치 (MFC 피킹 전면 1곳) */
  location: Location;
  /** 보충재고 팔레트 자리 */
  reserveId: string;
  /** 판매 인기 가중치 */
  weight: number;
  containsAlcohol: boolean;
  /** 낱개 외형(m) — 선반 칸에 몇 개 들어가는지 계산 */
  unit: { w: number; d: number; h: number };
  /** 피킹 칸 진열 한도 (칸 치수 ÷ 상품 치수) [시뮬] */
  shelfCap: number;
  /** 자동 보충 기준 C ≤ min (IV-04 의 min) [시뮬] */
  minQty: number;
  /** 입고 박스 입수 [가정 12유닛/박스 → 시뮬은 상품 크기별] */
  caseQty: number;
}

const NAMES: Record<TemperatureZone, [string, number][]> = {
  FROZEN: [
    ['아이스크림 바', 90],
    ['냉동 만두 1kg', 1000],
    ['냉동 볶음밥 300g', 300],
    ['냉동 새우 500g', 500],
    ['냉동 피자', 420],
    ['냉동 돈가스', 450],
    ['얼음컵', 160],
    ['냉동 블루베리', 400],
  ],
  CHILLED: [
    ['우유 900ml', 950],
    ['그릭요거트', 400],
    ['두부 300g', 310],
    ['계란 10구', 600],
    ['양파 1.5kg', 1500],
    ['청양고추 100g', 100],
    ['삼겹살 500g', 500],
    ['샐러드 팩', 180],
    ['김밥', 230],
    ['슬라이스 치즈', 270],
  ],
  AMBIENT: [
    ['봉지라면 5입', 600],
    ['생수 2L', 2050],
    ['콜라 500ml', 540],
    ['감자칩', 120],
    ['참치캔', 150],
    ['즉석밥 3입', 630],
    ['물티슈', 400],
    ['화장지 30롤', 3600],
    ['간장 500ml', 580],
    ['커피믹스 20입', 240],
    ['세제 리필', 1300],
    ['맥주 500ml', 540],
  ],
};

/** 무게로 대략의 외형을 정한다 (MFC 9-2 시험 치수 참고). */
function unitOf(weightG: number): { w: number; d: number; h: number } {
  if (weightG < 200) return { w: 0.06, d: 0.06, h: 0.11 };
  if (weightG < 700) return { w: 0.085, d: 0.07, h: 0.15 };
  if (weightG < 1600) return { w: 0.11, d: 0.09, h: 0.19 };
  return { w: 0.14, d: 0.13, h: 0.24 };
}

export const MAX_SHELF_CAP = 16;

export function buildCatalog(layout: Layout, fillRate: number, seed: number): Sku[] {
  const rng = new Rng(seed);
  const temps: TemperatureZone[] = ['AMBIENT', 'CHILLED', 'FROZEN'];
  const skus: Sku[] = [];
  let serial = 1;
  for (const t of temps) {
    const pool = [...layout.locationsByTemp[t]];
    const n = Math.floor(pool.length * fillRate);
    // 칸 배정은 무작위 (문서에 슬로팅 규칙 없음)
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const reserves = layout.reserves.filter((r) => r.temp === t);
    for (let i = 0; i < n; i++) {
      const [base, w] = rng.pick(NAMES[t]);
      const isB = rng.next() < 0.12;
      const code = `${isB ? 'B' : 'E'}-${String(serial).padStart(8, '0')}`;
      serial += 1;
      const weightG = isB ? w * 4 : w;
      const unit = unitOf(weightG);
      const loc = pool[i];
      const cols = Math.max(1, Math.floor(loc.slotW / (unit.w + 0.012)));
      const rows = Math.max(1, Math.floor(0.4 / (unit.d + 0.012)));
      const layers = Math.max(1, Math.min(2, Math.floor((loc.levelH - 0.05) / (unit.h + 0.01))));
      const shelfCap = Math.max(2, Math.min(MAX_SHELF_CAP, cols * rows * layers));
      skus.push({
        sku: code,
        name: `${base}${isB ? ' 묶음' : ''} #${i + 1}`,
        temp: t,
        barcode: `880${String(10_000_000 + serial * 7919).slice(-9)}${serial % 10}`,
        weightG,
        location: loc,
        reserveId: reserves[i % reserves.length].id,
        weight: 1 / Math.pow(rng.int(1, n), 0.9),
        containsAlcohol: base.startsWith('맥주'),
        unit,
        shelfCap,
        minQty: Math.max(1, Math.floor(shelfCap * 0.3)),
        caseQty: weightG < 700 ? 12 : weightG < 1600 ? 6 : 4,
      });
    }
  }
  return skus;
}
