import type { ControlCentre } from '../engine/ports';
import {
  ACCEL,
  BRAKE,
  MARGIN,
  MAX_SPEED,
  PERMIT_INTERVAL,
  RADIO_RELEASE_GAP,
  RADIO_WORKING_DELAY,
  RESTART_GAP,
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
  isEntryTrack,
  isPlatform,
  pairOf,
  xOf,
} from '../shared/map';
import type {
  EntryId,
  Message,
  PlatformId,
  ResourceId,
  SensorReadings,
  TimetableEntry,
  TrackId,
  TrainId,
  TrainState,
} from '../shared/types';

// The control centre. Its rules are in "Today's rule, for comparison" and "The centre
// comes first" in docs/design.md. It sees the true state of every train. The engine calls
// step once per simulated second while the centre is switched on. Every decision lives
// in a pure function below so it can be tested without the engine.
//
// It is today's system, and both programs get the same permits from it. It decides
// everything and uses no locks. untilX keeps a train behind the train ahead, at the end of
// its entry track until it has a platform it may enter, and at the platform stop until it
// holds the junction. It never depends on the platform keeper, the junction keeper or our
// platform sensors, which only our trains use.
//
// untilX is freeRunX() when nothing limits the train. That x is far enough past the end
// of EXIT that a train at full speed never brakes for it, so it runs off the map.
//
// Our trains run on their own rules while the centre is off. When it comes back it takes
// over from where they are: a platform a train has set its route to, and a train already
// in the junction zone. It holds no train that can still stop to a platform another train is
// on, whether the train's route or the centre's own earlier choice names it.
//
// Radio working: once the centre has been down for RADIO_WORKING_DELAY, staff move the
// stopped trains by radio. radioStep makes the same decisions as step, but releases one
// stopped train every RADIO_RELEASE_GAP and marks its permits `caution`.
//
// Layouts: the map has one to four entry tracks, each with its own pair of platforms. The
// centre reads the layout in use from the map when it decides, never when this file loads.
// It sends a train only to a platform of its own entry track's pair, and never to a platform
// outside the layout. There is one junction zone on every layout, so one train at a time goes
// through it however many platforms feed it. Design: "Layouts".

export type Permit = Extract<Message, { type: 'permit' }>;

/** The track each train has set to take next, as the engine passes it to step. */
export type Routes = Map<TrainId, TrackId | null>;

/**
 * How a centre is set up. There is one centre, here, and both programs use it.
 * Design: "Today's rule, for comparison".
 *
 * `restartGap` is the slow restart. After a gap in steps, the centre releases one
 * stopped train every `restartGap` seconds. Absent means RESTART_GAP, which a parameter file
 * can set. 0 means every train resumes at once. Design: "Slow restart".
 */
export interface CentreOptions {
  restartGap?: number;
}

export const DEFAULT_CENTRE_OPTIONS: CentreOptions = {};

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
  /** True while staff are moving trains by radio, from the first radioStep that acts until the centre is back. */
  radioWorking: boolean;
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
    radioWorking: false,
  };
}

/** Builds one permit message. Design: "Today's rule, for comparison". */
export function makePermit(
  to: TrainId,
  untilX: number,
  nextTrack: TrackId | null,
  now: number,
  leader: TrainId | null = null,
  caution = false,
): Permit {
  const permit: Permit = { type: 'permit', to, untilX, nextTrack, sentAt: now, leader };
  return caution ? { ...permit, caution: true } : permit;
}

// Map helpers. isEntryTrack and isPlatform come from the map and cover every layout.

/** True if the layout in use has this platform. Read when called, so it follows applyLayout. */
function inLayout(platform: PlatformId): boolean {
  return PLATFORMS.includes(platform);
}

/**
 * True if the centre's train detection shows this platform empty. A platform outside the
 * layout never reads empty, and nor does one with no reading. Design: "Layouts".
 */
function readsEmpty(platform: PlatformId, sensors: SensorReadings): boolean {
  return inLayout(platform) && sensors.platformOccupied[platform] === false;
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

/**
 * The platform each train on the map is sent to or is on, after what this step shows. A
 * train on an entry track whose route is set into a platform of its own pair is sent there,
 * even if the centre chose another one: our trains choose platforms themselves while the
 * centre is off, and the centre takes over from where they are. It ignores a route into
 * another track's pair or into a platform outside the layout. Where it takes over no route,
 * the centre's own earlier choice stands.
 *
 * Neither a route nor an earlier choice holds a train to a platform it must let go
 * (mustLetGo), and each entry track's queue is dealt in order (dealFrontFirst).
 * Design: "The centre comes first".
 */
function updatePlatforms(
  memory: CentreMemory,
  trains: TrainState[],
  sensors: SensorReadings,
  routes: Routes,
): Map<TrainId, PlatformId> {
  const platformFor = new Map<TrainId, PlatformId>();
  for (const train of trains) {
    const known = memory.platformFor.get(train.id) ?? null;
    const platform = platformToKeep(train, known, routes.get(train.id) ?? null, sensors);
    if (platform) platformFor.set(train.id, platform);
  }
  return dealFrontFirst(platformFor, trains);
}

/**
 * The platform one train keeps from before this step's choices, or null.
 * - In a platform: that platform.
 * - On an entry track: the platform of its own pair its route is set into, else the centre's
 *   earlier choice, but never one it must let go.
 * - On EXIT: the platform it left, until its rear is out of it.
 */
function platformToKeep(
  train: TrainState,
  known: PlatformId | null,
  route: TrackId | null,
  sensors: SensorReadings,
): PlatformId | null {
  const { track } = train.pos;
  if (isPlatform(track)) return track;
  if (isEntryTrack(track)) {
    if (route !== null && isOwnPlatform(track, route) && !mustLetGo(train, route, sensors)) return route;
    return known !== null && !mustLetGo(train, known, sensors) ? known : null;
  }
  return known !== null && rearX(train) < TRACK_START.EXIT ? known : null;
}

/** True if `route` is a platform of the layout that this entry track owns. */
function isOwnPlatform(entry: EntryId, route: TrackId): route is PlatformId {
  return isPlatform(route) && inLayout(route) && pairOf(entry).includes(route);
}

/** True if a train on an entry track can still stop before the end of that track. */
function canStopOnEntry(train: TrainState): boolean {
  return reachOf(train) <= endX(train.pos.track);
}

/**
 * True if a train on an entry track must not be held to this platform: another train is on
 * the platform, and this train can still stop before the end of its entry track. It goes for
 * a route the train has set and for the centre's own earlier choice alike. Without it the
 * centre would keep the train at the end of its entry track until that platform is empty. If
 * the train there has broken down, that is for good, with the other platform of the pair
 * unused and the whole entry track standing behind.
 *
 * A route like this is only a look. With the platform keeper and the platform sensors off, a
 * train of ours that stands at the end of its entry track sets its route into each platform
 * of its pair in turn, to look into it with its own sensor. While both hold a train it goes
 * on doing that, tick by tick. It has not chosen either.
 *
 * An earlier choice like this is out of date. While the centre is on, no other train reaches
 * a platform the centre has chosen for one. While it is off, a train of ours can take that
 * platform on its own rules. So can one during radio working, whose permits our trains ignore.
 *
 * Everything else still stands:
 * - A keeper grant and the fixed split need the platform to read empty.
 * - A creep ends when the train sees no train in the platform. One tick later it is moving in
 *   and can no longer stop.
 * - A train that can no longer stop is on its way in, and the centre never moves it.
 * - A baseline train only ever has the centre's own choice, and no other train gets onto that.
 * Design: "The centre comes first" and "Platform keeper switched off".
 */
function mustLetGo(train: TrainState, platform: PlatformId, sensors: SensorReadings): boolean {
  return !readsEmpty(platform, sensors) && canStopOnEntry(train);
}

/**
 * Keeps the platforms of each entry track's queue in order. Trains on one entry track cannot
 * pass each other. So behind a train that has no platform and can still stop, no train that
 * can still stop keeps one: a platform held further back could never be reached, and the
 * train in front could never be given it. assignPlatforms then deals again, front train first.
 *
 * While the centre stays on this changes nothing, because it chooses front train first and
 * keeps its choices. It matters when the centre comes back to an earlier choice that is out
 * of date. The front train lets go of a platform another train took (mustLetGo), and the
 * free platform of its pair may be one the centre chose for a train behind it.
 */
function dealFrontFirst(platformFor: Map<TrainId, PlatformId>, trains: TrainState[]): Map<TrainId, PlatformId> {
  const dealt = new Map(platformFor);
  const tracks = new Set(trains.map((train) => train.pos.track).filter(isEntryTrack));
  for (const track of tracks) {
    const queue = trains
      .filter((train) => train.pos.track === track && canStopOnEntry(train))
      .sort((a, b) => xOf(b.pos) - xOf(a.pos) || a.id - b.id);
    const firstWithout = queue.findIndex((train) => !dealt.has(train.id));
    if (firstWithout < 0) continue;
    for (const train of queue.slice(firstWithout + 1)) dealt.delete(train.id);
  }
  return dealt;
}

/**
 * True if the train is in the junction zone because it has gone past its platform stop, or
 * its rear has not yet cleared the zone on EXIT. Our trains can be there without the
 * centre's say-so, if they went through while the centre was off.
 */
function isInJunctionZone(train: TrainState): boolean {
  if (isPlatform(train.pos.track)) return train.pos.offset > PLATFORM_STOP;
  return train.pos.track === 'EXIT' && rearX(train) < JUNCTION_END_X;
}

/**
 * True if a train in a platform is setting off into the junction zone: it is moving with its
 * route set to EXIT. Only a train that is leaving does that. Our trains set off on a junction
 * keeper grant or a clock slot while the centre is off, and the centre's own holder sets off
 * on its permit.
 *
 * It is never true of a train that is arriving or waiting:
 * - An arriving train has no route out of its platform.
 * - A train waiting at its stop point may point its route at EXIT to look through the zone
 *   on a clock slot, but it stands still while it looks.
 * - A baseline train sets the route its permits name, and only the holder's name EXIT.
 * - A broken-down train is braking to a stand, not leaving.
 */
function isSettingOff(train: TrainState, routes: Routes): boolean {
  if (!isPlatform(train.pos.track) || train.brokenDown || isStopped(train)) return false;
  return routes.get(train.id) === 'EXIT';
}

/** The x a moving train reaches if it brakes fully from now on. */
function brakingEndX(train: TrainState): number {
  return xOf(train.pos) + (train.speed * train.speed) / (2 * BRAKE);
}

/**
 * The train that has the junction zone whatever the centre says, other than `holderId`, or
 * undefined. A train already in the zone comes first. Otherwise it is the train setting off
 * that will stop furthest along if braked now, lowest ID on a tie.
 */
function trainTakingZone(trains: TrainState[], routes: Routes, holderId: TrainId | null): TrainState | undefined {
  const others = trains.filter((train) => train.id !== holderId);
  const inZone = others.find(isInJunctionZone);
  if (inZone) return inZone;
  const settingOff = others.filter((train) => isSettingOff(train, routes));
  settingOff.sort((a, b) => brakingEndX(b) - brakingEndX(a) || a.id - b.id);
  return settingOff[0];
}

/** True if the holder has started its turn: it is moving, or its front is past its platform stop. */
function hasSetOff(holder: TrainState): boolean {
  return !isPlatform(holder.pos.track) || !isStopped(holder) || holder.pos.offset > PLATFORM_STOP;
}

/**
 * The junction holder after this step. Design: "The centre comes first".
 *
 * The centre takes over from where the trains are. A train already in the zone, or setting
 * off into it (isSettingOff), becomes the holder, so the centre lets it finish and lets no
 * other train in until it has cleared the zone. Telling a train that is setting off to stop
 * at its platform stop would be too late: it can run past it into the zone, beside the train
 * the centre let in.
 *
 * The centre keeps a holder that is not done. The one exception is a holder that has not set
 * off while another train has the zone. That holder is standing at its platform stop and
 * cannot go, so the turn passes to the train that has the zone, and the old holder waits in
 * the queue again. While the centre stays on this never happens: no train enters the zone or
 * sets off without being the holder.
 */
function updateJunctionHolder(memory: CentreMemory, trains: TrainState[], routes: Routes): TrainId | null {
  const holder = trains.find((train) => train.id === memory.junctionHolder);
  const taking = trainTakingZone(trains, routes, memory.junctionHolder);
  if (holder && !holderIsDone(holder) && (taking === undefined || hasSetOff(holder))) return holder.id;
  return taking?.id ?? null;
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
  sensors: SensorReadings,
  routes: Routes = new Map(),
): CentreMemory {
  const restart = isRestart(memory, now);
  const plans = new Map<TrainId, TrainPlan>();
  for (const train of trains) {
    plans.set(train.id, updatePlan(memory.plans.get(train.id), train, now, restart));
  }
  const junctionHolder = updateJunctionHolder(memory, trains, routes);
  return {
    ...memory,
    plans,
    platformFor: updatePlatforms(memory, trains, sensors, routes),
    junctionOrder: updateJunctionOrder(memory, plans, junctionHolder, trains, now),
    junctionHolder,
    lastStepAt: now,
  };
}

// Slow restart.

/** The slow restart's gap: the option if given, else RESTART_GAP, read now. */
function restartGapOf(options: CentreOptions): number {
  return options.restartGap ?? RESTART_GAP;
}

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
  const gap = restartGapOf(options);
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
  if (!restartGapOf(options)) {
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
 * Says whether the centre may permit a train onto a piece of track, from the true
 * occupancy its own train detection gives. A platform outside the layout is never available.
 * Design: "Today's rule, for comparison" and "Layouts".
 */
export function isAvailable(resource: ResourceId, memory: CentreMemory, sensors: SensorReadings): boolean {
  if (resource === 'JUNCTION') {
    const clear = !sensors.junctionOccupied && sensors.exitStartClear;
    return clear && memory.junctionHolder === null;
  }
  return readsEmpty(resource, sensors) && !isSentTo(resource, memory);
}

/**
 * Picks the platform the centre sends a train to, or null if none is free. It picks from
 * the entry track's own pair, the timetable's default first, and keeps a choice once made.
 * updatePlatforms drops a choice that no longer stands before this is asked.
 * The pair is the one the train's entry track owns: A owns P1 and P2, B owns P3 and P4,
 * C owns P5 and P6, D owns P7 and P8. The centre sees the true state, so it goes by the
 * track the train is on.
 * Design: "Today's rule, for comparison" and "Layouts".
 */
export function choosePlatform(
  train: TrainState,
  entry: TimetableEntry,
  memory: CentreMemory,
  sensors: SensorReadings,
): PlatformId | null {
  const kept = memory.platformFor.get(train.id);
  if (kept) return kept;
  const { track } = train.pos;
  const pair = pairOf(isEntryTrack(track) ? track : entry.entry);
  const candidates = [...pair.filter((p) => p === entry.platform), ...pair.filter((p) => p !== entry.platform)];
  return candidates.find((platform) => isAvailable(platform, memory, sensors)) ?? null;
}

/** Chooses a platform for every train on an entry track that has none, front train first. */
function assignPlatforms(memory: CentreMemory, trains: TrainState[], sensors: SensorReadings): CentreMemory {
  const waiting = trains
    .filter((train) => isEntryTrack(train.pos.track) && !memory.platformFor.has(train.id))
    .sort((a, b) => xOf(b.pos) - xOf(a.pos) || a.id - b.id);
  let next = memory;
  for (const train of waiting) {
    const entry = entryFor(next, train.id);
    const platform = entry ? choosePlatform(train, entry, next, sensors) : null;
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
  now: number,
): TrainId | null {
  if (!isAvailable('JUNCTION', memory, sensors)) return null;
  const isReady = (id: TrainId) => {
    const train = trains.find((t) => t.id === id);
    const entry = entryFor(memory, id);
    const plan = memory.plans.get(id);
    if (!train || !entry || !plan || plan.heldForRestart) return false;
    return isReadyToLeave(train, entry, plan, now);
  };
  return memory.junctionOrder.find(isReady) ?? null;
}

function grantJunction(memory: CentreMemory, trains: TrainState[], sensors: SensorReadings, now: number): CentreMemory {
  const next = nextThroughJunction(memory, trains, sensors, now);
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
 * - On an entry track: the platform the centre chose for it, or null.
 * - In a platform: EXIT, once the train holds the junction.
 * - On EXIT: null.
 * Design: "Today's rule, for comparison".
 */
export function nextTrackFor(train: TrainState, memory: CentreMemory): TrackId | null {
  const { track } = train.pos;
  if (isEntryTrack(track)) return memory.platformFor.get(train.id) ?? null;
  if (!isPlatform(track)) return null;
  return memory.junctionHolder === train.id ? 'EXIT' : null;
}

/**
 * The tracks a train's body is on. Its rear is on the track before for the first 100 m. A
 * train on EXIT whose platform the centre does not know may have its rear in any platform of
 * the layout, so it counts as on all of them.
 */
function tracksUnder(train: TrainState, memory: CentreMemory): TrackId[] {
  const { track } = train.pos;
  if (isEntryTrack(track) || rearX(train) >= TRACK_START[track]) return [track];
  if (isPlatform(track)) return [track, entryOf(track)];
  const platform = memory.platformFor.get(train.id);
  return platform ? [track, platform] : [track, ...PLATFORMS];
}

/** The tracks ahead that the centre knows a train will use. */
function pathOf(train: TrainState, memory: CentreMemory): TrackId[] {
  const { track } = train.pos;
  if (isPlatform(track)) return [track, 'EXIT'];
  if (!isEntryTrack(track)) return [track];
  const platform = memory.platformFor.get(train.id);
  return platform ? [track, platform] : [track];
}

/**
 * The nearest train ahead on this train's path, the one with the nearest rear, or null.
 * The permit names it as the train's leader. Design: "The centre comes first".
 */
export function trainAhead(train: TrainState, trains: TrainState[], memory: CentreMemory): TrainState | null {
  const path = pathOf(train, memory);
  let nearest: TrainState | null = null;
  for (const other of trains) {
    if (other.id === train.id || xOf(other.pos) <= xOf(train.pos)) continue;
    if (!tracksUnder(other, memory).some((track) => path.includes(track))) continue;
    if (nearest === null || rearX(other) < rearX(nearest)) nearest = other;
  }
  return nearest;
}

/** The x of the rear of the nearest train ahead on this train's path, or Infinity. */
function rearAheadX(train: TrainState, trains: TrainState[], memory: CentreMemory): number {
  const ahead = trainAhead(train, trains, memory);
  return ahead === null ? Infinity : rearX(ahead);
}

/**
 * True if a train on an entry track may run into the platform it is sent to. A train that
 * was permitted in and can no longer stop before the end of its entry track is let run in.
 */
function mayEnterPlatform(
  train: TrainState,
  platform: PlatformId,
  memory: CentreMemory,
  sensors: SensorReadings,
): boolean {
  if (readsEmpty(platform, sensors)) return true;
  const entryEnd = endX(train.pos.track);
  const permitted = memory.plans.get(train.id)?.untilX ?? xOf(train.pos);
  return permitted > entryEnd && reachOf(train) > entryEnd;
}

/** The furthest x a train may run to, before looking at the trains ahead. */
function stopPointX(train: TrainState, memory: CentreMemory, sensors: SensorReadings): number {
  const { track } = train.pos;
  if (isEntryTrack(track)) {
    const platform = memory.platformFor.get(train.id);
    const open = platform && mayEnterPlatform(train, platform, memory, sensors);
    return platform && open ? platformStopX(platform) : endX(track);
  }
  if (isPlatform(track) && memory.junctionHolder !== train.id) return platformStopX(track);
  return freeRunX();
}

/**
 * How far along the x axis a train may run.
 * - A broken-down train, or one a slow restart holds, stays at its own x.
 * - Every train stays MARGIN behind the true rear of the train ahead on its path.
 * - A train stops at the end of its entry track until it has a platform it may enter, and
 *   at the platform stop until it holds the junction.
 * - With nothing in the way the answer is freeRunX(), which lets it run off the map.
 * - The answer never moves back to a point a running train can no longer stop at.
 * Design: "Today's rule, for comparison".
 */
export function untilXFor(
  train: TrainState,
  trains: TrainState[],
  memory: CentreMemory,
  sensors: SensorReadings,
): number {
  const x = xOf(train.pos);
  const plan = memory.plans.get(train.id);
  if (train.brokenDown || plan?.heldForRestart) return x;
  const wanted = Math.min(stopPointX(train, memory, sensors), rearAheadX(train, trains, memory) - MARGIN);
  const promised = Math.min(plan?.untilX ?? x, reachOf(train));
  return Math.max(wanted, promised);
}

/** Makes this step's decisions: the slow restart, platforms and the junction. */
function decide(
  memory: CentreMemory,
  now: number,
  trains: TrainState[],
  sensors: SensorReadings,
  options: CentreOptions,
): CentreMemory {
  const released = releaseHeld(memory, trains, now, options);
  const assigned = assignPlatforms(released, trains, sensors);
  return grantJunction(assigned, trains, sensors, now);
}

/** Builds one permit per train and records each in the train's plan. */
function writePermits(
  memory: CentreMemory,
  now: number,
  trains: TrainState[],
  sensors: SensorReadings,
  caution = false,
): Permit[] {
  return trains.map((train) => {
    const untilX = untilXFor(train, trains, memory, sensors);
    const nextTrack = nextTrackFor(train, memory);
    const plan = memory.plans.get(train.id) ?? newPlan(train);
    memory.plans.set(train.id, { ...plan, untilX, nextTrack });
    const leader = trainAhead(train, trains, memory)?.id ?? null;
    return makePermit(train.id, untilX, nextTrack, now, leader, caution);
  });
}

/**
 * Radio working. True once the centre has been down for RADIO_WORKING_DELAY seconds, counted
 * from its last step, and from then on until the centre is back. Never before the centre's
 * first step. Design: "Radio working".
 */
export function isRadioWorking(memory: CentreMemory, now: number): boolean {
  if (memory.radioWorking) return true;
  if (memory.lastStepAt === null) return false;
  return now - memory.lastStepAt >= RADIO_WORKING_DELAY - TICK / 2;
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
    step(now, trains, sensors, routes): Message[] {
      memory = { ...updateMemory(memory, now, trains, sensors, routes), radioWorking: false };
      memory = decide(memory, now, trains, sensors, options);
      return writePermits(memory, now, trains, sensors);
    },
    radioStep(now, trains, sensors, routes): Message[] {
      if (!isRadioWorking(memory, now)) return [];
      memory = { ...updateMemory(memory, now, trains, sensors, routes), radioWorking: true };
      memory = decide(memory, now, trains, sensors, { ...options, restartGap: RADIO_RELEASE_GAP });
      return writePermits(memory, now, trains, sensors, true);
    },
  };
}
