import { describe, expect, it } from 'vitest';
import { dbfsToPercent } from './volmeter';

describe('dbfsToPercent', () => {
  it('mappe -60..0 dBFS sur 0..100 %', () => {
    expect(dbfsToPercent(-60)).toBe(0);
    expect(dbfsToPercent(0)).toBe(100);
    expect(dbfsToPercent(-30)).toBe(50);
  });

  it('borne les valeurs hors plage et le silence (-Infinity)', () => {
    expect(dbfsToPercent(-120)).toBe(0);
    expect(dbfsToPercent(10)).toBe(100);
    expect(dbfsToPercent(-Infinity)).toBe(0);
    expect(dbfsToPercent(Number.NaN)).toBe(0);
  });
});
