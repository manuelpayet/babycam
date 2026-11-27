import { describe, expect, it } from 'vitest';
import { decodeRoom, decryptSignal, deriveRoomKey, encodeRoom, encryptSignal, E2EE_PAYLOAD_PREFIX, E2EE_VERSION, relayRoomId, type SignalMessage } from './signaling';

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

describe('signaling (E2EE de la signalisation)', () => {
  it('deriveRoomKey : même salon → même clé (roundtrip inter-clés)', async () => {
    const k1 = await deriveRoomKey('ABC234');
    const k2 = await deriveRoomKey('ABC234');
    const msg: SignalMessage = { v: 1, t: 'offer', sdp: 'v=0\r\no=- 123\r\n' };
    const ct = await encryptSignal(k1, msg);
    await expect(decryptSignal(k2, ct)).resolves.toEqual(msg);
  });

  it('un autre salon ne déchiffre pas le payload', async () => {
    const keyA = await deriveRoomKey('ABC234');
    const keyB = await deriveRoomKey('XYZ999');
    const ct = await encryptSignal(keyA, { v: 1, t: 'offer', sdp: 'secret-sdp' });
    await expect(decryptSignal(keyB, ct)).rejects.toThrow();
  });

  it('le payload chiffré porte le préfixe, ne contient pas le clair, et change à chaque envoi (IV aléatoire)', async () => {
    const key = await deriveRoomKey('ABC234');
    const msg: SignalMessage = { v: 1, t: 'offer', sdp: 'v=0\r\no=- SDP_SECRET\r\n' };
    const ct = await encryptSignal(key, msg);
    expect(ct.startsWith(E2EE_PAYLOAD_PREFIX)).toBe(true);
    expect(ct).not.toContain('SDP_SECRET');
    expect(ct).not.toContain('v=0');
    const ct2 = await encryptSignal(key, msg);
    expect(ct2).not.toBe(ct);
    await expect(decryptSignal(key, ct)).resolves.toEqual(msg);
  });

  it('payload altéré ou sans préfixe → rejeté (authentification GCM)', async () => {
    const key = await deriveRoomKey('ABC234');
    const ct = await encryptSignal(key, { v: 1, t: 'candidate', candidate: { candidate: 'candidate:1 …' } });
    const body = ct.slice(E2EE_PAYLOAD_PREFIX.length);
    const tampered = E2EE_PAYLOAD_PREFIX + (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
    await expect(decryptSignal(key, tampered)).rejects.toThrow();
    await expect(decryptSignal(key, 'BCAM1/R/ABC234')).rejects.toThrow();
    await expect(decryptSignal(key, E2EE_PAYLOAD_PREFIX + '!!!')).rejects.toThrow();
  });

  it('versionne le format : une enveloppe de version inconnue (E2) est rejetée', async () => {
    const key = await deriveRoomKey('ABC234');
    const ct = await encryptSignal(key, { v: 1, t: 'offer', sdp: 'x' });
    expect(ct.startsWith(`BCAM1/E${E2EE_VERSION}/`)).toBe(true);
    const future = ct.replace(E2EE_PAYLOAD_PREFIX, 'BCAM1/E2/');
    await expect(decryptSignal(key, future)).rejects.toThrow(/version/);
  });

  it('relayRoomId : hash hex déterministe de 64 caractères, sans le code en clair', async () => {
    const id = await relayRoomId('ABC234');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain('ABC234');
    expect(await relayRoomId('ABC234')).toBe(id);
    expect(await relayRoomId('ABC235')).not.toBe(id);
  });
});
