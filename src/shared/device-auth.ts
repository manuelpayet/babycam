// Authentification des devices par paire de clés (ECDSA P-256 / SHA-256, WebCrypto).
// Chaque appareil génère sa paire à l'appairage ; la clé privée reste sur l'appareil
// (localStorage côté client), la clé publique est déclarée au relais au `join`.
// Le viewer signe chaque `request` : le relais vérifie la signature avant de la
// transmettre à la caméra, ce qui remplace l'ancien deviceId copiable (ré-approbation
// automatique) par une preuve de possession de la clé privée.
// Module pur (pas de DOM, pas de types Cloudflare) : utilisé par le client
// (src/shared/relay.ts), le worker (relay/src/index.ts) et le relais mock E2E.

export interface DeviceAuth {
  pubkey: string;
  ts: number;
  sig: string;
}

// Fenêtre de fraîcheur acceptée pour `ts` (dérive d'horloge entre appareils).
export const AUTH_TS_WINDOW_MS = 120_000;

const AUTH_VERSION = 'v1';

// Payload signé : bind la requête à la caméra visée (`to` = id de socket du relais).
export function authPayload(to: string, ts: number): string {
  return `${AUTH_VERSION}|request|${to}|${ts}`;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_P256_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export async function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDSA_P256, true, ['sign', 'verify']);
}

export async function exportPublicKeyB64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return b64urlEncode(new Uint8Array(raw));
}

export async function exportPrivateKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ECDSA_P256, true, ['sign']);
}

export async function importPublicKeyB64(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64urlDecode(b64), ECDSA_P256, false, ['verify']);
}

// Signe une requête d'accès à la caméra `to` : preuve de possession de la clé privée.
export async function signDeviceAuth(privateKey: CryptoKey, pubkey: string, to: string, ts: number = Date.now()): Promise<DeviceAuth> {
  const sig = await crypto.subtle.sign(ECDSA_P256_SIGN, privateKey, new TextEncoder().encode(authPayload(to, ts)));
  return { pubkey, ts, sig: b64urlEncode(new Uint8Array(sig)) };
}

// Vérifie la signature d'une requête. `now` est injectable pour les tests.
export async function verifyDeviceAuth(pubkeyB64: string, to: string, ts: number, sigB64: string, now: number = Date.now()): Promise<boolean> {
  if (!Number.isFinite(ts) || Math.abs(now - ts) > AUTH_TS_WINDOW_MS) return false;
  let key: CryptoKey;
  let sig: Uint8Array<ArrayBuffer>;
  try {
    key = await importPublicKeyB64(pubkeyB64);
    sig = b64urlDecode(sigB64);
  } catch {
    return false;
  }
  try {
    return await crypto.subtle.verify(ECDSA_P256_SIGN, key, sig, new TextEncoder().encode(authPayload(to, ts)));
  } catch {
    return false;
  }
}
