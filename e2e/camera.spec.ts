import { expect, test } from '@playwright/test';
import { debugParams, shot } from './helpers';

test('page caméra : démarrage avec médias factices, pistes audio+vidéo', async ({ page }) => {
  await page.goto('camera.html' + debugParams());
  await shot(page, 'I1.1-camera-off');
  await expect(page.locator('#start-btn')).toBeEnabled();

  await page.click('#start-btn');
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });
  await expect(page.locator('#status')).toContainText(/cours|running/i);
  await expect(page.locator('#start-btn')).toBeDisabled();
  await shot(page, 'I1.1-camera-on');

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
