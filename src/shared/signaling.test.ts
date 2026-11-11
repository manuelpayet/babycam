import { describe, expect, it } from 'vitest';
import {
  createChunkCollector,
  decodeMessage,
  decodeRoom,
  encodeMessage,
  encodeRoom,
  PROTOCOL_PREFIX,
  QR_CHUNK_SIZE,
  toQrChunks,
  type SignalMessage,
} from './signaling';

const sample: SignalMessage = {
  v: 1,
  t: 'offer',
  sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n'.repeat(80) + 'a=fingerprint:sha-256 ABCDEF\r\n',
};

describe('signaling', () => {
  it('round-trip encode/decode', () => {
    const encoded = encodeMessage(sample);
    expect(encoded.startsWith(`${PROTOCOL_PREFIX}:`)).toBe(true);
    expect(decodeMessage(encoded)).toEqual(sample);
  });

  it('round-trip answer', () => {
    const answer: SignalMessage = { v: 1, t: 'answer', sdp: 'v=0 answer sdp '.repeat(50) };
    expect(decodeMessage(encodeMessage(answer))).toEqual(answer);
  });

  it('le payload compressé est plus court que le SDP brut', () => {
    const encoded = encodeMessage(sample);
    expect(encoded.length).toBeLessThan(sample.sdp.length);
  });

  it('découpe en chunks QR et réassemble dans le désordre', () => {
    const encoded = encodeMessage(sample);
    const chunks = toQrChunks(encoded);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const c of chunks) expect(c.startsWith(`${PROTOCOL_PREFIX}/`)).toBe(true);
    expect(chunks[0].length).toBeLessThanOrEqual(QR_CHUNK_SIZE + 20);

    const collector = createChunkCollector();
    const shuffled = [...chunks].reverse();
    let full: string | null = null;
    for (const c of shuffled) full = collector.add(c) ?? full;
    expect(full).toBe(encoded);
    expect(decodeMessage(full!)).toEqual(sample);
  });

  it('chunk unique (petit payload)', () => {
    const small: SignalMessage = { v: 1, t: 'answer', sdp: 'v=0 x' };
    const chunks = toQrChunks(encodeMessage(small));
    expect(chunks.length).toBe(1);
    const collector = createChunkCollector();
    expect(collector.add(chunks[0])).toBe(encodeMessage(small));
  });

  it('rejette un mauvais préfixe', () => {
    expect(() => decodeMessage('XXXX:abc')).toThrow('bad prefix');
  });

  it('rejette un message invalide', () => {
    const bad = `${PROTOCOL_PREFIX}:aGVsbG8`;
    expect(() => decodeMessage(bad)).toThrow();
  });

  it('le collecteur ignore les textes qui ne sont pas des chunks', () => {
    const collector = createChunkCollector();
    expect(collector.add('hello world')).toBeNull();
    expect(collector.add(`${PROTOCOL_PREFIX}/2/5/abc`)).toBeNull();
  });

  it('encode/decode de code de salon', () => {
    const text = encodeRoom('ABC234');
    expect(text).toBe('BCAM1/R/ABC234');
    expect(decodeRoom(text)).toBe('ABC234');
    expect(decodeRoom(encodeMessage(sample))).toBeNull();
    expect(decodeRoom('BCAM1/R/abc')).toBeNull();
    expect(decodeRoom('BCAM1/R/ABC12')).toBeNull();
    expect(decodeRoom('BCAM1/R/ABC120')).toBeNull();
  });
});
