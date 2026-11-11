import { describe, expect, it } from 'vitest';
import { lumaDiffRatio, sensitivityToRatio } from './motion';

function frame(width: number, height: number, gray: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
  }
  return data;
}

describe('motion', () => {
  it('lumaDiffRatio : images identiques → 0', () => {
    const a = frame(8, 8, 100);
    expect(lumaDiffRatio(a, frame(8, 8, 100))).toBe(0);
  });

  it('lumaDiffRatio : tout change → 1', () => {
    const a = frame(8, 8, 0);
    const b = frame(8, 8, 255);
    expect(lumaDiffRatio(a, b)).toBe(1);
  });

  it('lumaDiffRatio : moitié des pixels changent → 0.5', () => {
    const a = frame(8, 8, 0);
    const b = frame(8, 8, 0);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 8 + x) * 4;
        b[i] = 255;
        b[i + 1] = 255;
        b[i + 2] = 255;
      }
    }
    expect(lumaDiffRatio(a, b)).toBe(0.5);
  });

  it('lumaDiffRatio : petit changement sous le seuil pixel → 0', () => {
    const a = frame(8, 8, 100);
    const b = frame(8, 8, 110);
    expect(lumaDiffRatio(a, b)).toBe(0);
  });

  it('lumaDiffRatio : tailles différentes → erreur', () => {
    expect(() => lumaDiffRatio(frame(8, 8, 0), frame(4, 4, 0))).toThrow('size mismatch');
  });

  it('sensitivityToRatio : décroît avec la sensibilité, bornes 0.396 → 0.02', () => {
    expect(sensitivityToRatio(1)).toBeCloseTo(0.396, 3);
    expect(sensitivityToRatio(100)).toBeCloseTo(0.02, 3);
    expect(sensitivityToRatio(50)).toBeCloseTo(0.21, 3);
    expect(sensitivityToRatio(100)).toBeLessThan(sensitivityToRatio(1));
  });
});
