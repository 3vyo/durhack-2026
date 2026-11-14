import type { ControlCentre } from '../engine/ports';
import {
  ACCEL,
  BRAKE,
  MARGIN,
  MAX_SPEED,
  PERMIT_INTERVAL,
  TICK,
  TRAIN_LENGTH,
} from '../shared/constants';
import {
  JUNCTION_END_X,
  JUNCTION_START_X,
  PLATFORMS,
  PLATFORM_STOP,
  TRACK_LENGTH,
  TRACK_START,
  entryOf,
  pairOf,
  xOf,
} from '../shared/map';
import type {
  Message,
  PlatformId,
  ResourceId,
  SensorReadings,
  TimetableEntry,
  TrackId,
  TrainId,
  TrainState,
} from '../shared/types';

// The control centre. Its rules are in "Today's rule, for comparison" and "Following
// permits" in docs/design.md. It sees the true state of every train. The engine calls
// step once per simulated second while the centre is switched on. Every decision lives
// in a pure function below so it can be tested without the engine.
//
// What a permit means depends on who the centre serves.
// - 'baseline': the centre decides everything and uses no locks. untilX keeps a train
//   behind the train ahead, at the end of its entry track until it has a platform it
//   may enter, and at the platform stop until it holds the junction.
// - 'ours': our trains hold locks, so the centre must not fight them. untilX only keeps
//   a train behind the train ahead, and nextTrack only suggests a platform.
//
// In both, untilX is freeRunX() when nothing limits the train. That x is far enough past
// the end of EXIT that a train at full speed never brakes for it, so it runs off the map.

export type Permit = Extract<Message, { type: 'permit' }>;

/** Which station and merge actors are switched on, as the engine passes it to step. */
export interface Alive {
  station: boolean;
  merge: boolean;
}

/**
 * How a centre is set up. There is one centre, here, and both programs use it.
 * Design: "Following permits" and "Today's rule, for comparison".
 *
 * `serves` says who reads the permits.
 * - 'baseline': baseline trains obey every permit. This is the default.
 * - 'ours': our trains treat permits as hints. The centre skips the dead actor rules,
 *   does not order the junction, and never holds a train where its locks would let it
 *   through.
 *
 * `restartGap` is the slow restart. After a gap in steps, the centre releases one
 * stopped train every `restartGap` seconds. 0 or absent means every train resumes at once.
 */
export interface CentreOptions {
  serves: 'baseline' | 'ours';
  restartGap?: number;
}

export const DEFAULT_CENTRE_OPTIONS: CentreOptions = { serves: 'baseline' };

/** The right-hand end of EXIT on the x axis. */
export const MAP_END_X = TRACK_START.EXIT + TRACK_LENGTH.EXIT;

/**
 * The untilX of a train that nothing limits. It is past the end of EXIT by the braking
 * distance at MAX_SPEED and one more permit interval of running, so a train that treats
 * it as a stop point still leaves the map at full speed. It is a function because the
 * shared constants can be replaced before a run, so they are read when used.
 */
export function freeRunX(): number {
  return MAP_END_X + (MAX_SPEED * MAX_SPEED) / (2 * BRAKE) + MAX_SPEED * PERMIT_INTERVAL;
}

// Local constants. src/shared/constants.ts does not name these.

/** A train stopped within this many metres short of offset 300 counts as stopped in its platform. */
export const STOP_TOLERANCE = 1;

/** A gap between steps longer than this many permit intervals means the centre was off. */
export const RESTART_GAP_FACTOR = 1.5;

/** What the centre has planned for one train. */
export interface TrainPlan {
  id: TrainId;
  /** The x the centre last let this train run to. */
  untilX: number;
  /** The track the centre last told this train to take next. */
  nextTrack: TrackId | null;
  /** When the train stopped in its platform, so the centre can count its dwell. */
  stoppedAt: number | null;
  /** True while the centre holds this stopped train after a restart, until its turn. */
  heldForRestart: boolean;
}

/** Everything the centre remembers between calls to step. */
export interface CentreMemory {
  timetable: TimetableEntry[];
  /** The centre's plan for each train on the map. */
  plans: Map<TrainId, TrainPlan>;
  /**
   * The platform each train is sent to or is on. A train has none until the centre
   * chooses, and loses it once its rear has left the platform.
   */
  platformFor: Map<TrainId, PlatformId>;
  /** The trains waiting to go through the junction zone, first in line first. */
  junctionOrder: TrainId[];
  /** The one train the centre has let into the junction zone, or null. */
  junctionHolder: TrainId | null;
  /** The `now` of the last step, or null before the first. A gap shows the centre was off. */
  lastStepAt: number | null;
  /** When the centre last released a held train during a slow restart, or null. */
  lastReleaseAt: number | null;
}

/** The centre's memory before its first step. Design: "Today's rule, for comparison". */
export function initialMemory(timetable: TimetableEntry[]): CentreMemory {
  return {
    timetable,
    plans: new Map(),
    platformFor: new Map(),
    junctionOrder: [],
    junctionHolder: null,
    lastStepAt: null,
    lastReleaseAt: null,
  };
}

/** Builds one permit message. Design: "Today's rule, for comparison". */
export function makePermit(
  to: TrainId,
  untilX: number,
  nextTrack: TrackId | null,
  now: number,
): Permit {
  return { type: 'permit', to, untilX, nextTrack, sentAt: now };
}

// Map helpers.

function isPlatform(track: TrackId): track is PlatformId {
  return (PLATFORMS as readonly TrackId[]).includes(track);
}

function isEntryTrack(track: TrackId): track is 'A' | 'B' {
  return track === 'A' || track === 'B';
}

function endX(track: TrackId): number {
  return TRACK_START[track] + TRACK_LENGTH[track];
}

/** The x where a train stops in a platform. It is the edge of the junction zone. */
function platformStopX(platform: PlatformId): number {
  return TRACK_START[platform] + PLATFORM_STOP;
}

function rearX(train: TrainState): number {
  return xOf(train.pos) - TRAIN_LENGTH;
}

function isStopped(train: TrainState): boolean {
  return train.speed <= 0;
}

function entryFor(memory: CentreMemory, id: TrainId): TimetableEntry | undefined {
  return memory.timetable.find((entry) => entry.id === id);
}

/** True if the train is stopped at the stop point of a platform. */
function isAtPlatformStop(train: TrainState): boolean {
  return (
    isPlatform(train.pos.track) &&
    isStopped(train) &&
    train.pos.offset >= PLATFORM_STOP - STOP_TOLERANCE
  );
}

/**
 * The furthest x a train is sure to stop by if told to brake now. It allows one permit
 * interval for the permit to arrive, with the train still accelerating meanwhile. A
 * stopped train's reach is its own x.
 */
export function reachOf(train: TrainState): number {
  if (isStopped(train)) return xOf(train.pos);
  const speed = train.speed + ACCEL * PERMIT_INTERVAL;
  return xOf(train.pos) + speed * PERMIT_INTERVAL + (speed * speed) / (2 * BRAKE);
}

// Memory.

function newPlan(train: TrainState): TrainPlan {
  return {
    id: train.id,
    untilX: xOf(train.pos),
    nextTrack: null,
    stoppedAt: null,
    heldForRestart: false,
  };
}

/** True if this step follows a gap, which means the centre was switched off. */
function isRestart(memory: CentreMemory, now: number): boolean {
  if (memory.lastStepAt === null) return false;
  return now - memory.lastStepAt > RESTART_GAP_FACTOR * PERMIT_INTERVAL;
}

function updatePlan(
  old: TrainPlan | undefined,
  train: TrainState,
  now: number,
  restart: boolean,
): TrainPlan {
  const plan = old ?? newPlan(train);
  const stoppedAt = plan.stoppedAt ?? (isAtPlatformStop(train) ? now : null);
  const held = plan.heldForRestart || (restart && isStopped(train) && !train.brokenDown);
  return { ...plan, stoppedAt, heldForRestart: held };
}

/** The platform each train on the map is sent to or is on, after what this step shows. */
function updatePlatforms(memory: CentreMemory, trains: TrainState[]): Map<TrainId, PlatformId> {
  const platformFor = new Map<TrainId, PlatformId>();
  for (const train of trains) {
    const { track } = train.pos;
    const known = memory.platformFor.get(train.id);
    if (isPlatform(track)) platformFor.set(train.id, track);
    else if (known && (isEntryTrack(track) || rearX(train) < TRACK_START.EXIT)) {
      platformFor.set(train.id, known);
    }
  }
  return platformFor;
}

/** True if the holder has left the junction zone behind, or cannot use its turn. */
function holderIsDone(holder: TrainState | undefined): boolean {
  if (!holder) return true;
  if (rearX(holder) >= JUNCTION_END_X) return true;
  return holder.brokenDown && xOf(holder.pos) < JUNCTION_START_X;
}

/** Keeps the waiting trains in order and adds the newly ready ones, lowest ID first. */
function updateJunctionOrder(
  memory: CentreMemory,
  plans: Map<TrainId, TrainPlan>,
  holder: TrainId | null,
  trains: TrainState[],
  now: number,
): TrainId[] {
  const isReady = (train: TrainState) => {
    const entry = entryFor(memory, train.id);
    const plan = plans.get(train.id);
    return entry !== undefined && plan !== undefined && isReadyToLeave(train, entry, plan, now);
  };
  const ready = trains.filter((train) => train.id !== holder && isReady(train)).map((t) => t.id);
  const kept = memory.junctionOrder.filter((id) => ready.includes(id));
  const added = ready.filter((id) => !kept.includes(id)).sort((a, b) => a - b);
  return [...kept, ...added];
}

/**
 * Records what changed since the last step: trains that entered, stopped in a platform,
 * left a platform, cleared the junction zone or left the map. It works from the true
 * state alone, so it also catches up after a gap of any length. The engine does not call
 * step while the centre is switched off. Design: "Today's rule, for comparison".
 */
export function updateMemory(
  memory: CentreMemory,
  now: number,
  trains: TrainState[],
  _sensors: SensorReadings,
  _alive: Alive,
): CentreMemory {
  const restart = isRestart(memory, now);
  const plans = new Map<TrainId, TrainPlan>();
  for (const train of trains) {
    plans.set(train.id, updatePlan(memory.plans.get(train.id), train, now, restart));
  }
  const holder = trains.find((train) => train.id === memory.junctionHolder);
  const junctionHolder = holderIsDone(holder) ? null : memory.junctionHolder;
  return {
    ...memory,
    plans,
    platformFor: updatePlatforms(memory, trains),
    junctionOrder: updateJunctionOrder(memory, plans, junctionHolder, trains, now),
    junctionHolder,
    lastStepAt: now,
  };
}

// Slow restart.

/**
 * During a slow restart, picks the one stopped train the centre releases next, or null.
 * It releases one train every `restartGap` seconds, the one furthest along the x axis
 * first, so no release waits behind a held train. Until its turn a held train keeps
 * untilX at its own x. Design: "Today's rule, for comparison".
 */
export function nextRestartRelease(
  memory: CentreMemory,
  trains: TrainState[],
  now: number,
  options: CentreOptions,
): TrainId | null {
  const gap = options.restartGap ?? 0;
  const last = memory.lastReleaseAt;
  if (last !== null && now - last < gap - TICK / 2) return null;
  const held = trains.filter((train) => memory.plans.get(train.id)?.heldForRestart);
  if (held.length === 0) return null;
  held.sort((a, b) => xOf(b.pos) - xOf(a.pos) || a.id - b.id);
  return held[0].id;
}

function release(memory: CentreMemory, ids: TrainId[], now: number): CentreMemory {
  if (ids.length === 0) return memory;
  const plans = new Map(memory.plans);
  for (const id of ids) {
    const plan = plans.get(id);
    if (plan) plans.set(id, { ...plan, heldForRestart: false });
  }
  return { ...memory, plans, lastReleaseAt: now };
}

/** Releases held trains: all at once with no restartGap, else the one whose turn it is. */
export function releaseHeld(
  memory: CentreMemory,
  trains: TrainState[],
  now: number,
  options: CentreOptions,
): CentreMemory {
  if (!options.restartGap) {
    const held = [...memory.plans.values()].filter((plan) => plan.heldForRestart);
    return release(memory, held.map((plan) => plan.id), now);
  }
  const next = nextRestartRelease(memory, trains, now, options);
  return next === null ? memory : release(memory, [next], now);
}

// Platforms.

function isSentTo(platform: PlatformId, memory: CentreMemory): boolean {
  return [...memory.platformFor.values()].includes(platform);
}

/**
 * Says whether the baseline centre may permit a train onto a piece of track. A dead
 * platform sensor reads as occupied, so its platform is unavailable. A dead station actor
 * makes every platform unavailable, and a dead merge actor makes the junction unavailable.
 * Design: "Today's rule, for comparison" and "Platform sensors switched off".
 */
export function isAvailable(
  resource: ResourceId,
  memory: CentreMemory,
  sensors: SensorReadings,
  alive: Alive,
): boolean {
  if (resource === 'JUNCTION') {
    const clear = !sensors.junctionOccupied && sensors.exitStartClear;
    return alive.merge && clear && memory.junctionHolder === null;
  }
  return alive.station && !sensors.platformOccupied[resource] && !isSentTo(resource, memory);
}

/**
 * Picks the platform the centre sends a train to, or null if none is free. It picks from
 * the entry track's own pair, the timetable's default first, and keeps a choice once made.
 * With `serves: 'ours'` the choice is a suggestion: a platform is free when no train is on
 * it or sent to it, and the dead actor and dead sensor rules do not apply.
 * Design: "Today's rule, for comparison" and "Following permits".
 */
export function choosePlatform(
  train: TrainState,
  entry: TimetableEntry,
  memory: CentreMemory,
  sensors: SensorReadings,
  alive: Alive,
  options: CentreOptions,
): PlatformId | null {
  const kept = memory.platformFor.get(train.id);
  if (kept) return kept;
  const pair = pairOf(entry.entry);
  const candidates = [...pair.filter((p) => p === entry.platform), ...pair.filter((p) => p !== entry.platform)];
  const isFree = (platform: PlatformId) =>
    options.serves === 'ours'
      ? !isSentTo(platform, memory)
      : isAvailable(platform, memory, sensors, alive);
  return candidates.find(isFree) ?? null;
}

/** Chooses a platform for every train on an entry track that has none, front train first. */
function assignPlatforms(
  memory: CentreMemory,
  trains: TrainState[],
  sensors: SensorReadings,
  alive: Alive,
  options: CentreOptions,
): CentreMemory {
  const waiting = trains
    .filter((train) => isEntryTrack(train.pos.track) && !memory.platformFor.has(train.id))
    .sort((a, b) => xOf(b.pos) - xOf(a.pos) || a.id - b.id);
  let next = memory;
  for (const train of waiting) {
    const entry = entryFor(next, train.id);
    const platform = entry ? choosePlatform(train, entry, next, sensors, alive, options) : null;
    if (platform) {
      next = { ...next, platformFor: new Map(next.platformFor).set(train.id, platform) };
    }
  }
  return next;
}

// The junction.

/**
 * Says whether a train in a platform has finished its dwell and may leave. The centre
 * counts the dwell from the step where it first saw the train stopped at the stop point.
 * A broken-down train is never ready.
 * Design: "Today's rule, for comparison" and "Entering the station".
 */
export function isReadyToLeave(
  train: TrainState,
  entry: TimetableEntry,
  plan: TrainPlan,
  now: number,
): boolean {
  if (train.brokenDown || !isPlatform(train.pos.track)) return false;
  if (plan.stoppedAt === null) return false;
  return now - plan.stoppedAt >= entry.dwell - TICK / 2;
}

/**
 * Picks the next train the centre lets into the junction zone, or null. Only one train
 * may be in the zone, and none may enter while the start of EXIT is not clear.
 * Design: "Today's rule, for comparison", "The map" and "Leaving the station".
 */
export function nextThroughJunction(
  memory: CentreMemory,
  trains: TrainState[],
  sensors: SensorReadings,
  alive: Alive,
  now: number,
): TrainId | null {
  if (!isAvailable('JUNCTION', memory, sensors, alive)) return null;
  const isReady = (id: TrainId) => {
    const train = trains.find((t) => t.id === id);
    const entry = entryFor(memory, id);
    const plan = memory.plans.get(id);
    if (!train || !entry || !plan || plan.heldForRestart) return false;
    return isReadyToLeave(train, entry, plan, now);
  };
  return memory.junctionOrder.find(isReady) ?? null;
}

function grantJunction(
  memory: CentreMemory,
  trains: TrainState[],
  sensors: SensorReadings,
  alive: Alive,
  now: number,
): CentreMemory {
  const next = nextThroughJunction(memory, trains, sensors, alive, now);
  if (next === null) return memory;
  return {
    ...memory,
    junctionHolder: next,
    junctionOrder: memory.junctionOrder.filter((id) => id !== next),
  };
}

// Permits.

/**
 * Picks the track a train should take at the end of its current track.
 * - On A or B: the platform the centre chose for it, or null.
 * - In a platform: EXIT. For baseline trains only once the train holds the junction.
 * - On EXIT: null.
 * Design: "Today's rule, for comparison" and "Following permits".
 */
export function nextTrackFor(
  train: TrainState,
  memory: CentreMemory,
  options: CentreOptions = DEFAULT_CENTRE_OPTIONS,
): TrackId | null {
  const { track } = train.pos;
  if (isEntryTrack(track)) return memory.platformFor.get(train.id) ?? null;
  if (!isPlatform(track)) return null;
  const mayLeave = options.serves === 'ours' || memory.junctionHolder === train.id;
  return mayLeave ? 'EXIT' : null;
}

/** The tracks a train's body is on. Its rear is on the track before for the first 100 m. */
function tracksUnder(train: TrainState, memory: CentreMemory): TrackId[] {
  const { track } = train.pos;
  if (isEntryTrack(track) || rearX(train) >= TRACK_START[track]) return [track];
  if (isPlatform(track)) return [track, entryOf(track)];
  const platform = memory.platformFor.get(train.id);
  return platform ? [track, platform] : [track, ...PLATFORMS];
}

/**
 * The tracks ahead that the centre knows a train will use. For our trains on A or B that
 * is the entry track only, because the station lock decides the platform, not the centre.
 */
function pathOf(train: TrainState, memory: CentreMemory, options: CentreOptions): TrackId[] {
  const { track } = train.pos;
  if (isPlatform(track)) return [track, 'EXIT'];
  if (!isEntryTrack(track)) return [track];
  const platform = options.serves === 'ours' ? undefined : memory.platformFor.get(train.id);
  return platform ? [track, platform] : [track];
}

/** The x of the rear of the nearest train ahead on this train's path, or Infinity. */
function rearAheadX(
  train: TrainState,
  trains: TrainState[],
  memory: CentreMemory,
  options: CentreOptions,
): number {
  const path = pathOf(train, memory, options);
  const ahead = trains.filter(
    (other) =>
      other.id !== train.id &&
      xOf(other.pos) > xOf(train.pos) &&
      tracksUnder(other, memory).some((track) => path.includes(track)),
  );
  return Math.min(Infinity, ...ahead.map(rearX));
}

/**
 * True if a baseline train on A or B may run into the platform it is sent to. A train
 * that was permitted in and can no longer stop before the end of its entry track is let
 * run in, whatever has failed since.
 */
function mayEnterPlatform(
  train: TrainState,
  platform: PlatformId,
  memory: CentreMemory,
  sensors: SensorReadings,
  alive: Alive,
): boolean {
  if (alive.station && !sensors.platformOccupied[platform]) return true;
  const entryEnd = endX(train.pos.track);
  const permitted = memory.plans.get(train.id)?.untilX ?? xOf(train.pos);
  return permitted > entryEnd && reachOf(train) > entryEnd;
}

/** The furthest x a baseline train may run to, before looking at the trains ahead. */
function stopPointX(
  train: TrainState,
  memory: CentreMemory,
  sensors: SensorReadings,
  alive: Alive,
): number {
  const { track } = train.pos;
  if (isEntryTrack(track)) {
    const platform = memory.platformFor.get(train.id);
    const open = platform && mayEnterPlatform(train, platform, memory, sensors, alive);
    return platform && open ? platformStopX(platform) : endX(track);
  }
  if (isPlatform(track) && memory.junctionHolder !== train.id) return platformStopX(track);
  return freeRunX();
}

/**
 * How far along the x axis a train may run.
 * - A broken-down train, or one a slow restart holds, stays at its own x.
 * - Every train stays MARGIN behind the true rear of the train ahead on its path.
 * - A baseline train also stops at the end of its entry track until it has a platform
 *   it may enter, and at the platform stop until it holds the junction.
 * - With nothing in the way the answer is freeRunX(), which lets it run off the map.
 * - The answer never moves back to a point a running train can no longer stop at.
 * Design: "Today's rule, for comparison" and "Following permits".
 */
export function untilXFor(
  train: TrainState,
  trains: TrainState[],
  memory: CentreMemory,
  sensors: SensorReadings,
  alive: Alive,
  options: CentreOptions = DEFAULT_CENTRE_OPTIONS,
): number {
  const x = xOf(train.pos);
  const plan = memory.plans.get(train.id);
  if (train.brokenDown || plan?.heldForRestart) return x;
  const stopPoint =
    options.serves === 'ours' ? freeRunX() : stopPointX(train, memory, sensors, alive);
  const wanted = Math.min(stopPoint, rearAheadX(train, trains, memory, options) - MARGIN);
  const promised = Math.min(plan?.untilX ?? x, reachOf(train));
  return Math.max(wanted, promised);
}

/** Makes this step's decisions: the slow restart, platforms and the junction. */
function decide(
  memory: CentreMemory,
  now: number,
  trains: TrainState[],
  sensors: SensorReadings,
  alive: Alive,
  options: CentreOptions,
): CentreMemory {
  const released = releaseHeld(memory, trains, now, options);
  const assigned = assignPlatforms(released, trains, sensors, alive, options);
  if (options.serves === 'ours') return assigned;
  return grantJunction(assigned, trains, sensors, alive, now);
}

/** Builds one permit per train and records each in the train's plan. */
function writePermits(
  memory: CentreMemory,
  now: number,
  trains: TrainState[],
  sensors: SensorReadings,
  alive: Alive,
  options: CentreOptions,
): Permit[] {
  return trains.map((train) => {
    const untilX = untilXFor(train, trains, memory, sensors, alive, options);
    const nextTrack = nextTrackFor(train, memory, options);
    const plan = memory.plans.get(train.id) ?? newPlan(train);
    memory.plans.set(train.id, { ...plan, untilX, nextTrack });
    return makePermit(train.id, untilX, nextTrack, now);
  });
}

/**
 * Builds the control centre. The engine calls step once per simulated second while the
 * centre is switched on, and sends the permits it returns over long range. Each step
 * returns one permit per train on the map.
 * Design: "Today's rule, for comparison".
 */
export function makeCentre(
  timetable: TimetableEntry[],
  options: CentreOptions = DEFAULT_CENTRE_OPTIONS,
): ControlCentre {
  let memory = initialMemory(timetable);
  return {
    step(now, trains, sensors, alive): Message[] {
      memory = updateMemory(memory, now, trains, sensors, alive);
      memory = decide(memory, now, trains, sensors, alive, options);
      return writePermits(memory, now, trains, sensors, alive, options);
    },
  };
}
