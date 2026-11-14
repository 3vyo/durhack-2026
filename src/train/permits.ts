import type { Message, PlatformId, TrackId, TrainId, TrainState } from '../shared/types';
import { brakeLimit, elapsed } from './follow';
import type { TrainNumbers } from './numbers';

// Rules from docs/design.md, "Train rules" > "Following permits". A permit is a hint. It
// can add a limit and suggest a platform. It never replaces a lock or lifts another limit.

/** The last permit the control centre sent this train. */
export interface HeldPermit {
  untilX: number;
  nextTrack: TrackId | null;
  sentAt: number;
}

/**
 * "Following permits". The newest permit addressed to this train, given the permit it
 * already had and this tick's inbox. Permits for other trains are ignored.
 */
export function latestPermit(prev: HeldPermit | null, inbox: Message[], id: TrainId): HeldPermit | null {
  let held = prev;
  for (const msg of inbox) {
    if (msg.type !== 'permit' || msg.to !== id) continue;
    if (held && held.sentAt > msg.sentAt) continue;
    held = { untilX: msg.untilX, nextTrack: msg.nextTrack, sentAt: msg.sentAt };
  }
  return held;
}

/**
 * "Following permits". True while the permit is under permitFresh seconds old, allowing
 * `slack`.
 */
export function isPermitFresh(
  permit: HeldPermit | null,
  now: number,
  numbers: Pick<TrainNumbers, 'permitFresh' | 'slack'>,
): boolean {
  return permit !== null && !elapsed(permit.sentAt, now, numbers.permitFresh, numbers.slack);
}

/**
 * "Following permits". The speed limit that keeps the train from passing untilX, braking
 * one tick early like a stop point. A permit that is not fresh, or no permit, adds no limit.
 */
export function permitLimit(
  self: TrainState,
  permit: HeldPermit | null,
  now: number,
  numbers: Pick<TrainNumbers, 'permitFresh' | 'slack' | 'xOf'>,
): number {
  if (permit === null || !isPermitFresh(permit, now, numbers)) return Infinity;
  return brakeLimit(permit.untilX - numbers.xOf(self.pos));
}

/**
 * "Following permits". The platform a fresh permit suggests asking for. Only a platform
 * from the train's own pair counts. A stale permit suggests nothing.
 */
export function suggestedPlatform(
  permit: HeldPermit | null,
  now: number,
  entry: 'A' | 'B',
  numbers: Pick<TrainNumbers, 'permitFresh' | 'slack' | 'pairs'>,
): PlatformId | null {
  if (permit === null || !isPermitFresh(permit, now, numbers)) return null;
  return numbers.pairs[entry].find((p) => p === permit.nextTrack) ?? null;
}
