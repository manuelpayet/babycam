import { describe, expect, it } from 'vitest';
import { BUILD_ID } from './build';

describe('BUILD_ID', () => {
  it('est une chaîne non vide (hash git injecté via define au build)', () => {
    expect(typeof BUILD_ID).toBe('string');
    expect(BUILD_ID.length).toBeGreaterThan(0);
  });
});
