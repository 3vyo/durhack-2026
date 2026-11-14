import { TRAIN_LENGTH } from '../shared/constants';
import type { TrackId, TrainState } from '../shared/types';
import { PLATFORM_STOP, TRACK_LENGTH } from './map';

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
 * True if any part of the train is in the junction zone: past offset 300 on a platform, or
 * in the first 200 m of EXIT. A train whose front is exactly at offset 300 is at the edge and
 * not yet in, because trains stop at or just short of it.
 */
export function touchesZone(segments: Segment[]): boolean {
  return segments.some((s) => {
    if (s.track === 'EXIT') return s.from < 200;
    if (s.track === 'A' || s.track === 'B') return false;
    return s.to > PLATFORM_STOP;
  });
}
