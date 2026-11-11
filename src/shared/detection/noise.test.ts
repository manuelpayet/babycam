import { describe, expect, it } from 'vitest';
import { rmsToDbfs, thresholdToDbfs } from './noise';

describe('noise', () => {
  it('rmsToDbfs : silence → -Infinity', () => {
    const silence = new Uint8Array(2048).fill(128);
    expect(rmsToDbfs(silence)).toBe(-Infinity);
  });

  it('rmsToDbfs : pleine échelle → ~0 dBFS', () => {
    const full = new Uint8Array(2048);
    for (let i = 0; i < full.length; i++) full[i] = i % 2 === 0 ? 255 : 0;
    expect(rmsToDbfs(full)).toBeGreaterThan(-1);
    expect(rmsToDbfs(full)).toBeLessThan(0);
  });

  it('rmsToDbfs : signal faible < -40 dBFS', () => {
    const quiet = new Uint8Array(2048).fill(128);
    quiet[0] = 128 + 4;
    const dbfs = rmsToDbfs(quiet);
    expect(dbfs).toBeLessThan(-40);
    expect(dbfs).toBeGreaterThan(-Infinity);
  });

  it('thresholdToDbfs : 0 → -60, 100 → 0, 50 → -30', () => {
    expect(thresholdToDbfs(0)).toBe(-60);
    expect(thresholdToDbfs(100)).toBe(0);
    expect(thresholdToDbfs(50)).toBe(-30);
  });
});
