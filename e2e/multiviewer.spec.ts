import { expect, test } from '@playwright/test';
import { createRoom, joinRoomAndConnect, startCamera } from './pairing-helper';
import { shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';

test('multi-viewers : 1 caméra → 2 viewers via le même salon, révocation', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const view1Ctx = await browser.newContext();
  const view2Ctx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view1 = await view1Ctx.newPage();
  const view2 = await view2Ctx.newPage();

  await startCamera(cam, relay.url);
  const room = await createRoom(cam);
  await joinRoomAndConnect(view1, relay.url, room);
  await joinRoomAndConnect(view2, relay.url, room);

  await expect(cam.locator('#viewers li')).toHaveCount(2);
  await shot(cam, 'I1.7-camera-2viewers');

  await view2.waitForFunction(
    () => {
      const video = document.querySelector<HTMLVideoElement>('#remote');
      return !!video && !!video.srcObject && video.readyState >= 2;
    },
    null,
    { timeout: 30_000 },
  );

  await cam.locator('#viewers li').first().locator('button').click();
  await expect(cam.locator('#viewers li')).toHaveCount(1);

  await camCtx.close();
  await view1Ctx.close();
  await view2Ctx.close();
  await killMockRelay(relay);
});

test('multi-caméras : 1 viewer surveille 2 salons en parallèle (mosaïque)', async ({ browser }) => {
  const relay = await startMockRelay();
  const cam1Ctx = await browser.newContext();
  const cam2Ctx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam1 = await cam1Ctx.newPage();
  const cam2 = await cam2Ctx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam1, relay.url);
  await startCamera(cam2, relay.url);
  const room1 = await createRoom(cam1);
  const room2 = await createRoom(cam2);
  expect(room1).not.toBe(room2);

  // Salon 1 : connexion auto (1 seule caméra dans le salon), la tuile #remote apparaît.
  await joinRoomAndConnect(view, relay.url, room1);

  // Retour à la page d'appairage pour rejoindre le salon 2 (2e chambre).
  await view.click('#pair-again');
  await view.fill('#room-input', room2);
  await view.click('#join-room-btn');

  // Mosaïque : 2 tuiles, toutes deux avec un flux vidéo actif.
  await expect(view.locator('#videos .tile')).toHaveCount(2, { timeout: 30_000 });
  await view.waitForFunction(
    () => {
      const vids = [...document.querySelectorAll<HTMLVideoElement>('#videos video')];
      return vids.length === 2 && vids.every((v) => !!v.srcObject && v.readyState >= 2);
    },
    null,
    { timeout: 30_000 },
  );
  // Les 2 salons sont bien isolés : la liste agrège les caméras des 2 salons.
  await expect(view.locator('#camera-list button')).toHaveCount(2, { timeout: 30_000 });
  await expect(view.locator('#videos .tile').first().locator('.tile-state')).toContainText(room1);
  await expect(view.locator('#videos .tile').nth(1).locator('.tile-state')).toContainText(room2);
  await expect(cam1.locator('#viewers li')).toHaveCount(1);
  await expect(cam2.locator('#viewers li')).toHaveCount(1);
  await shot(view, 'I6.1-viewer-2cameras');

  // Une alerte de la 2e caméra remonte bien sur le viewer (avec son nom dans l'historique).
  await cam2.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { sendToAll?: (m: unknown) => void } }).__babycam;
    bc?.sendToAll?.({ type: 'alert', kind: 'motion', level: 42, ts: Date.now() });
  });
  await expect(view.locator('#alert-banner')).toContainText(/mouvement|motion/i);
  await expect(view.locator('#alert-history li').first()).toContainText(/caméra|camera/i);

  // Quitter la 2e caméra : il reste 1 tuile.
  await view.locator('#videos .tile').nth(1).locator('button').click();
  await expect(view.locator('#videos .tile')).toHaveCount(1);
  await expect(view.locator('#remote')).toHaveCount(1);

  await cam1Ctx.close();
  await cam2Ctx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
