// The parameter file. One JSON file describes one run of the simulation: the physics and
// timer values, the timetable, and which failures happen and when. Every part is
// optional. Anything left out keeps its default, which is the value in docs/design.md.
//
// Use it like this, before a run starts:
//
//   const params = parseParams(JSON.parse(text)); // throws a ParamsError listing every problem
//   applyParams(params);                          // the constants now hold the file's values
//
// The map's geometry (track lengths, the ask point, the junction zone and the radio ranges) is
// not a parameter. It is fixed by docs/design.md and lives in map.ts. A file can pick one of
// the named layouts in map.ts, which says how many entry tracks and platforms there are.

import { DEFAULT_CONSTANTS, resetConstants, setConstants } from './constants';
import type { ConstantValues } from './constants';
import { DEFAULT_LAYOUT, LAYOUT_IDS, applyLayout, isLayoutId, resetLayout } from './map';
import type { LayoutId } from './map';
import type { TrainId } from './types';

// Each file key and the constant it sets. These two tables are the only list of the
// settable values in this file: the types, the defaults and constantsFor all come from them.

/** How trains move and what they can see. Metres, seconds, metres per second. */
const PHYSICS_KEYS = {
  maxSpeed: 'MAX_SPEED',
  accel: 'ACCEL',
  brake: 'BRAKE',
  trainLength: 'TRAIN_LENGTH',
  margin: 'MARGIN', // extra gap kept beyond braking distance
  sensorRange: 'SENSOR_RANGE', // how far a train's own sensor sees
  // The speed a train keeps to when it can only trust what it sees. Leave it out to use the
  // fastest whole number that can stop within sensorRange - margin.
  sightSpeed: 'SIGHT_SPEED',
  fresh: 'FRESH', // a position report older than this is stale
  tick: 'TICK', // simulation step
} as const satisfies Record<string, keyof ConstantValues>;

/** Every timer the rules use, in seconds. */
const TIMER_KEYS = {
  permitFresh: 'PERMIT_FRESH',
  permitInterval: 'PERMIT_INTERVAL',
  positionInterval: 'POSITION_INTERVAL',
  requestRepeat: 'REQUEST_REPEAT',
  junctionKeeperTimeout: 'JUNCTION_KEEPER_TIMEOUT',
  platformKeeperTimeout: 'PLATFORM_KEEPER_TIMEOUT',
  resumeSettle: 'RESUME_SETTLE',
  radioWorkingDelay: 'RADIO_WORKING_DELAY',
  radioReleaseGap: 'RADIO_RELEASE_GAP',
  restartGap: 'RESTART_GAP', // 0 turns the slow restart off
  slotLength: 'SLOT_LENGTH',
  slotWindow: 'SLOT_WINDOW',
} as const satisfies Record<string, keyof ConstantValues>;

export type PhysicsParams = { -readonly [K in keyof typeof PHYSICS_KEYS]: number };
export type TimerParams = { -readonly [K in keyof typeof TIMER_KEYS]: number };

/** The defaults for one table, read from the constants' values in docs/design.md. */
function defaultsFor<T extends Record<string, keyof ConstantValues>>(keys: T): { -readonly [K in keyof T]: number } {
  const out = {} as Record<string, number>;
  for (const [key, constant] of Object.entries(keys)) out[key] = DEFAULT_CONSTANTS[constant];
  return Object.freeze(out) as { -readonly [K in keyof T]: number };
}

/**
 * The trains in the run. Each train picks one of the layout's entry tracks at random from the
 * seed, so the same seed and layout always give the same timetable.
 */
export interface TimetableParams {
  seed: number;
  trains: number;
  minHeadway: number; // the shortest gap between two trains entering. Each gap is minHeadway to 2 * minHeadway seconds
  dwell: number; // seconds each train waits in its platform
}

/** What is switched on. radioDrop is the share of train-to-train messages lost, 0 to 1. */
export interface SwitchParams {
  centre: boolean;
  platformKeeper: boolean;
  junctionKeeper: boolean;
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
  layout: LayoutId; // which of the layouts in map.ts the run uses
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
  layout: DEFAULT_LAYOUT,
  physics: defaultsFor(PHYSICS_KEYS),
  timers: defaultsFor(TIMER_KEYS),
  timetable: Object.freeze({ seed: 1, trains: 16, minHeadway: 45, dwell: 30 }),
  start: Object.freeze({ centre: true, platformKeeper: true, junctionKeeper: true, sensors: true, radioDrop: 0 }),
  failures: Object.freeze([]) as unknown as FailureEvent[],
  runLength: 7200,
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
  const shape = { at: 0, centre: true, platformKeeper: true, junctionKeeper: true, sensors: true, radioDrop: 0, breakDown: 0 };
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
  for (const [key, value] of Object.entries(p.timers)) {
    if (key !== 'restartGap') positive(value as number, `timers.${key}`);
  }
  if (p.timers.restartGap < 0) problems.push(`timers.restartGap must not be negative, but is ${p.timers.restartGap}`);
  whole(p.timetable.trains, 'timetable.trains', 1);
  whole(p.timetable.seed, 'timetable.seed', 0);
  positive(p.timetable.minHeadway, 'timetable.minHeadway');
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
  if (t.junctionKeeperTimeout <= t.requestRepeat) problems.push(`timers.junctionKeeperTimeout (${t.junctionKeeperTimeout}) must be longer than timers.requestRepeat (${t.requestRepeat})`);
  if (t.platformKeeperTimeout <= t.requestRepeat) problems.push(`timers.platformKeeperTimeout (${t.platformKeeperTimeout}) must be longer than timers.requestRepeat (${t.requestRepeat})`);
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

  const known = ['name', 'layout', 'physics', 'timers', 'timetable', 'start', 'failures', 'runLength'];
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

  let layout: LayoutId = DEFAULT_PARAMS.layout;
  if (input.layout !== undefined) {
    if (isLayoutId(input.layout)) layout = input.layout;
    else problems.push(`layout must be one of ${LAYOUT_IDS.join(', ')}, but is ${JSON.stringify(input.layout)}`);
  }

  const params: SimParams = {
    name: top.name,
    layout,
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
  const out = { ...DEFAULT_CONSTANTS };
  for (const [key, constant] of Object.entries(PHYSICS_KEYS)) out[constant] = p.physics[key as keyof PhysicsParams];
  for (const [key, constant] of Object.entries(TIMER_KEYS)) out[constant] = p.timers[key as keyof TimerParams];
  return out;
}

/**
 * Make these parameters the ones every part of the build reads: the constants and the
 * layout. Call it before a run starts. The timetable and failures are not constants: the
 * runner reads those from the parameters it was given.
 */
export function applyParams(p: SimParams): void {
  setConstants(constantsFor(p));
  applyLayout(p.layout);
}

/** Go back to the values and the layout in docs/design.md. */
export function resetParams(): void {
  resetConstants();
  resetLayout();
}
