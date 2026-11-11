export interface Env {
  ROOM: DurableObjectNamespace;
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
export class RoomDO {
  constructor(private state: DurableObjectState) {}

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
    }
  }

  async webSocketClose(): Promise<void> {
    this.broadcastPresence();
  }

  async webSocketError(): Promise<void> {
    this.broadcastPresence();
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
