import { expect, test } from '@playwright/test';
import { pairViaPaste, startCamera } from './pairing-helper';
import { shot } from './helpers';

test('appairage QR complet caméra ↔ viewer : le flux A/V arrive', async ({ browser }) => {
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam);
  await pairViaPaste(cam, view);

  await expect(cam.locator('#viewers li')).toHaveCount(1);
  await expect(cam.locator('#viewers li')).toContainText('Viewer');
  await expect(view.locator('#status')).toContainText(/Connecté|Connected/i);

  const kinds = await view.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#remote')!;
    return (video.srcObject as MediaStream).getTracks().map((track) => track.kind).sort();
  });
  expect(kinds).toEqual(['audio', 'video']);

  await shot(cam, 'I1.6-camera-paired');
  await shot(view, 'I1.6-viewer-stream');

  await camCtx.close();
  await viewCtx.close();
});

test('la caméra voit le statut de connexion du peer', async ({ browser }) => {
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam);
  await pairViaPaste(cam, view);

  await cam.waitForFunction(
    () => {
      const bc = (window as unknown as { __babycam?: { getPeers?: () => { state: string }[] } }).__babycam;
      const peers = bc?.getPeers?.() ?? [];
      return peers.some((p) => p.state === 'connected');
    },
    null,
    { timeout: 30_000 },
  );

  await camCtx.close();
  await viewCtx.close();
});
