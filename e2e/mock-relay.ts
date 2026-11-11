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
}

export function startMockRelay(port = 0): Promise<MockRelay> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, host: '127.0.0.1' });
    wss.on('error', reject);
    const clients = new Map<WebSocket, RelayClientInfo>();
    const broadcast = () => {
      const cameras = [...clients.values()]
        .filter((c) => c.role === 'camera')
        .map((c) => ({ id: c.id, name: c.name, ts: Date.now() }));
      const text = JSON.stringify({ type: 'presence', cameras });
      for (const sock of clients.keys()) sock.send(text);
    };
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const m = JSON.parse(data.toString()) as Record<string, unknown>;
        const c = clients.get(ws);
        if (m.type === 'join') {
          const client: RelayClientInfo = { id: crypto.randomUUID(), role: m.role as string, name: String(m.name) };
          clients.set(ws, client);
          ws.send(JSON.stringify({ type: 'welcome', id: client.id }));
          broadcast();
        } else if (c && ['request', 'signal', 'candidate'].includes(m.type as string)) {
          for (const [sock, cl] of clients) {
            if (cl.id === m.to) sock.send(JSON.stringify({ ...m, from: c.id }));
          }
        }
      });
      ws.on('close', () => {
        clients.delete(ws);
        broadcast();
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
