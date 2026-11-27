import { expect, test } from '@playwright/test';
import { createRoom, joinRoomAndConnect, startCamera } from './pairing-helper';
import { killMockRelay, startMockRelay } from './mock-relay';

// Chiffrement E2E de la signalisation : après appairage, le relais n'a vu passer
// que des payloads chiffrés (BCAM1/E1/…) et un identifiant de salon hashé —
// jamais le code de salon, le SDP ni les candidats ICE en clair.
test('E2EE : le relais ne voit que du chiffré (AES-GCM, clé dérivée du code de salon)', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  try {
    await startCamera(cam, relay.url);
    const room = await createRoom(cam);
    await joinRoomAndConnect(view, relay.url, room);
    await expect(cam.locator('#viewers li')).toHaveCount(1);

    // L'URL de connexion au relais ne contient pas le code de salon en clair.
    expect(relay.seen.urls.length).toBeGreaterThan(0);
    for (const url of relay.seen.urls) {
      const roomParam = new URL(`http://relay${url}`).searchParams.get('room') ?? '';
      expect(roomParam).toMatch(/^[0-9a-f]{64}$/);
      expect(roomParam).not.toBe(room);
    }

    // Toutes les trames signal/candidate vues par le relais sont chiffrées.
    const frames = relay.seen.messages.map((t) => JSON.parse(t) as Record<string, unknown>);
    const signalFrames = frames.filter((m) => m.type === 'signal' || m.type === 'candidate');
    expect(signalFrames.length).toBeGreaterThan(0);
    for (const m of signalFrames) {
      const payload = (m.type === 'signal' ? m.msg : m.candidate) as unknown;
      expect(typeof payload).toBe('string');
      expect(payload as string).toMatch(/^BCAM1\/E1\//);
    }

    // Aucun SDP en clair sur le fil ('=' n'existe pas en base64url).
    const raw = relay.seen.messages.join('\n');
    expect(raw).not.toContain('v=0');
    expect(raw).not.toContain('a=ice');
    expect(raw).not.toContain('candidate:');
  } finally {
    await camCtx.close();
    await viewCtx.close();
    await killMockRelay(relay);
  }
});
