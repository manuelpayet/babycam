import { test } from '@playwright/test';
import { pairViaRoom, startCamera } from './pairing-helper';
import { shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';

test('détection de bruit : seuil à 0 + micro factice → alerte "noise" reçue par le viewer', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam, relay.url);
  await pairViaRoom(cam, view, relay.url);

  await view.waitForFunction(
    () => {
      const meter = document.querySelector<HTMLDivElement>('#noise-meter');
      const bc = (window as unknown as { __babycam?: { getLastLevel?: () => number | null } }).__babycam;
      return !!meter && parseFloat(meter.style.width || '0') > 0 && typeof bc?.getLastLevel?.() === 'number';
    },
    null,
    { timeout: 15_000 },
  );

  await view.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('#noise-threshold')!;
    el.value = '0';
    el.dispatchEvent(new Event('input'));
  });

  await cam.waitForFunction(
    () => {
      const bc = (window as unknown as { __babycam?: { getNoiseThresholdDbfs?: () => number | null } })
        .__babycam;
      return bc?.getNoiseThresholdDbfs?.() === -60;
    },
    null,
    { timeout: 10_000 },
  );

  await view.waitForFunction(
    () => {
      const bc = (window as unknown as { __babycam?: { getDataLog?: () => { type: string; kind?: string }[] } })
        .__babycam;
      const log = bc?.getDataLog?.() ?? [];
      return log.some((m) => m.type === 'alert' && m.kind === 'noise');
    },
    null,
    { timeout: 20_000 },
  );

  await shot(cam, 'I2.1-camera-noise-detect');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
