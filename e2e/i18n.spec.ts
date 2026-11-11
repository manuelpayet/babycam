import { expect, test } from '@playwright/test';
import { shot } from './helpers';

test('sélecteur de langue FR/EN', async ({ page }) => {
  await page.goto('index.html');
  await page.selectOption('#lang-select', 'fr');
  await expect(page.locator('[data-i18n="home.camera"]')).toHaveText('Je surveille (caméra)');
  await page.selectOption('#lang-select', 'en');
  await expect(page.locator('[data-i18n="home.camera"]')).toHaveText('I monitor (camera)');
  await shot(page, 'I0.3-home-en');
  await page.selectOption('#lang-select', 'fr');
  await expect(page.locator('[data-i18n="home.camera"]')).toHaveText('Je surveille (caméra)');
});
