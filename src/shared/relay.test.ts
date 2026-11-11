import { describe, expect, it } from 'vitest';
import { backoffDelayMs, newRoomCode } from './relay';

describe('relay', () => {
  it('newRoomCode : 6 caractères dans l’alphabet sans ambiguïté', () => {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 50; i++) {
      const code = newRoomCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(alphabet).toContain(ch);
    }
  });

  it('newRoomCode : codes différents à chaque appel', () => {
    const codes = new Set(Array.from({ length: 100 }, () => newRoomCode()));
    expect(codes.size).toBeGreaterThan(90);
  });

  it('backoffDelayMs : exponentiel, plafonné à 30s', () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(10)).toBe(30_000);
    expect(backoffDelayMs(100)).toBe(30_000);
    expect(backoffDelayMs(-3)).toBe(1000);
  });
});
