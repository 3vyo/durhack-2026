import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';
import type { TrainProgram } from '../../src/engine/ports';
import type { Press, Switches } from '../../src/engine/switches';
import { generateTimetable, makeRng } from '../../src/engine/timetable';
import { baselineProgram, ourProgram } from '../../src/runner/programs';
import { RADIO_WORKING_DELAY, SIGHT_SPEED } from '../../src/shared/constants';

// The real programs on the real engine: train agents, local actors and the control centre
// running together. docs/why.md claims zero collisions in every failure the demo can
// inject, and these tests are where that claim is checked.

const TRAINS = 12;
const TIMETABLE = { trains: TRAINS, minHeadway: 45, dwell: 30 };
const SEEDS = [1, 2, 3];
const LONG = 9000; // seconds. The slowest fallback moves about one train a minute.

interface Scenario {
  name: string;
  start?: Partial<Switches>;
  presses?: Press[];
}

interface Outcome {
  through: number;
  collisions: number;
  overruns: number;
  /** Where every train still on the map is, for a readable failure. */
  left: string[];
  /** What the trains were doing on the tick a collision or overrun was first counted. */
  firstProblem: string[];
  maxSpeed: number;
  /** The fastest each train went, and the fastest any train went on EXIT. */
  maxSpeedOf: Map<number, number>;
  maxSpeedOnExit: number;
  speeds: number[];
}

const OFF_AT = 300;
const ON_AT = 480;
const outage = (set: Partial<Switches>, back: Partial<Switches>): Press[] => [
  { at: OFF_AT, set },
  { at: ON_AT, set: back },
];

const FAILURES: Scenario[] = [
  { name: 'centre off from the start', start: { centre: false } },
  { name: 'centre outage, then restored', presses: outage({ centre: false }, { centre: true }) },
  { name: 'platform keeper off from the start', start: { platformKeeper: false } },
  { name: 'platform keeper killed mid-run', presses: [{ at: OFF_AT, set: { platformKeeper: false } }] },
  { name: 'platform keeper outage, then restored', presses: outage({ platformKeeper: false }, { platformKeeper: true }) },
  { name: 'junction keeper off from the start', start: { junctionKeeper: false } },
  { name: 'junction keeper killed mid-run', presses: [{ at: OFF_AT, set: { junctionKeeper: false } }] },
  { name: 'junction keeper outage, then restored', presses: outage({ junctionKeeper: false }, { junctionKeeper: true }) },
  { name: 'platform sensors off from the start', start: { sensors: false } },
  { name: 'platform sensors outage, then restored', presses: outage({ sensors: false }, { sensors: true }) },
  { name: 'radio at 50% loss', start: { radioDrop: 0.5 } },
  { name: 'radio at 100% loss', start: { radioDrop: 1 } },
  { name: 'blackout, trains talking', start: { centre: false, platformKeeper: false, junctionKeeper: false } },
  { name: 'blackout, trains silent', start: { centre: false, platformKeeper: false, junctionKeeper: false, radioDrop: 1 } },
  {
    name: 'blackout mid-run, then everything restored',
    presses: outage({ centre: false, platformKeeper: false, junctionKeeper: false }, { centre: true, platformKeeper: true, junctionKeeper: true }),
  },
  { name: 'everything off, sensors too', start: { centre: false, platformKeeper: false, junctionKeeper: false, sensors: false, radioDrop: 1 } },
  { name: 'platform keeper and sensors off', start: { platformKeeper: false, sensors: false } },
];

function describeTrains(engine: Engine): string[] {
  return engine
    .snapshot()
    .trains.map((t) => `train ${t.id} on ${t.pos.track} at ${t.pos.offset.toFixed(1)} m, ${t.speed.toFixed(1)} m/s, ${t.mode}${t.brokenDown ? ', broken down' : ''}`);
}

function run(program: TrainProgram, seed: number, s: Scenario, until = LONG, watchSpeed = false): Outcome {
  const presses: Press[] = [{ at: 0, set: s.start ?? {} }, ...(s.presses ?? [])];
  const engine = new Engine({ timetable: generateTimetable(seed, TIMETABLE), program, seed, runLength: until, presses });
  let firstProblem: string[] = [];
  let problems = 0;
  let maxSpeed = 0;
  let maxSpeedOnExit = 0;
  const maxSpeedOf = new Map<number, number>();
  while (!engine.finished && engine.now < until) {
    engine.step();
    if (watchSpeed) {
      for (const t of engine.snapshot().trains) {
        maxSpeed = Math.max(maxSpeed, t.speed);
        maxSpeedOf.set(t.id, Math.max(maxSpeedOf.get(t.id) ?? 0, t.speed));
        if (t.pos.track === 'EXIT') maxSpeedOnExit = Math.max(maxSpeedOnExit, t.speed);
      }
    }
    if (firstProblem.length === 0 && engine.now % 1 < 0.05) {
      const r = engine.result();
      if (r.collisions + r.overruns > problems) {
        problems = r.collisions + r.overruns;
        firstProblem = [`${r.collisions} collision(s) and ${r.overruns} overrun(s) by ${engine.now.toFixed(1)} s`, ...describeTrains(engine)];
      }
    }
  }
  const r = engine.result();
  return {
    through: r.exits.size,
    collisions: r.collisions,
    overruns: r.overruns,
    left: describeTrains(engine),
    firstProblem,
    maxSpeed,
    maxSpeedOf,
    maxSpeedOnExit,
    speeds: engine.snapshot().trains.map((t) => t.speed),
  };
}

/** Everything that must be true of a run where every train should get through safely. */
function expectClean(o: Outcome): void {
  expect(o.firstProblem).toEqual([]);
  expect({ collisions: o.collisions, overruns: o.overruns }).toEqual({ collisions: 0, overruns: 0 });
  expect(o.left).toEqual([]);
  expect(o.through).toBe(TRAINS);
}

describe('our program, nothing failed', () => {
  it.each(SEEDS)('runs every train through with no collision or overrun (seed %i)', (seed) => {
    expectClean(run(ourProgram, seed, { name: 'healthy' }));
  });

  it('runs trains at full speed when nothing has failed', () => {
    expect(run(ourProgram, 1, { name: 'healthy' }, LONG, true).maxSpeed).toBeGreaterThan(40);
  });
});

describe('our program, each failure the demo can inject', () => {
  for (const scenario of FAILURES) {
    it.each(SEEDS)(`${scenario.name}: no collision, no overrun, and every train gets through (seed %i)`, (seed) => {
      expectClean(run(ourProgram, seed, scenario));
    });
  }

  it('keeps every train that cannot hear its leader at sight speed or below in the silent blackout', () => {
    const o = run(ourProgram, 1, FAILURES.find((f) => f.name === 'blackout, trains silent')!, LONG, true);
    // Only the first train on each entry track has no train ahead, so only it may go faster.
    for (const e of generateTimetable(1, TIMETABLE)) {
      if (e.leader !== null) expect(o.maxSpeedOf.get(e.id)!).toBeLessThanOrEqual(SIGHT_SPEED + 1e-6);
    }
    // Nobody knows who is ahead on EXIT after a clock-slot start.
    expect(o.maxSpeedOnExit).toBeLessThanOrEqual(SIGHT_SPEED + 1e-6);
  });

  it.each(SEEDS)('stops behind a broken-down train with no collision (seed %i)', (seed) => {
    const timetable = generateTimetable(seed, TIMETABLE);
    const victim = timetable[2]!;
    const o = run(ourProgram, seed, { name: 'breakdown', presses: [{ at: victim.enterAt + 60, set: {}, breakDown: victim.id }] }, 4000);
    expect(o.firstProblem).toEqual([]);
    expect({ collisions: o.collisions, overruns: o.overruns }).toEqual({ collisions: 0, overruns: 0 });
    // Every train on the other entry track still gets through.
    const otherTrack = timetable.filter((e) => e.entry !== victim.entry).length;
    expect(o.through).toBeGreaterThanOrEqual(otherTrack);
  });
});

describe('our program, random presses at random times', () => {
  it.each(Array.from({ length: 20 }, (_, i) => i + 100))('has no collision or overrun (seed %i)', (seed) => {
    const rng = makeRng(seed);
    const presses: Press[] = [];
    const count = 3 + Math.floor(rng() * 6);
    for (let i = 0; i < count; i++) {
      const at = rng() * 1200;
      const pick = Math.floor(rng() * 5);
      const on = rng() < 0.5;
      if (pick === 0) presses.push({ at, set: { centre: on } });
      if (pick === 1) presses.push({ at, set: { platformKeeper: on } });
      if (pick === 2) presses.push({ at, set: { junctionKeeper: on } });
      if (pick === 3) presses.push({ at, set: { sensors: on } });
      if (pick === 4) presses.push({ at, set: { radioDrop: on ? 0 : rng() } });
    }
    const o = run(ourProgram, seed, { name: 'random', presses }, 4000);
    expect(o.firstProblem).toEqual([]);
    expect({ collisions: o.collisions, overruns: o.overruns }).toEqual({ collisions: 0, overruns: 0 });
  });
});

describe('the baseline', () => {
  it.each(SEEDS)('runs every train through with no collision or overrun when nothing has failed (seed %i)', (seed) => {
    expectClean(run(baselineProgram, seed, { name: 'healthy' }));
  });

  it.each(SEEDS)('stops every train with no collision when the centre and the radio go off for good (seed %i)', (seed) => {
    const presses = [{ at: OFF_AT, set: { centre: false, radioDrop: 1 } }];
    const o = run(baselineProgram, seed, { name: 'centre and radio off', presses }, 2000);
    expect(o.firstProblem).toEqual([]);
    expect({ collisions: o.collisions, overruns: o.overruns }).toEqual({ collisions: 0, overruns: 0 });
    expect(o.through).toBeLessThan(TRAINS);
    expect(o.speeds.every((s) => s === 0)).toBe(true);
  });

  it.each(SEEDS)('stays stopped for the first 20 minutes of a centre outage (seed %i)', (seed) => {
    const before = OFF_AT + RADIO_WORKING_DELAY - 10;
    const o = run(baselineProgram, seed, { name: 'centre off', presses: [{ at: OFF_AT, set: { centre: false } }] }, before);
    expect(o.speeds.every((s) => s === 0)).toBe(true);
  });

  it.each(SEEDS)('moves every train through by radio working when the centre never comes back, with no collision (seed %i)', (seed) => {
    const o = run(baselineProgram, seed, { name: 'centre off', presses: [{ at: OFF_AT, set: { centre: false } }] });
    expectClean(o);
  });

  it.each(SEEDS)('moves again when the centre comes back, with no collision (seed %i)', (seed) => {
    expectClean(run(baselineProgram, seed, { name: 'centre outage', presses: outage({ centre: false }, { centre: true }) }));
  });

  it.each(['platformKeeper', 'junctionKeeper', 'sensors'] as const)('has no collision with the %s switched off', (device) => {
    const o = run(baselineProgram, 1, { name: device, presses: [{ at: OFF_AT, set: { [device]: false } }] }, 2000);
    expect(o.firstProblem).toEqual([]);
    expect({ collisions: o.collisions, overruns: o.overruns }).toEqual({ collisions: 0, overruns: 0 });
  });

  it.each(SEEDS)('has no collision behind a broken-down train (seed %i)', (seed) => {
    const timetable = generateTimetable(seed, TIMETABLE);
    const victim = timetable[2]!;
    const o = run(baselineProgram, seed, { name: 'breakdown', presses: [{ at: victim.enterAt + 60, set: {}, breakDown: victim.id }] }, 3000);
    expect(o.firstProblem).toEqual([]);
    expect({ collisions: o.collisions, overruns: o.overruns }).toEqual({ collisions: 0, overruns: 0 });
  });
});

describe('ours against the baseline', () => {
  it.each(SEEDS)('gets more trains through a centre and radio outage that never ends (seed %i)', (seed) => {
    const scenario = { name: 'centre and radio off', presses: [{ at: OFF_AT, set: { centre: false, radioDrop: 1 } }] };
    const ours = run(ourProgram, seed, scenario);
    const base = run(baselineProgram, seed, scenario, 3000);
    expect(ours.through).toBe(TRAINS);
    expect(base.through).toBeLessThan(TRAINS);
  });
});

describe('radio working against ours', () => {
  it.each(SEEDS)('ours gets every train out of a centre outage that never ends before radio working does (seed %i)', (seed) => {
    const scenario = { name: 'centre off', presses: [{ at: OFF_AT, set: { centre: false } }] };
    const ours = run(ourProgram, seed, scenario, OFF_AT + RADIO_WORKING_DELAY);
    const base = run(baselineProgram, seed, scenario, OFF_AT + RADIO_WORKING_DELAY);
    expect(ours.through).toBe(TRAINS);
    expect(base.through).toBeLessThan(TRAINS);
  });
});

describe('the radio mode', () => {
  it('shows on baseline trains moving under radio working, and never on ours', () => {
    const presses = [{ at: OFF_AT, set: { centre: false } }];
    const seen = { baseline: new Set<string>(), ours: new Set<string>() };
    for (const [side, program] of [['baseline', baselineProgram], ['ours', ourProgram]] as const) {
      const timetable = generateTimetable(1, TIMETABLE);
      const engine = new Engine({ timetable, program, seed: 1, runLength: OFF_AT + RADIO_WORKING_DELAY + 300, presses });
      while (engine.now < OFF_AT + RADIO_WORKING_DELAY + 300) {
        engine.step();
        for (const t of engine.snapshot().trains) seen[side].add(t.mode);
      }
    }
    expect(seen.baseline.has('radio')).toBe(true);
    expect(seen.ours.has('radio')).toBe(false);
  });
});
