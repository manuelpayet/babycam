import { expect, test } from '@playwright/test';
import { debugParams, shot } from './helpers';

test('page caméra : démarrage avec médias factices, pistes audio+vidéo', async ({ page }) => {
  await page.goto('camera.html' + debugParams());
  await shot(page, 'I1.1-camera-off');
  await expect(page.locator('#start-btn')).toBeEnabled();

  const wakeLockProbe = await page.evaluate(async () => {
    try {
      const sentinel = await navigator.wakeLock?.request('screen');
      await sentinel?.release();
      return !!sentinel;
    } catch {
      return false;
    }
  });

  await page.click('#start-btn');
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });
  await expect(page.locator('#status')).toContainText(/cours|running/i);
  await expect(page.locator('#start-btn')).toBeDisabled();
  if (wakeLockProbe) {
    await expect(page.locator('#wakelock-status')).toContainText(/allumé|on/i);
  }
  await shot(page, 'I1.2-camera-on');

  const kinds = await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview')!;
    return (video.srcObject as MediaStream).getTracks().map((track) => track.kind).sort();
  });
  expect(kinds).toEqual(['audio', 'video']);

  await page.click('#stop-btn');
  await expect(page.locator('#status')).toContainText(/arrêtée|off/i);
  await expect(page.locator('#start-btn')).toBeEnabled();
  const stopped = await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview')!;
    return video.srcObject === null;
  });
  expect(stopped).toBe(true);
});

test('liste déroulante codec vidéo : peuplée, défaut = premier codec, choix persisté', async ({ page }) => {
  await page.goto('camera.html' + debugParams());
  const options = await page.locator('#video-codec option').allTextContents();
  expect(options.length).toBeGreaterThan(0);
  expect(options.every((o) => o.startsWith('video/'))).toBe(true);
  await expect(page.locator('#video-codec')).toHaveValue(options[0]);
  if (options.length > 1) {
    await page.selectOption('#video-codec', options[1]);
    await page.reload();
    await expect(page.locator('#video-codec')).toHaveValue(options[1]);
  }
});
