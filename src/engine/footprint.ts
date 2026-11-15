import { TRAIN_LENGTH } from '../shared/constants';
import type { TrackId, TrainState } from '../shared/types';
import { JUNCTION_EXIT_LENGTH, PLATFORM_STOP, TRACK_LENGTH, isPlatform } from '../shared/map';

/** A stretch of one track, in offsets from that track's start. */
export interface Segment {
  track: TrackId;
  from: number;
  to: number;
}

/** A train plus the track its rear may still be on. The engine keeps `prev` for each train. */
export interface Body {
  state: TrainState;
  prev: TrackId | null;
}

/**
 * The tracks a train covers. Its position is its front, so it spans TRAIN_LENGTH metres
 * behind that. For TRAIN_LENGTH metres after a track boundary the rear is still on the
 * previous track, so a train behind must see it and a collision check must count it there.
 */
export function footprint(b: Body): Segment[] {
  const { track, offset } = b.state.pos;
  const segments: Segment[] = [{ track, from: Math.max(0, offset - TRAIN_LENGTH), to: offset }];
  if (offset < TRAIN_LENGTH && b.prev !== null) {
    const length = TRACK_LENGTH[b.prev];
    segments.push({ track: b.prev, from: length - (TRAIN_LENGTH - offset), to: length });
  }
  return segments;
}

/**
 * True if any part of the train is in the junction zone: offset 300 or more on a platform, or
 * in the first 200 m of EXIT. This is the same edge as `inJunctionZone` in `src/shared/map.ts`,
 * which the actors and the train are written against, so offset 300 is in. Trains stop at or a
 * few centimetres short of 300, so a waiting train does not count as being in the zone.
 */
export function touchesZone(segments: Segment[]): boolean {
  return segments.some((s) => {
    if (s.track === 'EXIT') return s.from < JUNCTION_EXIT_LENGTH;
    return isPlatform(s.track) && s.to >= PLATFORM_STOP;
  });
}
