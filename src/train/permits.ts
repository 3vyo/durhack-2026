import { BRAKE, TICK } from '../shared/constants';
import { isEntryTrack, successors } from '../shared/map';
import type { EntryId, Message, PlatformId, TrackId, TrainId, TrainState } from '../shared/types';
import { brakeLimit, elapsed, type Leader } from './follow';
import { STOP_SHORT, type TrainNumbers } from './numbers';

// Rules from docs/design.md, "Train rules" > "The centre comes first". While a train holds
// a fresh permit it obeys it, like today's trains. When its permit goes stale it carries
// on with its own rules, starting from where the last permit left it.

/** The last permit the control centre sent this train. */
export interface HeldPermit {
  untilX: number;
  nextTrack: TrackId | null;
  sentAt: number;
  /** The train directly ahead when the permit was sent, null if none, absent if not said. */
  leader?: TrainId | null;
}

/**
 * "The centre comes first". The newest permit addressed to this train, given the permit it
 * already had and this tick's inbox. Permits for other trains are ignored, and so are radio
 * working permits (`caution`): by the time staff move trains by radio, ours are already
 * running on their own rules, which are faster. Design: "Radio working".
 */
export function latestPermit(prev: HeldPermit | null, inbox: Message[], id: TrainId): HeldPermit | null {
  let held = prev;
  for (const msg of inbox) {
    if (msg.type !== 'permit' || msg.to !== id || msg.caution) continue;
    if (held && held.sentAt > msg.sentAt) continue;
    held = { untilX: msg.untilX, nextTrack: msg.nextTrack, sentAt: msg.sentAt };
    if (msg.leader !== undefined) held.leader = msg.leader;
  }
  return held;
}

/**
 * "The centre comes first". True while the permit is under permitFresh seconds old,
 * allowing `slack`.
 */
export function isPermitFresh(
  permit: HeldPermit | null,
  now: number,
  numbers: Pick<TrainNumbers, 'permitFresh' | 'slack'>,
): boolean {
  return permit !== null && !elapsed(permit.sentAt, now, numbers.permitFresh, numbers.slack);
}

/**
 * "The centre comes first". The speed limit that keeps the train from passing untilX,
 * braking one tick early like a stop point. A permit that is not fresh, or no permit, adds
 * no limit.
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
 * "The centre comes first". The track to take while obeying a permit: the permit's
 * nextTrack. A nextTrack that does not lead on from the current track is ignored, and the
 * train keeps the one it set last tick if that one does.
 */
export function permitRoute(track: TrackId, permit: HeldPermit, previous: TrackId | null): TrackId | null {
  const leadsOn = (to: TrackId | null) => to !== null && successors(track).includes(to);
  if (permit.nextTrack === null) return null;
  if (leadsOn(permit.nextTrack)) return permit.nextTrack;
  return leadsOn(previous) ? previous : null;
}

/**
 * "The centre comes first". The leader a train takes from its last permit when the centre
 * fails: the train the permit named, 'none' if it named none, 'unknown' if it did not say.
 */
export function permitLeader(permit: HeldPermit | null): Leader {
  if (permit === null || permit.leader === undefined) return 'unknown';
  return permit.leader === null ? 'none' : permit.leader;
}

/**
 * "The centre comes first". The platform a train on an entry track keeps when the centre fails: the
 * one its last permit sent it to, if it can no longer stop before the end of its entry
 * track. Null if it can still stop, or the permit named no platform of its own pair.
 */
export function committedPlatform(
  self: TrainState,
  permit: HeldPermit | null,
  entry: EntryId,
  numbers: Pick<TrainNumbers, 'pairs' | 'entryLength'>,
): PlatformId | null {
  if (permit === null || !isEntryTrack(self.pos.track)) return null;
  const platform = numbers.pairs[entry].find((p) => p === permit.nextTrack) ?? null;
  if (platform === null) return null;
  // Full braking in steps of TICK covers about half a tick less than the smooth formula.
  const v = self.speed;
  const stoppingDistance = (v * v) / (2 * BRAKE) - (v * TICK) / 2;
  const canStop = stoppingDistance <= numbers.entryLength - self.pos.offset - STOP_SHORT;
  return canStop ? null : platform;
}
