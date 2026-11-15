import { describe, expect, it } from 'vitest';
import { ENVIRONMENT, parseQuality, qualityPreset } from '../../src/ui/environment';

describe('parseQuality', () => {
  it('is high unless the address asks for low', () => {
    expect(parseQuality('')).toBe('high');
    expect(parseQuality('?quality=low')).toBe('low');
    expect(parseQuality('?quality=LOW')).toBe('low');
    expect(parseQuality('?check=1&quality=low')).toBe('low');
    expect(parseQuality('?quality=ultra')).toBe('high');
  });
});

describe('qualityPreset', () => {
  it('turns off shadows, smoothing, extra pixels and trees in low', () => {
    expect(qualityPreset('low')).toMatchObject({ shadows: false, antialias: false, pixelRatioCap: 1, trees: 0 });
  });

  it('has shadows in high', () => {
    expect(qualityPreset('high').shadows).toBe(true);
    expect(qualityPreset('high').shadowMapSize).toBeGreaterThan(0);
  });
});

describe('ENVIRONMENT', () => {
  it('starts the fog beyond what the camera looks at, and ends it further out', () => {
    expect(ENVIRONMENT.fog.near).toBeGreaterThan(1);
    expect(ENVIRONMENT.fog.far).toBeGreaterThan(ENVIRONMENT.fog.near);
  });
});
