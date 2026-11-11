import { deflate, inflate } from 'pako';

export const PROTOCOL_PREFIX = 'BCAM1';

export interface SignalMessage {
  v: 1;
  t: 'offer' | 'answer';
  sdp: string;
}

// Capacité max d'un QR version 40-L en mode alphanumérique : 4296 caractères.
// On reste sous cette limite pour tenir dans UN seul QR quand c'est possible (réseau local, SDP compact).
export const QR_CHUNK_SIZE = 4200;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeMessage(msg: SignalMessage): string {
  const compressed = deflate(JSON.stringify(msg), { level: 9 });
  return `${PROTOCOL_PREFIX}:${toBase64Url(compressed)}`;
}

export function decodeMessage(text: string): SignalMessage {
  const trimmed = text.trim();
  if (!trimmed.startsWith(`${PROTOCOL_PREFIX}:`)) throw new Error('bad prefix');
  const bytes = fromBase64Url(trimmed.slice(PROTOCOL_PREFIX.length + 1));
  const json = inflate(bytes, { toText: true }) as string;
  const msg = JSON.parse(json) as SignalMessage;
  if (msg.v !== 1 || (msg.t !== 'offer' && msg.t !== 'answer') || typeof msg.sdp !== 'string') {
    throw new Error('bad message');
  }
  return msg;
}

export function toQrChunks(message: string): string[] {
  const body = message.slice(PROTOCOL_PREFIX.length + 1);
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += QR_CHUNK_SIZE) parts.push(body.slice(i, i + QR_CHUNK_SIZE));
  if (parts.length === 0) parts.push('');
  const n = parts.length;
  return parts.map((part, i) => `${PROTOCOL_PREFIX}/${i + 1}/${n}/${part}`);
}

export function createChunkCollector(): { add: (text: string) => string | null } {
  const parts = new Map<number, string>();
  let total = 0;
  return {
    add(text: string): string | null {
      const m = /^BCAM1\/(\d+)\/(\d+)\/(.*)$/s.exec(text.trim());
      if (!m) return null;
      const i = Number(m[1]);
      const n = Number(m[2]);
      if (i < 1 || i > n || n < 1) return null;
      total = n;
      parts.set(i, m[3]);
      if (parts.size < total) return null;
      let body = '';
      for (let k = 1; k <= total; k++) body += parts.get(k) ?? '';
      return `${PROTOCOL_PREFIX}:${body}`;
    },
  };
}
