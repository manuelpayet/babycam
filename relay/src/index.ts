import { sendWebPush, type WebPushSubscriptionJSON } from '../../src/shared/webpush';

export interface Env {
  ROOM: DurableObjectNamespace;
  // Secrets/vars du worker (wrangler.toml [vars] + `wrangler secret put VAPID_PRIVATE_KEY`).
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

interface Attachment {
  id: string;
  role: 'camera' | 'viewer' | null;
  name: string;
}

// L'état du salon vit dans les attachments des WebSockets (serializeAttachment),
// PAS dans une Map en mémoire : un Durable Object peut être évincé à tout moment
// (hibernation), et seule l'attachment survit à l'éviction. getWebSockets() renvoie
// les sockets hibernés, donc la présence reste correcte même après éviction.
// Les subscriptions push, elles, sont dans le stockage SQLite du DO (table push_subs) :
// elles doivent survivre même quand tous les sockets du salon sont fermés.
export class RoomDO {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    const att: Attachment = { id: crypto.randomUUID(), role: null, name: '' };
    server.serializeAttachment(att);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    switch (m.type) {
      case 'join': {
        const next: Attachment = {
          id: att.id,
          role: m.role === 'camera' ? 'camera' : 'viewer',
          name: String(m.name ?? ''),
        };
        ws.serializeAttachment(next);
        ws.send(JSON.stringify({ type: 'welcome', id: next.id }));
        this.broadcastPresence();
        break;
      }
      case 'request':
      case 'signal':
      case 'candidate': {
        if (!att.role) return;
        this.forward(m.to as string, { ...m, from: att.id });
        break;
      }
      case 'push': {
        // Un viewer enregistre sa subscription Web Push pour ce salon.
        if (att.role !== 'viewer') return;
        const sub = m.sub as WebPushSubscriptionJSON | undefined;
        if (
          !sub ||
          typeof sub.endpoint !== 'string' ||
          !sub.endpoint.startsWith('https://') ||
          typeof sub.keys?.p256dh !== 'string' ||
          typeof sub.keys?.auth !== 'string'
        ) {
          ws.send(JSON.stringify({ type: 'push-ack', ok: false }));
          return;
        }
        this.ensurePushTable();
        this.state.storage.sql.exec(
          'INSERT INTO push_subs (endpoint, sub, ts) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET sub = excluded.sub, ts = excluded.ts',
          sub.endpoint,
          JSON.stringify(sub),
          Date.now(),
        );
        ws.send(JSON.stringify({ type: 'push-ack', ok: true }));
        break;
      }
      case 'alert': {
        // La caméra signale une alerte : push Web Push vers tous les viewers abonnés
        // du salon (utile quand la page viewer est fermée, le flux DataChannel étant P2P).
        if (att.role !== 'camera') return;
        const kind = m.kind === 'motion' ? 'motion' : 'noise';
        const level = typeof m.level === 'number' ? m.level : 0;
        const ts = typeof m.ts === 'number' ? m.ts : Date.now();
        await this.dispatchAlert({ v: 1, kind, level, ts });
        break;
      }
    }
  }

  async webSocketClose(): Promise<void> {
    this.broadcastPresence();
  }

  async webSocketError(): Promise<void> {
    this.broadcastPresence();
  }

  private ensurePushTable(): void {
    this.state.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, ts INTEGER NOT NULL)',
    );
  }

  private async dispatchAlert(payload: { v: 1; kind: 'noise' | 'motion'; level: number; ts: number }): Promise<void> {
    const priv = this.env.VAPID_PRIVATE_KEY;
    const pub = this.env.VAPID_PUBLIC_KEY;
    const subject = this.env.VAPID_SUBJECT ?? 'mailto:admin@example.com';
    if (!priv || !pub) return; // VAPID non configuré : pas de push
    this.ensurePushTable();
    const rows = this.state.storage.sql
      .exec('SELECT endpoint, sub FROM push_subs')
      .toArray() as unknown as { endpoint: string; sub: string }[];
    const text = JSON.stringify(payload);
    await Promise.allSettled(
      rows.map(async (row) => {
        try {
          const sub = JSON.parse(row.sub) as WebPushSubscriptionJSON;
          const res = await sendWebPush(sub, text, { subject, privateKeyB64url: priv, publicKeyB64url: pub });
          if (res.gone) {
            // 404/410 : la subscription est morte, on la supprime.
            this.state.storage.sql.exec('DELETE FROM push_subs WHERE endpoint = ?', row.endpoint);
          }
        } catch {
          // endpoint injoignable : on ignore
        }
      }),
    );
  }

  private sockets(): { ws: WebSocket; att: Attachment | null }[] {
    return this.state.getWebSockets().map((ws) => ({ ws, att: ws.deserializeAttachment() as Attachment | null }));
  }

  private forward(to: string, msg: unknown): void {
    for (const { ws, att } of this.sockets()) {
      if (att?.id === to) {
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          // socket fermé
        }
      }
    }
  }

  private broadcastPresence(): void {
    const cameras = this.sockets()
      .filter((s) => s.att?.role === 'camera')
      .map((s) => ({ id: s.att!.id, name: s.att!.name, ts: Date.now() }));
    this.broadcast({ type: 'presence', cameras });
  }

  private broadcast(msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const { ws } of this.sockets()) {
      try {
        ws.send(text);
      } catch {
        // socket fermé
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const room = new URL(request.url).searchParams.get('room') ?? 'default';
    const id = env.ROOM.idFromName(room);
    return env.ROOM.get(id).fetch(request);
  },
};
