import { REQUEST_REPEAT, RESUME_SETTLE, TICK } from '../shared/constants';
import { ALL_PLATFORMS, PLATFORMS, pairOf } from '../shared/map';
import type {
  LocalActor,
  Message,
  Outgoing,
  PlatformId,
  SensorReadings,
  TimetableEntry,
  TrainId,
} from '../shared/types';
import { longerThan, stillSettling, wasSwitchedOff } from './resume';

// The platform keeper owns every platform of the layout in use and grants one lock per
// platform. Rules: docs/design.md, "Entering the station" and "Platform sensors switched
// off". The switched-back-on rule is from the review on pull request #31.
//
// The layout is read from PLATFORMS in src/shared/map.ts each time a function runs, never
// copied when this file loads or when the keeper is built. Each entry track owns its own two
// platforms, and the keeper never grants or offers a platform outside the layout or outside
// the asking train's pair.
//
// The actor uses only `now`, its inbox, the sensor readings and the timetable. In any
// doubtful case it refuses. A wrong refusal costs time. A wrong grant can cost a collision.

/**
 * How long a platform must have read empty before it is granted, after it read occupied
 * with no lock on it. Local to this file. It is the same wait as RESUME_SETTLE, for the
 * same reason: it covers a train getting from its stop at the end of its entry track to the
 * platform sensor.
 */
export function unlockedSettle(): number {
  return RESUME_SETTLE;
}

/** What the platform keeper has seen of the train holding a platform lock. */
export interface PlatformLock {
  holder: TrainId;
  grantedAt: number;
  /** True once the platform sensor has shown occupied since the grant. */
  seenArrive: boolean;
  /** The last time the holder's lockRequest was heard. */
  lastRequestAt: number;
}

/** The platform keeper's memory. It survives the actor being switched off and on again. */
export interface PlatformKeeperMemory {
  locks: Record<PlatformId, PlatformLock | null>;
  /**
   * The last time each platform read occupied while nobody held its lock. That reading is
   * a train that came in without a lock, or a dead sensor. Null if never.
   */
  unlockedOccupiedAt: Record<PlatformId, number | null>;
  /** The `now` of the last step, so the actor can spot a gap where it was switched off. */
  /**
   * When each train without a lock was last heard asking. Trains on one entry track cannot
   * pass each other, so only the front one may be granted. See trainAheadIsWaiting.
   */
  waiting?: Record<TrainId, number>;
  lastStepAt: number | null;
  /** When the actor last came back on. Null if it has never been off. */
  resumedAt: number | null;
}

/** The answer to one lockRequest for a platform. */
export type PlatformKeeperReply =
  | { kind: 'grant'; platform: PlatformId }
  | { kind: 'refuse'; alternative: PlatformId | null };

/**
 * The memory has a place for every platform any layout can have, so it has the same shape
 * whichever layout is in use when it is built. A platform outside the layout is never
 * locked, because canGrantPlatform never grants it.
 */
export function initialPlatformKeeperMemory(): PlatformKeeperMemory {
  const locks = {} as Record<PlatformId, PlatformLock | null>;
  const unlockedOccupiedAt = {} as Record<PlatformId, number | null>;
  for (const platform of ALL_PLATFORMS) {
    locks[platform] = null;
    unlockedOccupiedAt[platform] = null;
  }
  return { locks, unlockedOccupiedAt, lastStepAt: null, resumedAt: null };
}

/** True if the platform is in the layout in use. */
function inLayout(platform: PlatformId): boolean {
  return PLATFORMS.includes(platform);
}

/**
 * "Entering the station": the station only offers platforms from the train's own pair.
 * Looks up the train's entry track in the timetable and returns that track's two platforms:
 * P1 and P2 for A, P3 and P4 for B, P5 and P6 for C, P7 and P8 for D. A train that is not in
 * the timetable has no pair, so it is offered nothing. Nor is a train whose entry track is
 * not in the layout in use, since its platforms do not exist.
 */
export function ownPair(timetable: TimetableEntry[], train: TrainId): PlatformId[] {
  const entry = timetable.find((e) => e.id === train);
  return entry ? pairOf(entry.entry).filter(inLayout) : [];
}

/**
 * "Entering the station": when several trains ask on one tick, answer them in order of
 * `enterAt`, earliest first, lowest ID on a tie. So when two ask for the same platform,
 * the train in front gets it. If the train behind won, the one in front could sit at the
 * end of the entry track and block the train that holds the lock. A train that is not in
 * the timetable goes last.
 */
export function answerOrder(trains: TrainId[], timetable: TimetableEntry[]): TrainId[] {
  const enterAt = (id: TrainId) => timetable.find((e) => e.id === id)?.enterAt ?? Infinity;
  return [...trains].sort((a, b) => enterAt(a) - enterAt(b) || a - b);
}

/**
 * How long a train without a lock may be silent before the platform keeper stops counting it as
 * waiting. Two repeats, so one late request does not lose a train its place.
 */
export function waitingSilence(): number {
  return 2 * REQUEST_REPEAT;
}

/** Note every train that asked this tick and holds no lock, and forget the ones gone quiet. */
export function recordWaiting(memory: PlatformKeeperMemory, inbox: Message[], now: number): PlatformKeeperMemory {
  const waiting: Record<TrainId, number> = {};
  for (const [id, at] of Object.entries(memory.waiting ?? {})) {
    const train = Number(id);
    if (heldBy(memory, train) === null && !longerThan(now - at, waitingSilence())) waiting[train] = at;
  }
  for (const msg of inbox) {
    if (msg.type !== 'lockRequest' || msg.resource === 'JUNCTION') continue;
    if (heldBy(memory, msg.from) === null) waiting[msg.from] = now;
  }
  return { ...memory, waiting };
}

/**
 * True if a train that entered the same entry track before this one is still asking for a
 * platform and has none. Trains on one entry track stand in a queue, so a platform given to
 * a train further back could never be reached, and the queue would never move.
 */
export function trainAheadIsWaiting(memory: PlatformKeeperMemory, timetable: TimetableEntry[], train: TrainId): boolean {
  const mine = timetable.find((e) => e.id === train);
  if (!mine) return false;
  return Object.keys(memory.waiting ?? {}).some((id) => {
    const other = timetable.find((e) => e.id === Number(id));
    if (!other || other.id === train || other.entry !== mine.entry) return false;
    return other.enterAt < mine.enterAt || (other.enterAt === mine.enterAt && other.id < mine.id);
  });
}

/** The platform of the layout in use that this train holds the lock on, or null. */
export function heldBy(memory: PlatformKeeperMemory, train: TrainId): PlatformId | null {
  return PLATFORMS.find((p) => memory.locks[p]?.holder === train) ?? null;
}

export interface GrantCheck {
  now: number;
  train: TrainId;
  platform: PlatformId;
  pair: PlatformId[];
  memory: PlatformKeeperMemory;
  sensors: SensorReadings;
}

/** True if the platform read occupied with no lock on it less than unlockedSettle() ago. */
function unlockedTrainMayBeNear(memory: PlatformKeeperMemory, platform: PlatformId, now: number): boolean {
  const at = memory.unlockedOccupiedAt[platform];
  return at !== null && !longerThan(now - at, unlockedSettle());
}

/**
 * "Entering the station" and "Platform sensors switched off": a new grant. Grant a
 * platform only if it is in the layout in use and in the train's pair, its sensor says empty
 * (a dead sensor reads occupied), nobody holds its lock, and the train holds no lock already.
 *
 * A platform outside the layout should already read occupied in the sensor readings. The
 * check here does not depend on that.
 *
 * One more guard. A platform that read occupied with no lock on it had a train that came
 * in by the fixed split, or a dead sensor. When that reading turns empty, the sensors may
 * have just come back while a creeping train is about to roll onto the platform. So the
 * platform must then read empty for unlockedSettle() before it is granted.
 */
export function canGrantPlatform(check: GrantCheck): boolean {
  const { now, train, platform, pair, memory, sensors } = check;
  if (!inLayout(platform)) return false;
  if (!pair.includes(platform)) return false;
  if (sensors.platformOccupied[platform]) return false;
  if (memory.locks[platform] !== null) return false;
  if (heldBy(memory, train) !== null) return false;
  return !unlockedTrainMayBeNear(memory, platform, now);
}

export interface AlternativeCheck {
  now: number;
  train: TrainId;
  requested: PlatformId;
  pair: PlatformId[];
  memory: PlatformKeeperMemory;
  sensors: SensorReadings;
}

/**
 * "Platform sensors switched off": when the requested platform cannot be granted, offer
 * the other platform of the train's pair if it could be granted now.
 */
export function chooseAlternative(check: AlternativeCheck): PlatformId | null {
  const { requested, ...rest } = check;
  const others = check.pair.filter((p) => p !== requested);
  return others.find((p) => canGrantPlatform({ ...rest, platform: p })) ?? null;
}

export interface PlatformRequest {
  now: number;
  train: TrainId;
  platform: PlatformId;
  pair: PlatformId[];
  memory: PlatformKeeperMemory;
  sensors: SensorReadings;
  /** From stillSettling. While true, refuse with alternative null. */
  settling: boolean;
}

const REFUSE: PlatformKeeperReply = { kind: 'refuse', alternative: null };

/** True if this lock was granted before the actor was last switched off. */
function grantedBeforeResume(lock: PlatformLock, resumedAt: number | null): boolean {
  return resumedAt !== null && lock.grantedAt < resumedAt;
}

/**
 * "Platform sensors switched off": a train that already holds a lock gets that grant
 * again, never a refusal, even when its own front makes the sensor read occupied. It
 * gets the platform it holds, whichever platform it asked for, so no train ever holds two.
 *
 * The one exception is a lock from before the actor was switched off whose platform reads
 * occupied. A train may have taken that platform by the fixed split meanwhile. The holder
 * is refused until the platform reads empty, and keeps its lock. A holder that did hear
 * its grant ignores the refusal.
 */
function answerHolder(request: PlatformRequest, held: PlatformId): PlatformKeeperReply {
  const lock = request.memory.locks[held] as PlatformLock;
  const stale = grantedBeforeResume(lock, request.memory.resumedAt);
  if (stale && request.sensors.platformOccupied[held]) return REFUSE;
  return { kind: 'grant', platform: held };
}

/**
 * "Entering the station": answer one lockRequest for a platform with a grant, or a refusal
 * with or without an alternative. Uses canGrantPlatform and chooseAlternative.
 *
 * Switched back on: while `settling` is true, grant nothing and refuse with alternative
 * null, so waiting trains stop falling back to the fixed split. This goes for lock
 * holders too. They keep their locks, and a train that holds a grant ignores the refusal.
 */
export function answerPlatformRequest(request: PlatformRequest): PlatformKeeperReply {
  const { now, train, platform, pair, memory, sensors, settling } = request;
  if (settling) return REFUSE;
  const held = heldBy(memory, train);
  if (held !== null) return answerHolder(request, held);
  if (canGrantPlatform({ now, train, platform, pair, memory, sensors })) {
    return { kind: 'grant', platform };
  }
  const alternative = chooseAlternative({ now, train, requested: platform, pair, memory, sensors });
  return { kind: 'refuse', alternative };
}

/**
 * "Entering the station": after a grant, write the new lock into the lock table, so a
 * second request on the same tick sees the platform as taken.
 */
export function recordGrant(
  memory: PlatformKeeperMemory,
  train: TrainId,
  platform: PlatformId,
  now: number,
): PlatformKeeperMemory {
  const lock: PlatformLock = { holder: train, grantedAt: now, seenArrive: false, lastRequestAt: now };
  return { ...memory, locks: { ...memory.locks, [platform]: lock } };
}

/**
 * "Platform sensors switched off": note each platform lockRequest from a train that holds
 * a lock in that lock's lastRequestAt, whichever platform it asked for. The release guard
 * in canReleasePlatform uses this.
 */
export function recordHolderRequests(
  memory: PlatformKeeperMemory,
  inbox: Message[],
  now: number,
): PlatformKeeperMemory {
  const locks = { ...memory.locks };
  for (const msg of inbox) {
    if (msg.type !== 'lockRequest' || msg.resource === 'JUNCTION') continue;
    const held = heldBy(memory, msg.from);
    if (held !== null) locks[held] = { ...(locks[held] as PlatformLock), lastRequestAt: now };
  }
  return { ...memory, locks };
}

/**
 * "Entering the station": the actor releases a lock after the sensor has shown the train
 * arrive and then leave. This updates what the actor has seen, from one sensor reading.
 */
export function observePlatform(lock: PlatformLock, occupied: boolean, _now: number): PlatformLock {
  return occupied && !lock.seenArrive ? { ...lock, seenArrive: true } : lock;
}

export interface ReleaseCheck {
  now: number;
  lock: PlatformLock;
  occupied: boolean;
  /** From PlatformKeeperMemory. */
  resumedAt: number | null;
  /** RESUME_SETTLE. */
  settle: number;
  /** REQUEST_REPEAT. */
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
 * The actor hears nothing while it is off. So after it comes back the silence counts from
 * `resumedAt`, not from a request it heard before the gap.
 *
 * Switched back on: a lock with `seenArrive` true releases by the rule above. A lock with
 * `seenArrive` false releases only after the window `resumedAt + settle` is over, if its
 * sensor reads empty and the holder was not heard during the whole window. A holder still
 * on its way in is in the platform keeper's radio range, and short range drops nothing. A holder
 * in the platform shows on the sensor. A dead sensor reads occupied.
 */
export function canReleasePlatform(check: ReleaseCheck): boolean {
  const { now, lock, occupied, resumedAt, settle, repeat } = check;
  if (occupied) return false;
  if (lock.seenArrive) {
    const silentSince = Math.max(lock.lastRequestAt, resumedAt ?? lock.lastRequestAt);
    return longerThan(now - silentSince, repeat + 2 * TICK);
  }
  if (resumedAt === null) return false;
  return !stillSettling(resumedAt, now, settle) && lock.lastRequestAt < resumedAt;
}

/**
 * Switched back on: set `resumedAt` to now and keep every lock. The gap itself releases
 * nothing.
 */
export function resumePlatformKeeper(memory: PlatformKeeperMemory, now: number): PlatformKeeperMemory {
  return { ...memory, resumedAt: now };
}

/** Updates every lock from the sensors, then frees the ones that canReleasePlatform. */
function updateLocks(memory: PlatformKeeperMemory, sensors: SensorReadings, now: number): PlatformKeeperMemory {
  const locks = { ...memory.locks };
  for (const platform of PLATFORMS) {
    const held = locks[platform];
    if (held === null) continue;
    const occupied = sensors.platformOccupied[platform];
    const lock = observePlatform(held, occupied, now);
    const release = canReleasePlatform({
      now,
      lock,
      occupied,
      resumedAt: memory.resumedAt,
      settle: RESUME_SETTLE,
      repeat: REQUEST_REPEAT,
    });
    locks[platform] = release ? null : lock;
  }
  return { ...memory, locks };
}

/** Notes each platform that reads occupied while nobody holds its lock. */
function noteUnlockedOccupied(
  memory: PlatformKeeperMemory,
  sensors: SensorReadings,
  now: number,
): PlatformKeeperMemory {
  const unlockedOccupiedAt = { ...memory.unlockedOccupiedAt };
  for (const platform of PLATFORMS) {
    if (sensors.platformOccupied[platform] && memory.locks[platform] === null) {
      unlockedOccupiedAt[platform] = now;
    }
  }
  return { ...memory, unlockedOccupiedAt };
}

interface Asked {
  train: TrainId;
  platform: PlatformId;
}

/** The platform lockRequests in the inbox, in answerOrder. Everything else is ignored. */
function platformRequests(inbox: Message[], timetable: TimetableEntry[]): Asked[] {
  const asked: Asked[] = [];
  for (const msg of inbox) {
    if (msg.type === 'lockRequest' && msg.resource !== 'JUNCTION') {
      asked.push({ train: msg.from, platform: msg.resource });
    }
  }
  const order = answerOrder([...new Set(asked.map((a) => a.train))], timetable);
  return order.flatMap((train) => asked.filter((a) => a.train === train));
}

function toOutgoing(train: TrainId, asked: PlatformId, reply: PlatformKeeperReply): Outgoing {
  const msg: Message =
    reply.kind === 'grant'
      ? { type: 'lockGrant', to: train, resource: reply.platform, follow: null }
      : { type: 'lockRefuse', to: train, resource: asked, alternative: reply.alternative };
  return { msg, range: 'short' };
}

/** One step of the platform keeper: the memory after the step and the replies to send. */
export function stepPlatformKeeper(
  before: PlatformKeeperMemory,
  timetable: TimetableEntry[],
  now: number,
  inbox: Message[],
  sensors: SensorReadings,
): { memory: PlatformKeeperMemory; out: Outgoing[] } {
  let memory = wasSwitchedOff(before.lastStepAt, now) ? resumePlatformKeeper(before, now) : before;
  const settling = stillSettling(memory.resumedAt, now, RESUME_SETTLE);
  memory = recordHolderRequests(memory, inbox, now);
  memory = updateLocks(memory, sensors, now);
  memory = noteUnlockedOccupied(memory, sensors, now);
  memory = recordWaiting(memory, inbox, now);

  const out: Outgoing[] = [];
  for (const { train, platform } of platformRequests(inbox, timetable)) {
    const pair = ownPair(timetable, train);
    // Only the front train on each entry track may be granted. A train with a lock keeps it.
    const queuedBehind = heldBy(memory, train) === null && trainAheadIsWaiting(memory, timetable, train);
    const reply: PlatformKeeperReply = queuedBehind
      ? { kind: 'refuse', alternative: null }
      : answerPlatformRequest({ now, train, platform, pair, memory, sensors, settling });
    if (reply.kind === 'grant' && memory.locks[reply.platform] === null) {
      memory = recordGrant(memory, train, reply.platform, now);
      memory = recordWaiting(memory, [], now); // the train has its lock, so it is no longer waiting
    }
    out.push(toOutgoing(train, platform, reply));
  }
  return { memory: { ...memory, lastStepAt: now }, out };
}

/** Builds the platform keeper. Its memory lives in this closure. */
export function createPlatformKeeper(timetable: TimetableEntry[]): LocalActor {
  let memory = initialPlatformKeeperMemory();
  return {
    id: 'platformKeeper',
    step(now: number, inbox: Message[], sensors: SensorReadings): Outgoing[] {
      const result = stepPlatformKeeper(memory, timetable, now, inbox, sensors);
      memory = result.memory;
      return result.out;
    },
  };
}
