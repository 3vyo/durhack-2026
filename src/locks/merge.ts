import { MERGE_TIMEOUT, REQUEST_REPEAT, RESUME_SETTLE } from '../shared/constants';
import type { LocalActor, Message, Outgoing, SensorReadings, TrainId } from '../shared/types';
import { longerThan, stillSettling, wasSwitchedOff } from './resume';

// The merge actor owns the junction zone and grants one lock at a time.
// Rules: docs/design.md, "Leaving the station" and "Merge switched off". The
// switched-back-on rule is from the review on pull request #31.
//
// The actor uses only `now`, its inbox and the sensor readings. In any doubtful case it
// refuses. A wrong refusal costs time. A wrong grant can cost a collision.

/**
 * A queued request is dropped once its train has not been heard for longer than this.
 * Local to this file. Two repeats, so one late repeat does not lose a train its place.
 * It must stay shorter than RESUME_SETTLE, so that a train that left by clock slot while
 * the actor was off is out of the queue before the first grant after the actor is back.
 */
export function mergeSilence(): number {
  return 2 * REQUEST_REPEAT;
}

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
  /** The last train this actor saw into EXIT. The next grant names it in `follow`. */
  lastIntoExit: TrainId | null;
  /**
   * True when the actor cannot say who last entered EXIT: it has been switched off, or a
   * train it did not grant has been in the zone. The next grant then names the granted
   * train's own ID in `follow`, which a train reads as "leader unknown".
   */
  leaderUnknown: boolean;
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
    leaderUnknown: false,
    lastStepAt: null,
    resumedAt: null,
    zoneOccupiedSinceResume: false,
  };
}

/** The trains with a JUNCTION lockRequest in the inbox, each once, in inbox order. */
export function junctionRequesters(inbox: Message[]): TrainId[] {
  const trains: TrainId[] = [];
  for (const msg of inbox) {
    if (msg.type !== 'lockRequest' || msg.resource !== 'JUNCTION') continue;
    if (!trains.includes(msg.from)) trains.push(msg.from);
  }
  return trains;
}

/**
 * True if this holder was granted before the actor was last switched off. The actor does
 * not know what such a holder did during the gap, so it does not repeat its grant and
 * does not name it in a later `follow`.
 */
export function grantedBeforeResume(holder: JunctionHolder, resumedAt: number | null): boolean {
  return resumedAt !== null && holder.grantedAt < resumedAt;
}

/**
 * "Leaving the station": add each new JUNCTION lockRequest to the queue with the time it
 * was first heard. A repeat keeps its first time and updates lastHeardAt. Platform
 * requests are not for this actor.
 *
 * Trains in `skip` are not queued. The step passes the holder, and the last train it saw
 * into EXIT, whose request can only be a late one.
 */
export function recordJunctionRequests(
  queue: JunctionRequest[],
  inbox: Message[],
  now: number,
  skip: TrainId[] = [],
): JunctionRequest[] {
  const heard = junctionRequesters(inbox).filter((train) => !skip.includes(train));
  const repeated = queue.map((r) => (heard.includes(r.train) ? { ...r, lastHeardAt: now } : r));
  const added = heard
    .filter((train) => !queue.some((r) => r.train === train))
    .map((train) => ({ train, firstHeardAt: now, lastHeardAt: now }));
  return [...repeated, ...added];
}

/**
 * "Leaving the station": drop a request whose train has stopped asking, for example one
 * that left by clock slot. Otherwise the actor could grant a train that is gone and hold a
 * lock nobody uses. A request goes once its train has not been heard for longer than
 * `silence`. The step passes mergeSilence().
 */
export function dropSilentRequests(
  queue: JunctionRequest[],
  now: number,
  silence: number,
): JunctionRequest[] {
  return queue.filter((r) => !longerThan(now - r.lastHeardAt, silence));
}

/**
 * "Merge switched off": a train that hears no reply for 10 seconds starts using clock
 * slots. A train waiting in the queue behind others could wait that long while this actor
 * is alive, start in its slot, and meet the train the actor just granted. So the actor
 * answers every JUNCTION lockRequest it does not grant with a lockRefuse, alternative
 * null, over short range, on the tick it hears it. Not every tick.
 *
 * The holder is never refused. The step sends it its grant again. The exception is a
 * holder from before the actor was switched off, whose grant the actor does not repeat.
 * A train that did hear its grant ignores the refusal.
 *
 * Switched back on: while `settling` is true it refuses every JUNCTION request it hears.
 *
 * Returns the trains to refuse this tick. `memory` is after this tick's grant, if any.
 */
export function queuedToAnswer(
  memory: MergeMemory,
  inbox: Message[],
  settling: boolean,
): TrainId[] {
  const heard = junctionRequesters(inbox);
  const holder = memory.holder;
  if (settling || holder === null || grantedBeforeResume(holder, memory.resumedAt)) return heard;
  return heard.filter((train) => train !== holder.train);
}

/** "Leaving the station": oldest request first, lowest ID on a tie. */
export function nextForJunction(queue: JunctionRequest[]): TrainId | null {
  let next: JunctionRequest | null = null;
  for (const r of queue) {
    const older =
      next === null ||
      r.firstHeardAt < next.firstHeardAt ||
      (r.firstHeardAt === next.firstHeardAt && r.train < next.train);
    if (older) next = r;
  }
  return next === null ? null : next.train;
}

/**
 * "Leaving the station": grant only when nobody holds the lock, `junctionOccupied` is false
 * and `exitStartClear` is true.
 *
 * Switched back on: grant nothing while `settling` is true. A train that started in its
 * clock slot on the tick the actor came back shows on junctionOccupied inside the window.
 */
export function canGrantJunction(
  holder: JunctionHolder | null,
  sensors: SensorReadings,
  settling: boolean,
): boolean {
  return holder === null && !sensors.junctionOccupied && sensors.exitStartClear && !settling;
}

/**
 * "Leaving the station": the grant's `follow` is the last train into EXIT, which the new
 * holder treats as its leader. Null means no train has entered EXIT.
 *
 * When the actor does not know who last entered EXIT, `follow` is the granted train's own
 * ID. The train reads that as "leader unknown" and stays at SIGHT_SPEED or below. A stale
 * `follow` is the one unsafe value in this file. The train would take a limit point
 * beyond a train it has never heard and run at MAX_SPEED.
 */
export function followFor(memory: MergeMemory, train: TrainId): TrainId | null {
  return memory.leaderUnknown ? train : memory.lastIntoExit;
}

/**
 * "Leaving the station": the actor releases the lock when its sensor shows the junction
 * zone empty again. This records whether the holder has been seen in the zone yet.
 */
export function observeJunction(holder: JunctionHolder, sensors: SensorReadings): JunctionHolder {
  return sensors.junctionOccupied && !holder.seenEnter ? { ...holder, seenEnter: true } : holder;
}

/**
 * Every step: track the zone as a whole. Nothing changes while the zone reads empty.
 * While it reads occupied:
 * - Set zoneOccupiedSinceResume.
 * - If a holder granted since the last resume is in place, that is the train in the
 *   zone. Set lastIntoExit to it. The actor does this on entry and not on the grant, so
 *   a train that is granted and never leaves its platform is not named as a leader.
 * - Otherwise the train came by clock slot, or the holder is from before a gap, and this
 *   actor does not know who it is. Set leaderUnknown.
 */
export function observeZone(memory: MergeMemory, sensors: SensorReadings): MergeMemory {
  if (!sensors.junctionOccupied) return memory;
  const seen = { ...memory, zoneOccupiedSinceResume: true };
  const holder = memory.holder;
  if (holder === null || grantedBeforeResume(holder, memory.resumedAt)) {
    return { ...seen, leaderUnknown: true };
  }
  return { ...seen, lastIntoExit: holder.train, leaderUnknown: false };
}

export interface JunctionReleaseCheck {
  now: number;
  holder: JunctionHolder;
  sensors: SensorReadings;
  /** From MergeMemory. */
  resumedAt: number | null;
  zoneOccupiedSinceResume: boolean;
  /** RESUME_SETTLE. */
  settle: number;
  /** MERGE_TIMEOUT. A grant not used within this long is released. */
  unused: number;
}

/**
 * "Leaving the station": release once the holder has entered the zone and the zone is
 * empty again.
 *
 * An unused grant: a holder that has not been seen in the zone within `unused` of its
 * grant is released. This covers a train that breaks down in its platform after being
 * granted. A granted train is stopped at the edge of the zone, so it shows on the sensor
 * within a second or two of hearing the grant.
 *
 * Switched back on: a holder from before the gap with `seenEnter` false is released once
 * the window `resumedAt + settle` is over, if the zone read empty for the whole window.
 * Otherwise a holder that went through while the actor was off blocks the junction for
 * the rest of the run.
 */
export function canReleaseJunction(check: JunctionReleaseCheck): boolean {
  const { now, holder, sensors, resumedAt, zoneOccupiedSinceResume, settle, unused } = check;
  if (holder.seenEnter) return !sensors.junctionOccupied;
  if (grantedBeforeResume(holder, resumedAt)) {
    return !stillSettling(resumedAt, now, settle) && !zoneOccupiedSinceResume;
  }
  return longerThan(now - holder.grantedAt, unused);
}

/**
 * Switched back on:
 * - Set resumedAt to now and zoneOccupiedSinceResume to false.
 * - Set lastIntoExit to null and leaderUnknown to true, so no grant names a stale `follow`.
 * - Keep the queue and its order, but set every lastHeardAt to now, so dropSilentRequests
 *   clears the trains that left by clock slot.
 * - Keep the holder. canReleaseJunction decides about it after the window.
 */
export function resumeMerge(memory: MergeMemory, now: number): MergeMemory {
  return {
    ...memory,
    queue: memory.queue.map((r) => ({ ...r, lastHeardAt: now })),
    lastIntoExit: null,
    leaderUnknown: true,
    resumedAt: now,
    zoneOccupiedSinceResume: false,
  };
}

/** Updates the holder from the sensors, then frees the lock if canReleaseJunction. */
function updateHolder(memory: MergeMemory, sensors: SensorReadings, now: number): MergeMemory {
  if (memory.holder === null) return memory;
  const holder = observeJunction(memory.holder, sensors);
  const release = canReleaseJunction({
    now,
    holder,
    sensors,
    resumedAt: memory.resumedAt,
    zoneOccupiedSinceResume: memory.zoneOccupiedSinceResume,
    settle: RESUME_SETTLE,
    unused: MERGE_TIMEOUT,
  });
  return { ...memory, holder: release ? null : holder };
}

/** The trains whose requests are not queued: the holder and the last train into EXIT. */
function notQueued(memory: MergeMemory): TrainId[] {
  const skip: TrainId[] = [];
  if (memory.holder !== null) skip.push(memory.holder.train);
  if (memory.lastIntoExit !== null) skip.push(memory.lastIntoExit);
  return skip;
}

/** Grants the next train in the queue, if canGrantJunction. */
function grantNext(
  memory: MergeMemory,
  sensors: SensorReadings,
  settling: boolean,
  now: number,
): MergeMemory {
  if (!canGrantJunction(memory.holder, sensors, settling)) return memory;
  const train = nextForJunction(memory.queue);
  if (train === null) return memory;
  const holder = { train, follow: followFor(memory, train), grantedAt: now, seenEnter: false };
  return { ...memory, holder, queue: memory.queue.filter((r) => r.train !== train) };
}

function grantTo(holder: JunctionHolder): Outgoing {
  return {
    msg: { type: 'lockGrant', to: holder.train, resource: 'JUNCTION', follow: holder.follow },
    range: 'short',
  };
}

function refusalTo(train: TrainId): Outgoing {
  return {
    msg: { type: 'lockRefuse', to: train, resource: 'JUNCTION', alternative: null },
    range: 'short',
  };
}

/** One step of the merge actor: the memory after the step and the replies to send. */
export function stepMerge(
  before: MergeMemory,
  now: number,
  inbox: Message[],
  sensors: SensorReadings,
): { memory: MergeMemory; out: Outgoing[] } {
  let memory = wasSwitchedOff(before.lastStepAt, now) ? resumeMerge(before, now) : before;
  const settling = stillSettling(memory.resumedAt, now, RESUME_SETTLE);
  memory = observeZone(memory, sensors);
  memory = updateHolder(memory, sensors, now);

  const recorded = recordJunctionRequests(memory.queue, inbox, now, notQueued(memory));
  memory = { ...memory, queue: dropSilentRequests(recorded, now, mergeSilence()) };

  const holderBefore = memory.holder;
  memory = grantNext(memory, sensors, settling, now);

  const refused = queuedToAnswer(memory, inbox, settling);
  const out = refused.map(refusalTo);
  const holder = memory.holder;
  const granted = holder !== null && holder !== holderBefore;
  const repeated = junctionRequesters(inbox).some((train) => train === holder?.train);
  if (holder !== null && !refused.includes(holder.train) && (granted || repeated)) {
    // A repeated grant restarts the unused-grant timer, so the lock is never released
    // just after the holder was told again that it may go.
    memory = { ...memory, holder: { ...holder, grantedAt: now } };
    out.unshift(grantTo(holder));
  }
  return { memory: { ...memory, lastStepAt: now }, out };
}

/** Builds the merge actor. Its memory lives in this closure. */
export function createMergeActor(): LocalActor {
  let memory = initialMergeMemory();
  return {
    id: 'merge',
    step(now: number, inbox: Message[], sensors: SensorReadings): Outgoing[] {
      const result = stepMerge(memory, now, inbox, sensors);
      memory = result.memory;
      return result.out;
    },
  };
}
