import { expect, test } from '@playwright/test';
import { decodeMessage } from '../src/shared/signaling';
import { shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';
import { pairViaPaste, startCamera } from './pairing-helper';

test('I3.6 salon (relais) : trickle ICE, tous les codecs vidéo offerts, panneau diag avec IP des candidats', async ({ browser }) => {
  const relay = await startMockRelay();
  const relayParam = encodeURIComponent(relay.url);
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await cam.goto(`camera.html?stun=0&debug=1&relay=${relayParam}`);
  await cam.click('#start-btn');
  await cam.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });
  await cam.click('#pair-btn');
  await cam.waitForFunction(
    () => {
      const bc = (window as unknown as { __babycam?: { getRoomCode?: () => string } }).__babycam;
      return (bc?.getRoomCode?.() ?? '') !== '';
    },
    null,
    { timeout: 15_000 },
  );
  const room = await cam.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { getRoomCode?: () => string } }).__babycam;
    return bc?.getRoomCode?.() ?? '';
  });
  expect(room).toMatch(/^[A-Z2-9]{6}$/);

  await view.goto(`viewer.html?stun=0&debug=1&relay=${relayParam}`);
  await view.fill('#room-input', room);
  await view.click('#join-room-btn');
  await view.waitForFunction(
    () => {
      const video = document.querySelector<HTMLVideoElement>('#remote');
      return !!video && !!video.srcObject && video.readyState >= 2;
    },
    null,
    { timeout: 30_000 },
  );
  await expect(cam.locator('#viewers li')).toHaveCount(1);
  await expect(view.locator('#camera-list li')).toHaveCount(1);
  await expect(view.locator('#diag-relay')).toContainText('cameras=1');

  const remoteSdp = await view.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { getRemoteSdp?: () => string | null } }).__babycam;
    return bc?.getRemoteSdp?.() ?? '';
  });
  const mVideo = remoteSdp.split('\r\n').find((l) => l.startsWith('m=video'))!;
  expect(mVideo.split(' ').slice(3).length).toBeGreaterThan(1);

  await expect(cam.locator('#video-codec')).toBeHidden();
  await expect(cam.locator('label[for="video-codec"]')).toBeHidden();

  await cam.locator('#diag').evaluate((d) => {
    (d as HTMLDetailsElement).open = true;
  });
  await expect(cam.locator('#diag-relay')).toContainText('ws=1');
  await expect(cam.locator('#diag-peers li')).toContainText(/connected/);
  await expect(cam.locator('#diag-peers li')).toContainText(/:\d+ \(host\)/);
  await shot(cam, 'I3.6-camera-diag');

  await view.locator('#diag').evaluate((d) => {
    (d as HTMLDetailsElement).open = true;
  });
  await expect(view.locator('#diag-peers li')).toContainText(/connected/);
  await shot(view, 'I3.6-viewer-diag');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});

test('I3.6 QR local (relay=0) : 1 seul codec vidéo dans l offre + diag indique relais désactivé', async ({ browser }) => {
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();
  await startCamera(cam);
  await pairViaPaste(cam, view);
  await expect(cam.locator('#viewers li')).toHaveCount(1);

  const payload = await cam.locator('#offer-payload').inputValue();
  const msg = decodeMessage(payload);
  const mVideo = msg.sdp!.split('\r\n').find((l) => l.startsWith('m=video'))!;
  expect(mVideo.split(' ').slice(3)).toHaveLength(1);

  await expect(cam.locator('#video-codec')).toBeVisible();

  await expect(cam.locator('#diag-relay')).toContainText(/désactivé|disabled/i);
  await cam.locator('#diag').evaluate((d) => {
    (d as HTMLDetailsElement).open = true;
  });
  await expect(cam.locator('#diag-peers li')).toContainText(/connected/);
  await expect(cam.locator('#diag-peers li')).toContainText(/:\d+ \(host\)/);
  await shot(cam, 'I3.6-camera-diag-qr');

  await camCtx.close();
  await viewCtx.close();
});
