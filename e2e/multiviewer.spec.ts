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
