import { describe, expect, it } from 'vitest';
import { railFit, railOffsets } from '../../src/ui/rails';

describe('railOffsets', () => {
  it('centres whole pieces along the track', () => {
    expect(railOffsets(100, 25)).toEqual([12.5, 37.5, 62.5, 87.5]);
  });

  it('lets the last piece overhang', () => {
    expect(railOffsets(60, 25)).toEqual([12.5, 37.5, 62.5]);
  });

  it('gives nothing for an empty track and refuses a piece with no length', () => {
    expect(railOffsets(0, 25)).toEqual([]);
    expect(() => railOffsets(10, 0)).toThrow();
  });
});

describe('railFit', () => {
  it('fills a stretch exactly with the fewest pieces', () => {
    expect(railFit(280, 50)).toEqual({ count: 6, step: 280 / 6, scale: 280 / 6 / 50 });
    expect(railFit(100, 50)).toEqual({ count: 2, step: 50, scale: 1 });
  });

  it('gives no pieces for an empty stretch and refuses a piece with no length', () => {
    expect(railFit(0, 50).count).toBe(0);
    expect(() => railFit(10, 0)).toThrow();
  });
});
