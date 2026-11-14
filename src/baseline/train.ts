import {
  ACCEL,
  BRAKE,
  MARGIN,
  MAX_SPEED,
  PERMIT_FRESH,
  TICK,
  safeSpeed,
} from '../shared/constants';
import { successors, xOf } from '../shared/map';
import type {
  Message,
  TrackId,
  TrainAgentFactory,
  TrainId,
  TrainInput,
  TrainOutput,
  TrainState,
} from '../shared/types';
import type { Permit } from './centre';

// The baseline train agent. Its rules are in "Today's rule, for comparison" in
// docs/design.md. It holds no locks and obeys its permits. With no permit for
// PERMIT_FRESH seconds it brakes to a stop and waits, and it carries on when permits
// return.
//
// What keeps baseline trains apart when permits stop: a train never goes faster than
// safeSpeed of the distance to the untilX of its newest permit. That untilX still
// applies after the permit goes stale, so full braking always stops the train short of
// it. The train also keeps its last nextTrack, so a train that crosses onto its
// platform while braking stays on its path.
//
// Every decision lives in a pure function below so it can be tested without the engine.

/** Everything a baseline train remembers between ticks. */
export interface BaselineMemory {
  /** The newest permit addressed to this train, however old. */
  permit: Permit | null;
  /** The nextTrack this train returned on the previous tick. */
  nextTrack: TrackId | null;
}

/** A baseline train's memory before its first tick. Design: "Today's rule, for comparison". */
export function initialTrainMemory(): BaselineMemory {
  return { permit: null, nextTrack: null };
}

/**
 * Returns the newest permit in the inbox addressed to this train, or the one it already
 * holds if the inbox has none newer. It keeps a stale permit, because its untilX still
 * applies. Design: "Today's rule, for comparison".
 */
export function latestPermit(id: TrainId, inbox: Message[], held: Permit | null): Permit | null {
  let newest = held;
  for (const msg of inbox) {
    if (msg.type !== 'permit' || msg.to !== id) continue;
    if (newest === null || msg.sentAt >= newest.sentAt) newest = msg;
  }
  return newest;
}

/**
 * Says whether a permit is under PERMIT_FRESH seconds old. The clock is a float, so a
 * permit within half a tick of PERMIT_FRESH counts as stale.
 * Design: "Today's rule, for comparison".
 */
export function isPermitFresh(permit: Permit | null, now: number): boolean {
  return permit !== null && now - permit.sentAt < PERMIT_FRESH - TICK / 2;
}

/**
 * The x the train's front must not pass: the untilX of the newest permit it holds,
 * fresh or stale. With no permit ever, its current x.
 * Design: "Today's rule, for comparison".
 */
export function stopX(self: TrainState, permit: Permit | null): number {
  return permit === null ? xOf(self.pos) : permit.untilX;
}

/**
 * The fastest the train may go so that its front stops at or before stopX. It allows
 * for the ground it covers this tick, so it starts braking one tick early. It also
 * obeys sightAhead, as a driver would. With no fresh permit the limit is 0, which means
 * full braking. Because the train was already under safeSpeed of the distance to stopX,
 * it still stops short. Design: "Today's rule, for comparison" and "Following".
 */
export function speedLimit(
  self: TrainState,
  stopX: number,
  fresh: boolean,
  sightAhead: number | null,
): number {
  if (!fresh) return 0;
  const thisTick = (self.speed + ACCEL * TICK) * TICK;
  let limit = Math.min(MAX_SPEED, safeSpeed(stopX - xOf(self.pos) - thisTick));
  if (sightAhead !== null) {
    limit = Math.min(limit, safeSpeed(sightAhead - MARGIN - thisTick));
  }
  return limit;
}

/**
 * The acceleration that takes the train to its speed limit within one tick, or as near
 * as -BRAKE and ACCEL allow. Design: "Following".
 */
export function accelFor(speed: number, limit: number): number {
  if (limit <= 0) return -BRAKE;
  return Math.max(-BRAKE, Math.min(ACCEL, (limit - speed) / TICK));
}

function leadsOn(from: TrackId, to: TrackId | null): boolean {
  return to !== null && successors(from).includes(to);
}

/**
 * The track to take at the end of the current track. It follows a fresh permit's
 * nextTrack, and keeps its previous nextTrack while the permit is stale. It ignores a
 * track that does not lead on from the current one. It never reads the timetable.
 * Design: "Today's rule, for comparison".
 */
export function chooseNextTrack(
  self: TrainState,
  permit: Permit | null,
  now: number,
  previous: TrackId | null,
): TrackId | null {
  const { track } = self.pos;
  const kept = leadsOn(track, previous) ? previous : null;
  if (permit === null || !isPermitFresh(permit, now)) return kept;
  if (permit.nextTrack === null) return null;
  return leadsOn(track, permit.nextTrack) ? permit.nextTrack : kept;
}

/**
 * The label the display shows: 'central' while the train holds a fresh permit, otherwise
 * 'blind'. Design: "Following", the mode table.
 */
export function modeFor(permit: Permit | null, now: number): TrainOutput['mode'] {
  return isPermitFresh(permit, now) ? 'central' : 'blind';
}

/**
 * Builds the agent for a baseline train, which obeys its permits and holds no locks.
 * Design: "Today's rule, for comparison" and "Shared types".
 */
export const createBaselineAgent: TrainAgentFactory = (id, _timetable) => {
  let memory = initialTrainMemory();
  return {
    decide(input: TrainInput): TrainOutput {
      const permit = latestPermit(id, input.inbox, memory.permit);
      const fresh = isPermitFresh(permit, input.now);
      const limit = speedLimit(input.self, stopX(input.self, permit), fresh, input.sightAhead);
      const nextTrack = chooseNextTrack(input.self, permit, input.now, memory.nextTrack);
      memory = { permit, nextTrack };
      return {
        accel: accelFor(input.self.speed, limit),
        nextTrack,
        outbox: [],
        mode: modeFor(permit, input.now),
      };
    },
  };
};
