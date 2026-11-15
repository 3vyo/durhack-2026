/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { Engine, type EngineConfig } from '../../src/engine/engine';
import type { ControlCentre, TrainProgram } from '../../src/engine/ports';
import { DEFAULT_TIMETABLE, RUN_LENGTH, generateTimetable, spawnEntry } from '../../src/engine/timetable';
import { stubBaseline, stubOurs } from '../../src/runner/stubs';
import { ACCEL, MAX_SPEED, SIGHT_SPEED, TICK, resetConstants, setConstants } from '../../src/shared/constants';
import type { LocalActor, Message, Outgoing, SensorReadings, TimetableEntry, TrackId } from '../../src/shared/types';

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

  it('spawns a train at SIGHT_SPEED, the one speed that can always stop within what it can see', () => {
    const engine = new Engine(config(one));
    engine.step();
    // It spawns at SIGHT_SPEED, and the stub then accelerates for the one tick it has run.
    expect(engine.snapshot().trains[0].speed).toBeCloseTo(SIGHT_SPEED + ACCEL * TICK, 9);
  });

  it('lets a train that enters at SIGHT_SPEED accelerate to MAX_SPEED on a clear line', () => {
    const engine = new Engine(config(one));
    for (let i = 0; i < 600; i++) engine.step();
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
    expect(appearedAt).toBeGreaterThanOrEqual(15.9);
    expect(appearedAt).toBeLessThanOrEqual(16.5);

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
      platformKeeper: true,
      junctionKeeper: true,
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
          return { accel: id === 1 ? 0 : ACCEL, nextTrack: 'P1', outbox: [], mode: 'blind' };
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
    const platformKeeper: LocalActor = {
      id: 'platformKeeper',
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
            accel: ACCEL,
            nextTrack: 'P1',
            outbox: [{ msg: { type: 'lockRequest', from: id, resource: 'P1' }, range: 'short' }],
            mode: 'blind',
          };
        },
      }),
      makeActors: () => [platformKeeper],
      makeCentre: () => null,
    };
    const tt: TimetableEntry[] = [
      { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
      { id: 2, entry: 'B', enterAt: 30, platform: 'P3', leader: null, dwell: 30 },
    ];
    const engine = new Engine(config(tt, 300, program));
    for (let i = 0; i < 1300; i++) engine.step();
    expect(grants.get(1) ?? 0).toBeGreaterThan(0);
    expect(grants.get(2) ?? 0).toBe(0);
  });
});

describe('Engine with changed constants', () => {
  it('runs the once-a-second work every second after TICK changes', () => {
    setConstants({ TICK: 0.5 });
    try {
      const calls: number[] = [];
      const centre: ControlCentre = {
        step: (now) => {
          calls.push(now);
          return [];
        },
      };
      const program: TrainProgram = { ...stubOurs, makeCentre: () => centre };
      const engine = new Engine(config(one, 60, program));
      for (let i = 0; i < 6; i++) engine.step();
      expect(calls).toEqual([0, 1, 2]);
    } finally {
      resetConstants();
    }
  });
});

describe('Engine control centre', () => {
  interface CentreCall {
    now: number;
    sensors: SensorReadings;
    routes: Map<number, TrackId | null>;
  }
  function centreProgram(calls: CentreCall[]): TrainProgram {
    const centre: ControlCentre = {
      step: (now, _trains, sensors, routes) => {
        calls.push({ now, sensors, routes: new Map(routes) });
        return [];
      },
    };
    return { ...stubOurs, makeCentre: () => centre };
  }

  it('steps the centre once per simulated second while it is on', () => {
    const calls: CentreCall[] = [];
    const engine = new Engine(config(one, 60, centreProgram(calls)));
    for (let i = 0; i < 100; i++) engine.step();
    expect(calls.length).toBe(10);
    expect(calls[0].now).toBe(0);
    expect(calls[1].now).toBeCloseTo(1, 10);
  });

  it('gives the centre true platform readings, whatever the platform sensor switch says', () => {
    const calls: CentreCall[] = [];
    const engine = new Engine(config(one, 60, centreProgram(calls)));
    engine.press({ sensors: false, platformKeeper: false, junctionKeeper: false });
    for (let i = 0; i < 11; i++) engine.step();
    expect(calls[calls.length - 1].sensors.platformOccupied).toEqual({ P1: false, P2: false, P3: false, P4: false });
  });

  it("gives the centre each train's route from the last tick", () => {
    const calls: CentreCall[] = [];
    const engine = new Engine(config(one, 60, centreProgram(calls)));
    for (let i = 0; i < 11; i++) engine.step();
    const routes = calls[calls.length - 1].routes;
    expect([...routes.keys()]).toEqual([1]);
  });

  it('stops stepping the centre while it is switched off', () => {
    const calls: CentreCall[] = [];
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

describe('Engine safety', () => {
  it('counts one collision when two trains drive through each other', () => {
    const tt: TimetableEntry[] = [
      { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
      { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
    ];
    const engine = new Engine(config(tt, 600));
    runUntilDone(engine);
    expect(engine.result().collisions).toBe(1);
  });

  it('counts no collision when trains are spaced out in a healthy timetable', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const tt = generateTimetable(seed, DEFAULT_TIMETABLE);
      const engine = new Engine(config(tt, RUN_LENGTH));
      runUntilDone(engine);
      expect(engine.result().collisions, `seed ${seed}`).toBe(0);
    }
  });
});

describe('Engine overlay facts', () => {
  const tt2: TimetableEntry[] = [
    { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
    { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: 1, dwell: 30 },
  ];

  it('reports how old the last report from the timetable leader is', () => {
    let sent = false;
    const program: TrainProgram = {
      name: 'ours',
      agentFactory: (id) => ({
        decide: (input) => {
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
    const engine = new Engine(config(tt2, 60, program));
    engine.step();
    expect(engine.snapshot().trains.find((t) => t.id === 2)!.leaderAge).toBeNull();
    for (let i = 0; i < 80; i++) engine.step();
    const age = engine.snapshot().trains.find((t) => t.id === 2)!.leaderAge!;
    expect(age).toBeCloseTo(8, 5);
    expect(engine.snapshot().trains.find((t) => t.id === 1)!.leaderAge).toBeNull();
  });

  it('reports how old the last permit is, and none without a centre', () => {
    const withCentre = new Engine(config(one, 60, stubBaseline));
    for (let i = 0; i < 35; i++) withCentre.step();
    const age = withCentre.snapshot().trains[0].permitAge!;
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(1.5);

    const without = new Engine(config(one, 60, stubOurs));
    for (let i = 0; i < 35; i++) without.step();
    expect(without.snapshot().trains[0].permitAge).toBeNull();
  });

  it('records the last grants a train heard and never clears them', () => {
    const granting = (id: 'platformKeeper' | 'junctionKeeper'): LocalActor => ({
      id,
      step: (_now, inbox) =>
        inbox.flatMap((m: Message): Outgoing[] =>
          m.type === 'lockRequest'
            ? [{ msg: { type: 'lockGrant', to: m.from, resource: m.resource, follow: null }, range: 'short' }]
            : [],
        ),
    });
    const program: TrainProgram = {
      name: 'ours',
      agentFactory: (id) => ({
        decide: () => ({
          accel: ACCEL,
          nextTrack: 'P1',
          outbox: [
            { msg: { type: 'lockRequest', from: id, resource: 'P2' }, range: 'short' },
            { msg: { type: 'lockRequest', from: id, resource: 'JUNCTION' }, range: 'short' },
          ],
          mode: 'blind',
        }),
      }),
      makeActors: () => [granting('platformKeeper'), granting('junctionKeeper')],
      makeCentre: () => null,
    };
    const engine = new Engine(config(one, 300, program));
    while (engine.now < 130) engine.step();
    expect(engine.snapshot().trains[0].lastGrants).toEqual({ platform: 'P2', junction: false });
    while (engine.now < 150) engine.step();
    expect(engine.snapshot().trains[0].lastGrants).toEqual({ platform: 'P2', junction: true });
  });

  it('shows no grants for a train that never heard one', () => {
    const engine = new Engine(config(one, 60));
    engine.step();
    expect(engine.snapshot().trains[0].lastGrants).toEqual({ platform: null, junction: false });
  });
});

describe('Engine leader from a junction grant', () => {
  // Train 1 enters on A and broadcasts its position every tick. Train 2 enters on B, accelerates
  // into the junction keeper's range at about 146 s, and asks for the junction. The junction keeper grants it.
  function program(follow: number | null): TrainProgram {
    const junctionKeeper: LocalActor = {
      id: 'junctionKeeper',
      step: (_now, inbox) =>
        inbox.flatMap((m: Message): Outgoing[] =>
          m.type === 'lockRequest' && m.resource === 'JUNCTION'
            ? [{ msg: { type: 'lockGrant', to: m.from, resource: 'JUNCTION', follow }, range: 'short' }]
            : [],
        ),
    };
    return {
      name: 'ours',
      agentFactory: (id) => ({
        decide: (input) => {
          const outbox: Outgoing[] = [];
          if (id === 1) {
            outbox.push({
              msg: { type: 'position', from: 1, pos: input.self.pos, speed: input.self.speed, sentAt: input.now },
              range: 'long',
            });
          } else {
            outbox.push({ msg: { type: 'lockRequest', from: 2, resource: 'JUNCTION' }, range: 'short' });
          }
          return { accel: id === 1 ? 0 : ACCEL, nextTrack: 'P3', outbox, mode: 'blind' };
        },
      }),
      makeActors: () => [junctionKeeper],
      makeCentre: () => null,
    };
  }
  const tt = (leaderOfTwo: number | null): TimetableEntry[] => [
    { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
    { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: leaderOfTwo, dwell: 30 },
  ];
  const train2 = (e: Engine) => e.snapshot().trains.find((t) => t.id === 2)!;

  it('follows the train the junction keeper names, whatever the timetable said', () => {
    const engine = new Engine(config(tt(null), 300, program(1)));
    while (engine.now < 140) engine.step();
    expect(train2(engine).leaderAge).toBeNull();
    while (engine.now < 152) engine.step();
    expect(train2(engine).leaderAge).not.toBeNull();
    expect(train2(engine).leaderAge as number).toBeLessThan(0.5);
  });

  it('stops showing the entry-track leader once the junction keeper says there is no train ahead', () => {
    const engine = new Engine(config(tt(1), 300, program(null)));
    while (engine.now < 140) engine.step();
    expect(train2(engine).leaderAge as number).toBeLessThan(0.5);
    while (engine.now < 152) engine.step();
    expect(train2(engine).leaderAge).toBeNull();
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

describe('Engine breakdown', () => {
  it('stops a broken-down train where it is, for good', () => {
    const engine = new Engine(config(one));
    for (let i = 0; i < 200; i++) engine.step();
    engine.breakDown(1);
    engine.step();
    const at = engine.snapshot().trains[0].pos.offset;
    for (let i = 0; i < 500; i++) engine.step();
    const train = engine.snapshot().trains[0];
    expect(train.pos.offset).toBe(at);
    expect(train.speed).toBe(0);
    expect(train.brokenDown).toBe(true);
    expect(engine.result().exits.size).toBe(0);
  });

  it('breaks a train down from a scripted press', () => {
    const engine = new Engine({ ...config(one), presses: [{ at: 20, set: {}, breakDown: 1 }] });
    for (let i = 0; i < 199; i++) engine.step();
    expect(engine.snapshot().trains[0].brokenDown).toBeUndefined();
    for (let i = 0; i < 50; i++) engine.step();
    expect(engine.snapshot().trains[0].brokenDown).toBe(true);
    expect(engine.snapshot().trains[0].speed).toBe(0);
  });

  it('tells the agent it has broken down, and still asks it to decide', () => {
    const seen: boolean[] = [];
    const program: TrainProgram = {
      ...stubOurs,
      agentFactory: (id, timetable) => {
        const inner = stubOurs.agentFactory(id, timetable);
        return {
          decide: (input) => {
            seen.push(input.self.brokenDown);
            return inner.decide(input);
          },
        };
      },
    };
    const engine = new Engine(config(one, 600, program));
    for (let i = 0; i < 10; i++) engine.step();
    engine.breakDown(1);
    for (let i = 0; i < 10; i++) engine.step();
    expect(seen.slice(0, 10).every((b) => b === false)).toBe(true);
    expect(seen.slice(10).every((b) => b === true)).toBe(true);
    expect(seen.length).toBe(20);
  });

  it('counts a collision when a train that does not look ahead runs into a broken-down one', () => {
    const two: TimetableEntry[] = [
      { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 0 },
      { id: 2, entry: 'A', enterAt: 60, platform: 'P1', leader: 1, dwell: 0 },
    ];
    const engine = new Engine({ ...config(two), presses: [{ at: 40, set: {}, breakDown: 1 }] });
    runUntilDone(engine);
    expect(engine.result().collisions).toBe(1);
  });
});

describe('Engine.addTrain', () => {
  /** Steps until the train is on the map, and returns the time it appeared, or -1. */
  function appearedAt(engine: Engine, id: number, until: number): number {
    while (engine.now < until) {
      engine.step();
      if (engine.snapshot().trains.some((t) => t.id === id)) return engine.now;
    }
    return -1;
  }

  it('adds a train during a run that enters, runs and leaves, and counts it', () => {
    const timetable = [...one];
    const engine = new Engine(config(timetable));
    for (let i = 0; i < 50; i++) engine.step();
    const entry = spawnEntry(timetable, 'B', engine.now, 30);
    engine.addTrain(entry);
    expect(timetable).toContain(entry);
    runUntilDone(engine);
    expect(engine.result().finished).toBe(true);
    expect(engine.result().exits.has(entry.id)).toBe(true);
  });

  it('puts the new train in front of a later train on its track, which then follows it', () => {
    const timetable: TimetableEntry[] = [
      ...one,
      { id: 2, entry: 'A', enterAt: 200, platform: 'P2', leader: 1, dwell: 30 },
    ];
    const engine = new Engine(config(timetable, 1200));
    for (let i = 0; i < 200; i++) engine.step();
    const entry = spawnEntry(timetable, 'A', engine.now, 30);
    expect(entry.leader).toBe(1);
    engine.addTrain(entry);
    expect(timetable[1].leader).toBe(entry.id);
    const spawned = appearedAt(engine, entry.id, 200);
    expect(spawned).toBeGreaterThan(0);
    expect(engine.snapshot().trains.some((t) => t.id === 2)).toBe(false);
    runUntilDone(engine);
    expect(engine.result().finished).toBe(true);
    expect(engine.result().collisions).toBe(0);
  });

  it('waits behind a train that is due but still waiting to enter on its track', () => {
    const timetable: TimetableEntry[] = [
      ...one,
      { id: 2, entry: 'A', enterAt: 1, platform: 'P2', leader: 1, dwell: 30 },
    ];
    const engine = new Engine(config(timetable));
    for (let i = 0; i < 20; i++) engine.step(); // train 2 is due and held back by train 1
    const entry = spawnEntry(timetable, 'A', engine.now, 30);
    expect(entry.leader).toBe(2);
    engine.addTrain(entry);
    const second = appearedAt(engine, 2, 120);
    const third = appearedAt(engine, entry.id, 120);
    expect(second).toBeGreaterThan(0);
    expect(third).toBeGreaterThan(second);
  });

  it('adds the entry once when two engines share one timetable, and both run it', () => {
    const timetable = [...one];
    const a = new Engine(config(timetable));
    const b = new Engine(config(timetable));
    const entry = spawnEntry(timetable, 'B', 0, 30);
    a.addTrain(entry);
    b.addTrain(entry);
    expect(timetable.filter((e) => e.id === entry.id)).toHaveLength(1);
    a.step();
    b.step();
    expect(a.snapshot().trains.map((t) => t.id)).toContain(entry.id);
    expect(b.snapshot().trains.map((t) => t.id)).toContain(entry.id);
  });

  it('ignores the same train added twice', () => {
    const timetable = [...one];
    const engine = new Engine(config(timetable));
    const entry = spawnEntry(timetable, 'B', 0, 30);
    engine.addTrain(entry);
    engine.step();
    engine.addTrain(entry);
    engine.step();
    expect(engine.snapshot().trains.filter((t) => t.id === entry.id)).toHaveLength(1);
  });

  it('refuses a train due in the past, and a different train with an ID already in the timetable', () => {
    const timetable = [...one];
    const engine = new Engine(config(timetable));
    for (let i = 0; i < 10; i++) engine.step();
    expect(() => engine.addTrain({ ...spawnEntry(timetable, 'B', 0, 30) })).toThrow(/past/);
    expect(() => engine.addTrain({ ...one[0], enterAt: engine.now })).toThrow(/already/);
  });
});
