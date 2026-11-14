import type { Message, PlatformId, TrackId, TrainId, TrainState } from '../shared/types';
import type { TrainNumbers } from './numbers';

// Rules from docs/design.md, "Train rules" > "Following permits".
// Every function here is a placeholder that returns the safest value.

/** The last permit the control centre sent this train. */
export interface HeldPermit {
  untilX: number;
  nextTrack: TrackId | null;
  sentAt: number;
}

/**
 * "Following permits". The newest permit addressed to this train, given the permit it
 * already had and this tick's inbox. Permits for other trains are ignored.
 *
 * Placeholder: ignores every permit.
 */
export function latestPermit(
  _prev: HeldPermit | null,
  _inbox: Message[],
  _id: TrainId,
): HeldPermit | null {
  return null;
}

/**
 * "Following permits". True while the permit is under permitFresh seconds old, allowing
 * `slack`.
 *
 * Placeholder: never fresh.
 */
export function isPermitFresh(
  _permit: HeldPermit | null,
  _now: number,
  _numbers: Pick<TrainNumbers, 'permitFresh' | 'slack'>,
): boolean {
  return false;
}

/**
 * "Following permits". The speed limit that keeps the train from passing untilX, braking
 * one tick early like a stop point. A permit that is not fresh, or no permit, adds no limit.
 *
 * Placeholder: 0, so the train stops.
 */
export function permitLimit(
  _self: TrainState,
  _permit: HeldPermit | null,
  _now: number,
  _numbers: Pick<TrainNumbers, 'permitFresh' | 'slack' | 'xOf'>,
): number {
  return 0;
}

/**
 * "Following permits". The platform a fresh permit suggests asking for. Only a platform
 * from the train's own pair counts. A stale permit suggests nothing.
 *
 * Placeholder: no suggestion.
 */
export function suggestedPlatform(
  _permit: HeldPermit | null,
  _now: number,
  _entry: 'A' | 'B',
  _numbers: Pick<TrainNumbers, 'permitFresh' | 'slack' | 'pairs'>,
): PlatformId | null {
  return null;
}
