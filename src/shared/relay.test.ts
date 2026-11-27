import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { DEFAULT_RELAY_URL, backoffDelayMs, newRoomCode, relayUrlFromLocation, RelayClient } from './relay';

describe('relay', () => {
  it('newRoomCode : 6 caractères dans l’alphabet sans ambiguïté', () => {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 50; i++) {
      const code = newRoomCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(alphabet).toContain(ch);
    }
  });

  it('newRoomCode : codes différents à chaque appel', () => {
    const codes = new Set(Array.from({ length: 100 }, () => newRoomCode()));
    expect(codes.size).toBeGreaterThan(90);
  });

  it('backoffDelayMs : exponentiel, plafonné à 30s', () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(10)).toBe(30_000);
    expect(backoffDelayMs(100)).toBe(30_000);
    expect(backoffDelayMs(-3)).toBe(1000);
  });
});

describe('relayUrlFromLocation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('DEFAULT_RELAY_URL pointe vers le worker déployé (wss)', () => {
    expect(DEFAULT_RELAY_URL).toMatch(/^wss:\/\/babycam-relay\.[a-z0-9-]+\.workers\.dev$/);
  });

  it('?relay=<url> est prioritaire sur le défaut', () => {
    vi.stubGlobal('location', { search: '?relay=wss%3A%2F%2F127.0.0.1%3A8787' });
    expect(relayUrlFromLocation()).toBe('wss://127.0.0.1:8787');
  });

  it('sans paramètre, retombe sur DEFAULT_RELAY_URL (le relais est obligatoire)', () => {
    vi.stubGlobal('location', { search: '' });
    expect(relayUrlFromLocation()).toBe(DEFAULT_RELAY_URL);
  });
});

describe('RelayClient (chiffrement E2E sur le fil)', () => {
  interface CapturedRelay {
    wss: WebSocketServer;
    url: string;
    urls: string[];
    messages: string[];
  }

  // Relais minimal qui route par salon (comme relay/src/index.ts) et capture
  // l'URL de connexion et toutes les trames brutes reçues.
  async function startCapturedRelay(): Promise<CapturedRelay> {
    const urls: string[] = [];
    const messages: string[] = [];
    const clients = new Map<WsSocket, { id: string; role: string; room: string }>();
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    wss.on('connection', (ws, req) => {
      urls.push(req.url ?? '');
      ws.on('message', (data) => {
        const text = data.toString();
        messages.push(text);
        const m = JSON.parse(text) as Record<string, unknown>;
        if (m.type === 'join') {
          const room = new URL(`http://relay${req.url ?? ''}`).searchParams.get('room') ?? 'default';
          const client = { id: crypto.randomUUID(), role: String(m.role), room };
          clients.set(ws, client);
          ws.send(JSON.stringify({ type: 'welcome', id: client.id }));
          const cameras = [...clients.values()]
            .filter((c) => c.room === room && c.role === 'camera')
            .map((c) => ({ id: c.id, name: 'Caméra', ts: Date.now() }));
          for (const [sock, cl] of clients) {
            if (cl.room === room) sock.send(JSON.stringify({ type: 'presence', cameras }));
          }
        } else {
          const c = clients.get(ws);
          if (c && ['request', 'signal', 'candidate'].includes(m.type as string)) {
            for (const [sock, cl] of clients) {
              if (cl.id === m.to) sock.send(JSON.stringify({ ...m, from: c.id }));
            }
          }
        }
      });
      ws.on('close', () => clients.delete(ws));
    });
    await new Promise<void>((resolve, reject) => {
      wss.on('error', reject);
      wss.on('listening', () => resolve());
    });
    const addr = wss.address() as AddressInfo;
    return { wss, url: `ws://127.0.0.1:${addr.port}`, urls, messages };
  }

  async function stopRelay(relay: CapturedRelay): Promise<void> {
    await new Promise<void>((resolve) => {
      for (const client of relay.wss.clients) client.terminate();
      relay.wss.close(() => resolve());
    });
  }

  it('signal/candidate chiffrés de bout en bout : le relais ne voit que du chiffré et un salon hashé', async () => {
    const relay = await startCapturedRelay();
    try {
      const cam = new RelayClient(relay.url);
      const view = new RelayClient(relay.url);
      await cam.connect('ABC234', 'camera', 'Caméra');
      await view.connect('ABC234', 'viewer', 'Viewer');
      await vi.waitFor(() => {
        expect(cam.id).not.toBe('');
        expect(view.id).not.toBe('');
      });

      const signals: [string, unknown][] = [];
      const candidates: [string, unknown][] = [];
      view.onSignal = (from, msg) => signals.push([from, msg]);
      view.onCandidate = (from, c) => candidates.push([from, c]);

      const offer = { v: 1, t: 'offer', sdp: 'v=0\r\no=- SDP_SECRET_OFFER\r\n' };
      const cand = { candidate: 'candidate:1 1 udp 211 CANDIDATE_SECRET' };
      cam.signal(view.id, offer);
      cam.candidate(view.id, cand);
      await vi.waitFor(
        () => {
          expect(signals).toHaveLength(1);
          expect(candidates).toHaveLength(1);
        },
        { timeout: 5_000 },
      );

      // Le destinataire reçoit le message déchiffré, attribué au bon émetteur.
      expect(signals[0][0]).toBe(cam.id);
      expect(signals[0][1]).toEqual(offer);
      expect(candidates[0][0]).toBe(cam.id);
      expect(candidates[0][1]).toEqual(cand);

      // L'URL de connexion ne contient pas le code de salon en clair.
      expect(relay.urls.length).toBeGreaterThan(0);
      for (const url of relay.urls) {
        const roomParam = new URL(`http://relay${url}`).searchParams.get('room') ?? '';
        expect(roomParam).toMatch(/^[0-9a-f]{64}$/);
        expect(roomParam).not.toContain('ABC234');
      }

      // Le relais n'a vu passer que des payloads chiffrés, sans aucun clair.
      const frames = relay.messages.map((t) => JSON.parse(t) as Record<string, unknown>);
      const signalFrames = frames.filter((m) => m.type === 'signal');
      const candidateFrames = frames.filter((m) => m.type === 'candidate');
      expect(signalFrames).toHaveLength(1);
      expect(candidateFrames).toHaveLength(1);
      for (const m of [...signalFrames, ...candidateFrames]) {
        const payload = (m.type === 'signal' ? m.msg : m.candidate) as unknown;
        expect(typeof payload).toBe('string');
        expect(payload as string).toMatch(/^BCAM1\/E1\//);
      }
      const raw = relay.messages.join('\n');
      expect(raw).not.toContain('SDP_SECRET_OFFER');
      expect(raw).not.toContain('CANDIDATE_SECRET');
      expect(raw).not.toContain('v=0');

      cam.close();
      view.close();
    } finally {
      await stopRelay(relay);
    }
  });

  it('préserve l’ordre des signaux malgré le chiffrement asynchrone', async () => {
    const relay = await startCapturedRelay();
    try {
      const cam = new RelayClient(relay.url);
      const view = new RelayClient(relay.url);
      await cam.connect('ABC234', 'camera', 'Caméra');
      await view.connect('ABC234', 'viewer', 'Viewer');
      await vi.waitFor(() => expect(view.id).not.toBe(''));
      const received: unknown[] = [];
      view.onSignal = (_from, msg) => received.push(msg);
      for (let i = 0; i < 8; i++) cam.signal(view.id, { v: 1, t: 'offer', sdp: `sdp-${i}` });
      await vi.waitFor(() => expect(received).toHaveLength(8), { timeout: 5_000 });
      expect(received.map((m) => (m as { sdp: string }).sdp)).toEqual(Array.from({ length: 8 }, (_, i) => `sdp-${i}`));
      cam.close();
      view.close();
    } finally {
      await stopRelay(relay);
    }
  });
});
