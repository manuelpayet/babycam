import { describe, expect, it } from 'vitest';
import { filterSdpByVideoCodec, mungeSdpAggressive, slimSdpForQr, videoMimeFromSdp } from './sdp';

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
    expect(out).not.toContain('a=ssrc');
    expect(out).toContain('a=ice-ufrag:xyz');
  });

  it('garde toute la section vidéo si le codec demandé est absent', () => {
    const out = mungeSdpAggressive(SDP_FULL, 'video/AV1');
    const mVideo = out.split('\r\n').find((l) => l.startsWith('m=video'))!;
    expect(mVideo).toBe('m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99');
    expect(out).not.toContain('a=extmap:');
  });
});

const SDP_CANDS = [
  'v=0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=rtpmap:96 VP8/90000',
  'a=fingerprint:sha-256 AB:CD',
  'a=ice-ufrag:xyz',
  'a=mid:0',
  'a=group:BUNDLE 0',
  'a=msid-semantic: WMS',
  'a=ssrc:1001 cname:abc',
  'a=ssrc:1001 msid:track1',
  'a=ssrc-group:FID 1001 1002',
  'a=simulcast:send rid=1',
  'a=rid:1 send',
  'a=candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host generation 0',
  'a=candidate:2 1 tcp 1518280447 192.168.1.42 9 typ host generation 0',
  'a=candidate:3 1 udp 1677729535 203.0.113.5 54321 typ srflx raddr 192.168.1.42 rport 54321 generation 0',
  'a=end-of-candidates',
].join('\r\n');

describe('slimSdpForQr', () => {
  it('supprime ssrc/msid/rid/simulcast et ne garde que les candidats udp host', () => {
    const out = slimSdpForQr(SDP_CANDS);
    expect(out).not.toContain('a=ssrc');
    expect(out).not.toContain('a=msid');
    expect(out).not.toContain('a=rid:');
    expect(out).not.toContain('a=simulcast');
    expect(out).toContain('a=fingerprint:sha-256 AB:CD');
    expect(out).toContain('a=ice-ufrag:xyz');
    expect(out).toContain('a=mid:0');
    expect(out).toContain('a=group:BUNDLE 0');
    expect(out).toContain('a=candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host generation 0');
    expect(out).not.toContain('tcp');
    expect(out).not.toContain('srflx');
    expect(out).toContain('a=end-of-candidates');
  });
});

describe('videoMimeFromSdp', () => {
  it('retourne le premier codec vidéo de la section m=video', () => {
    expect(videoMimeFromSdp(SDP_FULL)).toBe('video/vp8');
    expect(videoMimeFromSdp('v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2')).toBeUndefined();
  });
});

describe('mungeSdpAggressive (slim QR)', () => {
  it('applique aussi le slimming (ssrc supprimé, candidats filtrés)', () => {
    const out = mungeSdpAggressive(SDP_CANDS, 'video/VP8');
    expect(out.split('\r\n').find((l) => l.startsWith('m=video'))).toBe('m=video 9 UDP/TLS/RTP/SAVPF 96');
    expect(out).not.toContain('a=ssrc');
    expect(out).not.toContain('tcp');
    expect(out).not.toContain('srflx');
  });
});
