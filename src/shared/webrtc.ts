import type { SignalMessage } from './signaling';
import { filterSdpByVideoCodec, mungeSdpAggressive } from './sdp';

export function iceServersFromLocation(): RTCIceServer[] {
  const params = new URLSearchParams(location.search);
  if (params.get('stun') === '0') return [];
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

export function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 8000): Promise<void> {
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
export interface SettingsMessage {
  type: 'settings';
  noiseThreshold: number;
  motionSens: number;
}
export type DataMessage = AlertMessage | HelloMessage | LevelMessage | SettingsMessage;

export const CHANNEL_LABEL = 'babycam';

export interface PeerInfo {
  id: string;
  name: string;
  state: string;
  iceConnectionState: string;
  iceGatheringState: string;
  signalingState: string;
  localCandidates: string[];
  remoteCandidates: string[];
}

interface PeerEntry {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  name: string;
  localCandidates: string[];
  remoteCandidates: string[];
  pendingCandidates: RTCIceCandidateInit[];
}

export interface PeerManagerOptions {
  trickle?: boolean;
  onCandidate?: (peerId: string, candidate: RTCIceCandidateInit) => void;
  onRenegotiate?: (peerId: string, msg: SignalMessage) => void;
  getVideoCodec?: () => string | undefined;
  aggressiveMunge?: boolean;
}

function mungeSdp(sdp: string, opts: PeerManagerOptions): string {
  const codec = opts.getVideoCodec?.();
  if (opts.aggressiveMunge) return mungeSdpAggressive(sdp, codec);
  return codec ? filterSdpByVideoCodec(sdp, codec) : sdp;
}

export class CameraPeers {
  private peers = new Map<string, PeerEntry>();
  private lastRegen = new Map<string, number>();
  onPeerChange?: () => void;
  onData?: (peerId: string, m: DataMessage) => void;

  constructor(
    private stream: MediaStream,
    private iceServers: RTCIceServer[],
    private opts: PeerManagerOptions = {},
  ) {}

  get list(): PeerInfo[] {
    return [...this.peers.entries()].map(([id, p]) => ({
      id,
      name: p.name,
      state: p.pc.connectionState,
      iceConnectionState: p.pc.iceConnectionState,
      iceGatheringState: p.pc.iceGatheringState,
      signalingState: p.pc.signalingState,
      localCandidates: p.localCandidates,
      remoteCandidates: p.remoteCandidates,
    }));
  }

  async createOffer(): Promise<{ id: string; msg: SignalMessage }> {
    const id = crypto.randomUUID();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry: PeerEntry = { pc, dc: null as unknown as RTCDataChannel, name: '…', localCandidates: [], remoteCandidates: [], pendingCandidates: [] };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const c = e.candidate.toJSON().candidate ?? '';
        if (c && !entry.localCandidates.includes(c)) entry.localCandidates.push(c);
        this.opts.onCandidate?.(id, e.candidate.toJSON());
      }
    };
    const dc = pc.createDataChannel(CHANNEL_LABEL);
    entry.dc = dc;
    this.peers.set(id, entry);
    dc.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string) as DataMessage;
        this.onData?.(id, m);
        if (m.type === 'hello') {
          const entry = this.peers.get(id);
          if (entry) entry.name = m.name;
          this.onPeerChange?.();
        }
      } catch {
        // message ignoré
      }
    };
    pc.onconnectionstatechange = () => {
      this.onPeerChange?.();
      if (pc.connectionState === 'failed') void this.renegotiate(id).catch(() => undefined);
    };
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    await pc.setLocalDescription(await pc.createOffer());
    if (!this.opts.trickle) await waitIceComplete(pc);
    const sdp = mungeSdp(pc.localDescription!.sdp, this.opts);
    return { id, msg: { v: 1, t: 'offer', sdp } };
  }

  private async renegotiate(id: string): Promise<void> {
    const entry = this.peers.get(id);
    if (!entry || !this.opts.onRenegotiate) return;
    const now = performance.now();
    if (now - (this.lastRegen.get(id) ?? 0) < 5000) return;
    this.lastRegen.set(id, now);
    entry.pc.restartIce();
    await entry.pc.setLocalDescription(await entry.pc.createOffer());
    if (!this.opts.trickle) await waitIceComplete(entry.pc);
    const sdp = mungeSdp(entry.pc.localDescription!.sdp, this.opts);
    this.opts.onRenegotiate(id, { v: 1, t: 'offer', sdp });
  }

  async acceptAnswer(id: string, msg: SignalMessage): Promise<void> {
    const peer = this.peers.get(id);
    if (!peer) throw new Error('unknown peer');
    await peer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    for (const c of peer.pendingCandidates.splice(0)) this.addCandidate(id, c);
  }

  addCandidate(id: string, candidate: RTCIceCandidateInit): void {
    const entry = this.peers.get(id);
    if (!entry) return;
    if (!entry.pc.remoteDescription) {
      entry.pendingCandidates.push(candidate);
      return;
    }
    if (candidate.candidate && !entry.remoteCandidates.includes(candidate.candidate)) {
      entry.remoteCandidates.push(candidate.candidate);
    }
    void entry.pc.addIceCandidate(candidate).catch(() => undefined);
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
  readonly localCandidates: string[] = [];
  readonly remoteCandidates: string[] = [];
  private pendingCandidates: RTCIceCandidateInit[] = [];
  onTrack?: (stream: MediaStream) => void;
  onData?: (m: DataMessage) => void;
  onState?: (state: string) => void;
  onCandidate?: (candidate: RTCIceCandidateInit) => void;
  onOpen?: () => void;

  send(m: DataMessage): void {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(m));
  }

  constructor(
    private iceServers: RTCIceServer[],
    private name: string,
    private trickle = false,
  ) {}

  async acceptOffer(msg: SignalMessage): Promise<SignalMessage> {
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        const c = e.candidate.toJSON().candidate ?? '';
        if (c && !this.localCandidates.includes(c)) this.localCandidates.push(c);
        this.onCandidate?.(e.candidate.toJSON());
      }
    };
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
        this.onOpen?.();
      };
    };
    this.pc.onconnectionstatechange = () => this.onState?.(this.pc?.connectionState ?? 'new');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    for (const c of this.pendingCandidates.splice(0)) this.addCandidate(c);
    if (!this.trickle) await waitIceComplete(this.pc);
    return { v: 1, t: 'answer', sdp: this.pc.localDescription!.sdp };
  }

  async renegotiate(msg: SignalMessage): Promise<SignalMessage> {
    if (!this.pc) throw new Error('no peer connection');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    for (const c of this.pendingCandidates.splice(0)) this.addCandidate(c);
    if (!this.trickle) await waitIceComplete(this.pc);
    return { v: 1, t: 'answer', sdp: this.pc.localDescription!.sdp };
  }

  addCandidate(candidate: RTCIceCandidateInit): void {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    if (candidate.candidate && !this.remoteCandidates.includes(candidate.candidate)) {
      this.remoteCandidates.push(candidate.candidate);
    }
    void this.pc.addIceCandidate(candidate).catch(() => undefined);
  }
}
