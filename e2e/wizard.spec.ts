import { expect, test } from '@playwright/test';
import { pairViaPaste, startCamera } from './pairing-helper';
import { debugParams, shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';

test('caméra : « Appairer » ouvre la page dédiée #/pair, retour auto à la connexion', async ({ browser }) => {
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam);
  await expect(cam.locator('body')).toHaveClass(/view-main/);
  await expect(cam.locator('#pairing')).toBeHidden();

  await cam.click('#pair-btn');
  await expect(cam.locator('body')).toHaveClass(/view-pair/);
  await expect(cam.locator('#preview')).toBeHidden();
  await expect(cam.locator('#qr-box')).toBeVisible();
  await expect(cam.locator('#answer-box')).toBeVisible();
  await expect(cam.locator('#pair-done')).toBeHidden();
  const steps = cam.locator('#pairing .wizard-steps li');
  await expect(steps.nth(2)).toHaveClass(/active/);
  await expect(steps.nth(0)).toHaveClass(/done/);
  await shot(cam, 'I4.1-camera-wizard-offer');

  const offer = await cam.locator('#offer-payload').inputValue();
  await view.goto('viewer.html' + debugParams());
  await view.fill('#offer-input', offer);
  await view.click('#apply-offer-btn');
  await view.waitForSelector('#qr-box-answer:not([hidden])');
  const answer = await view.locator('#answer-payload').inputValue();
  await cam.fill('#answer-payload', answer);
  await cam.click('#apply-answer-btn');
  await view.waitForFunction(
    () => {
      const video = document.querySelector<HTMLVideoElement>('#remote');
      return !!video && !!video.srcObject && video.readyState >= 2;
    },
    null,
    { timeout: 30_000 },
  );

  await expect(cam.locator('body')).toHaveClass(/view-main/);
  await expect(cam.locator('#pairing')).toBeHidden();
  await expect(cam.locator('#viewers li')).toHaveCount(1);
  await shot(cam, 'I4.1-camera-wizard-done');

  await camCtx.close();
  await viewCtx.close();
});

test('viewer : la page d’appairage #/pair est la vue par défaut + une offre invalide ne fait pas avancer', async ({ page }) => {
  await page.goto('viewer.html' + debugParams());
  await expect(page.locator('body')).toHaveClass(/view-pair/);
  await expect(page.locator('#remote')).toBeHidden();
  const steps = page.locator('#pairing .wizard-steps li');
  await expect(steps.nth(0)).toHaveClass(/active/);
  await expect(page.locator('#qr-box-answer')).toBeHidden();
  await expect(page.locator('#wiz-waiting')).toBeHidden();

  await page.fill('#offer-input', 'pas-une-offre');
  await page.click('#apply-offer-btn');
  await expect(page.locator('#status')).toContainText(/invalide|invalid/i);
  await expect(page.locator('#qr-box-answer')).toBeHidden();
  await expect(page.locator('#wiz-waiting')).toBeHidden();
  await expect(steps.nth(0)).toHaveClass(/active/);
  await expect(steps.nth(1)).not.toHaveClass(/done|active/);
  await shot(page, 'I4.1-viewer-wizard-initial');
});

test('viewer : étapes révélées après l’offre, puis bascule sur la vue vidéo #/ à la connexion', async ({ browser }) => {
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam);
  await pairViaPaste(cam, view);

  await expect(view.locator('body')).toHaveClass(/view-main/);
  await expect(view.locator('#remote')).toBeVisible();
  await expect(view.locator('#wiz-waiting-text')).toContainText(/Connecté|Connected/i);
  const steps = view.locator('#pairing .wizard-steps li');
  await expect(steps.nth(2)).toHaveClass(/done/);
  await expect(steps.nth(0)).toHaveClass(/done/);
  await shot(view, 'I4.1-viewer-wizard-connected');

  await camCtx.close();
  await viewCtx.close();
});

test('caméra (relais) : page #/pair, l’étape « réponse du viewer » est sautée', async ({ page }) => {
  const relay = await startMockRelay();
  const relayParam = encodeURIComponent(relay.url);
  await page.goto(`camera.html?stun=0&debug=1&relay=${relayParam}`);
  await page.click('#start-btn');
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });
  await page.click('#pair-btn');
  await expect(page.locator('body')).toHaveClass(/view-pair/);
  await expect(page.locator('#qr-box')).toBeVisible();
  await expect(page.locator('#answer-box')).toBeHidden();
  await expect(page.locator('#pair-done')).toBeHidden();
  const steps = page.locator('#pairing .wizard-steps li');
  await expect(steps.nth(1)).toHaveClass(/active/);
  await expect(steps.nth(2)).toHaveClass(/done/);
  await shot(page, 'I4.1-camera-wizard-relay');
  await killMockRelay(relay);
});
