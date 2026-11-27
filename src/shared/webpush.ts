// Web Push côté « application server » (RFC 8030 / 8291 / 8292), 100 % WebCrypto :
// - chiffrement du payload en aes128gcm (RFC 8188 + 8291 §3.4)
// - en-tête d'autorisation VAPID en JWT ES256 (RFC 8292)
// Ce module est partagé avec le relais Cloudflare (relay/src/index.ts l'importe :
// wrangler bundle les imports relatifs) et couvert par les tests vitest racine
// (vecteur de test RFC 8291 appendice A dans webpush.test.ts).

export interface WebPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface WebPushSubscriptionJSON {
  endpoint: string;
  keys: WebPushSubscriptionKeys;
}

const te = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function uint32be(n: number): Uint8Array {
  return Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

async function hmacSha256(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// Préfixe PKCS#8 d'une clé privée EC P-256 (algorithme ecPublicKey + prime256v1,
// ECPrivateKey version 1 + OCTET STRING de 32 octets) : on ajoute le scalaire brut.
const PKCS8_P256_PREFIX = Uint8Array.from([
  0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
]);

export async function importP256PrivateKey(
  d: Uint8Array<ArrayBuffer>,
  usages: KeyUsage[],
  alg: 'ECDH' | 'ECDSA',
): Promise<CryptoKey> {
  if (d.length !== 32) throw new Error('clé privée P-256 invalide (32 octets attendus)');
  const der = concat(PKCS8_P256_PREFIX, d);
  return crypto.subtle.importKey('pkcs8', der, { name: alg, namedCurve: 'P-256' }, false, usages);
}

export interface EncryptResult {
  body: Uint8Array<ArrayBuffer>;
  asPublic: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}

// Chiffre `payload` pour la subscription `sub` en aes128gcm (RFC 8291 §3.4).
// `opts.salt` / `opts.asPrivate` / `opts.asPublicRaw` existent pour les tests à vecteur
// connu (RFC 8291 appendice A) ; sans options, une paire ECDH éphémère est générée.
export async function encryptPushPayload(
  payload: string,
  sub: WebPushSubscriptionJSON,
  opts: { salt?: Uint8Array<ArrayBuffer>; asPrivate?: CryptoKey; asPublicRaw?: Uint8Array<ArrayBuffer> } = {},
): Promise<EncryptResult> {
  const uaPublic = base64UrlDecode(sub.keys.p256dh);
  const authSecret = base64UrlDecode(sub.keys.auth);
  const salt: Uint8Array<ArrayBuffer> = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  let asPrivate = opts.asPrivate;
  let asPublic = opts.asPublicRaw;
  if (!asPrivate || !asPublic) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }

  // ecdh_secret = ECDH(as_private, ua_public)
  const uaPubKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, asPrivate, 256));

  // PRK_key = HKDF-Extract(salt=auth_secret, IKM=ecdh_secret)
  // IKM     = HKDF-Expand(PRK_key, key_info, 32) avec key_info = "WebPush: info" || 0x00 || ua_public || as_public
  const prkKey = await hmacSha256(authSecret, ecdh);
  const keyInfo = concat(te.encode('WebPush: info'), Uint8Array.from([0]), uaPublic, asPublic);
  const ikm = await hmacSha256(prkKey, concat(keyInfo, Uint8Array.from([1])));

  // PRK   = HKDF-Extract(salt, IKM)
  // CEK   = HKDF-Expand(PRK, "Content-Encoding: aes128gcm" || 0x00, 16)
  // NONCE = HKDF-Expand(PRK, "Content-Encoding: nonce" || 0x00, 12)
  const prk = await hmacSha256(salt, ikm);
  const cekInfo = concat(te.encode('Content-Encoding: aes128gcm'), Uint8Array.from([0]));
  const cek = (await hmacSha256(prk, concat(cekInfo, Uint8Array.from([1])))).slice(0, 16);
  const nonceInfo = concat(te.encode('Content-Encoding: nonce'), Uint8Array.from([0]));
  const nonce = (await hmacSha256(prk, concat(nonceInfo, Uint8Array.from([1])))).slice(0, 12);

  // Record aes128gcm (RFC 8188) : header = salt(16) || rs(4, BE) || keyid_len(1) || as_public(65)
  // plaintext = payload || 0x02 (délimiteur de padding), chiffré en AES-128-GCM (tag 16 octets en sortie).
  const header = concat(salt, uint32be(4096), Uint8Array.from([asPublic.length]), asPublic);
  const plaintext = concat(te.encode(payload), Uint8Array.from([2]));
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plaintext));
  return { body: concat(header, cipher), asPublic, salt };
}

// Convertit une signature ECDSA WebCrypto en brut R||S (64 octets, format JWS) :
// Node/Workers renvoient déjà le brut, certains environnements renvoient du DER ASN.1.
export function ecdsaSignatureToRaw(sig: Uint8Array): Uint8Array {
  if (sig.length === 64) return sig;
  function readInt(offset: number): { val: Uint8Array; next: number } {
    if (sig[offset] !== 0x02) throw new Error('DER invalide');
    let len = sig[offset + 1];
    let hdr = 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | sig[offset + 2 + i];
      hdr = 2 + n;
    }
    let start = offset + hdr;
    const end = start + len;
    while (start < end - 1 && sig[start] === 0) start++; // retire le zéro de signe
    return { val: sig.slice(start, end), next: end };
  }
  if (sig[0] !== 0x30) throw new Error('DER invalide');
  const r = readInt(2);
  const s = readInt(r.next);
  const out = new Uint8Array(64);
  out.set(r.val, 32 - r.val.length);
  out.set(s.val, 64 - s.val.length);
  return out;
}

export interface VapidOptions {
  endpoint: string;
  subject: string;
  privateKeyB64url: string;
  publicKeyB64url: string;
  nowSec?: number;
}

// En-tête `Authorization: vapid t=<JWT ES256>, k=<clé publique>` (RFC 8292).
export async function vapidAuthorizationHeader(opts: VapidOptions): Promise<string> {
  const aud = new URL(opts.endpoint).origin;
  const exp = (opts.nowSec ?? Math.floor(Date.now() / 1000)) + 12 * 3600;
  const header = base64UrlEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64UrlEncode(te.encode(JSON.stringify({ aud, exp, sub: opts.subject })));
  const key = await importP256PrivateKey(base64UrlDecode(opts.privateKeyB64url), ['sign'], 'ECDSA');
  const sigDer = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${header}.${payload}`)),
  );
  const jwt = `${header}.${payload}.${base64UrlEncode(ecdsaSignatureToRaw(sigDer))}`;
  return `vapid t=${jwt}, k=${opts.publicKeyB64url}`;
}

export interface SendPushResult {
  status: number;
  ok: boolean;
  gone: boolean;
}

// Envoie un push Web Push chiffré vers l'endpoint de la subscription.
export async function sendWebPush(
  sub: WebPushSubscriptionJSON,
  payload: string,
  vapid: { subject: string; privateKeyB64url: string; publicKeyB64url: string },
): Promise<SendPushResult> {
  const { body } = await encryptPushPayload(payload, sub);
  const authorization = await vapidAuthorizationHeader({ endpoint: sub.endpoint, ...vapid });
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Authorization: authorization,
    },
    body,
  });
  return { status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410 };
}
