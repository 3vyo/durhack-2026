import { describe, expect, it } from 'vitest';
import { bodyDim, legendItems, markerSpec, shapePath, shapePoints } from '../../src/ui/markers';
import { MODES } from '../../src/ui/palette';

describe('markerSpec', () => {
  it('gives a moving central train a full blue square', () => {
    expect(markerSpec('central', false)).toEqual({ shape: 'square', hex: 0x3987e5, css: '#3987e5', opacity: 1, stopped: false });
  });

  it('fades a stopped train but keeps its colour, so its mode still reads', () => {
    const s = markerSpec('blind', true);
    expect(s.opacity).toBeLessThan(1);
    expect(s.hex).toBe(markerSpec('blind', false).hex);
    expect(s.stopped).toBe(true);
  });

  it('gives the five modes five shapes', () => {
    expect(new Set(MODES.map((m) => markerSpec(m, false).shape)).size).toBe(5);
  });

  it('shows radio working as a purple hexagon', () => {
    expect(markerSpec('radio', false)).toMatchObject({ shape: 'hexagon', css: '#8a57ae' });
  });
});

describe('bodyDim', () => {
  it('leaves a moving train alone and dims a stopped one', () => {
    expect(bodyDim(false)).toBe(1);
    expect(bodyDim(true)).toBeGreaterThanOrEqual(0.3);
    expect(bodyDim(true)).toBeLessThanOrEqual(0.6);
  });
});

describe('legendItems', () => {
  it('lists the five modes in order, each with a meaning', () => {
    const items = legendItems();
    expect(items.map((i) => i.mode)).toEqual(['central', 'radio', 'full', 'stale', 'blind']);
    for (const i of items) expect(i.meaning).not.toBe('');
  });
});

describe('shapes', () => {
  it('has the right number of corners, and none for a circle', () => {
    expect(shapePoints('circle', 5)).toEqual([]);
    expect(shapePoints('square', 5)).toHaveLength(4);
    expect(shapePoints('hexagon', 5)).toHaveLength(6);
    expect(shapePoints('triangle', 5)).toHaveLength(3);
    expect(shapePoints('diamond', 5)).toHaveLength(4);
  });

  it('keeps every corner near the radius, so no shape looks bigger than another', () => {
    for (const shape of ['square', 'hexagon', 'triangle', 'diamond'] as const) {
      for (const [x, y] of shapePoints(shape, 10)) expect(Math.hypot(x, y)).toBeLessThanOrEqual(13.5);
    }
  });

  it('makes closed SVG paths', () => {
    expect(shapePath('circle', 5)).toMatch(/Z$/);
    expect(shapePath('square', 5)).toMatch(/^M .* Z$/);
  });
});
