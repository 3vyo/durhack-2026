import { describe, expect, it } from 'vitest';
import { railOffsets } from '../../src/ui/rails';

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
