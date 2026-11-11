import { expect, test } from '@playwright/test';
import { killMockRelay, startMockRelay } from './mock-relay';
import { shot } from './helpers';

test('découverte par salon : la caméra publie sa présence, le viewer rejoint et reçoit le flux', async ({ browser }) => {
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
  await cam.click('#create-room-btn');
  await expect(cam.locator('#room-code')).not.toBeHidden();
  const room = (await cam.locator('#room-code').textContent())!.trim();
  expect(room).toHaveLength(6);

  await view.goto(`viewer.html?stun=0&debug=1&relay=${relayParam}`);
  await view.fill('#room-input', room);
  await view.click('#join-room-btn');
  await expect(view.locator('#camera-list button')).toHaveCount(1);
  await shot(view, 'I2.4-viewer-room-list');

  await view.locator('#camera-list button').first().click();
  await view.waitForFunction(
    () => {
      const video = document.querySelector<HTMLVideoElement>('#remote');
      return !!video && !!video.srcObject && video.readyState >= 2;
    },
    null,
    { timeout: 30_000 },
  );
  await expect(cam.locator('#viewers li')).toHaveCount(1);
  await shot(cam, 'I2.4-camera-room');
  await shot(view, 'I2.4-viewer-discovered');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
