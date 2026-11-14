import type { LocalActor, Message, Outgoing, SensorReadings, TrainId } from '../shared/types';

// The merge actor owns the junction zone and grants one lock at a time.
// Rules: docs/design.md, "Leaving the station" and "Merge switched off". Refusing queued
// trains and the switched-back-on rule are from the review on pull request #31. Pull
// request #35 writes them into the design.
//
// Everything here is a placeholder. Each function returns its safest value, and step
// sends nothing. The design says silence means no, so a silent merge actor is safe.
//
// `settle` (RESUME_SETTLE) and `silence` (see dropSilentRequests) are inputs, not
// constants in this file. Neither has an agreed value yet. Each waits on a constant in
// src/shared/constants.ts. Pull request #34 adds the shared timing constants, but neither
// of these is in it yet.

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
  /** When the actor last came back on. Null if it has never been off. */
  resumedAt: number | null;
  /** True if junctionOccupied has read true at any step since resumedAt. */
  zoneOccupiedSinceResume: boolean;
}

export function initialMergeMemory(): MergeMemory {
  return {
    holder: null,
    queue: [],
    lastIntoExit: null,
    lastStepAt: null,
    resumedAt: null,
    zoneOccupiedSinceResume: false,
  };
}

/**
 * "Leaving the station": add each new JUNCTION lockRequest to the queue with the time it
 * was first heard. A repeat keeps its first time and updates lastHeardAt. Platform
 * requests are not for this actor.
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
 * "Leaving the station": drop a request whose train has stopped asking, for example one
 * that left by clock slot. Otherwise the actor could grant a train that is gone and hold a
 * lock nobody uses. A request goes once its train has not been heard for longer than
 * `silence`. `silence` is an input. Its value is not agreed and waits on a constant in
 * src/shared/constants.ts. It must be at least one REQUEST_REPEAT plus two TICKs.
 *
 * Placeholder: drops nobody.
 */
export function dropSilentRequests(
  queue: JunctionRequest[],
  _now: number,
  _silence: number,
): JunctionRequest[] {
  return queue;
}

/**
 * "Merge switched off": a train that hears no reply for 10 seconds starts using clock
 * slots. A train waiting in the queue behind others could wait that long while this actor
 * is alive, start in its slot, and meet the train the actor just granted. So the actor
 * answers every JUNCTION lockRequest it does not grant with a lockRefuse, alternative
 * null, over short range, on the tick it hears it. Not every tick.
 *
 * Switched back on: while `settling` is true it refuses every JUNCTION request it hears.
 *
 * Returns the trains to refuse this tick. `memory` is after this tick's grant, if any.
 *
 * Placeholder: answers nobody.
 */
export function queuedToAnswer(
  _memory: MergeMemory,
  _inbox: Message[],
  _settling: boolean,
): TrainId[] {
  return [];
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
 * Switched back on: grant nothing while `settling` is true. A train that started in its
 * clock slot on the tick the actor came back shows on junctionOccupied inside the window.
 *
 * Placeholder: never grants.
 */
export function canGrantJunction(
  _holder: JunctionHolder | null,
  _sensors: SensorReadings,
  _settling: boolean,
): boolean {
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
 * Switched back on, and every step: track the zone as a whole.
 * - Set zoneOccupiedSinceResume once junctionOccupied reads true.
 * - Set lastIntoExit to null whenever junctionOccupied is true and nobody holds the lock.
 *   That train came by clock slot, and this actor does not know who it is. A stale
 *   `follow` is the one unsafe value in this file. The train would take a limit point
 *   beyond a clock-slot train it has never heard and run at MAX_SPEED. Null keeps it at
 *   SIGHT_SPEED.
 *
 * Placeholder: changes nothing. That is safe because followFor's placeholder names no
 * leader.
 */
export function observeZone(memory: MergeMemory, _sensors: SensorReadings): MergeMemory {
  return memory;
}

export interface JunctionReleaseCheck {
  now: number;
  holder: JunctionHolder;
  sensors: SensorReadings;
  /** From MergeMemory. */
  resumedAt: number | null;
  zoneOccupiedSinceResume: boolean;
  /** RESUME_SETTLE. Not agreed yet. See resume.ts. */
  settle: number;
}

/**
 * "Leaving the station": release once the holder has entered the zone and the zone is
 * empty again.
 *
 * Switched back on: a holder with `seenEnter` false is released once the window
 * `resumedAt + settle` is over, if the zone read empty for the whole window. Otherwise a
 * holder that went through while the actor was off blocks the junction for the rest of
 * the run.
 *
 * Placeholder: never releases.
 */
export function canReleaseJunction(_check: JunctionReleaseCheck): boolean {
  return false;
}

/**
 * Switched back on:
 * - Set resumedAt to now and zoneOccupiedSinceResume to false.
 * - Set lastIntoExit to null, so no grant names a stale `follow`.
 * - Keep the queue and its order, but set every lastHeardAt to now, so dropSilentRequests
 *   clears the trains that left by clock slot.
 * - Keep the holder. canReleaseJunction decides about it after the window.
 *
 * Placeholder: changes nothing. That is safe because stillSettling's placeholder keeps
 * the actor from granting, and followFor's placeholder names no leader.
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
      // 1. If wasSwitchedOff, call resumeMerge.
      // 2. Update the zone with observeZone, and the holder with observeJunction. Free
      //    the holder if canReleaseJunction.
      // 3. Add new requests with recordJunctionRequests, then dropSilentRequests with
      //    `silence`.
      // 4. If canGrantJunction, grant nextForJunction with follow from followFor, over
      //    short range, and set lastIntoExit to that train. Pass `settling` from
      //    stillSettling.
      // 5. Send a lockRefuse to each train from queuedToAnswer, over short range.
      // 6. Set memory.lastStepAt to now.
      void memory;
      return [];
    },
  };
}
