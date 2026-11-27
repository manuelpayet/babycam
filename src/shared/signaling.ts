// Signalisation : le SDP (offer/answer/candidate) transite par le relais WebSocket
// (relay.ts), jamais par QR. Le seul payload QR restant est le code de salon.
//
// Chiffrement de bout en bout : la signalisation (SDP + candidats ICE) est chiffrée
// en AES-GCM (WebCrypto) avec une clé dérivée du code de salon (PBKDF2-SHA-256), et
// l'identifiant de salon passé au relais dans l'URL est un hash SHA-256 du code :
// le relais ne voit que du chiffré et ne peut pas dériver la clé.

export interface SignalMessage {
  v: 1;
  t: 'offer' | 'answer' | 'candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

export function encodeRoom(room: string): string {
  return `BCAM1/R/${room}`;
}

export function decodeRoom(text: string): string | null {
  const m = /^BCAM1\/R\/([A-Z2-9]{6})$/.exec(text.trim());
  return m ? m[1] : null;
}

// --- E2EE de la signalisation ---

// Format versionné de l'enveloppe chiffrée sur le fil :
// `BCAM1/E<version>/<base64url(iv ‖ ciphertext+tag)>` — toute version inconnue
// est rejetée au déchiffrement.
export const E2EE_VERSION = 1;
export const E2EE_PAYLOAD_PREFIX = `BCAM1/E${E2EE_VERSION}/`;

// Sel fixe de dérivation (séparation de domaine) + nombre d'itérations PBKDF2
// (recommandation OWASP pour PBKDF2-HMAC-SHA-256).
const E2EE_KEY_SALT = new TextEncoder().encode('babycam/e2ee/v1');
const E2EE_PBKDF2_ITERATIONS = 600_000;
const ROOM_ID_PREFIX = 'babycam/room/v1:';
const GCM_IV_BYTES = 12;

// Clé AES-GCM 256 dérivée du code de salon (non extractable).
export async function deriveRoomKey(room: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(room), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: E2EE_KEY_SALT, iterations: E2EE_PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Identifiant de salon exposé au relais (paramètre ?room= de l'URL WebSocket) :
// hash SHA-256 du code, pour que le relais ne connaisse pas le secret.
export async function relayRoomId(room: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ROOM_ID_PREFIX + room));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Chiffre un message de signalisation : IV aléatoire de 12 octets par message,
// le résultat est `<E2EE_PAYLOAD_PREFIX><base64url(iv ‖ ciphertext+tag)>`.
export async function encryptSignal(key: CryptoKey, msg: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(msg))));
  const payload = new Uint8Array(GCM_IV_BYTES + ciphertext.length);
  payload.set(iv, 0);
  payload.set(ciphertext, GCM_IV_BYTES);
  return E2EE_PAYLOAD_PREFIX + bytesToBase64Url(payload);
}

// Déchiffre un payload chiffré versionné ; rejette si la version est inconnue,
// si la trame est malformée ou si l'authentification GCM échoue (mauvaise clé / altération).
export async function decryptSignal(key: CryptoKey, payload: string): Promise<unknown> {
  if (!payload.startsWith(E2EE_PAYLOAD_PREFIX)) throw new Error(`e2ee: version de payload chiffré non supportée (attendu ${E2EE_PAYLOAD_PREFIX})`);
  const raw = base64UrlToBytes(payload.slice(E2EE_PAYLOAD_PREFIX.length));
  if (raw.length <= GCM_IV_BYTES) throw new Error('e2ee: payload trop court');
  const iv = raw.slice(0, GCM_IV_BYTES);
  const ciphertext = raw.slice(GCM_IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plain) as string) as unknown;
}

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '';
    out += i + 2 < bytes.length ? B64URL_ALPHABET[b2 & 0x3f] : '';
  }
  return out;
}

function base64UrlToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil((text.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let p = 0;
  for (const ch of text) {
    const v = B64URL_ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('e2ee: base64url invalide');
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[p++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return bytes.subarray(0, p);
}
