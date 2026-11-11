import { describe, expect, it } from 'vitest';
import { registerPwa } from './pwa';

describe('registerPwa', () => {
  it('ne plante pas hors navigateur (env node)', () => {
    expect(() => registerPwa()).not.toThrow();
  });
});
