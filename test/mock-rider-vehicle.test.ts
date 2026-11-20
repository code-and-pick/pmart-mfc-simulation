import { describe, expect, it } from 'vitest';
import { pickVehicle } from '../src/sim/rider';
import { RIDER_VEHICLE } from '../src/config';

describe('MOCK 라이더 수단 섞기', () => {
  it('비율 합이 1 이고 누적 구간대로 뽑는다', () => {
    const sum = Object.values(RIDER_VEHICLE.mockMix).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(pickVehicle(0)).toBe('MOTORCYCLE');
    expect(pickVehicle(0.65)).toBe('CAR');
    expect(pickVehicle(0.999)).toBe('WALK');
  });

  it('고르게 뽑으면 여섯 수단이 다 나온다', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(pickVehicle(i / 100));
    expect(seen.size).toBe(6);
  });
});
