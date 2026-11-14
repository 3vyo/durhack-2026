import { describe, expect, it } from 'vitest';
import { MODES, MODE_STYLE, SURFACE, contrastRatio } from '../../src/ui/palette';

describe('contrastRatio', () => {
  it('is 21 for white on black and 1 for a colour on itself', () => {
    expect(contrastRatio(0xffffff, 0x000000)).toBeCloseTo(21, 2);
    expect(contrastRatio(0x000000, 0x000000)).toBe(1);
  });

  it('does not depend on the order of the two colours', () => {
    expect(contrastRatio(0x3987e5, SURFACE.scene)).toBe(contrastRatio(SURFACE.scene, 0x3987e5));
  });
});

describe('MODE_STYLE', () => {
  it('covers the five modes, in order: who is in charge, then how well the train ahead is known', () => {
    expect(MODES).toEqual(['central', 'radio', 'full', 'stale', 'blind']);
  });

  it('gives every mode its own colour and its own shape, so colour is never the only cue', () => {
    expect(new Set(MODES.map((m) => MODE_STYLE[m].hex)).size).toBe(5);
    expect(new Set(MODES.map((m) => MODE_STYLE[m].shape)).size).toBe(5);
  });

  it('keeps the checked colours', () => {
    expect(MODES.map((m) => MODE_STYLE[m].css)).toEqual(['#3987e5', '#8a57ae', '#008300', '#c98500', '#d55181']);
  });

  it('stands out from the scene background, at least 3 to 1', () => {
    for (const m of MODES) expect(contrastRatio(MODE_STYLE[m].hex, SURFACE.scene)).toBeGreaterThanOrEqual(3);
  });

  it('writes each css colour as its hex value', () => {
    for (const m of MODES) expect(MODE_STYLE[m].css).toBe(`#${MODE_STYLE[m].hex.toString(16).padStart(6, '0')}`);
  });

  it('explains every mode in a line', () => {
    for (const m of MODES) expect(MODE_STYLE[m].meaning.length).toBeGreaterThan(10);
  });
});
