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

export function backoffDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
}

// URL du relais par défaut (worker Cloudflare `babycam-relay`, déployé via `wrangler deploy` dans relay/).
export const DEFAULT_RELAY_URL: string = 'wss://babycam-relay.veille-cron.workers.dev';

export function relayUrlFromLocation(): string | null {
  const param = new URLSearchParams(location.search).get('relay');
  if (param === '0') return null;
  if (param) return param;
  return DEFAULT_RELAY_URL !== '' ? DEFAULT_RELAY_URL : null;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private join: { room: string; role: RelayRole; name: string } | null = null;
  private autoReconnect = false;
  id = '';
  onPresence?: (cameras: PresenceCamera[]) => void;
  onRequest?: (from: string) => void;
  onSignal?: (from: string, msg: unknown) => void;
  onCandidate?: (from: string, candidate: RTCIceCandidateInit) => void;
  onReconnecting?: (attempt: number, delayMs: number) => void;

  constructor(private url: string) {}

  get wsState(): number {
    return this.ws ? this.ws.readyState : 3;
  }

  connect(room: string, role: RelayRole, name: string, opts: { autoReconnect?: boolean } = {}): Promise<void> {
    this.join = { room, role, name };
    this.autoReconnect = opts.autoReconnect ?? false;
    return this.open();
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const join = this.join!;
      const ws = new WebSocket(`${this.url}?room=${encodeURIComponent(join.room)}`);
      this.ws = ws;
      ws.onopen = () => {
        this.attempts = 0;
        settled = true;
        this.send({ type: 'join', role: join.role, name: join.name });
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('relay: erreur de connexion'));
        }
        this.scheduleReconnect();
      };
      ws.onclose = () => {
        this.scheduleReconnect();
      };
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

  private scheduleReconnect(): void {
    if (!this.autoReconnect || !this.join || this.reconnectTimer) return;
    const delay = backoffDelayMs(this.attempts++);
    this.onReconnecting?.(this.attempts, delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.open().catch(() => undefined);
    }, delay);
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
    this.autoReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.ws?.close();
    this.ws = null;
  }
}
