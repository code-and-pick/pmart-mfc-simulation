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
  /** 판매 인기 가중치 */
  weight: number;
  containsAlcohol: boolean;
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

export function buildCatalog(layout: Layout, count: number, mix: Record<TemperatureZone, number>, seed: number): Sku[] {
  const rng = new Rng(seed);
  const temps: TemperatureZone[] = ['AMBIENT', 'CHILLED', 'FROZEN'];
  const total = mix.AMBIENT + mix.CHILLED + mix.FROZEN;
  const skus: Sku[] = [];
  let serial = 1;
  for (const t of temps) {
    const n = Math.round((count * mix[t]) / total);
    // 낮은 단(허리 높이)부터, 인기 상품을 문 가까운 곳에 두지는 않는다(문서에 슬로팅 규칙 없음)
    const pool = [...layout.locationsByTemp[t]];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < n && i < pool.length; i++) {
      const [base, w] = rng.pick(NAMES[t]);
      const isB = rng.next() < 0.12;
      const code = `${isB ? 'B' : 'E'}-${String(serial).padStart(8, '0')}`;
      serial += 1;
      skus.push({
        sku: code,
        name: `${base}${isB ? ' 묶음' : ''} #${i + 1}`,
        temp: t,
        barcode: `880${String(10_000_000 + serial * 7919).slice(-9)}${serial % 10}`,
        weightG: isB ? w * 4 : w,
        location: pool[i],
        weight: 1 / Math.pow(rng.int(1, n), 0.9),
        containsAlcohol: base.startsWith('맥주'),
      });
    }
  }
  return skus;
}
