import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { debugParams, shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';

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

test('appairage refusé si la caméra est arrêtée', async ({ page }) => {
  await page.goto('camera.html' + debugParams());
  await page.click('#pair-btn');
  await expect(page.locator('#qr-box')).toBeHidden();
  await expect(page.locator('#status')).toContainText(/Démarre|Start/i);
});

test('QR d’appairage = code de salon (relais) : minuscule, décodable, identique au code affiché, appairage complet via relais', async ({ browser }) => {
  const relay = await startMockRelay();
  const relayParam = encodeURIComponent(relay.url);
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await cam.goto(`camera.html?stun=0&debug=1&relay=${relayParam}`);
  await cam.click('#start-btn');
  await cam.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });
  await cam.click('#pair-btn');
  await expect(cam.locator('#qr-box')).toBeVisible();

  const qrText = await decodeCanvas(cam, '#qr-canvas');
  expect(qrText).toMatch(/^BCAM1\/R\/[A-Z2-9]{6}$/);
  const room = qrText!.slice('BCAM1/R/'.length);
  await expect(cam.locator('#room-code')).toHaveText(room);
  await expect(cam.locator('#room-payload')).toHaveValue(qrText!);
  await shot(cam, 'I3.3-camera-room-qr');

  await view.goto(`viewer.html?stun=0&debug=1&relay=${relayParam}`);
  await view.fill('#room-input', room);
  await view.click('#join-room-btn');
  await view.waitForFunction(
    () => {
      const video = document.querySelector<HTMLVideoElement>('#remote');
      return !!video && !!video.srcObject && video.readyState >= 2;
    },
    null,
    { timeout: 30_000 },
  );
  await expect(cam.locator('#viewers li')).toHaveCount(1);
  await shot(view, 'I3.3-viewer-paired-room-qr');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
