import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export interface MockRelay {
  wss: WebSocketServer;
  url: string;
  port: number;
}

interface RelayClientInfo {
  id: string;
  role: string;
  name: string;
  room: string;
}

export function startMockRelay(port = 0): Promise<MockRelay> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, host: '127.0.0.1' });
    wss.on('error', reject);
    const clients = new Map<WebSocket, RelayClientInfo>();
    // Comme le worker réel (RoomDO isolé par ?room=) : présence et routage intra-salon uniquement.
    const broadcast = (room: string) => {
      const cameras = [...clients.values()]
        .filter((c) => c.role === 'camera' && c.room === room)
        .map((c) => ({ id: c.id, name: c.name, ts: Date.now() }));
      const text = JSON.stringify({ type: 'presence', cameras });
      for (const [sock, c] of clients) {
        if (c.room === room) sock.send(text);
      }
    };
    wss.on('connection', (ws, req) => {
      const room = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('room') ?? 'default';
      ws.on('message', (data) => {
        const m = JSON.parse(data.toString()) as Record<string, unknown>;
        const c = clients.get(ws);
        if (m.type === 'join') {
          const client: RelayClientInfo = { id: crypto.randomUUID(), role: m.role as string, name: String(m.name), room };
          clients.set(ws, client);
          ws.send(JSON.stringify({ type: 'welcome', id: client.id }));
          broadcast(room);
        } else if (c && ['request', 'signal', 'candidate'].includes(m.type as string)) {
          for (const [sock, cl] of clients) {
            if (cl.id === m.to && cl.room === c.room) sock.send(JSON.stringify({ ...m, from: c.id }));
          }
        }
      });
      ws.on('close', () => {
        const c = clients.get(ws);
        clients.delete(ws);
        if (c) broadcast(c.room);
      });
    });
    wss.on('listening', () => {
      const addr = wss.address() as AddressInfo;
      resolve({ wss, url: `ws://127.0.0.1:${addr.port}`, port: addr.port });
    });
  });
}

export function killMockRelay(relay: MockRelay): Promise<void> {
  return new Promise((resolve) => {
    for (const client of relay.wss.clients) client.terminate();
    relay.wss.close(() => resolve());
  });
}
