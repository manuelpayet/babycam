import { expect, test } from '@playwright/test';
import { shot } from './helpers';

test('accueil servi + manifest PWA + icônes', async ({ page }) => {
  await page.goto('index.html');
  await expect(page.locator('h1')).toHaveText('Babycam');
  await shot(page, 'I0.2-home');

  const manifestRes = await page.request.get('manifest.webmanifest');
  expect(manifestRes.ok()).toBeTruthy();
  const manifest = await manifestRes.json();
  expect(manifest.name).toBe('Babycam');
  expect(manifest.display).toBe('standalone');

  const iconRes = await page.request.get('icons/icon-192.png');
  expect(iconRes.ok()).toBeTruthy();
});

test('service worker enregistré + app shell offline', async ({ page, context }) => {
  await page.goto('camera.html');
  await shot(page, 'I0.2-camera-initial');

  await page.waitForFunction(
    async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length > 0 && regs[0].active !== null;
    },
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    async () => {
      const keys = await caches.keys();
      if (keys.length === 0) return false;
      const cache = await caches.open(keys[0]);
      return (await cache.keys()).length > 0;
    },
    null,
    { timeout: 30_000 },
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#start-btn')).toBeVisible();
  await shot(page, 'I0.2-camera-offline');
});
