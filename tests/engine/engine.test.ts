/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { Engine, type EngineConfig } from '../../src/engine/engine';
import type { TrainProgram } from '../../src/engine/ports';
import { DEFAULT_TIMETABLE, generateTimetable } from '../../src/engine/timetable';
import { stubOurs } from '../../src/runner/stubs';
import { ACCEL, MAX_SPEED } from '../../src/shared/constants';
import type { TimetableEntry } from '../../src/shared/types';

const one: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
];

function config(timetable: TimetableEntry[], runLength = 600, program: TrainProgram = stubOurs): EngineConfig {
  return { timetable, program, seed: 1, runLength };
}

function runUntilDone(engine: Engine): void {
  while (!engine.result().finished && engine.now < engine.result().runLength) engine.step();
}

describe('Engine', () => {
  it('drives a train to the end of EXIT and records its exit time', () => {
    const engine = new Engine(config(one));
    runUntilDone(engine);
    const result = engine.result();
    expect(result.finished).toBe(true);
    expect(result.exits.get(1)).toBeGreaterThanOrEqual(12400 / MAX_SPEED);
  });

  it('spawns a train at MAX_SPEED', () => {
    const engine = new Engine(config(one));
    engine.step();
    expect(engine.snapshot().trains[0].speed).toBe(MAX_SPEED);
  });

  it('holds a train back while the start of its entry track is occupied', () => {
    const two: TimetableEntry[] = [
      ...one,
      { id: 2, entry: 'A', enterAt: 1, platform: 'P2', leader: 1, dwell: 30 },
    ];
    const engine = new Engine(config(two));
    let appearedAt = -1;
    while (appearedAt < 0 && engine.now < 60) {
      engine.step();
      if (engine.snapshot().trains.some((t) => t.id === 2)) appearedAt = engine.now;
    }
    expect(appearedAt).toBeGreaterThanOrEqual(8.8);
    expect(appearedAt).toBeLessThanOrEqual(9.5);

    runUntilDone(engine);
    const alone = new Engine(config([{ ...two[1], leader: null }]));
    runUntilDone(alone);
    expect(engine.result().exits.get(2)!).toBeGreaterThan(alone.result().exits.get(2)! + 5);
  });

  it('gives identical snapshots for the same config after 3000 steps', () => {
    const tt = generateTimetable(1, DEFAULT_TIMETABLE);
    const a = new Engine(config(tt, 2000));
    const b = new Engine(config(tt, 2000));
    for (let i = 0; i < 3000; i++) {
      a.step();
      b.step();
    }
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  });

  it('lists a train only between its entry and its exit', () => {
    const engine = new Engine(config([{ ...one[0], enterAt: 5 }]));
    expect(engine.snapshot().trains).toEqual([]);
    for (let i = 0; i < 40; i++) engine.step();
    expect(engine.snapshot().trains).toEqual([]);
    for (let i = 0; i < 20; i++) engine.step();
    expect(engine.snapshot().trains).toHaveLength(1);
    runUntilDone(engine);
    expect(engine.snapshot().trains).toEqual([]);
  });

  it('does nothing when stepped after runLength', () => {
    const engine = new Engine(config(one, 1));
    for (let i = 0; i < 50; i++) engine.step();
    expect(engine.now).toBeCloseTo(1, 10);
  });

  it('counts an overrun when an agent leaves a track end with an invalid nextTrack', () => {
    const overrunning: TrainProgram = {
      name: 'ours',
      agentFactory: () => ({
        decide: () => ({ accel: ACCEL, nextTrack: 'P4', outbox: [], mode: 'blind' }),
      }),
      makeActors: () => [],
      makeCentre: () => null,
    };
    const engine = new Engine(config(one, 200, overrunning));
    runUntilDone(engine);
    expect(engine.result().overruns).toBeGreaterThan(0);
  });
});

describe('Engine display reason', () => {
  function withReason(reason: unknown): TrainProgram {
    return {
      name: 'ours',
      agentFactory: () => ({
        decide: () =>
          ({ accel: ACCEL, nextTrack: 'P1', outbox: [], mode: 'full', reason }) as ReturnType<
            ReturnType<TrainProgram['agentFactory']>['decide']
          >,
      }),
      makeActors: () => [],
      makeCentre: () => null,
    };
  }

  it('passes a string reason through to the snapshot', () => {
    const engine = new Engine(config(one, 600, withReason('braking: leader report 8 s old')));
    engine.step();
    expect(engine.snapshot().trains[0].reason).toBe('braking: leader report 8 s old');
  });

  it('ignores a reason that is not a string', () => {
    const engine = new Engine(config(one, 600, withReason(42)));
    engine.step();
    expect('reason' in engine.snapshot().trains[0]).toBe(false);
  });
});

describe('engine purity', () => {
  const sources = import.meta.glob('../../src/engine/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  it('finds the engine source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0);
  });

  it('never uses the wall clock, Math.random or the browser in code', () => {
    for (const [file, text] of Object.entries(sources)) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\b(Math\.random|Date\.now|performance\.now|document|window)\b/);
    }
  });
});
