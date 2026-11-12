import { expect, test } from '@playwright/test';
import { pairViaRoom, startCamera } from './pairing-helper';
import { shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';

test('alerte bruit de bout en bout : bannière + historique côté viewer', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam, relay.url);
  await pairViaRoom(cam, view, relay.url);

  await cam.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { sendToAll?: (m: unknown) => void } }).__babycam;
    bc?.sendToAll?.({ type: 'alert', kind: 'noise', level: -18, ts: Date.now() });
  });

  await expect(view.locator('#alert-banner')).toBeVisible();
  await expect(view.locator('#alert-banner')).toContainText(/bruit|noise/i);
  await expect(view.locator('#alert-history li')).toHaveCount(1);
  await shot(view, 'I2.3-viewer-alert');

  await cam.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { sendToAll?: (m: unknown) => void } }).__babycam;
    bc?.sendToAll?.({ type: 'alert', kind: 'motion', level: 12, ts: Date.now() });
  });

  await expect(view.locator('#alert-banner')).toContainText(/mouvement|motion/i);
  await expect(view.locator('#alert-history li')).toHaveCount(2);
  await shot(view, 'I2.3-viewer-alert-motion');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
