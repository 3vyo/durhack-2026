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
//
// Everything here is a placeholder. Each function returns its safest value, and step
// sends nothing. The design says silence means no, so a silent station is safe.

export const PLATFORMS: readonly PlatformId[] = ['P1', 'P2', 'P3', 'P4'];

/** The fixed split from "Station switched off": A owns P1 and P2, B owns P3 and P4. */
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
}

/** The answer to one lockRequest for a platform. Null from answerPlatformRequest means say nothing. */
export type StationReply =
  | { kind: 'grant'; platform: PlatformId }
  | { kind: 'refuse'; alternative: PlatformId | null };

export function initialStationMemory(): StationMemory {
  return {
    locks: { P1: null, P2: null, P3: null, P4: null },
    lastStepAt: null,
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
}

/**
 * "Entering the station": answer one lockRequest for a platform with a grant, or a refusal
 * with or without an alternative. Uses canGrantPlatform and chooseAlternative.
 *
 * Placeholder: says nothing.
 */
export function answerPlatformRequest(_request: PlatformRequest): StationReply | null {
  return null;
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
}

/**
 * "Entering the station" and "Platform sensors switched off": release only after the train
 * has arrived and left, and never while the train could still be on its way in. A dead
 * sensor looks like a train arriving, and its return looks like a train leaving.
 *
 * Placeholder: never releases.
 */
export function canReleasePlatform(_check: ReleaseCheck): boolean {
  return false;
}

/**
 * The actor was switched off and is now on again. It still has its old memory. What it
 * should do with it is not decided yet, and the design does not cover it.
 *
 * Placeholder: keeps every lock it held, so it grants none of those platforms.
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
      // 1. If there was a gap since memory.lastStepAt, call resumeStation.
      // 2. Update each lock with observePlatform, then free it if canReleasePlatform.
      // 3. Note repeat requests from lock holders in lastRequestAt.
      // 4. Answer each platform lockRequest with answerPlatformRequest, over short range.
      //    Ignore JUNCTION requests and every other message type.
      void memory;
      return [];
    },
  };
}
