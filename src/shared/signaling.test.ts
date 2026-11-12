import { describe, expect, it } from 'vitest';
import { decodeRoom, encodeRoom } from './signaling';

describe('signaling (code de salon)', () => {
  it('encode/decode de code de salon', () => {
    const text = encodeRoom('ABC234');
    expect(text).toBe('BCAM1/R/ABC234');
    expect(decodeRoom(text)).toBe('ABC234');
  });

  it('rejette les textes qui ne sont pas un code de salon', () => {
    expect(decodeRoom('BCAM1/R/abc')).toBeNull();
    expect(decodeRoom('BCAM1/R/ABC12')).toBeNull();
    expect(decodeRoom('BCAM1/R/ABC120')).toBeNull();
    expect(decodeRoom('hello')).toBeNull();
    expect(decodeRoom('BCAM1:abcdef')).toBeNull();
  });
});
