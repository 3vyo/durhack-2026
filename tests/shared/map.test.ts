import { describe, expect, it } from 'vitest';
import {
  ASK_POINT,
  EXIT_CLEAR_LENGTH,
  JUNCTION_END_X,
  JUNCTION_EXIT_LENGTH,
  JUNCTION_PLATFORM_LENGTH,
  JUNCTION_START_X,
  PLATFORMS,
  PLATFORM_PAIRS,
  PLATFORM_STOP,
  RANGE,
  TRACK_LENGTH,
  TRACK_START,
  entryOf,
  inJunctionZone,
  inRange,
  pairOf,
  successors,
  xOf,
} from '../../src/shared/map';
import type { TrackId } from '../../src/shared/types';

// Each value is checked against docs/design.md. The map table gives the starts and
// lengths. "Two fixed places matter" gives the ask point and the junction zone.
// "The radio" gives the ranges. The design does not say which edges count as inside, so
// the edge tests for inRange and inJunctionZone follow "Task 3: Map geometry" in #26.

const TRACKS: TrackId[] = ['A', 'B', 'P1', 'P2', 'P3', 'P4', 'EXIT'];

describe('the map table', () => {
  it('has the four platforms P1 to P4, lowest first', () => {
    expect(PLATFORMS).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('starts A and B at 0, each 6000 m long', () => {
    for (const t of ['A', 'B'] as const) {
      expect(TRACK_START[t]).toBe(0);
      expect(TRACK_LENGTH[t]).toBe(6000);
    }
  });

  it('starts every platform at 6000, each 400 m long', () => {
    for (const p of PLATFORMS) {
      expect(TRACK_START[p]).toBe(6000);
      expect(TRACK_LENGTH[p]).toBe(400);
    }
  });

  it('starts EXIT at 6400, 6000 m long, ending at 12400', () => {
    expect(TRACK_START.EXIT).toBe(6400);
    expect(TRACK_LENGTH.EXIT).toBe(6000);
    expect(TRACK_START.EXIT + TRACK_LENGTH.EXIT).toBe(12400);
  });

  it('has an entry for every track and no others', () => {
    expect(Object.keys(TRACK_START).sort()).toEqual([...TRACKS].sort());
    expect(Object.keys(TRACK_LENGTH).sort()).toEqual([...TRACKS].sort());
  });

  it('joins each track to the next with no gap', () => {
    expect(TRACK_START.A + TRACK_LENGTH.A).toBe(TRACK_START.P1);
    expect(TRACK_START.B + TRACK_LENGTH.B).toBe(TRACK_START.P3);
    for (const p of PLATFORMS) {
      expect(TRACK_START[p] + TRACK_LENGTH[p]).toBe(TRACK_START.EXIT);
    }
  });
});

describe('fixed places', () => {
  it('puts the ask point at offset 4800', () => {
    expect(ASK_POINT).toBe(4800);
  });

  it('stops a train in a platform with its front at offset 300', () => {
    expect(PLATFORM_STOP).toBe(300);
  });

  it('makes the junction zone the last 100 m of a platform and the first 200 m of EXIT', () => {
    expect(JUNCTION_PLATFORM_LENGTH).toBe(100);
    expect(JUNCTION_EXIT_LENGTH).toBe(200);
  });

  it('puts the junction zone between x 6300 and x 6600', () => {
    expect(JUNCTION_START_X).toBe(6300);
    expect(JUNCTION_END_X).toBe(6600);
  });

  it('starts the junction zone at the platform stop point', () => {
    expect(TRACK_LENGTH.P1 - JUNCTION_PLATFORM_LENGTH).toBe(PLATFORM_STOP);
  });

  it('checks the first 300 m of EXIT for exitStartClear', () => {
    expect(EXIT_CLEAR_LENGTH).toBe(300);
  });
});

describe('xOf', () => {
  it('is the offset on A and B', () => {
    expect(xOf({ track: 'A', offset: 0 })).toBe(0);
    expect(xOf({ track: 'B', offset: 4800 })).toBe(4800);
  });

  it('adds 6000 on a platform', () => {
    expect(xOf({ track: 'P1', offset: 0 })).toBe(6000);
    expect(xOf({ track: 'P3', offset: 300 })).toBe(6300);
    expect(xOf({ track: 'P4', offset: 400 })).toBe(6400);
  });

  it('adds 6400 on EXIT', () => {
    expect(xOf({ track: 'EXIT', offset: 0 })).toBe(6400);
    expect(xOf({ track: 'EXIT', offset: 100 })).toBe(6500);
    expect(xOf({ track: 'EXIT', offset: 6000 })).toBe(12400);
  });

  it('gives the same x at the end of a track and the start of the next', () => {
    expect(xOf({ track: 'A', offset: 6000 })).toBe(xOf({ track: 'P1', offset: 0 }));
    expect(xOf({ track: 'P2', offset: 400 })).toBe(xOf({ track: 'EXIT', offset: 0 }));
  });
});

describe('inJunctionZone', () => {
  it('starts at platform offset 300', () => {
    for (const p of PLATFORMS) {
      expect(inJunctionZone({ track: p, offset: 299 })).toBe(false);
      expect(inJunctionZone({ track: p, offset: 299.99 })).toBe(false);
      expect(inJunctionZone({ track: p, offset: 300 })).toBe(true);
      expect(inJunctionZone({ track: p, offset: 399 })).toBe(true);
      expect(inJunctionZone({ track: p, offset: 400 })).toBe(true);
    }
  });

  it('ends at EXIT offset 200', () => {
    expect(inJunctionZone({ track: 'EXIT', offset: 0 })).toBe(true);
    expect(inJunctionZone({ track: 'EXIT', offset: 199 })).toBe(true);
    expect(inJunctionZone({ track: 'EXIT', offset: 199.99 })).toBe(true);
    expect(inJunctionZone({ track: 'EXIT', offset: 200 })).toBe(false);
    expect(inJunctionZone({ track: 'EXIT', offset: 5000 })).toBe(false);
  });

  it('never includes A or B', () => {
    for (const t of ['A', 'B'] as const) {
      expect(inJunctionZone({ track: t, offset: 0 })).toBe(false);
      expect(inJunctionZone({ track: t, offset: 5000 })).toBe(false);
      expect(inJunctionZone({ track: t, offset: 6000 })).toBe(false);
    }
  });

  it('agrees with JUNCTION_START_X and JUNCTION_END_X', () => {
    expect(xOf({ track: 'P2', offset: 300 })).toBe(JUNCTION_START_X);
    expect(xOf({ track: 'EXIT', offset: 200 })).toBe(JUNCTION_END_X);
  });
});

describe('RANGE and inRange', () => {
  it('lets a train reach the platform keeper from x 4300 to 6400', () => {
    expect(RANGE.platformKeeper).toEqual([4300, 6400]);
  });

  it('lets a train reach the junction keeper from x 6000 to 6600', () => {
    expect(RANGE.junctionKeeper).toEqual([6000, 6600]);
  });

  it('lets a train hear platform sensors from x 5500 to 6400', () => {
    expect(RANGE.sensors).toEqual([5500, 6400]);
  });

  it('counts both ends of the platform keeper range as inside', () => {
    expect(inRange(4299, RANGE.platformKeeper)).toBe(false);
    expect(inRange(4300, RANGE.platformKeeper)).toBe(true);
    expect(inRange(6400, RANGE.platformKeeper)).toBe(true);
    expect(inRange(6401, RANGE.platformKeeper)).toBe(false);
  });

  it('counts both ends of the junction keeper range as inside', () => {
    expect(inRange(5999, RANGE.junctionKeeper)).toBe(false);
    expect(inRange(6000, RANGE.junctionKeeper)).toBe(true);
    expect(inRange(6600, RANGE.junctionKeeper)).toBe(true);
    expect(inRange(6601, RANGE.junctionKeeper)).toBe(false);
  });

  it('counts both ends of the sensor range as inside', () => {
    expect(inRange(5499, RANGE.sensors)).toBe(false);
    expect(inRange(5500, RANGE.sensors)).toBe(true);
    expect(inRange(6400, RANGE.sensors)).toBe(true);
    expect(inRange(6401, RANGE.sensors)).toBe(false);
  });
});

describe('successors', () => {
  it('sends A to P1 and P2, and B to P3 and P4', () => {
    expect(successors('A')).toEqual(['P1', 'P2']);
    expect(successors('B')).toEqual(['P3', 'P4']);
  });

  it('sends every platform to EXIT', () => {
    for (const p of PLATFORMS) {
      expect(successors(p)).toEqual(['EXIT']);
    }
  });

  it('sends EXIT nowhere', () => {
    expect(successors('EXIT')).toEqual([]);
  });

  it('returns a new array, so a caller cannot change the map', () => {
    successors('A').push('P3');
    expect(successors('A')).toEqual(['P1', 'P2']);
    expect(PLATFORM_PAIRS.A).toEqual(['P1', 'P2']);
  });
});

describe('platform ownership', () => {
  it('gives A the pair P1, P2 and B the pair P3, P4', () => {
    expect(pairOf('A')).toEqual(['P1', 'P2']);
    expect(pairOf('B')).toEqual(['P3', 'P4']);
  });

  it('keeps PLATFORM_PAIRS as it was', () => {
    expect(PLATFORM_PAIRS).toEqual({ A: ['P1', 'P2'], B: ['P3', 'P4'] });
  });

  it('gives P1 and P2 to A, and P3 and P4 to B', () => {
    expect(entryOf('P1')).toBe('A');
    expect(entryOf('P2')).toBe('A');
    expect(entryOf('P3')).toBe('B');
    expect(entryOf('P4')).toBe('B');
  });

  it('agrees with pairOf for every platform', () => {
    for (const p of PLATFORMS) {
      expect(pairOf(entryOf(p))).toContain(p);
    }
  });
});
