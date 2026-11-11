import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';

const DIR = 'docs/screenshots';

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

export function debugParams(): string {
  return '?stun=0&debug=1';
}
