export type RelayRole = 'camera' | 'viewer';

export interface PresenceCamera {
  id: string;
  name: string;
  ts: number;
}

export function newRoomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export class RelayClient {
  private ws: WebSocket | null = null;
  id = '';
  onPresence?: (cameras: PresenceCamera[]) => void;
  onRequest?: (from: string) => void;
  onSignal?: (from: string, msg: unknown) => void;
  onCandidate?: (from: string, candidate: RTCIceCandidateInit) => void;

  constructor(private url: string) {}

  connect(room: string, role: RelayRole, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.url}?room=${encodeURIComponent(room)}`);
      this.ws = ws;
      ws.onopen = () => {
        this.send({ type: 'join', role, name });
        resolve();
      };
      ws.onerror = () => reject(new Error('relay: erreur de connexion'));
      ws.onmessage = (ev) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(ev.data as string) as Record<string, unknown>;
        } catch {
          return;
        }
        switch (m.type) {
          case 'welcome':
            this.id = m.id as string;
            break;
          case 'presence':
            this.onPresence?.(m.cameras as PresenceCamera[]);
            break;
          case 'request':
            this.onRequest?.(m.from as string);
            break;
          case 'signal':
            this.onSignal?.(m.from as string, m.msg);
            break;
          case 'candidate':
            this.onCandidate?.(m.from as string, m.candidate as RTCIceCandidateInit);
            break;
        }
      };
    });
  }

  send(m: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  request(to: string): void {
    this.send({ type: 'request', to });
  }

  signal(to: string, msg: unknown): void {
    this.send({ type: 'signal', to, msg });
  }

  candidate(to: string, candidate: RTCIceCandidateInit): void {
    this.send({ type: 'candidate', to, candidate });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
