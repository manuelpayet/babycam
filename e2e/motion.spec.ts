import { test } from '@playwright/test';
import { pairViaRoom, startCamera } from './pairing-helper';
import { shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';

test('détection de mouvement : sensibilité max + vidéo factice animée → alerte "motion"', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam, relay.url);
  await pairViaRoom(cam, view, relay.url);

  await view.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('#motion-sens')!;
    el.value = '100';
    el.dispatchEvent(new Event('input'));
  });

  await cam.waitForFunction(
    () => {
      const bc = (window as unknown as { __babycam?: { getMotionRatioThreshold?: () => number | null } })
        .__babycam;
      const r = bc?.getMotionRatioThreshold?.();
      return typeof r === 'number' && r <= 0.01;
    },
    null,
    { timeout: 10_000 },
  );

  await view.waitForFunction(
    () => {
      const bc = (window as unknown as { __babycam?: { getDataLog?: () => { type: string; kind?: string }[] } })
        .__babycam;
      const log = bc?.getDataLog?.() ?? [];
      return log.some((m) => m.type === 'alert' && m.kind === 'motion');
    },
    null,
    { timeout: 20_000 },
  );

  await shot(cam, 'I2.2-camera-motion-detect');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
