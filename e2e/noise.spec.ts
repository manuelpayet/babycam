import { expect, test } from '@playwright/test';
import { pairViaPaste, startCamera } from './pairing-helper';
import { shot } from './helpers';

async function meterWidth(page: import('@playwright/test').Page): Promise<number> {
  const w = await page.locator('#vol-fill').evaluate((el) => (el as HTMLElement).style.width);
  return Number.parseFloat(w);
}

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

  await expect.poll(() => meterWidth(cam), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(() => meterWidth(view), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(view.locator('#vol-dbfs')).toContainText(/dB/);
  await shot(cam, 'I3.8-camera-volmeter');
  await shot(view, 'I3.8-viewer-volmeter');

  await camCtx.close();
  await viewCtx.close();
});
