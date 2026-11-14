/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { Engine, type EngineConfig } from '../../src/engine/engine';
import type { ControlCentre, TrainProgram } from '../../src/engine/ports';
import { DEFAULT_TIMETABLE, generateTimetable } from '../../src/engine/timetable';
import { stubBaseline, stubOurs } from '../../src/runner/stubs';
import { ACCEL, BRAKE, MAX_SPEED } from '../../src/shared/constants';
import type { LocalActor, Message, Outgoing, TimetableEntry } from '../../src/shared/types';

const one: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
];

function config(timetable: TimetableEntry[], runLength = 600, program: TrainProgram = stubOurs): EngineConfig {
  return { timetable, program, seed: 1, runLength, presses: [] };
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

describe('Engine switches', () => {
  it('starts with every switch on', () => {
    const engine = new Engine(config(one));
    expect(engine.snapshot().switches).toEqual({
      centre: true,
      station: true,
      merge: true,
      sensors: true,
      radioDrop: 0,
    });
  });

  it('applies scripted presses at their time', () => {
    const engine = new Engine({
      ...config(one),
      presses: [{ at: 5, set: { centre: false } }],
    });
    for (let i = 0; i < 49; i++) engine.step();
    expect(engine.snapshot().switches.centre).toBe(true);
    for (let i = 0; i < 3; i++) engine.step();
    expect(engine.snapshot().switches.centre).toBe(false);
  });

  it('applies a live press on the next snapshot', () => {
    const engine = new Engine(config(one));
    engine.press({ centre: false, radioDrop: 1 });
    const s = engine.snapshot().switches;
    expect(s.centre).toBe(false);
    expect(s.radioDrop).toBe(1);
  });

  it('lets a later scripted press override a live press', () => {
    const engine = new Engine({ ...config(one), presses: [{ at: 1, set: { centre: true } }] });
    engine.press({ centre: false });
    for (let i = 0; i < 12; i++) engine.step();
    expect(engine.snapshot().switches.centre).toBe(true);
  });
});

describe('Engine sightAhead', () => {
  it('gives an agent the distance to a slower train ahead on its entry track', () => {
    const seen: Array<number | null> = [];
    const program: TrainProgram = {
      name: 'ours',
      agentFactory: (id) => ({
        decide: (input) => {
          if (id === 2) seen.push(input.sightAhead);
          return { accel: id === 1 ? -BRAKE : 0, nextTrack: 'P1', outbox: [], mode: 'blind' };
        },
      }),
      makeActors: () => [],
      makeCentre: () => null,
    };
    const two: TimetableEntry[] = [
      { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
      { id: 2, entry: 'A', enterAt: 0, platform: 'P1', leader: 1, dwell: 30 },
    ];
    const engine = new Engine(config(two, 60, program));
    for (let i = 0; i < 600; i++) engine.step();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBeNull();
    const closing = seen.filter((v): v is number => v !== null);
    expect(closing.length).toBeGreaterThan(0);
    for (const v of closing) expect(v).toBeLessThanOrEqual(300);
  });
});

describe('Engine messages', () => {
  it('delivers a message sent on tick t on tick t + 1', () => {
    const log: Array<{ now: number; n: number }> = [];
    let sent = false;
    const program: TrainProgram = {
      name: 'ours',
      agentFactory: (id) => ({
        decide: (input) => {
          if (id === 2) log.push({ now: input.now, n: input.inbox.length });
          const outbox: Outgoing[] = [];
          if (id === 1 && !sent) {
            sent = true;
            outbox.push({
              msg: { type: 'position', from: 1, pos: input.self.pos, speed: input.self.speed, sentAt: input.now },
              range: 'long',
            });
          }
          return { accel: 0, nextTrack: 'P1', outbox, mode: 'blind' };
        },
      }),
      makeActors: () => [],
      makeCentre: () => null,
    };
    const tt: TimetableEntry[] = [
      { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
      { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
    ];
    const engine = new Engine(config(tt, 60, program));
    for (let i = 0; i < 4; i++) engine.step();
    expect(log.map((l) => l.n)).toEqual([0, 1, 0, 0]);
  });

  it('delivers a short-range reply only to a train inside the actor range', () => {
    const grants = new Map<number, number>();
    const station: LocalActor = {
      id: 'station',
      step: (_now, inbox) =>
        inbox.flatMap((m: Message): Outgoing[] =>
          m.type === 'lockRequest'
            ? [{ msg: { type: 'lockGrant', to: m.from, resource: m.resource, follow: null }, range: 'short' }]
            : [],
        ),
    };
    const program: TrainProgram = {
      name: 'ours',
      agentFactory: (id) => ({
        decide: (input) => {
          for (const m of input.inbox) {
            if (m.type === 'lockGrant') grants.set(id, (grants.get(id) ?? 0) + 1);
          }
          return {
            accel: 0,
            nextTrack: 'P1',
            outbox: [{ msg: { type: 'lockRequest', from: id, resource: 'P1' }, range: 'short' }],
            mode: 'blind',
          };
        },
      }),
      makeActors: () => [station],
      makeCentre: () => null,
    };
    const tt: TimetableEntry[] = [
      { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
      { id: 2, entry: 'B', enterAt: 30, platform: 'P3', leader: null, dwell: 30 },
    ];
    const engine = new Engine(config(tt, 300, program));
    for (let i = 0; i < 1100; i++) engine.step();
    expect(grants.get(1) ?? 0).toBeGreaterThan(0);
    expect(grants.get(2) ?? 0).toBe(0);
  });
});

describe('Engine control centre', () => {
  function centreProgram(calls: Array<{ now: number; alive: { station: boolean; merge: boolean } }>): TrainProgram {
    const centre: ControlCentre = {
      step: (now, _trains, _sensors, alive) => {
        calls.push({ now, alive: { ...alive } });
        return [];
      },
    };
    return { ...stubOurs, makeCentre: () => centre };
  }

  it('steps the centre once per simulated second while it is on', () => {
    const calls: Array<{ now: number; alive: { station: boolean; merge: boolean } }> = [];
    const engine = new Engine(config(one, 60, centreProgram(calls)));
    for (let i = 0; i < 100; i++) engine.step();
    expect(calls.length).toBe(10);
    expect(calls[0].now).toBe(0);
    expect(calls[1].now).toBeCloseTo(1, 10);
  });

  it('tells the centre which local actors are alive', () => {
    const calls: Array<{ now: number; alive: { station: boolean; merge: boolean } }> = [];
    const engine = new Engine(config(one, 60, centreProgram(calls)));
    engine.step();
    engine.press({ station: false });
    for (let i = 0; i < 10; i++) engine.step();
    expect(calls[0].alive).toEqual({ station: true, merge: true });
    expect(calls[calls.length - 1].alive).toEqual({ station: false, merge: true });
  });

  it('stops stepping the centre while it is switched off', () => {
    const calls: Array<{ now: number; alive: { station: boolean; merge: boolean } }> = [];
    const engine = new Engine(config(one, 60, centreProgram(calls)));
    engine.press({ centre: false });
    for (let i = 0; i < 50; i++) engine.step();
    expect(calls).toEqual([]);
  });
});

describe('stubBaseline', () => {
  it('runs a train to the end while permits keep arriving', () => {
    const engine = new Engine(config(one, 600, stubBaseline));
    runUntilDone(engine);
    expect(engine.result().finished).toBe(true);
  });

  it('stops a train when the centre is cut, and lets it go again when permits return', () => {
    const engine = new Engine({
      ...config(one, 600, stubBaseline),
      presses: [
        { at: 30, set: { centre: false } },
        { at: 120, set: { centre: true } },
      ],
    });
    while (engine.now < 115) engine.step();
    const stopped = engine.snapshot().trains[0];
    expect(stopped.speed).toBe(0);
    expect(engine.result().finished).toBe(false);

    while (engine.now < 130) engine.step();
    expect(engine.snapshot().trains[0].speed).toBeGreaterThan(0);
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
