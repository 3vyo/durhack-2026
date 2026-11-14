import { BRAKE } from '../shared/constants';
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
// docs/design.md. It holds no locks and obeys its permits. With no permit for 5 seconds
// it brakes to a stop and waits, and it carries on when permits return. Every decision
// lives in a pure function below so it can be tested without the engine. Each one is a
// placeholder that returns the safest value.

/**
 * A permit is fresh for this many seconds. Design: "Today's rule, for comparison" and
 * "Following permits". src/shared/constants.ts does not name it yet.
 */
export const PERMIT_FRESH = 5;

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
 * holds if the inbox has none newer. Design: "Today's rule, for comparison".
 *
 * Placeholder: null, so the train acts as if it holds no permit.
 */
export function latestPermit(
  _id: TrainId,
  _inbox: Message[],
  _held: Permit | null,
): Permit | null {
  return null;
}

/**
 * Says whether a permit is under PERMIT_FRESH seconds old.
 * Design: "Today's rule, for comparison".
 *
 * Placeholder: false, so every permit counts as stale.
 */
export function isPermitFresh(_permit: Permit | null, _now: number): boolean {
  return false;
}

/**
 * The fastest the train may go so that its front stops at or before the permit's
 * untilX, braking one tick early. With no fresh permit the limit is 0.
 * Design: "Today's rule, for comparison" and "Following".
 *
 * Placeholder: 0, so the train may not move.
 */
export function speedLimit(
  _self: TrainState,
  _permit: Permit | null,
  _now: number,
  _sightAhead: number | null,
): number {
  return 0;
}

/**
 * The acceleration that holds the train at or under its speed limit, between -BRAKE
 * and ACCEL. Design: "Following".
 *
 * Placeholder: -BRAKE, so the brakes stay on.
 */
export function accelFor(_speed: number, _limit: number): number {
  return -BRAKE;
}

/**
 * The track to take at the end of the current track. It follows the permit's nextTrack.
 * Design: "Today's rule, for comparison".
 *
 * Placeholder: null, so the train's path ends at the end of its current track.
 */
export function chooseNextTrack(
  _self: TrainState,
  _permit: Permit | null,
  _now: number,
  _previous: TrackId | null,
): TrackId | null {
  return null;
}

/**
 * The label the display shows. 'central' while the train holds a fresh permit.
 * Design: "Following", the mode table.
 *
 * Placeholder: 'blind'.
 */
export function modeFor(_permit: Permit | null, _now: number): TrainOutput['mode'] {
  return 'blind';
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
      const limit = speedLimit(input.self, permit, input.now, input.sightAhead);
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
