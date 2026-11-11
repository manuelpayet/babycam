import { expect, test } from '@playwright/test';
import { encodeMessage } from '../src/shared/signaling';
import { debugParams, shot } from './helpers';

const OFFER = encodeMessage({ v: 1, t: 'offer', sdp: 'v=0 test-offer' });

test('viewer : coller une offre valide est accepté, une offre invalide est rejetée', async ({ page }) => {
  await page.goto('viewer.html' + debugParams());
  await shot(page, 'I1.5-viewer-initial');

  await page.fill('#offer-input', 'pas-une-offre');
  await page.click('#apply-offer-btn');
  await expect(page.locator('#status')).toContainText(/invalide|invalid/i);

  await page.fill('#offer-input', OFFER);
  await page.click('#apply-offer-btn');
  await expect(page.locator('#status')).toContainText(/reçue|received/i);
  const pending = await page.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { getPendingOffer?: () => unknown } }).__babycam;
    const offer = bc?.getPendingOffer?.();
    return offer && typeof offer === 'object' ? ((offer as { t?: string }).t ?? null) : null;
  });
  expect(pending).toBe('offer');
  await shot(page, 'I1.5-viewer-offer');
});
