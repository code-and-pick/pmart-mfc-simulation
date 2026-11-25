// 시뮬레이션용 SKU 목록. 실제 상품 마스터(product-service)가 아니다.
// SKU 형식만 계약을 따른다: ^[EB]-[0-9]{8}$ (전역 공통 8자리, E=낱개 / B=묶음).
import type { TemperatureZone } from './contract';
import type { Layout, Location } from './layout';
import { Rng } from '../util/rng';
import { ean13CheckDigit } from './barcode';

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
  /** 피킹 칸 진열 한도 = slotCapacity(칸 치수, 상품 치수) — 백엔드 칸 용량 식과 같음 */
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

/**
 * 칸에 이 상품이 몇 개 들어가나 — 백엔드 mfc-inventory UnitSize.capacity 와 같은 식:
 * floor(칸 부피 × fill ÷ 상품 부피), 어느 방향(축 정렬 6가지)으로도 칸보다 크면 0. 칸 하중은 LAN 에 값이 없어 보지 않는다.
 */
export function slotCapacity(cell: { w: number; d: number; h: number }, unitMm: { w: number; d: number; h: number }, fill: number): number {
  const a = [unitMm.w, unitMm.d, unitMm.h].sort((x, y) => x - y);
  const c = [cell.w, cell.d, cell.h].sort((x, y) => x - y);
  if (a[0] > c[0] || a[1] > c[1] || a[2] > c[2]) return 0;
  return Math.floor((cell.w * cell.d * cell.h * fill) / (unitMm.w * unitMm.d * unitMm.h));
}

const mm = (u: { w: number; d: number; h: number }) => ({ w: Math.round(u.w * 1000), d: Math.round(u.d * 1000), h: Math.round(u.h * 1000) });

/**
 * MOCK 상품 목록. 온도대별 count 개를 그 온도대 칸에 무작위로 한 칸씩 둔다(문서에 슬로팅 규칙 없음).
 * 상온은 좁은 칸에 안 들어가는 큰 상품을 H(큰 상품 구역)에 둔다 — 백엔드 LAN 재고 펼침(mfc_spread_stock.py)과 같은 생각.
 */
export function buildCatalog(layout: Layout, count: Record<TemperatureZone, number>, fill: number, seed: number, highTurnoverTop = 0): Sku[] {
  const rng = new Rng(seed);
  const temps: TemperatureZone[] = ['AMBIENT', 'CHILLED', 'FROZEN'];
  const skus: Sku[] = [];
  let serial = 1;
  for (const t of temps) {
    const pool = layout.locationsByTemp[t].filter((l) => !l.closed);
    const n = Math.min(pool.length, count[t]);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const used = new Set<string>();
    /**
     * 들어가는(용량 2 이상) 첫 빈 칸. 상온 큰 상품은 H 먼저.
     * 상온 고회전 구역 F(MFC 2-1 "카테고리 무관 인기 SKU")는 인기 상위 highTurnoverTop 개 상품 몫 — 그 상품은 F 먼저, 나머지는 F 를 피한다
     * (사용자 2026-11-23 "진짜 고회전 상품(주문율 높은 상품 top20)은 거기에 적치"). F 에 안 들어가면 다른 칸
     */
    const isF = (l: Location) => t === 'AMBIENT' && l.code[0] === 'F';
    const pickSlot = (unitMm: { w: number; d: number; h: number }, hot: boolean): Location => {
      const ok = (l: Location) => !used.has(l.code) && slotCapacity(l.dimMm, unitMm, fill) >= 2;
      const found =
        (hot ? pool.find((l) => ok(l) && isF(l)) : undefined) ??
        pool.find((l) => ok(l) && l.code[0] !== 'H' && !isF(l)) ??
        pool.find((l) => ok(l) && !isF(l)) ??
        pool.find(ok) ??
        pool.find((l) => !used.has(l.code))!;
      used.add(found.code);
      return found;
    };
    const reserves = layout.reserveRackSpots.filter((r) => r.temp === t); // 보충재고 = 보충재고 랙(입고재고 팔레트는 아님)
    // 먼저 상품(인기 가중치 포함)을 만들고, 인기 순으로 칸을 고른다 — 상위 highTurnoverTop 개 상온 상품이 F 를 먼저 갖는다
    const made: { base: string; isB: boolean; code: string; sn: number; weightG: number; unit: { w: number; d: number; h: number }; weight: number; i: number }[] = [];
    for (let i = 0; i < n; i++) {
      const [base, w] = rng.pick(NAMES[t]);
      const isB = rng.next() < 0.12;
      const code = `${isB ? 'B' : 'E'}-${String(serial).padStart(8, '0')}`;
      const sn = serial;
      serial += 1;
      const weightG = isB ? w * 4 : w;
      made.push({ base, isB, code, sn, weightG, unit: unitOf(weightG), weight: 1 / Math.pow(rng.int(1, Math.max(1, n)), 0.9), i });
    }
    const hot = new Set(t === 'AMBIENT' ? [...made].sort((a, b) => b.weight - a.weight || a.i - b.i).slice(0, highTurnoverTop).map((m) => m.i) : []);
    const locOf = new Map<number, Location>();
    for (const m of [...made].sort((a, b) => Number(hot.has(b.i)) - Number(hot.has(a.i)) || a.i - b.i)) locOf.set(m.i, pickSlot(mm(m.unit), hot.has(m.i)));
    for (const { base, isB, code, sn, weightG, unit, weight, i } of made) {
      const loc = locOf.get(i)!;
      const shelfCap = Math.max(1, slotCapacity(loc.dimMm, mm(unit), fill));
      skus.push({
        sku: code,
        name: `${base}${isB ? ' 묶음' : ''} #${i + 1}`,
        temp: t,
        // 상품마다 다른 EAN-13(880 + 9자리 + 검사 숫자) — 예전엔 온도대 끝 serial 을 써서 같은 온도대가 다 같은 12자리였다(2026-11-25 말풍선 캡처로 발견)
        barcode: ((b) => `${b}${ean13CheckDigit(b)}`)(`880${String((sn * 7919) % 1_000_000_000).padStart(9, '0')}`),
        weightG,
        location: loc,
        reserveId: reserves[i % reserves.length].id,
        weight,
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
