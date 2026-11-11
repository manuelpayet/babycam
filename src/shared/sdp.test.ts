import { describe, expect, it } from 'vitest';
import { filterSdpByVideoCodec, mungeSdpAggressive } from './sdp';

const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
  'a=rtpmap:96 VP8/90000',
  'a=fmtp:96 x-google-start-bitrate=800',
  'a=rtcp-fb:96 goog-remb',
  'a=rtpmap:97 H264/90000',
  'a=fmtp:97 profile-level-id=42e01f',
  'a=rtcp-fb:97 nack',
  'a=rtpmap:98 VP9/90000',
  'a=rtcp-fb:98 nack',
  'a=mid:0',
  'a=ssrc:1001 cname:abc',
].join('\r\n');

describe('filterSdpByVideoCodec', () => {
  it('ne garde que le codec vidéo choisi dans m=video et ses attributs', () => {
    const out = filterSdpByVideoCodec(SDP, 'video/VP9');
    const mVideo = out.split('\r\n').find((l) => l.startsWith('m=video'))!;
    expect(mVideo).toBe('m=video 9 UDP/TLS/RTP/SAVPF 98');
    expect(out).toContain('a=rtpmap:98 VP9/90000');
    expect(out).toContain('a=rtcp-fb:98 nack');
    expect(out).not.toContain('a=rtpmap:96 VP8/90000');
    expect(out).not.toContain('a=fmtp:97 profile-level-id=42e01f');
    expect(out).not.toContain('a=rtcp-fb:97 nack');
  });

  it('laisse la section audio et les attributs non-codec intactes', () => {
    const out = filterSdpByVideoCodec(SDP, 'video/H264');
    expect(out).toContain('m=audio 9 UDP/TLS/RTP/SAVPF 111');
    expect(out).toContain('a=rtpmap:111 opus/48000/2');
    expect(out).toContain('a=mid:0');
    expect(out).toContain('a=ssrc:1001 cname:abc');
    expect(out).toContain('a=rtpmap:97 H264/90000');
    expect(out).not.toContain('VP8');
  });

  it('retourne le SDP inchangé si le codec est inconnu', () => {
    expect(filterSdpByVideoCodec(SDP, 'video/AV1')).toBe(SDP);
  });

  it('est insensible à la casse', () => {
    const out = filterSdpByVideoCodec(SDP, 'VIDEO/vp8');
    expect(out).toContain('a=rtpmap:96 VP8/90000');
    expect(out).not.toContain('H264');
  });
});

const SDP_FULL = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0 8',
  'a=rtpmap:111 opus/48000/2',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 H264/90000',
  'a=rtpmap:98 VP9/90000',
  'a=rtpmap:99 rtx/90000',
  'a=fmtp:99 apt=96',
  'a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'a=mid:0',
  'a=ssrc:1001 cname:abc',
  'a=ice-ufrag:xyz',
].join('\r\n');

describe('mungeSdpAggressive (QR sans relais)', () => {
  it('ne garde que le codec vidéo choisi et opus en audio, et supprime les extmap', () => {
    const out = mungeSdpAggressive(SDP_FULL, 'video/VP8');
    const mVideo = out.split('\r\n').find((l) => l.startsWith('m=video'))!;
    expect(mVideo).toBe('m=video 9 UDP/TLS/RTP/SAVPF 96');
    const mAudio = out.split('\r\n').find((l) => l.startsWith('m=audio'))!;
    expect(mAudio).toBe('m=audio 9 UDP/TLS/RTP/SAVPF 111');
    expect(out).toContain('a=rtpmap:111 opus/48000/2');
    expect(out).not.toContain('PCMU');
    expect(out).not.toContain('H264');
    expect(out).not.toContain('VP9');
    expect(out).not.toContain('rtx');
    expect(out).not.toContain('a=extmap:');
    expect(out).toContain('a=mid:0');
    expect(out).toContain('a=ssrc:1001 cname:abc');
    expect(out).toContain('a=ice-ufrag:xyz');
  });

  it('garde toute la section vidéo si le codec demandé est absent', () => {
    const out = mungeSdpAggressive(SDP_FULL, 'video/AV1');
    const mVideo = out.split('\r\n').find((l) => l.startsWith('m=video'))!;
    expect(mVideo).toBe('m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99');
    expect(out).not.toContain('a=extmap:');
  });
});
