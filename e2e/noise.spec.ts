import { test } from '@playwright/test';
import { pairViaPaste, startCamera } from './pairing-helper';
import { shot } from './helpers';

test('détection de bruit : seuil à 0 + micro factice → alerte "noise" reçue par le viewer', async ({ browser }) => {
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam);
  await pairViaPaste(cam, view);

  await cam.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('#noise-threshold')!;
    el.value = '0';
    el.dispatchEvent(new Event('input'));
  });

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
});
