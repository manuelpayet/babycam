import { describe, expect, it } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  ecdsaSignatureToRaw,
  encryptPushPayload,
  importP256PrivateKey,
  vapidAuthorizationHeader,
} from './webpush';

// Vecteur de test RFC 8291 §5 + appendice A (espaces des base64url du RFC retirés).
const RFC = {
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  // corps complet de la §5 (header 86 octets + ciphertext 58 octets = 144 octets)
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  // plaintext de la §5, en base64url tel que publié par le RFC (42 octets)
  plaintextB64: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
};

// Paire VAPID DE TEST UNIQUEMENT (générée pour les tests, sans aucun rapport avec la paire
// de production : la clé privée de prod n'est jamais dans le code, c'est un secret wrangler).
const VAPID_PUBLIC = 'BLAcehEbYz6w1CVGT8o652fIcC2Zbp0NvTx8l9xxm5j_h6s9JCD0PJTIFyU4S6XHOUXgIt40p32HEqqS1qLw5jo';
const VAPID_PRIVATE = 'jhN7FQP-BeKBMe1xTsGmURt48aCGGslSWJkR92xArZY';

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('base64url', () => {
  it('encode/décode aller-retour', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(65));
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it('décode le vecteur RFC (point P-256 non compressé = 65 octets)', () => {
    const pub = base64UrlDecode(RFC.uaPublic);
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(0x04);
    expect(base64UrlEncode(pub)).toBe(RFC.uaPublic);
  });
});

describe('encryptPushPayload (aes128gcm, RFC 8291)', () => {
  it('reproduit exactement le vecteur de test RFC 8291 appendice A', async () => {
    const asPrivate = await importP256PrivateKey(base64UrlDecode(RFC.asPrivate), ['deriveBits'], 'ECDH');
    const { body, asPublic, salt } = await encryptPushPayload(
      new TextDecoder().decode(base64UrlDecode(RFC.plaintextB64)),
      { endpoint: 'https://push.example.com/sub/1', keys: { p256dh: RFC.uaPublic, auth: RFC.authSecret } },
      { salt: base64UrlDecode(RFC.salt), asPrivate, asPublicRaw: base64UrlDecode(RFC.asPublic) },
    );
    expect(base64UrlEncode(salt)).toBe(RFC.salt);
    expect(base64UrlEncode(asPublic)).toBe(RFC.asPublic);
    expect(body.slice(0, 86)).toEqual(base64UrlDecode(RFC.header));
    expect(body).toHaveLength(144);
    expect(base64UrlEncode(body)).toBe(RFC.body);
  });

  it('chiffre un payload quelconque en un record aes128gcm bien formé', async () => {
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const p256dh = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
    const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const payload = '{"v":1,"kind":"noise","level":-18,"ts":42}';
    const { body } = await encryptPushPayload(payload, { endpoint: 'https://push.example.com/sub/2', keys: { p256dh, auth } });
    // header 86 octets + payload + délimiteur 0x02 + tag GCM 16 octets
    expect(body).toHaveLength(86 + payload.length + 1 + 16);
    expect(body[16 + 4]).toBe(65); // keyid_len
    expect(body[16 + 5]).toBe(0x04); // point non compressé
  });
});

describe('ecdsaSignatureToRaw', () => {
  it('laisse passer une signature déjà en brut R||S (64 octets)', () => {
    const raw = crypto.getRandomValues(new Uint8Array(64));
    expect(ecdsaSignatureToRaw(raw)).toBe(raw);
  });

  it('convertit une signature DER en R||S (64 octets), zéro de signe retiré', () => {
    const r = new Uint8Array(32).fill(0x11);
    const s = concat(new Uint8Array([0x00]), new Uint8Array(32).fill(0x22));
    const body = concat(Uint8Array.from([0x02, 32]), r, Uint8Array.from([0x02, 33]), s);
    const sig = concat(Uint8Array.from([0x30, body.length]), body);
    const raw = ecdsaSignatureToRaw(sig);
    expect(raw).toHaveLength(64);
    expect(raw.slice(0, 32)).toEqual(new Uint8Array(32).fill(0x11));
    expect(raw.slice(32)).toEqual(new Uint8Array(32).fill(0x22));
  });
});

// Reconversion brut R||S → DER pour vérification WebCrypto (tests seulement).
function rawToDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  function int(b: Uint8Array): Uint8Array<ArrayBuffer> {
    let start = 0;
    while (start < b.length - 1 && b[start] === 0) start++;
    let v = b.slice(start);
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(Uint8Array.from([0x02, v.length]), v);
  }
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(Uint8Array.from([0x30, body.length]), body);
}

describe('vapidAuthorizationHeader (RFC 8292)', () => {
  it('produit un JWT ES256 signé vérifiable avec la clé publique, aud = origine du push service', async () => {
    const nowSec = 1_800_000_000;
    const header = await vapidAuthorizationHeader({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      subject: 'mailto:test@example.com',
      privateKeyB64url: VAPID_PRIVATE,
      publicKeyB64url: VAPID_PUBLIC,
      nowSec,
    });
    expect(header.startsWith('vapid t=')).toBe(true);
    expect(header.endsWith(`, k=${VAPID_PUBLIC}`)).toBe(true);
    const jwt = header.slice('vapid t='.length, header.lastIndexOf(', k='));
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as Record<string, unknown>;
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:test@example.com');
    expect(claims.exp).toBe(nowSec + 12 * 3600);

    const pubKey = await crypto.subtle.importKey(
      'raw',
      base64UrlDecode(VAPID_PUBLIC),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    // Node signe/vérifie en brut R||S ; on essaie le DER si l'environnement renvoyait du DER.
    const sigBytes = base64UrlDecode(s);
    const data = new TextEncoder().encode(`${h}.${p}`);
    const okRaw = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sigBytes, data);
    const okDer = sigBytes.length === 64 ? await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, rawToDer(sigBytes), data) : false;
    expect(okRaw || okDer).toBe(true);
  });
});
