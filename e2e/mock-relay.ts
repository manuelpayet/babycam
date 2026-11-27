import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export interface MockRelay {
  wss: WebSocketServer;
  url: string;
  port: number;
  /** subscriptions push reçues, indexées par endpoint */
  pushSubs: Map<string, unknown>;
  /** nombre de push-ack envoyés */
  pushAcks: number;
  /** alertes reçues des caméras */
  alerts: { kind: string; level: number; ts: number; from: string }[];
  /** somme des abonnés push ciblés par les alertes (ce qu'un vrai relais pousserait) */
  pushTargets: number;
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
    const state = {
      pushSubs: new Map<string, unknown>(),
      pushAcks: 0,
      alerts: [] as { kind: string; level: number; ts: number; from: string }[],
      pushTargets: 0,
    };
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
        } else if (m.type === 'push') {
          // Un viewer enregistre sa subscription Web Push (le vrai relais la stocke
          // et l'utilise pour pousser les alertes ; ici on la mémorise juste).
          const sub = m.sub as { endpoint?: string } | undefined;
          if (c && typeof sub?.endpoint === 'string') {
            state.pushSubs.set(sub.endpoint, sub);
            state.pushAcks++;
            ws.send(JSON.stringify({ type: 'push-ack', ok: true }));
          } else {
            ws.send(JSON.stringify({ type: 'push-ack', ok: false }));
          }
        } else if (m.type === 'alert') {
          // Une caméra signale une alerte : le vrai relais enverrait un Web Push
          // à chaque subscription du salon.
          if (c) {
            state.alerts.push({ kind: String(m.kind), level: Number(m.level), ts: Number(m.ts), from: c.id });
            state.pushTargets += state.pushSubs.size;
          }
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
      resolve({
        wss,
        url: `ws://127.0.0.1:${addr.port}`,
        port: addr.port,
        pushSubs: state.pushSubs,
        alerts: state.alerts,
        // getters : les compteurs sont mutés après le resolve
        get pushAcks() {
          return state.pushAcks;
        },
        get pushTargets() {
          return state.pushTargets;
        },
      });
    });
  });
}

export function killMockRelay(relay: MockRelay): Promise<void> {
  return new Promise((resolve) => {
    for (const client of relay.wss.clients) client.terminate();
    relay.wss.close(() => resolve());
  });
}
