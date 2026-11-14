import { describe, expect, it } from 'vitest';
import {
  JUNCTION_END_X,
  JUNCTION_START_X,
  PLATFORM_STOP_OFFSET,
  TRACK_LENGTH,
  TRACK_START,
  pairOf,
  xOf,
} from '../../src/baseline/map';

describe('xOf', () => {
  it('is the offset on an entry track', () => {
    expect(xOf({ track: 'A', offset: 4800 })).toBe(4800);
    expect(xOf({ track: 'B', offset: 0 })).toBe(0);
  });

  it('adds 6000 on a platform', () => {
    expect(xOf({ track: 'P3', offset: PLATFORM_STOP_OFFSET })).toBe(6300);
  });

  it('adds 6400 on EXIT', () => {
    expect(xOf({ track: 'EXIT', offset: 6000 })).toBe(12400);
  });
});

describe('pairOf', () => {
  it('gives A the platforms P1 and P2', () => {
    expect(pairOf('A')).toEqual(['P1', 'P2']);
  });

  it('gives B the platforms P3 and P4', () => {
    expect(pairOf('B')).toEqual(['P3', 'P4']);
  });
});

describe('map constants', () => {
  it('starts each platform where the entry tracks end and EXIT where platforms end', () => {
    expect(TRACK_START.P1).toBe(TRACK_START.A + TRACK_LENGTH.A);
    expect(TRACK_START.P4).toBe(TRACK_START.B + TRACK_LENGTH.B);
    expect(TRACK_START.EXIT).toBe(TRACK_START.P2 + TRACK_LENGTH.P2);
  });

  it('puts the junction zone over the last 100 m of each platform and the first 200 m of EXIT', () => {
    expect(JUNCTION_START_X).toBe(TRACK_START.P1 + TRACK_LENGTH.P1 - 100);
    expect(JUNCTION_END_X).toBe(TRACK_START.EXIT + 200);
  });

  it('puts the platform stop point on the edge of the junction zone', () => {
    expect(TRACK_START.P1 + PLATFORM_STOP_OFFSET).toBe(JUNCTION_START_X);
  });
});
