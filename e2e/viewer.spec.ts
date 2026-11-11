import { expect, test } from '@playwright/test';
import { debugParams, shot } from './helpers';

test('viewer : une offre invalide est rejetée, aucune réponse générée', async ({ page }) => {
  await page.goto('viewer.html' + debugParams());
  await shot(page, 'I1.5-viewer-initial');

  await page.fill('#offer-input', 'pas-une-offre');
  await page.click('#apply-offer-btn');
  await expect(page.locator('#status')).toContainText(/invalide|invalid/i);
  await expect(page.locator('#qr-box-answer')).toBeHidden();
});
