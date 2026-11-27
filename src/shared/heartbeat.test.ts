import { describe, expect, it } from 'vitest';
import { heartbeatAgeMs, isHeartbeatStale, offlineSeconds } from './heartbeat';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from './webrtc';

describe('heartbeat — logique de staleness', () => {
  it('les constantes respectent le briefing (ping 2s, staleness 5s)', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(2_000);
    expect(HEARTBEAT_TIMEOUT_MS).toBe(5_000);
  });

  it('age null si aucun ping reçu', () => {
    expect(heartbeatAgeMs(null, 1_000)).toBeNull();
  });

  it('age = now - dernier ping reçu', () => {
    expect(heartbeatAgeMs(1_000, 4_500)).toBe(3_500);
  });

  it('stale uniquement au-delà de HEARTBEAT_TIMEOUT_MS', () => {
    const t0 = 10_000;
    expect(isHeartbeatStale(t0, t0)).toBe(false);
    expect(isHeartbeatStale(t0, t0 + HEARTBEAT_TIMEOUT_MS)).toBe(false);
    expect(isHeartbeatStale(t0, t0 + HEARTBEAT_TIMEOUT_MS + 1)).toBe(true);
    expect(isHeartbeatStale(t0, t0 + 60_000)).toBe(true);
  });

  it('jamais stale si aucun ping reçu (attente du premier ping)', () => {
    expect(isHeartbeatStale(null, Date.now() + 999_999)).toBe(false);
  });

  it('timeout paramétrable', () => {
    expect(isHeartbeatStale(0, 1_500, 1_000)).toBe(true);
    expect(isHeartbeatStale(0, 500, 1_000)).toBe(false);
  });

  it('offlineSeconds arrondit à la seconde avec un minimum de 1', () => {
    expect(offlineSeconds(0)).toBe(1);
    expect(offlineSeconds(499)).toBe(1);
    expect(offlineSeconds(500)).toBe(1);
    expect(offlineSeconds(5_200)).toBe(5);
    expect(offlineSeconds(5_600)).toBe(6);
  });
});
