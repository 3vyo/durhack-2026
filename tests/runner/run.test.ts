import { describe, expect, it } from 'vitest';
import type { TrainProgram } from '../../src/engine/ports';
import { DEFAULT_TIMETABLE } from '../../src/engine/timetable';
import {
  hasCollisions,
  runBatch,
  runScenario,
  type ScenarioSummary,
  type Stats,
} from '../../src/runner/run';
import { stubBaseline, stubOurs } from '../../src/runner/stubs';
import { SCENARIOS } from '../../src/scenarios/scenarios';
import { BRAKE } from '../../src/shared/constants';

const programs = { baseline: stubBaseline, ours: stubOurs };
const seeds = [1, 2, 3];

describe('runScenario', () => {
  it('gives the same exits for the same options', () => {
    const o = {
      seed: 4,
      scenario: SCENARIOS['centre-outage'],
      program: stubBaseline,
      timetable: DEFAULT_TIMETABLE,
    };
    const a = runScenario(o);
    const b = runScenario(o);
    expect([...a.exits]).toEqual([...b.exits]);
    expect(a.finished).toBe(true);
  });
});

// Each batch test runs several full simulations, so give them room when the machine is busy.
describe('runBatch', { timeout: 30_000 }, () => {
  it('scores the baseline against its own healthy run as zero delay', () => {
    const s = runBatch(SCENARIOS.healthy, seeds, programs, DEFAULT_TIMETABLE);
    expect(s.baseline.meanDelay).toBe(0);
    expect(s.baseline.meanTimeToNormal).toBe(0);
    expect(s.seeds).toBe(3);
    expect(s.scenario).toBe('healthy');
  });

  it('shows the baseline losing time in a centre outage while the stub fallback does not', () => {
    const s = runBatch(SCENARIOS['centre-outage'], seeds, programs, DEFAULT_TIMETABLE);
    expect(s.baseline.meanDelay).toBeGreaterThan(0);
    expect(s.ours.meanDelay).toBe(0);
    expect(s.ours.meanTimeToNormal).toBe(0);
    expect(s.baseline.meanTimeToNormal).not.toBeNull();
    expect(s.baseline.meanTimeToNormal as number).toBeGreaterThan(0);
  });

  it('is the same on a second run', () => {
    const a = runBatch(SCENARIOS['centre-outage'], seeds, programs, DEFAULT_TIMETABLE);
    const b = runBatch(SCENARIOS['centre-outage'], seeds, programs, DEFAULT_TIMETABLE);
    expect(a).toEqual(b);
  });

  it('throws for no seeds', () => {
    expect(() => runBatch(SCENARIOS.healthy, [], programs, DEFAULT_TIMETABLE)).toThrow('at least one seed');
  });

  it('throws for a duplicate seed', () => {
    expect(() => runBatch(SCENARIOS.healthy, [1, 2, 1], programs, DEFAULT_TIMETABLE)).toThrow('duplicate seed');
  });

  it('throws a clear message when the healthy reference cannot finish', () => {
    expect(() => runBatch(SCENARIOS.healthy, [1], programs, DEFAULT_TIMETABLE, 1)).toThrow(
      /reference did not finish/,
    );
  });

  it('reports collisions from a program that drives trains into each other', () => {
    // Every train brakes from the moment it enters, so consecutive trains on one entry track
    // stop on top of each other.
    const stopper: TrainProgram = {
      ...stubOurs,
      agentFactory: () => ({
        decide: () => ({ accel: -BRAKE, nextTrack: 'P1', outbox: [], mode: 'blind' }),
      }),
    };
    const s = runBatch(SCENARIOS.healthy, [1, 2], { baseline: stubBaseline, ours: stopper }, DEFAULT_TIMETABLE);
    expect(s.ours.collisions).toBeGreaterThan(0);
    expect(hasCollisions([s])).toBe(true);
  });

  it('gives both programs the identical timetable', () => {
    const seen: string[] = [];
    const recording = (base: TrainProgram): TrainProgram => ({
      ...base,
      agentFactory: (id, timetable) => {
        if (id === 1) seen.push(JSON.stringify(timetable));
        return base.agentFactory(id, timetable);
      },
    });
    runBatch(
      SCENARIOS['centre-outage'],
      [7],
      { baseline: recording(stubBaseline), ours: recording(stubOurs) },
      DEFAULT_TIMETABLE,
    );
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
  });
});

describe('stub baseline', () => {
  const tt = [{ id: 1, entry: 'A' as const, enterAt: 0, platform: 'P1' as const, leader: null, dwell: 30 }];
  const state = { id: 1, pos: { track: 'A' as const, offset: 1000 }, speed: 45, brokenDown: false };
  const permit = [{ type: 'permit' as const, to: 1, untilX: 12400, nextTrack: null, sentAt: 0 }];

  it('keeps accelerating while it holds a permit and sees nothing ahead', () => {
    const agent = stubBaseline.agentFactory(1, tt);
    const out = agent.decide({ now: 0, self: state, inbox: permit, sightAhead: null });
    expect(out.accel).toBeGreaterThan(0);
    expect(out.mode).toBe('central');
  });

  it('brakes for a train it can see when it is going too fast to stop short of it', () => {
    const agent = stubBaseline.agentFactory(1, tt);
    const out = agent.decide({ now: 0, self: state, inbox: permit, sightAhead: 100 });
    expect(out.accel).toBeLessThan(0);
  });

  it('brakes to a stop once its permit is older than FRESH seconds', () => {
    const agent = stubBaseline.agentFactory(1, tt);
    agent.decide({ now: 0, self: state, inbox: permit, sightAhead: null });
    const out = agent.decide({ now: 6, self: state, inbox: [], sightAhead: null });
    expect(out.accel).toBeLessThan(0);
    expect(out.mode).toBe('blind');
  });
});

describe('hasCollisions', () => {
  const clean: Stats = {
    meanDelay: 0,
    spreadDelay: 0,
    meanTimeToNormal: 0,
    collisions: 0,
    closeCalls: 0,
    overruns: 0,
  };
  const summary = (baseline: Stats, ours: Stats): ScenarioSummary => ({
    scenario: 'healthy',
    seeds: 1,
    baseline,
    ours,
  });

  it('is false when nothing collided', () => {
    expect(hasCollisions([summary(clean, clean)])).toBe(false);
  });

  it('is true for a collision in ours', () => {
    expect(hasCollisions([summary(clean, { ...clean, collisions: 1 })])).toBe(true);
  });

  it('is true for a collision in the baseline, which is a bug in the rig', () => {
    expect(hasCollisions([summary({ ...clean, collisions: 1 }, clean)])).toBe(true);
  });
});
