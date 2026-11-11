import type { SignalMessage } from './signaling';

export function iceServersFromLocation(): RTCIceServer[] {
  const params = new URLSearchParams(location.search);
  if (params.get('stun') === '0') return [];
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

export function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        cleanup();
        resolve();
      }
    };
    function cleanup(): void {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
    }
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

export type AlertKind = 'noise' | 'motion';
export interface AlertMessage {
  type: 'alert';
  kind: AlertKind;
  level: number;
  ts: number;
}
export interface HelloMessage {
  type: 'hello';
  name: string;
}
export interface LevelMessage {
  type: 'level';
  dbfs: number;
}
export type DataMessage = AlertMessage | HelloMessage | LevelMessage;

export const CHANNEL_LABEL = 'babycam';

export interface PeerInfo {
  id: string;
  name: string;
  state: string;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  name: string;
}

export class CameraPeers {
  private peers = new Map<string, PeerEntry>();
  onPeerChange?: () => void;

  constructor(
    private stream: MediaStream,
    private iceServers: RTCIceServer[],
  ) {}

  get list(): PeerInfo[] {
    return [...this.peers.entries()].map(([id, p]) => ({ id, name: p.name, state: p.pc.connectionState }));
  }

  async createOffer(): Promise<{ id: string; msg: SignalMessage }> {
    const id = crypto.randomUUID();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const dc = pc.createDataChannel(CHANNEL_LABEL);
    this.peers.set(id, { pc, dc, name: '…' });
    dc.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string) as DataMessage;
        if (m.type === 'hello') {
          const entry = this.peers.get(id);
          if (entry) entry.name = m.name;
          this.onPeerChange?.();
        }
      } catch {
        // message ignoré
      }
    };
    pc.onconnectionstatechange = () => this.onPeerChange?.();
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    await pc.setLocalDescription(await pc.createOffer());
    await waitIceComplete(pc, 4000);
    return { id, msg: { v: 1, t: 'offer', sdp: pc.localDescription!.sdp } };
  }

  async acceptAnswer(id: string, msg: SignalMessage): Promise<void> {
    const peer = this.peers.get(id);
    if (!peer) throw new Error('unknown peer');
    await peer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
  }

  sendToAll(m: DataMessage): void {
    const text = JSON.stringify(m);
    for (const p of this.peers.values()) {
      if (p.dc.readyState === 'open') p.dc.send(text);
    }
  }

  revoke(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.dc.close();
    p.pc.close();
    this.peers.delete(id);
    this.onPeerChange?.();
  }
}

export class ViewerPeer {
  pc: RTCPeerConnection | null = null;
  dc: RTCDataChannel | null = null;
  readonly remoteStream = new MediaStream();
  onTrack?: (stream: MediaStream) => void;
  onData?: (m: DataMessage) => void;
  onState?: (state: string) => void;

  constructor(
    private iceServers: RTCIceServer[],
    private name: string,
  ) {}

  async acceptOffer(msg: SignalMessage): Promise<SignalMessage> {
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc.ontrack = (ev) => {
      for (const track of ev.streams[0].getTracks()) this.remoteStream.addTrack(track);
      this.onTrack?.(this.remoteStream);
    };
    this.pc.ondatachannel = (ev) => {
      this.dc = ev.channel;
      this.dc.onmessage = (e) => {
        try {
          this.onData?.(JSON.parse(e.data as string) as DataMessage);
        } catch {
          // message ignoré
        }
      };
      this.dc.onopen = () => {
        const hello: HelloMessage = { type: 'hello', name: this.name };
        this.dc?.send(JSON.stringify(hello));
      };
    };
    this.pc.onconnectionstatechange = () => this.onState?.(this.pc?.connectionState ?? 'new');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitIceComplete(this.pc, 4000);
    return { v: 1, t: 'answer', sdp: this.pc.localDescription!.sdp };
  }
}
