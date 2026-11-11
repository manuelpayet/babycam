import { expect, test } from '@playwright/test';
import { pairViaPaste, startCamera } from './pairing-helper';
import { shot } from './helpers';

test('viewer : activer le son après appairage', async ({ browser }) => {
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam);
  await pairViaPaste(cam, view);

  const mutedBefore = await view.evaluate(() => document.querySelector<HTMLVideoElement>('#remote')!.muted);
  expect(mutedBefore).toBe(true);

  await view.click('#unmute-btn');
  const mutedAfter = await view.evaluate(() => document.querySelector<HTMLVideoElement>('#remote')!.muted);
  expect(mutedAfter).toBe(false);

  await shot(view, 'I1.8-viewer-unmuted');

  await camCtx.close();
  await viewCtx.close();
});
