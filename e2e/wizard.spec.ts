import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { createRoom, joinRoomAndConnect, startCamera } from './pairing-helper';
import { relayParams, shot } from './helpers';
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

test('caméra : « Appairer » ouvre la page dédiée #/pair avec le QR du code de salon, retour auto à la connexion', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam, relay.url);
  await expect(cam.locator('body')).toHaveClass(/view-main/);
  await expect(cam.locator('#pairing')).toBeHidden();

  const room = await createRoom(cam);
  await expect(cam.locator('body')).toHaveClass(/view-pair/);
  await expect(cam.locator('#preview')).toBeHidden();
  await expect(cam.locator('#qr-box')).toBeVisible();
  await expect(cam.locator('#pair-done')).toBeHidden();
  const steps = cam.locator('#pairing .wizard-steps li');
  await expect(steps.nth(1)).toHaveClass(/active/);
  await expect(steps.nth(0)).toHaveClass(/done/);
  const qrText = await decodeCanvas(cam, '#qr-canvas');
  expect(qrText).toBe(`BCAM1/R/${room}`);
  await expect(cam.locator('#room-code')).toHaveText(room);
  await expect(cam.locator('#room-payload')).toHaveValue(qrText!);
  await shot(cam, 'I4.1-camera-wizard-room');

  await joinRoomAndConnect(view, relay.url, room);
  await expect(cam.locator('body')).toHaveClass(/view-main/);
  await expect(cam.locator('#viewers li')).toHaveCount(1);
  await shot(cam, 'I4.1-camera-wizard-done');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});

test('viewer : la page d’appairage #/pair est la vue par défaut + un code invalide ne fait pas avancer', async ({ page }) => {
  const relay = await startMockRelay();
  await page.goto('viewer.html' + relayParams(relay.url));
  await expect(page.locator('body')).toHaveClass(/view-pair/);
  await expect(page.locator('#remote')).toBeHidden();
  const steps = page.locator('#pairing .wizard-steps li');
  await expect(steps.nth(0)).toHaveClass(/active/);
  await expect(page.locator('#wiz-waiting')).toBeHidden();
  await expect(page.locator('#room-input')).toBeVisible();

  await page.fill('#room-input', 'XX');
  await page.click('#join-room-btn');
  await expect(page.locator('#status')).toContainText(/invalide|invalid/i);
  await expect(page.locator('#wiz-waiting')).toBeHidden();
  await expect(steps.nth(0)).toHaveClass(/active/);
  await expect(steps.nth(1)).not.toHaveClass(/done|active/);
  await shot(page, 'I4.1-viewer-wizard-initial');
  await killMockRelay(relay);
});

test('viewer : connexion via le salon → bascule sur la vue vidéo #/', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam, relay.url);
  const room = await createRoom(cam);
  await joinRoomAndConnect(view, relay.url, room);

  await expect(view.locator('body')).toHaveClass(/view-main/);
  await expect(view.locator('#remote')).toBeVisible();
  await expect(view.locator('#wiz-waiting-text')).toContainText(/Connecté|Connected/i);
  const steps = view.locator('#pairing .wizard-steps li');
  await expect(steps.nth(1)).toHaveClass(/done/);
  await expect(steps.nth(0)).toHaveClass(/done/);
  await shot(view, 'I4.1-viewer-wizard-connected');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
