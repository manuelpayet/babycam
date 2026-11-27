import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraPeers, HEARTBEAT_INTERVAL_MS, type DataMessage } from './webrtc';

class FakeDataChannel {
  readyState = 'open';
  readonly sent: string[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 'closed';
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  readonly channels: FakeDataChannel[] = [];
  connectionState = 'new';
  iceConnectionState = 'new';
  iceGatheringState = 'new';
  signalingState = 'stable';
  localDescription: { sdp: string } | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor() {
    FakePeerConnection.instances.push(this);
  }
  createDataChannel(): FakeDataChannel {
    const dc = new FakeDataChannel();
    this.channels.push(dc);
    return dc;
  }
  addTrack(): void {}
  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: 'offer', sdp: 'fake-sdp' };
  }
  async setLocalDescription(desc: { sdp: string }): Promise<void> {
    this.localDescription = desc;
  }
  restartIce(): void {}
  close(): void {
    this.connectionState = 'closed';
  }
}

function makePeers(): CameraPeers {
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  return new CameraPeers(stream, []);
}

function channel(): FakeDataChannel {
  return FakePeerConnection.instances[0].channels[0];
}

function sentMessages(): DataMessage[] {
  return channel().sent.map((s) => JSON.parse(s) as DataMessage);
}

describe('CameraPeers — heartbeat DataChannel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakePeerConnection.instances = [];
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('envoie un ping immédiat à la création du peer puis un ping régulier', async () => {
    const peers = makePeers();
    const { id } = await peers.createOffer();
    expect(channel().sent).toHaveLength(1);
    expect(JSON.parse(channel().sent[0])).toMatchObject({ type: 'ping' });

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    const pings = sentMessages();
    expect(pings).toHaveLength(4);
    for (const m of pings) {
      expect(m.type).toBe('ping');
      if (m.type === 'ping') expect(typeof m.ts).toBe('number');
    }
    peers.revoke(id);
  });

  it('envoie un ping à l’ouverture du DataChannel', async () => {
    const peers = makePeers();
    const { id } = await peers.createOffer();
    const before = channel().sent.length;
    channel().onopen?.();
    expect(channel().sent.length).toBe(before + 1);
    expect(JSON.parse(channel().sent[channel().sent.length - 1])).toMatchObject({ type: 'ping' });
    peers.revoke(id);
  });

  it('arrête le heartbeat quand tous les peers sont révoqués', async () => {
    const peers = makePeers();
    const { id } = await peers.createOffer();
    peers.revoke(id);
    const count = channel().sent.length;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 5);
    expect(channel().sent.length).toBe(count);
  });

  it('ne heartbeat que les DataChannels ouverts', async () => {
    const peers = makePeers();
    const { id } = await peers.createOffer();
    channel().readyState = 'connecting';
    const count = channel().sent.length;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(channel().sent.length).toBe(count);
    peers.revoke(id);
  });

  it('redémarre le heartbeat via startHeartbeat après un arrêt manuel', async () => {
    const peers = makePeers();
    const { id } = await peers.createOffer();
    peers.stopHeartbeat();
    const count = channel().sent.length;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(channel().sent.length).toBe(count);
    peers.startHeartbeat();
    expect(channel().sent.length).toBe(count + 1);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(channel().sent.length).toBe(count + 2);
    peers.revoke(id);
  });
});
