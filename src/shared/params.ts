// The parameter file. One JSON file describes one run of the simulation: the physics and
// timer values, the timetable, and which failures happen and when. Every part is
// optional. Anything left out keeps its default, which is the value in docs/design.md.
//
// Use it like this, before a run starts:
//
//   const params = parseParams(JSON.parse(text)); // throws a ParamsError listing every problem
//   applyParams(params);                          // the constants now hold the file's values
//
// The map (track lengths, the ask point, the junction zone and the radio ranges) is not a
// parameter. It is fixed by docs/design.md and lives in map.ts.

import { DEFAULT_CONSTANTS, resetConstants, setConstants } from './constants';
import type { ConstantValues } from './constants';
import type { TrainId } from './types';

/** How trains move and what they can see. Metres, seconds, metres per second. */
export interface PhysicsParams {
  maxSpeed: number;
  accel: number;
  brake: number;
  trainLength: number;
  margin: number; // extra gap kept beyond braking distance
  sensorRange: number; // how far a train's own sensor sees
  /**
   * The speed a train keeps to when it can only trust what it sees. Leave it out to use
   * the fastest whole number that can stop within sensorRange - margin.
   */
  sightSpeed: number;
  fresh: number; // a position report older than this is stale
  tick: number; // simulation step
}

/** Every timer the rules use, in seconds. */
export interface TimerParams {
  permitFresh: number;
  permitInterval: number;
  positionInterval: number;
  requestRepeat: number;
  mergeTimeout: number;
  stationTimeout: number;
  resumeSettle: number;
  radioWorkingDelay: number;
  radioReleaseGap: number;
  slotLength: number;
  slotWindow: number;
  slotCount: number;
}

/** The trains in the run. Trains alternate between track A and track B. */
export interface TimetableParams {
  seed: number; // the same seed always gives the same timetable
  trains: number;
  headway: number; // each gap between trains is headway to 2 * headway seconds
  dwell: number; // seconds each train waits in its platform
}

/** What is switched on. radioDrop is the share of train-to-train messages lost, 0 to 1. */
export interface SwitchParams {
  centre: boolean;
  station: boolean;
  merge: boolean;
  sensors: boolean;
  radioDrop: number;
}

/** Something that happens during the run: switches change, or a train breaks down. */
export interface FailureEvent extends Partial<SwitchParams> {
  at: number; // seconds from the start of the run
  breakDown?: TrainId;
}

export interface SimParams {
  name: string;
  physics: PhysicsParams;
  timers: TimerParams;
  timetable: TimetableParams;
  start: SwitchParams; // the state of every switch when the run begins
  failures: FailureEvent[];
  runLength: number; // seconds. The run stops here even if trains are still on the map
}

/** The fastest whole speed that can stop within sensorRange - margin at this braking rate. */
export function defaultSightSpeed(brake: number, sensorRange: number, margin: number): number {
  return Math.floor(Math.sqrt(2 * brake * Math.max(0, sensorRange - margin)));
}

export const DEFAULT_PARAMS: Readonly<SimParams> = Object.freeze({
  name: 'default',
  physics: Object.freeze({
    maxSpeed: DEFAULT_CONSTANTS.MAX_SPEED,
    accel: DEFAULT_CONSTANTS.ACCEL,
    brake: DEFAULT_CONSTANTS.BRAKE,
    trainLength: DEFAULT_CONSTANTS.TRAIN_LENGTH,
    margin: DEFAULT_CONSTANTS.MARGIN,
    sensorRange: DEFAULT_CONSTANTS.SENSOR_RANGE,
    sightSpeed: DEFAULT_CONSTANTS.SIGHT_SPEED,
    fresh: DEFAULT_CONSTANTS.FRESH,
    tick: DEFAULT_CONSTANTS.TICK,
  }),
  timers: Object.freeze({
    permitFresh: DEFAULT_CONSTANTS.PERMIT_FRESH,
    permitInterval: DEFAULT_CONSTANTS.PERMIT_INTERVAL,
    positionInterval: DEFAULT_CONSTANTS.POSITION_INTERVAL,
    requestRepeat: DEFAULT_CONSTANTS.REQUEST_REPEAT,
    mergeTimeout: DEFAULT_CONSTANTS.MERGE_TIMEOUT,
    stationTimeout: DEFAULT_CONSTANTS.STATION_TIMEOUT,
    resumeSettle: DEFAULT_CONSTANTS.RESUME_SETTLE,
    radioWorkingDelay: DEFAULT_CONSTANTS.RADIO_WORKING_DELAY,
    radioReleaseGap: DEFAULT_CONSTANTS.RADIO_RELEASE_GAP,
    slotLength: DEFAULT_CONSTANTS.SLOT_LENGTH,
    slotWindow: DEFAULT_CONSTANTS.SLOT_WINDOW,
    slotCount: DEFAULT_CONSTANTS.SLOT_COUNT,
  }),
  timetable: Object.freeze({ seed: 1, trains: 12, headway: 45, dwell: 30 }),
  start: Object.freeze({ centre: true, station: true, merge: true, sensors: true, radioDrop: 0 }),
  failures: Object.freeze([]) as unknown as FailureEvent[],
  runLength: 3600,
});

/** Thrown by parseParams. `problems` has one line per thing wrong with the file. */
export class ParamsError extends Error {
  constructor(readonly problems: string[]) {
    super(`The parameter file has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n- ${problems.join('\n- ')}`);
    this.name = 'ParamsError';
  }
}

type Bag = Record<string, unknown>;

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read one section of the file. Every key must be one the section knows, and every value
 * must have the same type as its default. Problems are added to `problems`.
 */
function readSection<T extends object>(input: unknown, defaults: T, where: string, problems: string[]): T {
  const out = { ...defaults } as Bag;
  if (input === undefined) return out as T;
  if (!isBag(input)) {
    problems.push(`${where} must be an object`);
    return out as T;
  }
  for (const [key, value] of Object.entries(input)) {
    if (!(key in defaults)) {
      problems.push(`${where}.${key} is not a known setting (known: ${Object.keys(defaults).join(', ')})`);
      continue;
    }
    const want = typeof (defaults as Bag)[key];
    if (typeof value !== want || (want === 'number' && !Number.isFinite(value))) {
      problems.push(`${where}.${key} must be a ${want}, but is ${JSON.stringify(value)}`);
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

function readFailures(input: unknown, problems: string[]): FailureEvent[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    problems.push('failures must be a list');
    return [];
  }
  const shape = { at: 0, centre: true, station: true, merge: true, sensors: true, radioDrop: 0, breakDown: 0 };
  const out: FailureEvent[] = [];
  input.forEach((item, i) => {
    const where = `failures[${i}]`;
    if (!isBag(item)) {
      problems.push(`${where} must be an object`);
      return;
    }
    const before = problems.length;
    for (const [key, value] of Object.entries(item)) {
      if (!(key in shape)) {
        problems.push(`${where}.${key} is not a known setting (known: ${Object.keys(shape).join(', ')})`);
      } else if (typeof value !== typeof (shape as Bag)[key] || (typeof value === 'number' && !Number.isFinite(value))) {
        problems.push(`${where}.${key} must be a ${typeof (shape as Bag)[key]}, but is ${JSON.stringify(value)}`);
      }
    }
    if (!('at' in item)) problems.push(`${where}.at is missing: say when it happens, in seconds`);
    if (Object.keys(item).filter((k) => k !== 'at').length === 0) problems.push(`${where} changes nothing: set a switch or breakDown`);
    if (problems.length === before) out.push(item as unknown as FailureEvent);
  });
  return out.sort((a, b) => a.at - b.at);
}

function checkValues(p: SimParams, problems: string[]): void {
  const positive = (value: number, name: string) => {
    if (!(value > 0)) problems.push(`${name} must be more than 0, but is ${value}`);
  };
  const whole = (value: number, name: string, min: number) => {
    if (!Number.isInteger(value) || value < min) problems.push(`${name} must be a whole number of at least ${min}, but is ${value}`);
  };
  const share = (value: number | undefined, name: string) => {
    if (value !== undefined && (value < 0 || value > 1)) problems.push(`${name} must be between 0 and 1, but is ${value}`);
  };

  for (const [key, value] of Object.entries(p.physics)) positive(value as number, `physics.${key}`);
  for (const [key, value] of Object.entries(p.timers)) positive(value as number, `timers.${key}`);
  whole(p.timers.slotCount, 'timers.slotCount', 1);
  whole(p.timetable.trains, 'timetable.trains', 1);
  whole(p.timetable.seed, 'timetable.seed', 0);
  positive(p.timetable.headway, 'timetable.headway');
  if (p.timetable.dwell < 0) problems.push(`timetable.dwell must not be negative, but is ${p.timetable.dwell}`);
  positive(p.runLength, 'runLength');
  share(p.start.radioDrop, 'start.radioDrop');

  const { physics: ph, timers: t } = p;
  if (ph.margin >= ph.sensorRange) {
    problems.push(`physics.margin (${ph.margin}) must be less than physics.sensorRange (${ph.sensorRange}), or a train can never stop for what it sees`);
  } else if (ph.brake > 0) {
    const limit = Math.sqrt(2 * ph.brake * (ph.sensorRange - ph.margin));
    if (ph.sightSpeed > limit) {
      problems.push(`physics.sightSpeed (${ph.sightSpeed}) is too fast to stop within sensorRange - margin; it must be at most ${limit.toFixed(2)}`);
    }
  }
  if (ph.sightSpeed > ph.maxSpeed) problems.push(`physics.sightSpeed (${ph.sightSpeed}) must not be more than physics.maxSpeed (${ph.maxSpeed})`);
  if (ph.tick > 1) problems.push(`physics.tick must be 1 second or less, but is ${ph.tick}`);
  for (const key of ['permitInterval', 'positionInterval', 'requestRepeat'] as const) {
    if (t[key] < ph.tick) problems.push(`timers.${key} (${t[key]}) must not be shorter than physics.tick (${ph.tick})`);
  }
  if (t.permitFresh <= t.permitInterval) {
    problems.push(`timers.permitFresh (${t.permitFresh}) must be longer than timers.permitInterval (${t.permitInterval}), or every permit is stale when it arrives`);
  }
  if (t.mergeTimeout <= t.requestRepeat) problems.push(`timers.mergeTimeout (${t.mergeTimeout}) must be longer than timers.requestRepeat (${t.requestRepeat})`);
  if (t.stationTimeout <= t.requestRepeat) problems.push(`timers.stationTimeout (${t.stationTimeout}) must be longer than timers.requestRepeat (${t.requestRepeat})`);
  if (t.resumeSettle < t.requestRepeat + 2 * ph.tick) {
    problems.push(`timers.resumeSettle (${t.resumeSettle}) must be at least timers.requestRepeat plus two ticks (${t.requestRepeat + 2 * ph.tick})`);
  }
  if (t.slotWindow > t.slotLength) problems.push(`timers.slotWindow (${t.slotWindow}) must not be longer than timers.slotLength (${t.slotLength})`);

  p.failures.forEach((f, i) => {
    if (f.at < 0) problems.push(`failures[${i}].at must not be negative, but is ${f.at}`);
    share(f.radioDrop, `failures[${i}].radioDrop`);
    if (f.breakDown !== undefined && (!Number.isInteger(f.breakDown) || f.breakDown < 1 || f.breakDown > p.timetable.trains)) {
      problems.push(`failures[${i}].breakDown must be a train number from 1 to ${p.timetable.trains}, but is ${f.breakDown}`);
    }
  });
}

/**
 * Turn the contents of a parameter file into a full set of parameters. Anything the file
 * leaves out keeps its default. Throws a ParamsError that lists every problem at once.
 */
export function parseParams(input: unknown): SimParams {
  const problems: string[] = [];
  if (!isBag(input)) throw new ParamsError(['the file must hold one JSON object']);

  const known = ['name', 'physics', 'timers', 'timetable', 'start', 'failures', 'runLength'];
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) problems.push(`${key} is not a known section (known: ${known.join(', ')})`);
  }

  const physics = readSection(input.physics, DEFAULT_PARAMS.physics, 'physics', problems);
  // Work out sightSpeed only from values that make sense, so one bad value gives one problem.
  if (isBag(input.physics) && !('sightSpeed' in input.physics) && physics.brake > 0 && physics.sensorRange > physics.margin) {
    physics.sightSpeed = defaultSightSpeed(physics.brake, physics.sensorRange, physics.margin);
  }
  const top = readSection(
    { ...(input.name === undefined ? {} : { name: input.name }), ...(input.runLength === undefined ? {} : { runLength: input.runLength }) },
    { name: DEFAULT_PARAMS.name, runLength: DEFAULT_PARAMS.runLength },
    'the file',
    problems,
  );

  const params: SimParams = {
    name: top.name,
    physics,
    timers: readSection(input.timers, DEFAULT_PARAMS.timers, 'timers', problems),
    timetable: readSection(input.timetable, DEFAULT_PARAMS.timetable, 'timetable', problems),
    start: readSection(input.start, DEFAULT_PARAMS.start, 'start', problems),
    failures: readFailures(input.failures, problems),
    runLength: top.runLength,
  };
  checkValues(params, problems);
  if (problems.length > 0) throw new ParamsError(problems);
  return params;
}

/** The constants a set of parameters stands for. */
export function constantsFor(p: SimParams): ConstantValues {
  return {
    MAX_SPEED: p.physics.maxSpeed,
    ACCEL: p.physics.accel,
    BRAKE: p.physics.brake,
    TRAIN_LENGTH: p.physics.trainLength,
    MARGIN: p.physics.margin,
    SENSOR_RANGE: p.physics.sensorRange,
    SIGHT_SPEED: p.physics.sightSpeed,
    FRESH: p.physics.fresh,
    TICK: p.physics.tick,
    PERMIT_FRESH: p.timers.permitFresh,
    PERMIT_INTERVAL: p.timers.permitInterval,
    POSITION_INTERVAL: p.timers.positionInterval,
    REQUEST_REPEAT: p.timers.requestRepeat,
    MERGE_TIMEOUT: p.timers.mergeTimeout,
    STATION_TIMEOUT: p.timers.stationTimeout,
    RESUME_SETTLE: p.timers.resumeSettle,
    RADIO_WORKING_DELAY: p.timers.radioWorkingDelay,
    RADIO_RELEASE_GAP: p.timers.radioReleaseGap,
    SLOT_LENGTH: p.timers.slotLength,
    SLOT_WINDOW: p.timers.slotWindow,
    SLOT_COUNT: p.timers.slotCount,
  };
}

/**
 * Make these parameters the ones every part of the build reads. Call it before a run
 * starts. The timetable and failures are not constants: the runner reads those from the
 * parameters it was given.
 */
export function applyParams(p: SimParams): void {
  setConstants(constantsFor(p));
}

/** Go back to the values in docs/design.md. */
export function resetParams(): void {
  resetConstants();
}
