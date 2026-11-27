import { HEARTBEAT_TIMEOUT_MS } from './webrtc';

// Logique de staleness du heartbeat applicatif (pure, testable hors navigateur) :
// la caméra envoie { type: 'ping', ts } sur le DataChannel, le viewer track le
// dernier ping reçu et déclare la caméra hors ligne au-delà de HEARTBEAT_TIMEOUT_MS.

export function heartbeatAgeMs(lastHeartbeatAt: number | null, now: number): number | null {
  return lastHeartbeatAt === null ? null : now - lastHeartbeatAt;
}

export function isHeartbeatStale(
  lastHeartbeatAt: number | null,
  now: number,
  timeoutMs: number = HEARTBEAT_TIMEOUT_MS,
): boolean {
  const age = heartbeatAgeMs(lastHeartbeatAt, now);
  return age !== null && age > timeoutMs;
}

export function offlineSeconds(elapsedMs: number): number {
  return Math.max(1, Math.round(elapsedMs / 1000));
}
