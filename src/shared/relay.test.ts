import { describe, expect, it } from 'vitest';
import { newRoomCode } from './relay';

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
});
