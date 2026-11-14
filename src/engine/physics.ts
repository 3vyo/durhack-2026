import { ACCEL, BRAKE, MAX_SPEED, TICK } from '../shared/constants';
import type { TrackId, TrainState } from '../shared/types';
import { TRACK_LENGTH, successors } from './map';

/**
 * Moves one train for one step. Speed is updated first, then distance is speed * dt.
 * At a track end the train moves onto nextTrack if it is a valid successor. Otherwise
 * it is stopped at the end: a safeguard, since an agent should have stopped earlier.
 * Leaving the end of EXIT reports exited.
 */
export function advanceTrain(
  s: TrainState,
  accel: number,
  nextTrack: TrackId | null,
  dt: number = TICK,
): { state: TrainState; exited: boolean } {
  const a = Math.min(ACCEL, Math.max(-BRAKE, accel));
  const speed = Math.min(MAX_SPEED, Math.max(0, s.speed + a * dt));
  const offset = s.pos.offset + speed * dt;
  const track = s.pos.track;
  const length = TRACK_LENGTH[track];

  if (offset < length) {
    return { state: { ...s, speed, pos: { track, offset } }, exited: false };
  }
  if (track === 'EXIT') {
    return { state: { ...s, speed, pos: { track, offset: length } }, exited: true };
  }
  if (nextTrack !== null && successors(track).includes(nextTrack)) {
    return {
      state: { ...s, speed, pos: { track: nextTrack, offset: offset - length } },
      exited: false,
    };
  }
  return { state: { ...s, speed: 0, pos: { track, offset: length } }, exited: false };
}
