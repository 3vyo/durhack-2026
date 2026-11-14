import type { LocalActor, Message, Outgoing, SensorReadings, TrainId } from '../shared/types';

// The merge actor owns the junction zone and grants one lock at a time.
// Rules: docs/design.md, "Leaving the station".
//
// Everything here is a placeholder. Each function returns its safest value, and step
// sends nothing. The design says silence means no, so a silent merge actor is safe.

/** One train waiting for the junction. */
export interface JunctionRequest {
  train: TrainId;
  /** When the actor first heard this train ask. Repeats do not change it. */
  firstHeardAt: number;
  /** When the actor last heard this train ask. */
  lastHeardAt: number;
}

/** The train holding the junction lock. */
export interface JunctionHolder {
  train: TrainId;
  /** The train named in this holder's grant, so a repeated grant names the same one. */
  follow: TrainId | null;
  grantedAt: number;
  /** True once the junction sensor has shown occupied since the grant. */
  seenEnter: boolean;
}

/** The merge actor's memory. It survives the actor being switched off and on again. */
export interface MergeMemory {
  holder: JunctionHolder | null;
  queue: JunctionRequest[];
  /** The last train this actor let into EXIT. The next grant names it in `follow`. */
  lastIntoExit: TrainId | null;
  /** The `now` of the last step, so the actor can spot a gap where it was switched off. */
  lastStepAt: number | null;
}

export function initialMergeMemory(): MergeMemory {
  return { holder: null, queue: [], lastIntoExit: null, lastStepAt: null };
}

/**
 * "Leaving the station": add each new JUNCTION lockRequest to the queue with the time it
 * was first heard. A repeat keeps its first time. Platform requests are not for this actor.
 *
 * Placeholder: returns the queue unchanged, so nobody joins it.
 */
export function recordJunctionRequests(
  queue: JunctionRequest[],
  _inbox: Message[],
  _now: number,
): JunctionRequest[] {
  return queue;
}

/**
 * "Leaving the station": oldest request first, lowest ID on a tie.
 *
 * Placeholder: nobody is next.
 */
export function nextForJunction(_queue: JunctionRequest[]): TrainId | null {
  return null;
}

/**
 * "Leaving the station": grant only when nobody holds the lock, `junctionOccupied` is false
 * and `exitStartClear` is true.
 *
 * Placeholder: never grants.
 */
export function canGrantJunction(_holder: JunctionHolder | null, _sensors: SensorReadings): boolean {
  return false;
}

/**
 * "Leaving the station": the grant's `follow` is the last train let into EXIT, which the
 * new holder treats as its leader.
 *
 * Placeholder: names no leader, so the train stays at SIGHT_SPEED or below.
 */
export function followFor(_memory: MergeMemory): TrainId | null {
  return null;
}

/**
 * "Leaving the station": the actor releases the lock when its sensor shows the junction
 * zone empty again. This records whether the holder has been seen in the zone yet.
 *
 * Placeholder: records nothing, so the lock never looks ready to release.
 */
export function observeJunction(holder: JunctionHolder, _sensors: SensorReadings): JunctionHolder {
  return holder;
}

/**
 * "Leaving the station": release once the holder has entered the zone and the zone is
 * empty again.
 *
 * Placeholder: never releases.
 */
export function canReleaseJunction(_holder: JunctionHolder, _sensors: SensorReadings): boolean {
  return false;
}

/**
 * The actor was switched off and is now on again. It still has its old memory. What it
 * should do with it is not decided yet. While it was off, trains used clock slots, so
 * `lastIntoExit` and the queue may be out of date.
 *
 * Placeholder: keeps the memory as it was.
 */
export function resumeMerge(memory: MergeMemory, _now: number): MergeMemory {
  return memory;
}

/** Builds the merge actor. Its memory lives in this closure. */
export function createMergeActor(): LocalActor {
  const memory = initialMergeMemory();
  return {
    id: 'merge',
    step(_now: number, _inbox: Message[], _sensors: SensorReadings): Outgoing[] {
      // The order the real step will follow:
      // 1. If there was a gap since memory.lastStepAt, call resumeMerge.
      // 2. Update the holder with observeJunction, then free it if canReleaseJunction.
      // 3. Add new requests with recordJunctionRequests.
      // 4. If canGrantJunction, grant nextForJunction with follow from followFor, over
      //    short range, and set lastIntoExit to that train.
      void memory;
      return [];
    },
  };
}
