import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { approvePending, createRoom, startCamera } from './pairing-helper';
import { killMockRelay, startMockRelay, type MockRelay } from './mock-relay';
import { exportPublicKeyB64, generateDeviceKeyPair, signDeviceAuth } from '../src/shared/device-auth';

// Client WebSocket brut pour tester le relais directement (hors navigateur).
class RawClient {
  readonly messages: Record<string, unknown>[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.messages.push(JSON.parse(d.toString()) as Record<string, unknown>));
  }
  async waitFor(type: string, timeout = 10_000): Promise<Record<string, unknown>> {
    const start = Date.now();
    for (;;) {
      const found = this.messages.find((m) => m.type === type);
      if (found) return found;
      if (Date.now() - start > timeout) throw new Error(`timeout en attente d'un message '${type}'`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
}

async function joinRaw(relay: MockRelay, room: string, pubkey: string, name: string): Promise<{ client: RawClient; cameraId: string }> {
  const ws = new WebSocket(`${relay.url}?room=${encodeURIComponent(room)}`);
  const client = new RawClient(ws);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  client.send({ type: 'join', role: 'viewer', name, pubkey });
  await client.waitFor('welcome');
  const presence = await client.waitFor('presence');
  const cameras = (presence.cameras as { id: string }[]) ?? [];
  return { client, cameraId: cameras[0].id };
}

test('appairage par paire de clés : signature vérifiée par le relais, approbation caméra persistée, ré-approbation auto, révocation', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  await startCamera(cam, relay.url);
  const room = await createRoom(cam);

  const pair = await generateDeviceKeyPair();
  const pubkey = await exportPublicKeyB64(pair.publicKey);

  // 1) requête sans signature valide -> rejetée par le relais, aucune demande côté caméra
  const raw = await joinRaw(relay, room, pubkey, 'Viewer brut');
  raw.client.send({ type: 'request', to: raw.cameraId, pubkey, ts: Date.now(), sig: 'AAAA' });
  await raw.client.waitFor('rejected');
  await expect(cam.locator('#pending-requests li')).toHaveCount(0);

  // 2) requête signée avec une clé inconnue -> transmise comme non approuvée (demande en attente)
  const ts1 = Date.now();
  const auth1 = await signDeviceAuth(pair.privateKey, pubkey, raw.cameraId, ts1);
  raw.client.send({ type: 'request', to: raw.cameraId, ...auth1 });
  await expect(cam.locator('#pending-requests li')).toHaveCount(1);

  // 3) approbation manuelle côté caméra -> offre reçue, clé enregistrée côté caméra dans le relais
  await approvePending(cam);
  await raw.client.waitFor('signal');

  // 4) reconnexion avec la même paire de clés (nouveau socket) -> ré-approbation automatique
  const raw2 = await joinRaw(relay, room, pubkey, 'Viewer brut');
  const auth2 = await signDeviceAuth(pair.privateKey, pubkey, raw2.cameraId, ts1 + 1000);
  raw2.client.send({ type: 'request', to: raw2.cameraId, ...auth2 });
  await raw2.client.waitFor('signal'); // offre reçue sans nouveau clic côté caméra
  await expect(cam.locator('#pending-requests li')).toHaveCount(0);

  // 5) révocation côté caméra -> la clé n'est plus approuvée, la prochaine requête redevient en attente
  // (hook debug : la section #viewers est masquée tant que la caméra est sur la vue #/pair)
  await cam.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { revokeFirst?: () => void } }).__babycam;
    bc?.revokeFirst?.();
  });
  await expect(cam.locator('#viewers li')).toHaveCount(1); // le 2e peer (même clé) reste listé
  const raw3 = await joinRaw(relay, room, pubkey, 'Viewer brut');
  const auth3 = await signDeviceAuth(pair.privateKey, pubkey, raw3.cameraId, ts1 + 2000);
  raw3.client.send({ type: 'request', to: raw3.cameraId, ...auth3 });
  await expect(cam.locator('#pending-requests li')).toHaveCount(1);

  raw.client.ws.close();
  raw2.client.ws.close();
  raw3.client.ws.close();
  await camCtx.close();
  await killMockRelay(relay);
});
