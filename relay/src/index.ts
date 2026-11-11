export interface Env {
  ROOM: DurableObjectNamespace;
}

interface Client {
  ws: WebSocket;
  id: string;
  role: 'camera' | 'viewer';
  name: string;
}

export class RoomDO {
  private clients = new Map<WebSocket, Client>();

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    const client = this.clients.get(ws);
    switch (m.type) {
      case 'join': {
        const c: Client = {
          ws,
          id: crypto.randomUUID(),
          role: m.role as Client['role'],
          name: String(m.name ?? ''),
        };
        this.clients.set(ws, c);
        ws.send(JSON.stringify({ type: 'welcome', id: c.id }));
        this.broadcastPresence();
        break;
      }
      case 'request':
      case 'signal':
      case 'candidate': {
        if (!client) return;
        this.forward(m.to as string, { ...m, from: client.id });
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.clients.delete(ws);
    this.broadcastPresence();
  }

  private forward(to: string, msg: unknown): void {
    for (const c of this.clients.values()) {
      if (c.id === to) {
        try {
          c.ws.send(JSON.stringify(msg));
        } catch {
          // socket fermée
        }
      }
    }
  }

  private broadcastPresence(): void {
    const cameras = [...this.clients.values()]
      .filter((c) => c.role === 'camera')
      .map((c) => ({ id: c.id, name: c.name, ts: Date.now() }));
    this.broadcast({ type: 'presence', cameras });
  }

  private broadcast(msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      try {
        c.ws.send(text);
      } catch {
        // socket fermée
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
