import { describe, expect, it } from 'vitest';
import {
  AUTH_TS_WINDOW_MS,
  authPayload,
  b64urlDecode,
  b64urlEncode,
  exportPrivateKeyJwk,
  exportPublicKeyB64,
  generateDeviceKeyPair,
  importPrivateKeyJwk,
  signDeviceAuth,
  verifyDeviceAuth,
} from './device-auth';

describe('device-auth', () => {
  it('b64url : round-trip sur des octets quelconques', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    expect(b64urlDecode(b64urlEncode(bytes))).toEqual(bytes);
    expect(b64urlEncode(bytes)).not.toMatch(/[+/=]/);
  });

  it('génère une paire ECDSA P-256 dont la clé privée survit à un round-trip JWK', async () => {
    const pair = await generateDeviceKeyPair();
    const pubkey = await exportPublicKeyB64(pair.publicKey);
    const jwk = await exportPrivateKeyJwk(pair.privateKey);
    const reimported = await importPrivateKeyJwk(jwk);
    const auth = await signDeviceAuth(reimported, pubkey, 'cam-1');
    expect(await verifyDeviceAuth(pubkey, 'cam-1', auth.ts, auth.sig)).toBe(true);
  });

  it('signe et vérifie une requête (preuve de possession de la clé privée)', async () => {
    const pair = await generateDeviceKeyPair();
    const pubkey = await exportPublicKeyB64(pair.publicKey);
    const auth = await signDeviceAuth(pair.privateKey, pubkey, 'cam-123');
    expect(auth.pubkey).toBe(pubkey);
    expect(await verifyDeviceAuth(pubkey, 'cam-123', auth.ts, auth.sig)).toBe(true);
  });

  it('rejette une signature présentée pour une autre caméra (`to` bindé)', async () => {
    const pair = await generateDeviceKeyPair();
    const pubkey = await exportPublicKeyB64(pair.publicKey);
    const auth = await signDeviceAuth(pair.privateKey, pubkey, 'cam-123');
    expect(await verifyDeviceAuth(pubkey, 'cam-999', auth.ts, auth.sig)).toBe(false);
  });

  it('rejette un ts hors fenêtre de fraîcheur (anti-rejeu)', async () => {
    const pair = await generateDeviceKeyPair();
    const pubkey = await exportPublicKeyB64(pair.publicKey);
    const now = Date.now();
    const auth = await signDeviceAuth(pair.privateKey, pubkey, 'cam-123', now - AUTH_TS_WINDOW_MS - 1);
    expect(await verifyDeviceAuth(pubkey, 'cam-123', auth.ts, auth.sig, now)).toBe(false);
    // dans la fenêtre : accepté
    const fresh = await signDeviceAuth(pair.privateKey, pubkey, 'cam-123', now - AUTH_TS_WINDOW_MS + 1000);
    expect(await verifyDeviceAuth(pubkey, 'cam-123', fresh.ts, fresh.sig, now)).toBe(true);
  });

  it('rejette une signature vérifiée avec une autre clé publique', async () => {
    const pair = await generateDeviceKeyPair();
    const other = await generateDeviceKeyPair();
    const otherPubkey = await exportPublicKeyB64(other.publicKey);
    const pubkey = await exportPublicKeyB64(pair.publicKey);
    const auth = await signDeviceAuth(pair.privateKey, pubkey, 'cam-123');
    expect(await verifyDeviceAuth(otherPubkey, 'cam-123', auth.ts, auth.sig)).toBe(false);
  });

  it('rejette une signature ou un ts falsifié, et un payload malformé', async () => {
    const pair = await generateDeviceKeyPair();
    const pubkey = await exportPublicKeyB64(pair.publicKey);
    const auth = await signDeviceAuth(pair.privateKey, pubkey, 'cam-123');
    const tampered = { ...auth, sig: auth.sig.slice(0, -2) + (auth.sig.endsWith('aa') ? 'bb' : 'aa') };
    expect(await verifyDeviceAuth(pubkey, 'cam-123', tampered.ts, tampered.sig)).toBe(false);
    expect(await verifyDeviceAuth(pubkey, 'cam-123', Number.NaN, auth.sig)).toBe(false);
    expect(await verifyDeviceAuth('!!!pas-une-cle!!!', 'cam-123', auth.ts, auth.sig)).toBe(false);
    expect(authPayload('cam-123', 42)).toBe('v1|request|cam-123|42');
  });
});
