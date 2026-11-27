import type { SignalMessage } from './signaling';

export const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';
// TURN de secours pour les NAT symétriques (STUN insuffisant) : relais public OpenRelay.
export const DEFAULT_TURN_URL = 'turn:openrelay.metered.ca:80';
export const DEFAULT_TURN_USERNAME = 'openrelayproject';
export const DEFAULT_TURN_CREDENTIAL = 'openrelayprojectsecret';

export function iceServersFromLocation(): RTCIceServer[] {
  const params = new URLSearchParams(location.search);
  // ?stun=0 : aucun serveur ICE (mode QR local, comportement historique).
  if (params.get('stun') === '0') return [];
  const servers: RTCIceServer[] = [{ urls: DEFAULT_STUN_URL }];
  // ?turn=0 désactive le relais TURN ; ?turn=<url> le remplace (identifiants par défaut
  // alors omis, sauf ?turnuser=/ ?turnpass= explicites).
  if (params.get('turn') !== '0') {
    const customUrl = params.get('turn');
    const turn: RTCIceServer = { urls: customUrl ?? DEFAULT_TURN_URL };
    const username = params.get('turnuser') ?? (customUrl ? undefined : DEFAULT_TURN_USERNAME);
    const credential = params.get('turnpass') ?? (customUrl ? undefined : DEFAULT_TURN_CREDENTIAL);
    if (username) turn.username = username;
    if (credential) turn.credential = credential;
    servers.push(turn);
  }
  return servers;
}

export function hasTurnServer(iceServers: RTCIceServer[]): boolean {
  return iceServers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/i.test(u)));
}

export function isRelayCandidate(candidate: string): boolean {
  return /\styp\srelay(\s|$)/.test(candidate);
}

// Gathering ICE terminé sans aucun candidat relay alors qu'un serveur TURN est configuré :
// le relais TURN est injoignable (réseau bloqué, mauvais identifiants, serveur down).
export function turnFailedAfterGathering(iceServers: RTCIceServer[], gatheredRelay: boolean): boolean {
  return !gatheredRelay && hasTurnServer(iceServers);
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
  relay: boolean;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  name: string;
  localCandidates: string[];
  remoteCandidates: string[];
  pendingCandidates: RTCIceCandidateInit[];
  relay: boolean;
  turnReported: boolean;
}

// Appairage 100 % relais : ICE trickle (les candidats partent via onCandidate),
// le SDP n'est jamais allégé ni transporté par QR.
export interface PeerManagerOptions {
  onCandidate?: (peerId: string, candidate: RTCIceCandidateInit) => void;
  onRenegotiate?: (peerId: string, msg: SignalMessage) => void;
  onTurnFailed?: (peerId: string) => void;
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
      relay: p.relay,
    }));
  }

  private reportTurnFailure(id: string, entry: PeerEntry): void {
    if (entry.turnReported || !turnFailedAfterGathering(this.iceServers, entry.relay)) return;
    entry.turnReported = true;
    this.opts.onTurnFailed?.(id);
  }

  async createOffer(): Promise<{ id: string; msg: SignalMessage }> {
    const id = crypto.randomUUID();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry: PeerEntry = { pc, dc: null as unknown as RTCDataChannel, name: '…', localCandidates: [], remoteCandidates: [], pendingCandidates: [], relay: false, turnReported: false };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const c = e.candidate.toJSON().candidate ?? '';
        if (c && !entry.localCandidates.includes(c)) entry.localCandidates.push(c);
        if (c && isRelayCandidate(c)) entry.relay = true;
        this.opts.onCandidate?.(id, e.candidate.toJSON());
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') this.reportTurnFailure(id, entry);
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
    return { id, msg: { v: 1, t: 'offer', sdp: pc.localDescription!.sdp } };
  }

  private async renegotiate(id: string): Promise<void> {
    const entry = this.peers.get(id);
    if (!entry || !this.opts.onRenegotiate) return;
    const now = performance.now();
    if (now - (this.lastRegen.get(id) ?? 0) < 5000) return;
    this.lastRegen.set(id, now);
    entry.pc.restartIce();
    await entry.pc.setLocalDescription(await entry.pc.createOffer());
    this.opts.onRenegotiate(id, { v: 1, t: 'offer', sdp: entry.pc.localDescription!.sdp });
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
  relay = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private turnReported = false;
  onTrack?: (stream: MediaStream) => void;
  onData?: (m: DataMessage) => void;
  onState?: (state: string) => void;
  onCandidate?: (candidate: RTCIceCandidateInit) => void;
  onOpen?: () => void;
  onTurnFailed?: () => void;

  send(m: DataMessage): void {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(m));
  }

  constructor(
    private iceServers: RTCIceServer[],
    private name: string,
  ) {}

  async acceptOffer(msg: SignalMessage): Promise<SignalMessage> {
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        const c = e.candidate.toJSON().candidate ?? '';
        if (c && !this.localCandidates.includes(c)) this.localCandidates.push(c);
        if (c && isRelayCandidate(c)) this.relay = true;
        this.onCandidate?.(e.candidate.toJSON());
      }
    };
    this.pc.onicegatheringstatechange = () => {
      if (this.pc?.iceGatheringState === 'complete' && !this.turnReported && turnFailedAfterGathering(this.iceServers, this.relay)) {
        this.turnReported = true;
        this.onTurnFailed?.();
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
    return { v: 1, t: 'answer', sdp: this.pc.localDescription!.sdp };
  }

  async renegotiate(msg: SignalMessage): Promise<SignalMessage> {
    if (!this.pc) throw new Error('no peer connection');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    for (const c of this.pendingCandidates.splice(0)) this.addCandidate(c);
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
