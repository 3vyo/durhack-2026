import type {
  LocalActor,
  Message,
  Outgoing,
  PlatformId,
  SensorReadings,
  TimetableEntry,
  TrainId,
} from '../shared/types';

// The station actor owns the four platforms and grants one lock per platform.
// Rules: docs/design.md, "Entering the station" and "Platform sensors switched off".
// The switched-back-on rule is from the review on pull request #31. Pull request #35
// writes it into the design.
//
// Everything here is a placeholder. Each function returns its safest value, and step
// sends nothing. The design says silence means no, so a silent station is safe.
//
// Two numbers are inputs, not constants in this file. `repeat` waits on REQUEST_REPEAT,
// which pull request #34 adds to src/shared/constants.ts. `settle` waits on
// RESUME_SETTLE, which has no agreed value yet. See resume.ts.

export const PLATFORMS: readonly PlatformId[] = ['P1', 'P2', 'P3', 'P4'];

/**
 * The fixed split from "Station switched off": A owns P1 and P2, B owns P3 and P4.
 * This moves to src/shared/ when pull request #34 merges. Import it from there then.
 */
export const PLATFORM_PAIRS: Readonly<Record<TimetableEntry['entry'], readonly PlatformId[]>> = {
  A: ['P1', 'P2'],
  B: ['P3', 'P4'],
};

/** What the station has seen of the train holding a platform lock. */
export interface PlatformLock {
  holder: TrainId;
  grantedAt: number;
  /** True once the platform sensor has shown occupied since the grant. */
  seenArrive: boolean;
  /** The last time the holder's lockRequest for this platform was heard. */
  lastRequestAt: number;
}

/** The station's memory. It survives the actor being switched off and on again. */
export interface StationMemory {
  locks: Record<PlatformId, PlatformLock | null>;
  /** The `now` of the last step, so the actor can spot a gap where it was switched off. */
  lastStepAt: number | null;
  /** When the actor last came back on. Null if it has never been off. */
  resumedAt: number | null;
}

/** The answer to one lockRequest for a platform. Null from answerPlatformRequest means say nothing. */
export type StationReply =
  | { kind: 'grant'; platform: PlatformId }
  | { kind: 'refuse'; alternative: PlatformId | null };

export function initialStationMemory(): StationMemory {
  return {
    locks: { P1: null, P2: null, P3: null, P4: null },
    lastStepAt: null,
    resumedAt: null,
  };
}

/**
 * "Entering the station": the station only offers platforms from the train's own pair.
 * Looks up the train's entry track in the timetable and returns that track's two platforms.
 *
 * Placeholder: returns no platforms, so the train is offered nothing.
 */
export function ownPair(_timetable: TimetableEntry[], _train: TrainId): PlatformId[] {
  return [];
}

/**
 * "Entering the station": when several trains ask on one tick, answer them in order of
 * `enterAt`, earliest first, lowest ID on a tie. So when two ask for the same platform,
 * the train in front gets it. If the train behind won, the one in front could sit at the
 * end of the entry track and block the train that holds the lock.
 *
 * Placeholder: answers nobody.
 */
export function answerOrder(_trains: TrainId[], _timetable: TimetableEntry[]): TrainId[] {
  return [];
}

export interface GrantCheck {
  train: TrainId;
  platform: PlatformId;
  pair: PlatformId[];
  memory: StationMemory;
  sensors: SensorReadings;
}

/**
 * "Entering the station" and "Platform sensors switched off": grant a platform only if it
 * is in the train's pair, its sensor says empty (a dead sensor reads occupied), and no
 * other train holds its lock.
 *
 * Placeholder: never grants.
 */
export function canGrantPlatform(_check: GrantCheck): boolean {
  return false;
}

export interface AlternativeCheck {
  train: TrainId;
  requested: PlatformId;
  pair: PlatformId[];
  memory: StationMemory;
  sensors: SensorReadings;
}

/**
 * "Platform sensors switched off": when the requested platform cannot be granted, offer
 * the other platform of the train's pair if it could be granted now.
 *
 * Placeholder: offers nothing.
 */
export function chooseAlternative(_check: AlternativeCheck): PlatformId | null {
  return null;
}

export interface PlatformRequest {
  now: number;
  train: TrainId;
  platform: PlatformId;
  pair: PlatformId[];
  memory: StationMemory;
  sensors: SensorReadings;
  /** From stillSettling. While true, refuse with alternative null. */
  settling: boolean;
}

/**
 * "Entering the station": answer one lockRequest for a platform with a grant, or a refusal
 * with or without an alternative. Uses canGrantPlatform and chooseAlternative.
 *
 * Switched back on: while `settling` is true, grant nothing and refuse with alternative
 * null, so waiting trains stop falling back to the fixed split.
 *
 * Placeholder: says nothing.
 */
export function answerPlatformRequest(_request: PlatformRequest): StationReply | null {
  return null;
}

/**
 * "Entering the station": after a grant, write the new lock into the lock table, so a
 * second request on the same tick sees the platform as taken.
 *
 * Placeholder: records nothing. This is safe only because nothing is granted yet.
 */
export function recordGrant(
  memory: StationMemory,
  _train: TrainId,
  _platform: PlatformId,
  _now: number,
): StationMemory {
  return memory;
}

/**
 * "Platform sensors switched off": note each lockRequest from a train that already holds
 * that platform in its lock's lastRequestAt. The release guard in canReleasePlatform
 * uses this.
 *
 * Placeholder: records nothing.
 */
export function recordHolderRequests(
  memory: StationMemory,
  _inbox: Message[],
  _now: number,
): StationMemory {
  return memory;
}

/**
 * "Entering the station": the actor releases a lock after the sensor has shown the train
 * arrive and then leave. This updates what the actor has seen, from one sensor reading.
 *
 * Placeholder: records nothing, so the lock never looks ready to release.
 */
export function observePlatform(lock: PlatformLock, _occupied: boolean, _now: number): PlatformLock {
  return lock;
}

export interface ReleaseCheck {
  now: number;
  lock: PlatformLock;
  occupied: boolean;
  /** From StationMemory. */
  resumedAt: number | null;
  /** RESUME_SETTLE. Not agreed yet. See resume.ts. */
  settle: number;
  /** REQUEST_REPEAT, from pull request #34. */
  repeat: number;
}

/**
 * "Entering the station" and "Platform sensors switched off": release only after the train
 * has arrived and left, and never while the train could still be on its way in.
 *
 * The guard. A dead sensor looks like a train arriving, and its return looks like a train
 * leaving, so the sensor alone is not enough. A train keeps repeating its lockRequest
 * after the grant until its front is in the platform. The actor keeps the lock while it
 * hears those repeats. So a lock releases only when the sensor has shown arrive then
 * leave and the holder has not been heard for longer than one `repeat` plus two TICKs.
 * The two ticks cover a repeat that arrives a tick after it is sent, and a train whose
 * repeat timer fires a tick late.
 *
 * Switched back on: a lock with `seenArrive` true releases by the rule above. A lock with
 * `seenArrive` false releases only after the window `resumedAt + settle` is over, if its
 * sensor reads empty and the holder was not heard during the whole window. A holder still
 * on its way in is in the station's radio range, and short range drops nothing. A holder
 * in the platform shows on the sensor. A dead sensor reads occupied.
 *
 * Placeholder: never releases.
 */
export function canReleasePlatform(_check: ReleaseCheck): boolean {
  return false;
}

/**
 * Switched back on: set `resumedAt` to now and keep every lock. The gap itself releases
 * nothing.
 *
 * Placeholder: changes nothing. That is safe because stillSettling's placeholder already
 * keeps the actor from granting.
 */
export function resumeStation(memory: StationMemory, _now: number): StationMemory {
  return memory;
}

/** Builds the station actor. Its memory lives in this closure. */
export function createStationActor(timetable: TimetableEntry[]): LocalActor {
  const memory = initialStationMemory();
  void timetable;
  return {
    id: 'station',
    step(_now: number, _inbox: Message[], _sensors: SensorReadings): Outgoing[] {
      // The order the real step will follow:
      // 1. If wasSwitchedOff, call resumeStation.
      // 2. Note repeat requests from lock holders with recordHolderRequests.
      // 3. Update each lock with observePlatform, then free it if canReleasePlatform.
      // 4. Take the platform lockRequests from the inbox, put them in answerOrder, and
      //    answer each with answerPlatformRequest over short range. Pass `settling` from
      //    stillSettling. After each grant, call recordGrant before the next request.
      //    Ignore JUNCTION requests and every other message type.
      // 5. Set memory.lastStepAt to now.
      void memory;
      return [];
    },
  };
}
