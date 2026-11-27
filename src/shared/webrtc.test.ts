import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CameraPeers, ViewerPeer } from './webrtc';
import type { SignalMessage } from './signaling';

// Fakes DOM/WebRTC (environnement node) pour tester la logique des peers.

class FakeMediaStreamTrack {
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  onended: (() => void) | null = null;
  constructor(public kind: 'audio' | 'video') {}
  stop(): void {
    this.readyState = 'ended';
    this.onended?.();
  }
}

class FakeMediaStream {
  private tracks: FakeMediaStreamTrack[] = [];
  addTrack(track: FakeMediaStreamTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }
  removeTrack(track: FakeMediaStreamTrack): void {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }
}

class FakeRTCDataChannel {
  readyState = 'open';
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  sent: string[] = [];
  send(text: string): void {
    this.sent.push(text);
  }
  close(): void {
    this.readyState = 'closed';
  }
}

interface FakeTransceiver {
  track: FakeMediaStreamTrack;
  init: { direction: string };
}

class FakeRTCPeerConnection {
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  iceGatheringState = 'complete';
  onicecandidate: ((e: { candidate: null }) => void) | null = null;
  ontrack: ((ev: { track: FakeMediaStreamTrack; streams: FakeMediaStream[] }) => void) | null = null;
  ondatachannel: ((ev: { channel: FakeRTCDataChannel }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  addedTracks: FakeMediaStreamTrack[] = [];
  transceivers: FakeTransceiver[] = [];
  dataChannels: FakeRTCDataChannel[] = [];
  closed = false;

  constructor() {}

  createDataChannel(): FakeRTCDataChannel {
    const dc = new FakeRTCDataChannel();
    this.dataChannels.push(dc);
    return dc;
  }
  addTrack(track: FakeMediaStreamTrack): void {
    this.addedTracks.push(track);
  }
  addTransceiver(track: FakeMediaStreamTrack, init: { direction: string }): FakeTransceiver {
    const tr: FakeTransceiver = { track, init };
    this.transceivers.push(tr);
    queueMicrotask(() => this.onnegotiationneeded?.());
    return tr;
  }
  async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
    return { type: 'offer', sdp: `offre-${this.transceivers.length}-mline` };
  }
  async createAnswer(): Promise<{ type: 'answer'; sdp: string }> {
    return { type: 'answer', sdp: 'reponse' };
  }
  async setLocalDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = desc;
    this.signalingState = 'stable';
  }
  async addIceCandidate(): Promise<void> {}
  restartIce(): void {}
  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }
}

interface EntryView {
  pc: FakeRTCPeerConnection;
  dc: FakeRTCDataChannel;
}

function peersInternals(peers: CameraPeers): Map<string, EntryView> {
  return (peers as unknown as { peers: Map<string, EntryView> }).peers;
}

function makeStream(): FakeMediaStream {
  const s = new FakeMediaStream();
  s.addTrack(new FakeMediaStreamTrack('video'));
  s.addTrack(new FakeMediaStreamTrack('audio'));
  return s;
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

beforeAll(() => {
  vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
  vi.stubGlobal('MediaStream', FakeMediaStream);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('CameraPeers (talkie-walkie)', () => {
  it('offre avec les pistes A/V, applique une réponse, accepte une renégociation entrante et reçoit une piste distante', async () => {
    const peers = new CameraPeers(makeStream() as unknown as MediaStream, [], {});
    const { id, msg } = await peers.createOffer();
    expect(msg.t).toBe('offer');

    const entry = peersInternals(peers).get(id)!;
    expect(entry.pc.addedTracks.map((t) => t.kind).sort()).toEqual(['audio', 'video']);
    expect(entry.dc).toBeTruthy();

    await peers.acceptAnswer(id, { v: 1, t: 'answer', sdp: 'rep' });
    expect(entry.pc.remoteDescription?.sdp).toBe('rep');

    // Le viewer ajoute son micro → offre de renégotiation entrante → la caméra répond.
    const ans = await peers.acceptOffer(id, { v: 1, t: 'offer', sdp: 'offre-viewer' });
    expect(ans.t).toBe('answer');
    expect(ans.sdp).toBe('reponse');

    // Piste distante reçue (second flux audio viewer→caméra).
    const received: Array<{ peerId: string; kind: string; inStream: boolean }> = [];
    peers.onRemoteTrack = (peerId, track, stream) => {
      received.push({ peerId, kind: track.kind, inStream: stream.getTracks().includes(track) });
    };
    const talkTrack = new FakeMediaStreamTrack('audio');
    entry.pc.ontrack?.({ track: talkTrack, streams: [] });
    expect(received).toEqual([{ peerId: id, kind: 'audio', inStream: true }]);

    // Révocation → fin de la piste distante + fermeture.
    const ended: string[] = [];
    peers.onRemoteTrackEnd = (peerId, track) => ended.push(`${peerId}:${track.kind}`);
    peers.revoke(id);
    expect(ended).toEqual([`${id}:audio`]);
    expect(entry.pc.closed).toBe(true);
    expect(peersInternals(peers).has(id)).toBe(false);
  });

  it('acceptOffer refuse une renégociation si la signalisation n est pas stable', async () => {
    const peers = new CameraPeers(makeStream() as unknown as MediaStream, [], {});
    const { id } = await peers.createOffer();
    // pas de réponse appliquée → signalingState encore have-local-offer
    const entry = peersInternals(peers).get(id)!;
    expect(entry.pc.signalingState).toBe('have-local-offer');
    await expect(peers.acceptOffer(id, { v: 1, t: 'offer', sdp: 'x' })).rejects.toThrow(/stable/);
  });
});

describe('ViewerPeer (talkie-walkie)', () => {
  it('addTalkTrack ajoute un transceiver sendonly et déclenche une offre de renégociation', async () => {
    const peer = new ViewerPeer([], 'Testeur');
    const answer = await peer.acceptOffer({ v: 1, t: 'offer', sdp: 'offre-cam' });
    expect(answer.t).toBe('answer');
    const pc = peer.pc as unknown as FakeRTCPeerConnection;

    const offers: SignalMessage[] = [];
    peer.onRenegotiate = (m) => offers.push(m);

    const mic = new FakeMediaStreamTrack('audio');
    mic.enabled = false;
    peer.addTalkTrack(mic as unknown as MediaStreamTrack);
    expect(peer.hasTalkTrack).toBe(true);
    await flush();
    expect(offers).toHaveLength(1);
    expect(offers[0].t).toBe('offer');
    expect(typeof offers[0].sdp).toBe('string');
    expect(pc.transceivers).toHaveLength(1);
    expect(pc.transceivers[0].init.direction).toBe('sendonly');

    // La caméra répond à la renégociation.
    await peer.acceptAnswer({ v: 1, t: 'answer', sdp: 'rep-cam' });
    expect(pc.remoteDescription?.sdp).toBe('rep-cam');
    expect(pc.signalingState).toBe('stable');

    // Un second addTalkTrack ne rajoute pas de transceiver.
    peer.addTalkTrack(new FakeMediaStreamTrack('audio') as unknown as MediaStreamTrack);
    expect(pc.transceivers).toHaveLength(1);
  });

  it('renegotiate (offre de la caméra, ex. ICE restart) conserve le transceiver talk', async () => {
    const peer = new ViewerPeer([], 'Testeur');
    await peer.acceptOffer({ v: 1, t: 'offer', sdp: 'offre-cam' });
    const pc = peer.pc as unknown as FakeRTCPeerConnection;
    peer.addTalkTrack(new FakeMediaStreamTrack('audio') as unknown as MediaStreamTrack);
    await flush();
    const ans = await peer.renegotiate({ v: 1, t: 'offer', sdp: 'offre-cam-2' });
    expect(ans.t).toBe('answer');
    expect(pc.transceivers).toHaveLength(1);
  });
});
