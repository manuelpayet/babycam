import type { DeviceAuth } from './device-auth';

export type RelayRole = 'camera' | 'viewer';

export interface PresenceCamera {
  id: string;
  name: string;
  ts: number;
}

// Requête d'accès reçue par la caméra : `approved` = la clé publique du viewer est
// enregistrée côté caméra dans le relais (ré-approbation automatique, prouvée par
// la signature vérifiée par le relais).
export interface RequestInfo {
  approved: boolean;
  pubkey: string;
  name: string;
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
  private join: { room: string; role: RelayRole; name: string; pubkey: string } | null = null;
  private autoReconnect = false;
  private presenceList: PresenceCamera[] = [];
  id = '';

  get cameras(): PresenceCamera[] {
    return this.presenceList;
  }
  onPresence?: (cameras: PresenceCamera[]) => void;
  onRequest?: (from: string, req: RequestInfo) => void;
  onSignal?: (from: string, msg: unknown) => void;
  onCandidate?: (from: string, candidate: RTCIceCandidateInit) => void;
  onRejected?: (reason: string) => void;
  onRevoke?: (from: string) => void;
  onReconnecting?: (attempt: number, delayMs: number) => void;

  constructor(private url: string) {}

  get wsState(): number {
    return this.ws ? this.ws.readyState : 3;
  }

  connect(room: string, role: RelayRole, name: string, opts: { autoReconnect?: boolean; pubkey?: string } = {}): Promise<void> {
    this.join = { room, role, name, pubkey: opts.pubkey ?? '' };
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
        this.send({ type: 'join', role: join.role, name: join.name, pubkey: join.pubkey });
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
            this.onRequest?.(m.from as string, {
              approved: m.approved === true,
              pubkey: String(m.pubkey ?? ''),
              name: String(m.name ?? ''),
            });
            break;
          case 'signal':
            this.onSignal?.(m.from as string, m.msg);
            break;
          case 'candidate':
            this.onCandidate?.(m.from as string, m.candidate as RTCIceCandidateInit);
            break;
          case 'rejected':
            this.onRejected?.(String(m.reason ?? 'auth'));
            break;
          case 'revoke':
            this.onRevoke?.(m.from as string);
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

  // Requête signée (preuve de possession de la clé privée de l'appareil) ; le relais
  // vérifie la signature puis indique à la caméra si la clé publique est approuvée.
  request(to: string, auth: DeviceAuth): void {
    this.send({ type: 'request', to, pubkey: auth.pubkey, ts: auth.ts, sig: auth.sig });
  }

  // Révoque un viewer côté relais (sa clé publique est retirée des approvedDevices).
  revoke(to: string): void {
    this.send({ type: 'revoke', to });
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
