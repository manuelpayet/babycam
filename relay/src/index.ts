import { AUTH_TS_WINDOW_MS, verifyDeviceAuth } from '../../src/shared/device-auth';

export interface Env {
  ROOM: DurableObjectNamespace;
}

interface Attachment {
  id: string;
  role: 'camera' | 'viewer' | null;
  name: string;
  pubkey: string;
}

// L'état du salon vit dans les attachments des WebSockets (serializeAttachment),
// PAS dans une Map en mémoire : un Durable Object peut être évincé à tout moment
// (hibernation), et seule l'attachment survit à l'éviction. getWebSockets() renvoie
// les sockets hibernés, donc la présence reste correcte même après éviction.
//
// Appairage par paire de clés : chaque appareil déclare sa clé publique ECDSA au
// `join` (pubkey). Le viewer signe chaque `request` ; le relais vérifie la signature
// (preuve de possession de la clé privée, l'ancien deviceId copiable ne suffit plus).
// Les clés publiques approuvées sont stockées CÔTÉ CAMÉRA dans le relais
// (approvedDevices, clé = pubkey de la caméra, persistance DO storage) : quand la
// caméra répond (signal) à un viewer, ce viewer est approuvé ; `revoke` le retire.
export class RoomDO {
  // Anti-rejeu : (pubkey|ts|sig) déjà vus, avec expiry. En mémoire seulement (la fenêtre
  // de fraîcheur de ts borne le risque résiduel après une éviction du DO).
  private seenAuth = new Map<string, number>();
  private approvedCache = new Map<string, Set<string>>();

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    const att: Attachment = { id: crypto.randomUUID(), role: null, name: '', pubkey: '' };
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
          pubkey: typeof m.pubkey === 'string' ? m.pubkey.slice(0, 200) : '',
        };
        ws.serializeAttachment(next);
        ws.send(JSON.stringify({ type: 'welcome', id: next.id }));
        this.broadcastPresence();
        break;
      }
      case 'request': {
        if (att.role !== 'viewer' || !att.pubkey) return;
        const to = String(m.to ?? '');
        const ts = Number(m.ts);
        const sig = String(m.sig ?? '');
        if (!this.checkReplay(att.pubkey, ts, sig)) return;
        const ok = await verifyDeviceAuth(att.pubkey, to, ts, sig);
        if (!ok) {
          try {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'auth' }));
          } catch {
            // socket fermé
          }
          return;
        }
        const target = this.sockets().find((s) => s.att?.id === to && s.att.role === 'camera');
        if (!target?.att) return;
        const approved = target.att.pubkey ? await this.isApproved(target.att.pubkey, att.pubkey) : false;
        this.forward(to, { type: 'request', from: att.id, approved, pubkey: att.pubkey, name: att.name });
        break;
      }
      case 'signal':
      case 'candidate': {
        if (!att.role) return;
        // La caméra qui répond à un viewer l'approuve : sa clé publique est enregistrée
        // côté caméra dans le relais (approvedDevices), persistée dans le DO.
        if (m.type === 'signal' && att.role === 'camera' && att.pubkey) {
          const target = this.sockets().find((s) => s.att?.id === m.to);
          if (target?.att?.role === 'viewer' && target.att.pubkey) {
            await this.approve(att.pubkey, target.att.pubkey);
          }
        }
        this.forward(m.to as string, { ...m, from: att.id });
        break;
      }
      case 'revoke': {
        if (att.role !== 'camera' || !att.pubkey) return;
        const target = this.sockets().find((s) => s.att?.id === m.to);
        if (target?.att?.pubkey) await this.unapprove(att.pubkey, target.att.pubkey);
        this.forward(m.to as string, { type: 'revoke', from: att.id });
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

  private checkReplay(pubkey: string, ts: number, sig: string): boolean {
    const now = Date.now();
    const key = `${pubkey}|${ts}|${sig}`;
    if ((this.seenAuth.get(key) ?? 0) > now) return false;
    for (const [k, exp] of this.seenAuth) {
      if (exp <= now) this.seenAuth.delete(k);
    }
    if (this.seenAuth.size > 1000) this.seenAuth.clear();
    this.seenAuth.set(key, now + 2 * AUTH_TS_WINDOW_MS);
    return true;
  }

  private storageKey(cameraPubkey: string): string {
    return `approved:${cameraPubkey}`;
  }

  private async approvedSet(cameraPubkey: string): Promise<Set<string>> {
    let set = this.approvedCache.get(cameraPubkey);
    if (!set) {
      const stored = await this.state.storage.get<string[]>(this.storageKey(cameraPubkey));
      set = new Set(stored ?? []);
      this.approvedCache.set(cameraPubkey, set);
    }
    return set;
  }

  private async isApproved(cameraPubkey: string, viewerPubkey: string): Promise<boolean> {
    return (await this.approvedSet(cameraPubkey)).has(viewerPubkey);
  }

  private async approve(cameraPubkey: string, viewerPubkey: string): Promise<void> {
    const set = await this.approvedSet(cameraPubkey);
    if (set.has(viewerPubkey)) return;
    set.add(viewerPubkey);
    await this.state.storage.put(this.storageKey(cameraPubkey), [...set]);
  }

  private async unapprove(cameraPubkey: string, viewerPubkey: string): Promise<void> {
    const set = await this.approvedSet(cameraPubkey);
    if (!set.delete(viewerPubkey)) return;
    await this.state.storage.put(this.storageKey(cameraPubkey), [...set]);
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
