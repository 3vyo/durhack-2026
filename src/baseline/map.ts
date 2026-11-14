import type { PlatformId, Position, TrackId } from '../shared/types';

// Temporary. Pull request #34 adds the shared map to src/shared/. When #34 merges, the
// shared map replaces this file and src/baseline/ imports from it instead. Until then
// every number here must match "The map", or the centre and the engine will disagree
// about where the junction zone is.
//
// The map facts the centre and the baseline train both need. They come from "The map"
// in docs/design.md.

/** Where each track starts on the shared x axis, in metres. Design: "The map". */
export const TRACK_START: Record<TrackId, number> = {
  A: 0,
  B: 0,
  P1: 6000,
  P2: 6000,
  P3: 6000,
  P4: 6000,
  EXIT: 6400,
};

/** How long each track is, in metres. Design: "The map". */
export const TRACK_LENGTH: Record<TrackId, number> = {
  A: 6000,
  B: 6000,
  P1: 400,
  P2: 400,
  P3: 400,
  P4: 400,
  EXIT: 6000,
};

/** A train stops with its front at this offset in a platform. Design: "The map". */
export const PLATFORM_STOP_OFFSET = 300;

/**
 * The junction zone on the x axis: the last 100 m of every platform plus the first
 * 200 m of EXIT. Design: "The map".
 */
export const JUNCTION_START_X = 6300;
export const JUNCTION_END_X = 6600;

/** A train's x is its track's start plus its offset. Design: "The map". */
export function xOf(pos: Position): number {
  return TRACK_START[pos.track] + pos.offset;
}

/** The platforms an entry track feeds. A feeds P1 and P2, B feeds P3 and P4. Design: "The map". */
export function pairOf(entry: 'A' | 'B'): [PlatformId, PlatformId] {
  return entry === 'A' ? ['P1', 'P2'] : ['P3', 'P4'];
}
