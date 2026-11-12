import { expect, test } from '@playwright/test';
import { debugParams, shot } from './helpers';

test('viewer : un code de salon invalide est rejeté, aucune connexion', async ({ page }) => {
  await page.goto('viewer.html' + debugParams());
  await shot(page, 'I1.5-viewer-initial');

  await page.fill('#room-input', 'XX');
  await page.click('#join-room-btn');
  await expect(page.locator('#status')).toContainText(/invalide|invalid/i);
  await expect(page.locator('#wiz-waiting')).toBeHidden();
});
