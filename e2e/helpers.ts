import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';

const DIR = 'docs/screenshots';

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

// Sans ?relay= : le relais par défaut (worker déployé) est utilisé.
export function debugParams(): string {
  return '?stun=0&debug=1';
}

// ?relay=<url> : relais explicite (mock local dans les tests E2E).
export function relayParams(relayUrl: string): string {
  return `?stun=0&debug=1&relay=${encodeURIComponent(relayUrl)}`;
}
