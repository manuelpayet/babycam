import type { Page } from '@playwright/test';
import { debugParams } from './helpers';

export async function startCamera(cam: Page): Promise<void> {
  await cam.goto('camera.html' + debugParams());
  await cam.click('#start-btn');
  await cam.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });
}

export async function pairViaPaste(cam: Page, view: Page): Promise<void> {
  const previousOffer = await cam.locator('#offer-payload').inputValue().catch(() => '');
  await cam.click('#pair-btn');
  await cam.waitForFunction(
    (prev) => {
      const el = document.querySelector<HTMLTextAreaElement>('#offer-payload');
      return !!el && el.value.startsWith('BCAM1:') && el.value !== prev;
    },
    previousOffer,
    { timeout: 30_000 },
  );
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
}
