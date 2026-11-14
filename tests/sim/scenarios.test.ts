import { describe, expect, it } from 'vitest';
import type { TrainProgram } from '../../src/engine/ports';
import { SIGHT_SPEED } from '../../src/shared/constants';
import { type Press, Sim, type Switches, makeRng, makeTimetable } from './harness';
import { baselineProgram, ourProgram } from './programs';

// The whole of each program running together: train agents, local actors and the control
// centre. docs/why.md claims zero collisions in every failure the demo can inject, and
// these tests are where that claim is checked.

const TRAINS = 12;
const SEEDS = [1, 2, 3];
const LONG = 9000; // seconds. The slowest fallback moves about one train a minute.

interface Scenario {
  name: string;
  start?: Partial<Switches>;
  presses?: Press[];
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
  { name: 'station actor off from the start', start: { station: false } },
  { name: 'station actor killed mid-run', presses: [{ at: OFF_AT, set: { station: false } }] },
  { name: 'station actor outage, then restored', presses: outage({ station: false }, { station: true }) },
  { name: 'merge actor off from the start', start: { merge: false } },
  { name: 'merge actor killed mid-run', presses: [{ at: OFF_AT, set: { merge: false } }] },
  { name: 'merge actor outage, then restored', presses: outage({ merge: false }, { merge: true }) },
  { name: 'platform sensors off from the start', start: { sensors: false } },
  { name: 'platform sensors outage, then restored', presses: outage({ sensors: false }, { sensors: true }) },
  { name: 'radio at 50% loss', start: { radioDrop: 0.5 } },
  { name: 'radio at 100% loss', start: { radioDrop: 1 } },
  { name: 'blackout, trains talking', start: { centre: false, station: false, merge: false } },
  { name: 'blackout, trains silent', start: { centre: false, station: false, merge: false, radioDrop: 1 } },
  {
    name: 'blackout mid-run, then everything restored',
    presses: outage({ centre: false, station: false, merge: false }, { centre: true, station: true, merge: true }),
  },
  { name: 'everything off, sensors too', start: { centre: false, station: false, merge: false, sensors: false, radioDrop: 1 } },
  { name: 'station actor and sensors off', start: { station: false, sensors: false } },
];

function run(program: TrainProgram, seed: number, s: Scenario, until = LONG): Sim {
  return new Sim({ program, timetable: makeTimetable(seed, TRAINS), seed, start: s.start, presses: s.presses }).run(until);
}

function problems(sim: Sim): string[] {
  return sim.incidents.filter((i) => i.kind !== 'close-call').map((i) => `${i.kind} at ${i.at.toFixed(1)} s: ${i.detail}`);
}

function stuck(sim: Sim): string[] {
  return sim.trains.map((t) => `train ${t.state.id} on ${t.state.pos.track} at ${t.state.pos.offset.toFixed(0)} m, ${t.state.speed.toFixed(1)} m/s, ${t.mode}`);
}

describe('our program, nothing failed', () => {
  it.each(SEEDS)('runs every train through with no collision or overrun (seed %i)', (seed) => {
    const sim = run(ourProgram, seed, { name: 'healthy' });
    expect(problems(sim)).toEqual([]);
    expect(stuck(sim)).toEqual([]);
    expect(sim.exits.size).toBe(TRAINS);
  });

  it('runs trains at full speed when nothing has failed', () => {
    const sim = run(ourProgram, 1, { name: 'healthy' });
    expect(Math.max(...sim.maxSpeedSeen.values())).toBeGreaterThan(40);
  });
});

describe('our program, each failure the demo can inject', () => {
  for (const scenario of FAILURES) {
    it.each(SEEDS)(`${scenario.name}: no collision, no overrun, and every train gets through (seed %i)`, (seed) => {
      const sim = run(ourProgram, seed, scenario);
      expect(problems(sim)).toEqual([]);
      expect(stuck(sim)).toEqual([]);
      expect(sim.exits.size).toBe(TRAINS);
    });
  }

  it('keeps every train at sight speed or below in the silent blackout', () => {
    const sim = run(ourProgram, 1, FAILURES.find((f) => f.name === 'blackout, trains silent')!);
    expect(Math.max(...sim.maxSpeedSeen.values())).toBeLessThanOrEqual(SIGHT_SPEED + 1e-6);
  });

  it.each(SEEDS)('stops behind a broken-down train with no collision (seed %i)', (seed) => {
    const sim = run(ourProgram, seed, { name: 'breakdown', presses: [{ at: 200, breakDown: 3 }] }, 3000);
    expect(problems(sim)).toEqual([]);
    // Train 3 is on track A. Every train on track B still gets through.
    const tt = makeTimetable(seed, TRAINS);
    for (const e of tt.filter((e) => e.entry === 'B')) expect(sim.exits.has(e.id)).toBe(true);
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
      if (pick === 1) presses.push({ at, set: { station: on } });
      if (pick === 2) presses.push({ at, set: { merge: on } });
      if (pick === 3) presses.push({ at, set: { sensors: on } });
      if (pick === 4) presses.push({ at, set: { radioDrop: on ? 0 : rng() } });
    }
    const sim = run(ourProgram, seed, { name: 'random', presses }, 4000);
    expect(problems(sim)).toEqual([]);
  });
});

describe('the baseline', () => {
  it.each(SEEDS)('runs every train through with no collision or overrun when nothing has failed (seed %i)', (seed) => {
    const sim = run(baselineProgram, seed, { name: 'healthy' });
    expect(problems(sim)).toEqual([]);
    expect(stuck(sim)).toEqual([]);
    expect(sim.exits.size).toBe(TRAINS);
  });

  it.each(SEEDS)('stops every train with no collision when the centre goes off for good (seed %i)', (seed) => {
    const sim = run(baselineProgram, seed, { name: 'centre off', presses: [{ at: OFF_AT, set: { centre: false } }] }, 2000);
    expect(problems(sim)).toEqual([]);
    expect(sim.exits.size).toBeLessThan(TRAINS);
    for (const t of sim.trains) expect(t.state.speed).toBe(0);
  });

  it.each(SEEDS)('moves again when the centre comes back, with no collision (seed %i)', (seed) => {
    const sim = run(baselineProgram, seed, { name: 'centre outage', presses: outage({ centre: false }, { centre: true }) });
    expect(problems(sim)).toEqual([]);
    expect(stuck(sim)).toEqual([]);
    expect(sim.exits.size).toBe(TRAINS);
  });

  it.each(['station', 'merge', 'sensors'] as const)('has no collision with the %s switched off', (device) => {
    const sim = run(baselineProgram, 1, { name: device, presses: [{ at: OFF_AT, set: { [device]: false } }] }, 2000);
    expect(problems(sim)).toEqual([]);
  });
});

describe('ours against the baseline', () => {
  const totalExitTime = (sim: Sim, until: number) => {
    let sum = 0;
    for (let id = 1; id <= TRAINS; id++) sum += sim.exits.get(id) ?? until;
    return sum;
  };

  it.each(SEEDS)('gets trains through a centre outage sooner than the baseline (seed %i)', (seed) => {
    const scenario = { name: 'centre outage', presses: outage({ centre: false }, { centre: true }) };
    const ours = run(ourProgram, seed, scenario);
    const base = run(baselineProgram, seed, scenario);
    expect(totalExitTime(ours, LONG)).toBeLessThan(totalExitTime(base, LONG));
  });

  it('keeps moving through a centre outage that never ends, where the baseline stops', () => {
    const scenario = { name: 'centre off', presses: [{ at: OFF_AT, set: { centre: false } }] };
    const ours = run(ourProgram, 1, scenario);
    const base = run(baselineProgram, 1, scenario, 3000);
    expect(ours.exits.size).toBe(TRAINS);
    expect(base.exits.size).toBeLessThan(TRAINS);
  });
});
