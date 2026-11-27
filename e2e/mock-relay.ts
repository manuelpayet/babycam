import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { AUTH_TS_WINDOW_MS, verifyDeviceAuth } from '../src/shared/device-auth';

export interface MockRelay {
  wss: WebSocketServer;
  url: string;
  port: number;
}

interface RelayClientInfo {
  id: string;
  role: string;
  name: string;
  pubkey: string;
}

// Mock du worker RoomDO : mêmes règles d'approbation par paire de clés — le viewer
// signe chaque `request`, le relais vérifie, et les clés publiques approuvées sont
// stockées côté caméra (clé = pubkey caméra) quand la caméra répond (signal).
export function startMockRelay(port = 0): Promise<MockRelay> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, host: '127.0.0.1' });
    wss.on('error', reject);
    const clients = new Map<WebSocket, RelayClientInfo>();
    const approved = new Map<string, Set<string>>(); // pubkey caméra -> pubkeys viewers approuvées
    const seenAuth = new Map<string, number>();
    const isApproved = (cameraPubkey: string, viewerPubkey: string): boolean =>
      approved.get(cameraPubkey)?.has(viewerPubkey) ?? false;
    const checkReplay = (pubkey: string, ts: number, sig: string): boolean => {
      const now = Date.now();
      const key = `${pubkey}|${ts}|${sig}`;
      if ((seenAuth.get(key) ?? 0) > now) return false;
      for (const [k, exp] of seenAuth) if (exp <= now) seenAuth.delete(k);
      if (seenAuth.size > 1000) seenAuth.clear();
      seenAuth.set(key, now + 2 * AUTH_TS_WINDOW_MS);
      return true;
    };
    const broadcast = () => {
      const cameras = [...clients.values()]
        .filter((c) => c.role === 'camera')
        .map((c) => ({ id: c.id, name: c.name, ts: Date.now() }));
      const text = JSON.stringify({ type: 'presence', cameras });
      for (const sock of clients.keys()) sock.send(text);
    };
    const forward = (to: string, msg: unknown) => {
      for (const [sock, cl] of clients) {
        if (cl.id === to) sock.send(JSON.stringify(msg));
      }
    };
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const m = JSON.parse(data.toString()) as Record<string, unknown>;
        const c = clients.get(ws);
        if (m.type === 'join') {
          const client: RelayClientInfo = {
            id: crypto.randomUUID(),
            role: m.role as string,
            name: String(m.name),
            pubkey: typeof m.pubkey === 'string' ? m.pubkey.slice(0, 200) : '',
          };
          clients.set(ws, client);
          ws.send(JSON.stringify({ type: 'welcome', id: client.id }));
          broadcast();
        } else if (m.type === 'request' && c) {
          if (c.role !== 'viewer' || !c.pubkey) return;
          const to = String(m.to ?? '');
          const ts = Number(m.ts);
          const sig = String(m.sig ?? '');
          if (!checkReplay(c.pubkey, ts, sig)) return;
          void verifyDeviceAuth(c.pubkey, to, ts, sig).then((ok) => {
            if (!ok) {
              ws.send(JSON.stringify({ type: 'rejected', reason: 'auth' }));
              return;
            }
            const target = [...clients.values()].find((cl) => cl.id === to && cl.role === 'camera');
            if (!target) return;
            const isOk = target.pubkey ? isApproved(target.pubkey, c.pubkey) : false;
            forward(to, { type: 'request', from: c.id, approved: isOk, pubkey: c.pubkey, name: c.name });
          });
        } else if (c && m.type === 'signal' && c.role === 'camera' && c.pubkey) {
          const target = [...clients.values()].find((cl) => cl.id === m.to);
          if (target?.role === 'viewer' && target.pubkey) {
            const set = approved.get(c.pubkey) ?? new Set<string>();
            set.add(target.pubkey);
            approved.set(c.pubkey, set);
          }
          forward(m.to as string, { ...m, from: c.id });
        } else if (c && m.type === 'revoke' && c.role === 'camera') {
          const target = [...clients.values()].find((cl) => cl.id === m.to);
          if (target?.pubkey) approved.get(c.pubkey)?.delete(target.pubkey);
          forward(m.to as string, { type: 'revoke', from: c.id });
        } else if (c && ['signal', 'candidate'].includes(m.type as string)) {
          forward(m.to as string, { ...m, from: c.id });
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
