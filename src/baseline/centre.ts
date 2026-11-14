import type { ControlCentre } from '../engine/ports';
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
import { xOf } from './map';

// The control centre. Its rules are in "Today's rule, for comparison" in docs/design.md.
// It sees the true state of every train, decides platforms and junction order itself,
// and uses no locks. The engine calls step once per simulated second while the centre
// is switched on. Every decision lives in a pure function below so it can be tested
// without the engine. Each one is a placeholder that returns the safest value.

export type Permit = Extract<Message, { type: 'permit' }>;

/** Which station and merge actors are switched on, as the engine passes it to step. */
export interface Alive {
  station: boolean;
  merge: boolean;
}

/**
 * Who reads the permits. The team has not decided whether ours uses this centre too.
 *
 * - 'baseline': baseline trains obey every permit. This is the default.
 * - 'ours': our trains treat permits as hints. The centre then only suggests platforms
 *   from the train's own pair. Design: "Following permits".
 */
export interface CentreOptions {
  serves: 'baseline' | 'ours';
}

export const DEFAULT_CENTRE_OPTIONS: CentreOptions = { serves: 'baseline' };

/** What the centre has planned for one train. */
export interface TrainPlan {
  id: TrainId;
  /** The x the centre last let this train run to. */
  untilX: number;
  /** The track the centre last told this train to take next. */
  nextTrack: TrackId | null;
  /** When the train stopped in its platform, so the centre can count its dwell. */
  stoppedAt: number | null;
}

/** Everything the centre remembers between calls to step. */
export interface CentreMemory {
  timetable: TimetableEntry[];
  /** The centre's plan for each train it has seen. */
  plans: Map<TrainId, TrainPlan>;
  /** The platform the centre has sent each train to. A train with no entry has none yet. */
  platformFor: Map<TrainId, PlatformId>;
  /** The trains waiting to go through the junction zone, first in line first. */
  junctionOrder: TrainId[];
  /** The one train the centre has let into the junction zone, or null. */
  junctionHolder: TrainId | null;
}

/** The centre's memory before its first step. */
export function initialMemory(timetable: TimetableEntry[]): CentreMemory {
  return {
    timetable,
    plans: new Map(),
    platformFor: new Map(),
    junctionOrder: [],
    junctionHolder: null,
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

/**
 * Records what changed since the last step: trains that entered, stopped in a platform,
 * left a platform or cleared the junction zone. Design: "Today's rule, for comparison".
 *
 * Placeholder: returns the memory unchanged.
 */
export function updateMemory(
  memory: CentreMemory,
  _now: number,
  _trains: TrainState[],
  _sensors: SensorReadings,
): CentreMemory {
  return memory;
}

/**
 * Says whether the centre may permit a train onto a piece of track. A dead platform
 * sensor reads as occupied, so its platform is unavailable. A dead station actor makes
 * every platform unavailable, and a dead merge actor makes the junction unavailable.
 * Design: "Today's rule, for comparison" and "Platform sensors switched off".
 *
 * Placeholder: false, so nothing is available.
 */
export function isAvailable(
  _resource: ResourceId,
  _memory: CentreMemory,
  _sensors: SensorReadings,
  _alive: Alive,
): boolean {
  return false;
}

/**
 * Picks the platform the centre sends a train to, or null if none is available.
 * With `serves: 'ours'` it only picks from the train's own pair.
 * Design: "Today's rule, for comparison" and "Following permits".
 *
 * Placeholder: null, so the train is sent nowhere.
 */
export function choosePlatform(
  _train: TrainState,
  _entry: TimetableEntry,
  _memory: CentreMemory,
  _sensors: SensorReadings,
  _alive: Alive,
  _options: CentreOptions,
): PlatformId | null {
  return null;
}

/**
 * Says whether a train in a platform has finished its dwell and may ask to leave.
 * Design: "Today's rule, for comparison" and "Entering the station".
 *
 * Placeholder: false, so no train leaves.
 */
export function isReadyToLeave(
  _train: TrainState,
  _entry: TimetableEntry,
  _plan: TrainPlan,
  _now: number,
): boolean {
  return false;
}

/**
 * Picks the next train the centre lets into the junction zone, or null. Only one train
 * may be in the zone, and none may enter while the start of EXIT is not clear.
 * Design: "Today's rule, for comparison" and "The map".
 *
 * Placeholder: null, so no train goes through.
 */
export function nextThroughJunction(
  _memory: CentreMemory,
  _trains: TrainState[],
  _sensors: SensorReadings,
  _alive: Alive,
  _now: number,
): TrainId | null {
  return null;
}

/**
 * Picks the track a train should take at the end of its current track.
 * Design: "Today's rule, for comparison".
 *
 * Placeholder: null, so the train's path ends at the end of its current track.
 */
export function nextTrackFor(
  _train: TrainState,
  _memory: CentreMemory,
): TrackId | null {
  return null;
}

/**
 * How far along the x axis a train may run. It keeps the train behind the train ahead,
 * short of a platform it may not enter, and short of the junction zone until the train
 * holds it. Design: "Today's rule, for comparison".
 *
 * Placeholder: the train's current x, so it may not move.
 */
export function untilXFor(
  train: TrainState,
  _trains: TrainState[],
  _memory: CentreMemory,
): number {
  return xOf(train.pos);
}

/**
 * Builds the control centre. The engine calls step once per simulated second while the
 * centre is switched on, and sends the permits it returns over long range.
 *
 * Placeholder: step sends no permits, so every baseline train stops.
 */
export function makeCentre(
  timetable: TimetableEntry[],
  _options: CentreOptions = DEFAULT_CENTRE_OPTIONS,
): ControlCentre {
  let memory = initialMemory(timetable);
  return {
    step(now, trains, sensors, _alive): Message[] {
      memory = updateMemory(memory, now, trains, sensors);
      // Planned: one permit per train in `trains`, built from choosePlatform,
      // nextThroughJunction, nextTrackFor and untilXFor.
      return [];
    },
  };
}
