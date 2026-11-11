import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RELAY_URL, backoffDelayMs, newRoomCode, relayUrlFromLocation } from './relay';

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

describe('relayUrlFromLocation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('DEFAULT_RELAY_URL pointe vers le worker déployé (wss)', () => {
    expect(DEFAULT_RELAY_URL).toMatch(/^wss:\/\/babycam-relay\.[a-z0-9-]+\.workers\.dev$/);
  });

  it('?relay=<url> est prioritaire sur le défaut', () => {
    vi.stubGlobal('location', { search: '?relay=wss%3A%2F%2F127.0.0.1%3A8787' });
    expect(relayUrlFromLocation()).toBe('wss://127.0.0.1:8787');
  });

  it('?relay=0 désactive le relais (tests E2E hors ligne)', () => {
    vi.stubGlobal('location', { search: '?relay=0' });
    expect(relayUrlFromLocation()).toBeNull();
  });

  it('sans paramètre, retombe sur DEFAULT_RELAY_URL', () => {
    vi.stubGlobal('location', { search: '' });
    expect(relayUrlFromLocation()).toBe(DEFAULT_RELAY_URL);
  });
});
