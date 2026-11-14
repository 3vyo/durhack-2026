import { describe, expect, it } from 'vitest';
import { RANGE, inJunctionZone, inRange, successors, xOf } from '../../src/engine/map';

describe('xOf', () => {
  it('adds the offset to the track start on EXIT', () => {
    expect(xOf({ track: 'EXIT', offset: 100 })).toBe(6500);
  });

  it('places platform offset 300 at x 6300', () => {
    expect(xOf({ track: 'P3', offset: 300 })).toBe(6300);
  });
});

describe('successors', () => {
  it('sends A to P1 and P2, and B to P3 and P4', () => {
    expect(successors('A')).toEqual(['P1', 'P2']);
    expect(successors('B')).toEqual(['P3', 'P4']);
  });

  it('sends every platform to EXIT and EXIT nowhere', () => {
    expect(successors('P2')).toEqual(['EXIT']);
    expect(successors('EXIT')).toEqual([]);
  });
});

describe('inJunctionZone', () => {
  it('starts 100 m from the end of a platform', () => {
    expect(inJunctionZone({ track: 'P1', offset: 299 })).toBe(false);
    expect(inJunctionZone({ track: 'P1', offset: 300 })).toBe(true);
    expect(inJunctionZone({ track: 'P1', offset: 399 })).toBe(true);
  });

  it('covers the first 200 m of EXIT', () => {
    expect(inJunctionZone({ track: 'EXIT', offset: 199 })).toBe(true);
    expect(inJunctionZone({ track: 'EXIT', offset: 200 })).toBe(false);
  });

  it('does not cover an entry track', () => {
    expect(inJunctionZone({ track: 'A', offset: 5000 })).toBe(false);
  });
});

describe('inRange', () => {
  it('includes both ends of the station range', () => {
    expect(inRange(4299, RANGE.station)).toBe(false);
    expect(inRange(4300, RANGE.station)).toBe(true);
    expect(inRange(6400, RANGE.station)).toBe(true);
    expect(inRange(6401, RANGE.station)).toBe(false);
  });
});
