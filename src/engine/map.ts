import type { Position, TrackId } from '../shared/types';

// All trains run left to right on one shared x axis, in metres.
// A train's x is its track's start plus its offset.

export const TRACK_START: Record<TrackId, number> = {
  A: 0,
  B: 0,
  P1: 6000,
  P2: 6000,
  P3: 6000,
  P4: 6000,
  EXIT: 6400,
};

export const TRACK_LENGTH: Record<TrackId, number> = {
  A: 6000,
  B: 6000,
  P1: 400,
  P2: 400,
  P3: 400,
  P4: 400,
  EXIT: 6000,
};

/** Offset on A and B where a train must ask for a platform. */
export const ASK_POINT = 4800;

/** Offset in a platform where a stopped train has its front. */
export const PLATFORM_STOP = 300;

/** Where short-range messages reach, as inclusive x ranges. */
export const RANGE = {
  station: [4300, 6400],
  merge: [6000, 6600],
  sensors: [5500, 6400],
} as const;

const SUCCESSORS: Record<TrackId, TrackId[]> = {
  A: ['P1', 'P2'],
  B: ['P3', 'P4'],
  P1: ['EXIT'],
  P2: ['EXIT'],
  P3: ['EXIT'],
  P4: ['EXIT'],
  EXIT: [],
};

export function xOf(pos: Position): number {
  return TRACK_START[pos.track] + pos.offset;
}

export function successors(track: TrackId): TrackId[] {
  return [...SUCCESSORS[track]];
}

/** The last 100 m of every platform plus the first 200 m of EXIT. */
export function inJunctionZone(pos: Position): boolean {
  if (pos.track === 'EXIT') return pos.offset < 200;
  if (pos.track === 'A' || pos.track === 'B') return false;
  return pos.offset >= PLATFORM_STOP;
}

export function inRange(x: number, r: readonly [number, number]): boolean {
  return x >= r[0] && x <= r[1];
}
