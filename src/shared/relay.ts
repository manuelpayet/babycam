import { decryptSignal, deriveRoomKey, encryptSignal, relayRoomId } from './signaling';

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

// Le relais est obligatoire (plus de mode hors-ligne) : ?relay=<url> ne fait que
// remplacer l'URL (tests E2E avec relais mock), le défaut est le worker déployé.
export function relayUrlFromLocation(): string | null {
  const param = new URLSearchParams(location.search).get('relay');
  if (param) return param;
  return DEFAULT_RELAY_URL !== '' ? DEFAULT_RELAY_URL : null;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private join: { room: string; role: RelayRole; name: string } | null = null;
  private autoReconnect = false;
  private presenceList: PresenceCamera[] = [];
  // Chiffrement E2E de la signalisation : clé AES-GCM dérivée du code de salon.
  private key: CryptoKey | null = null;
  // Files FIFO : les messages chiffrés (émission) et déchiffrés (réception) sont
  // traités dans l'ordre d'arrivée, le chiffrement WebCrypto étant asynchrone.
  private sendQueue: Promise<void> = Promise.resolve();
  private recvQueue: Promise<void> = Promise.resolve();
  id = '';

  get cameras(): PresenceCamera[] {
    return this.presenceList;
  }
  onPresence?: (cameras: PresenceCamera[]) => void;
  onRequest?: (from: string) => void;
  onSignal?: (from: string, msg: unknown) => void;
  onCandidate?: (from: string, candidate: RTCIceCandidateInit) => void;
  onReconnecting?: (attempt: number, delayMs: number) => void;

  constructor(private url: string) {}

  get wsState(): number {
    return this.ws ? this.ws.readyState : 3;
  }

  async connect(room: string, role: RelayRole, name: string, opts: { autoReconnect?: boolean } = {}): Promise<void> {
    // E2EE : la clé est dérivée du code de salon et l'identifiant de salon envoyé au
    // relais (?room=) est un hash du code — le relais ne voit que du chiffré et ne
    // peut pas dériver la clé. La clé est dérivée une seule fois (reconnexions comprises).
    this.key = await deriveRoomKey(room);
    this.join = { room: await relayRoomId(room), role, name };
    this.autoReconnect = opts.autoReconnect ?? false;
    await this.open();
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
            this.presenceList = (m.cameras as PresenceCamera[]) ?? [];
            this.onPresence?.(this.presenceList);
            break;
          case 'request':
            this.onRequest?.(m.from as string);
            break;
          case 'signal':
            this.deliverDecrypted(m.from as string, m.msg, (from, msg) => this.onSignal?.(from, msg));
            break;
          case 'candidate':
            this.deliverDecrypted(m.from as string, m.candidate, (from, msg) => this.onCandidate?.(from, msg as RTCIceCandidateInit));
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

  private enqueueSend(job: () => Promise<void>): void {
    this.sendQueue = this.sendQueue.then(job).catch(() => undefined);
  }

  // Déchiffre un payload de signalisation reçu avant de le remettre au handler ;
  // les déchiffrements sont chaînés pour préserver l'ordre des messages.
  private deliverDecrypted(from: string, payload: unknown, deliver: (from: string, msg: unknown) => void): void {
    const key = this.key;
    if (!key) {
      deliver(from, payload);
      return;
    }
    if (typeof payload !== 'string') return; // signalisation attendue chiffrée
    this.recvQueue = this.recvQueue
      .then(() => decryptSignal(key, payload))
      .then((msg) => deliver(from, msg))
      .catch(() => {
        // code de salon différent ou trame altérée : message ignoré
      });
  }

  send(m: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  request(to: string): void {
    this.send({ type: 'request', to });
  }

  signal(to: string, msg: unknown): void {
    const key = this.key;
    if (!key) {
      this.send({ type: 'signal', to, msg });
      return;
    }
    this.enqueueSend(async () => {
      this.send({ type: 'signal', to, msg: await encryptSignal(key, msg) });
    });
  }

  candidate(to: string, candidate: RTCIceCandidateInit): void {
    const key = this.key;
    if (!key) {
      this.send({ type: 'candidate', to, candidate });
      return;
    }
    this.enqueueSend(async () => {
      this.send({ type: 'candidate', to, candidate: await encryptSignal(key, candidate) });
    });
  }

  close(): void {
    this.autoReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.ws?.close();
    this.ws = null;
  }
}
