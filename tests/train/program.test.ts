import { describe, expect, it } from 'vitest';
import { makeCentre } from '../../src/baseline/centre';
import type { TrainProgram } from '../../src/engine/ports';
import { makeActors } from '../../src/locks';
import { SIGHT_SPEED } from '../../src/shared/constants';
import { createTrainAgent } from '../../src/train';
import { Sim, makeRng, makeTimetable, type Press, type Switches } from '../sim/harness';

// Our trains run with the real station actor, merge actor and control centre in the test
// simulation in tests/sim/harness.ts. Every case must end with no collision, no overrun
// and no close call, and with every train off the right-hand end of EXIT.

const ours = (withCentre: boolean): TrainProgram => ({
  name: 'ours',
  agentFactory: createTrainAgent,
  makeActors,
  makeCentre: (timetable) => (withCentre ? makeCentre(timetable, { serves: 'ours' }) : null),
});

const TRAINS = 8;

function run(start: Partial<Switches>, presses: Press[] = [], seed = 1, withCentre = false): Sim {
  const timetable = makeTimetable(seed, TRAINS);
  return new Sim({ program: ours(withCentre), timetable, seed, start, presses }).run(3000);
}

function expectSafeAndDone(sim: Sim): void {
  expect(sim.incidents).toEqual([]);
  expect(sim.exits.size).toBe(TRAINS);
}

describe('our trains with the real actors', () => {
  const cases: Array<[string, Partial<Switches>]> = [
    ['everything on', {}],
    ['the station actor off', { station: false }],
    ['the merge actor off', { merge: false }],
    ['the platform sensors off', { sensors: false }],
    ['the station actor and the sensors off', { station: false, sensors: false }],
    ['the station actor, the merge actor and the sensors off', { station: false, merge: false, sensors: false }],
    ['no train hearing another', { radioDrop: 1 }],
    ['half the train messages lost', { radioDrop: 0.5 }],
    ['everything off and no train hearing another', { station: false, merge: false, sensors: false, radioDrop: 1 }],
  ];

  for (const [name, start] of cases) {
    it(`runs every train through safely with ${name}`, () => {
      expectSafeAndDone(run(start));
      expectSafeAndDone(run(start, [], 2, true));
    });
  }

  it('stays safe while the actors and sensors are switched off and on mid-run', () => {
    const presses: Press[] = [
      { at: 150, set: { station: false, merge: false } },
      { at: 260, set: { station: true } },
      { at: 333, set: { merge: true } },
      { at: 400, set: { sensors: false } },
      { at: 470, set: { merge: false } },
      { at: 520, set: { sensors: true, merge: true } },
      { at: 600, set: { station: false } },
      { at: 655, set: { station: true, merge: false } },
      { at: 700, set: { merge: true } },
    ];
    expectSafeAndDone(run({}, presses));
    expectSafeAndDone(run({}, presses, 3, true));
  });

  it('stays safe with random switches on a busy timetable', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = makeRng(seed * 7919);
      const timetable = makeTimetable(seed, 10, 15 + Math.floor(rng() * 30), 10 + Math.floor(rng() * 40));
      const keys = ['station', 'merge', 'sensors', 'centre'] as const;
      const presses: Press[] = [];
      for (let at = 50; at < 1200; at += rng() * 80) {
        presses.push({ at, set: { [keys[Math.floor(rng() * keys.length)]!]: rng() < 0.5 } });
        if (rng() < 0.15) presses.push({ at, set: { radioDrop: rng() < 0.5 ? 1 : rng() } });
      }
      presses.push({ at: 1300, set: { station: true, merge: true, sensors: true, radioDrop: 0 } });
      const sim = new Sim({ program: ours(true), timetable, seed, presses }).run(5000);
      expect(sim.incidents).toEqual([]);
      expect(sim.exits.size).toBe(10);
    }
  });

  it('queues safely behind a broken-down train', () => {
    const sim = run({}, [{ at: 200, breakDown: 3 }]);
    expect(sim.incidents).toEqual([]);
    // Train 3 is on track A. The trains behind it on A wait. Track B keeps running.
    expect(sim.exits.has(3)).toBe(false);
    expect([2, 4, 6, 8].every((id) => sim.exits.has(id))).toBe(true);
  });

  it('with no train hearing another, the followers stay at SIGHT_SPEED until the merge actor names a leader', () => {
    const sim = new Sim({ program: ours(false), timetable: makeTimetable(1, TRAINS), start: { radioDrop: 1, merge: false } });
    sim.run(3000);
    expect(sim.incidents).toEqual([]);
    // Trains 1 and 2 lead their tracks. Every other train is blind on its entry track, and
    // blind again on EXIT after a clock slot start.
    for (let id = 3; id <= TRAINS; id++) expect(sim.maxSpeedSeen.get(id)!).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
  });
});
