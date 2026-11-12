import { expect, test } from '@playwright/test';
import { pairViaRoom, startCamera } from './pairing-helper';
import { shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';

test('viewer : activer le son après appairage', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam, relay.url);
  await pairViaRoom(cam, view, relay.url);

  const mutedBefore = await view.evaluate(() => document.querySelector<HTMLVideoElement>('#remote')!.muted);
  expect(mutedBefore).toBe(true);

  await view.click('#unmute-btn');
  const mutedAfter = await view.evaluate(() => document.querySelector<HTMLVideoElement>('#remote')!.muted);
  expect(mutedAfter).toBe(false);

  await shot(view, 'I1.8-viewer-unmuted');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
