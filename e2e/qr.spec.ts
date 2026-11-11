import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { toQrChunks } from '../src/shared/signaling';
import { debugParams, shot } from './helpers';

async function decodeCanvas(page: import('@playwright/test').Page, selector: string): Promise<string | null> {
  const pixels = await page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: Array.from(img.data), width: img.width, height: img.height };
  }, selector);
  const result = jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  return result?.data ?? null;
}

test('QR d offre : UN seul QR en mode LAN (sans STUN), décodable et identique au payload', async ({ page }) => {
  await page.goto('camera.html' + debugParams());
  await page.click('#start-btn');
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });

  await page.click('#pair-btn');
  await expect(page.locator('#qr-box')).toBeVisible();
  await expect(page.locator('#answer-box')).toBeVisible();

  const payload = await page.locator('#offer-payload').inputValue();
  expect(payload.startsWith('BCAM1:')).toBe(true);

  const chunks = toQrChunks(payload);
  expect(chunks.length).toBe(1);
  expect(chunks[0]).toMatch(/^BCAM1\/1\/1\//);

  const qrText = await decodeCanvas(page, '#qr-canvas');
  expect(qrText).toBe(chunks[0]);

  await shot(page, 'I3.2-camera-qr-single');
});

test('appairage refusé si la caméra est arrêtée', async ({ page }) => {
  await page.goto('camera.html' + debugParams());
  await page.click('#pair-btn');
  await expect(page.locator('#qr-box')).toBeHidden();
  await expect(page.locator('#status')).toContainText(/Démarre|Start/i);
});
