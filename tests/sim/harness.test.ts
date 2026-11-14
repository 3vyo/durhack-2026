import { describe, expect, it } from 'vitest';
import type { TrainProgram } from '../../src/engine/ports';
import { ACCEL, MAX_SPEED, SIGHT_SPEED, TICK, TRAIN_LENGTH } from '../../src/shared/constants';
import type { LocalActor, Message, TimetableEntry, TrainAgentFactory, TrainInput, TrainOutput } from '../../src/shared/types';
import { ENTRY_CLEAR, Sim, makeRng, makeTimetable } from './harness';

// These tests check the harness itself with stand-in programs, so a failure in the real
// rules is never confused with a fault in the harness.

const entry = (id: number, enterAt: number, over: Partial<TimetableEntry> = {}): TimetableEntry => ({
  id,
  entry: 'A',
  enterAt,
  platform: 'P1',
  leader: id === 1 ? null : id - 1,
  dwell: 0,
  ...over,
});

/** Drives flat out and never looks ahead. */
const reckless: TrainAgentFactory = (id, timetable) => {
  const mine = timetable.find((e) => e.id === id)!;
  return {
    decide: (input): TrainOutput => ({
      accel: ACCEL,
      nextTrack: input.self.pos.track === 'A' || input.self.pos.track === 'B' ? mine.platform : 'EXIT',
      outbox: [],
      mode: 'blind',
    }),
  };
};

function program(agentFactory: TrainAgentFactory, actors: LocalActor[] = []): TrainProgram {
  return { name: 'ours', agentFactory, makeActors: () => actors, makeCentre: () => null };
}

describe('the test simulation', () => {
  it('gives the same random numbers for the same seed', () => {
    const a = makeRng(7);
    const b = makeRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(makeRng(8)()).not.toBe(makeRng(7)());
  });

  it('builds a timetable that alternates tracks, uses each pair and names leaders', () => {
    const tt = makeTimetable(3, 6);
    expect(tt.map((e) => e.entry)).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
    expect(tt.map((e) => e.platform)).toEqual(['P1', 'P3', 'P2', 'P4', 'P1', 'P3']);
    expect(tt.map((e) => e.leader)).toEqual([null, null, 1, 2, 3, 4]);
    for (let i = 1; i < tt.length; i++) expect(tt[i]!.enterAt - tt[i - 1]!.enterAt).toBeGreaterThanOrEqual(45);
    expect(makeTimetable(3, 6)).toEqual(tt);
  });

  it('runs one train from the start of A to the end of EXIT', () => {
    const sim = new Sim({ program: program(reckless), timetable: [entry(1, 0)] }).run(1000);
    expect(sim.allExited).toBe(true);
    expect(sim.incidents).toEqual([]);
    // 12,400 m: it enters at SIGHT_SPEED, so it cannot beat MAX_SPEED the whole way.
    expect(sim.exits.get(1)!).toBeGreaterThan(12400 / MAX_SPEED);
    expect(sim.exits.get(1)!).toBeLessThan(12400 / MAX_SPEED + 30);
    expect(sim.maxSpeedSeen.get(1)!).toBeCloseTo(MAX_SPEED, 5);
  });

  it('enters a train at SIGHT_SPEED', () => {
    const sim = new Sim({ program: program(reckless), timetable: [entry(1, 0)] });
    sim.step();
    expect(sim.trains[0]!.state.speed).toBeCloseTo(SIGHT_SPEED + ACCEL * TICK, 6);
  });

  it('counts a collision once when a train runs into a broken-down train', () => {
    const sim = new Sim({
      program: program(reckless),
      timetable: [entry(1, 0), entry(2, 60)],
      presses: [{ at: 40, breakDown: 1 }],
    }).run(400);
    expect(sim.collisions).toBe(1);
    expect(sim.incidents.find((i) => i.kind === 'collision')!.trains).toEqual([1, 2]);
  });

  it('counts two trains in the junction zone on different platforms as a collision', () => {
    const tt = [entry(1, 0, { platform: 'P1' }), entry(2, 0, { entry: 'B', platform: 'P3', leader: null })];
    const sim = new Sim({ program: program(reckless), timetable: tt }).run(600);
    expect(sim.collisions).toBe(1);
    expect(sim.incidents[0]!.detail).toContain('junction zone');
  });

  it('counts an overrun when a moving train reaches the end of its track with no nextTrack', () => {
    const noRoute: TrainAgentFactory = () => ({ decide: () => ({ accel: ACCEL, nextTrack: null, outbox: [], mode: 'blind' }) });
    const sim = new Sim({ program: program(noRoute), timetable: [entry(1, 0)] }).run(400);
    expect(sim.overruns).toBe(1);
    expect(sim.trains[0]!.state.pos).toEqual({ track: 'A', offset: 6000 });
    expect(sim.trains[0]!.state.speed).toBe(0);
  });

  it('holds a train out of the map until the start of its track is clear', () => {
    const sim = new Sim({
      program: program(reckless),
      timetable: [entry(1, 0), entry(2, 30)],
      presses: [{ at: 5, breakDown: 1 }],
    }).run(200);
    // Train 1 stopped about 105 m in, inside the first ENTRY_CLEAR metres.
    expect(sim.trains[0]!.state.pos.offset).toBeLessThan(ENTRY_CLEAR);
    expect(sim.entered.has(2)).toBe(false);
    expect(sim.collisions).toBe(0);
  });

  it('reports sightAhead as the distance from the front to the rear of the train ahead', () => {
    const seen: Array<number | null> = [];
    const watcher: TrainAgentFactory = (id, timetable) => {
      const flatOut = reckless(id, timetable);
      return {
        decide: (input: TrainInput) => {
          if (id === 2) {
            seen.push(input.sightAhead);
            return { accel: -100, nextTrack: 'P1', outbox: [], mode: 'blind' };
          }
          return flatOut.decide(input);
        },
      };
    };
    const sim = new Sim({
      program: program(watcher),
      timetable: [entry(1, 0), entry(2, 60)],
      presses: [{ at: 30, breakDown: 1 }],
    }).run(120);
    const front1 = sim.trains.find((t) => t.state.id === 1)!.state.pos.offset;
    const front2 = sim.trains.find((t) => t.state.id === 2)!.state.pos.offset;
    const gap = front1 - TRAIN_LENGTH - front2;
    expect(gap).toBeGreaterThan(300);
    expect(seen[seen.length - 1]).toBeNull(); // further than SENSOR_RANGE
    // Move train 2 to 200 m behind the rear of train 1 and look again.
    sim.trains.find((t) => t.state.id === 2)!.state.pos.offset = front1 - TRAIN_LENGTH - 200;
    sim.step();
    expect(seen[seen.length - 1]).toBeCloseTo(200, 6);
  });

  it('shows a train in the junction zone as an obstacle at the edge of the zone', () => {
    const seen: Array<number | null> = [];
    const tt = [entry(1, 0, { platform: 'P1' }), entry(2, 0, { entry: 'B', platform: 'P3', leader: null })];
    const agents: TrainAgentFactory = (id, timetable) => {
      const flatOut = reckless(id, timetable);
      return {
        decide: (input: TrainInput) => {
          if (id === 2 && input.self.pos.track === 'P3') {
            seen.push(input.sightAhead);
            return { accel: -100, nextTrack: 'EXIT', outbox: [], mode: 'blind' };
          }
          return flatOut.decide(input);
        },
      };
    };
    const sim = new Sim({ program: program(agents), timetable: tt });
    while (sim.trains.length < 2 || sim.trains[0]!.state.pos.track !== 'P1' || sim.trains[0]!.state.pos.offset < 300) sim.step();
    const two = sim.trains.find((t) => t.state.id === 2)!;
    two.state.pos = { track: 'P3', offset: 120 };
    two.state.speed = 0;
    sim.step();
    sim.step();
    expect(seen[seen.length - 1]).toBeCloseTo(180, 6); // 300 - 120
  });

  it('delivers a message on the tick after it was sent, and only inside radio range', () => {
    const heardAt: number[] = [];
    const grantAt: number[] = [];
    const granter: LocalActor = {
      id: 'station',
      step: (now, inbox) => {
        const out = [];
        for (const m of inbox) {
          if (m.type !== 'lockRequest') continue;
          heardAt.push(now);
          const msg: Message = { type: 'lockGrant', to: m.from, resource: m.resource, follow: null };
          out.push({ msg, range: 'short' as const });
        }
        return out;
      },
    };
    const sentAt: number[] = [];
    const asker: TrainAgentFactory = () => ({
      decide: (input: TrainInput) => {
        if (input.inbox.some((m) => m.type === 'lockGrant')) grantAt.push(input.now);
        sentAt.push(input.now);
        const msg: Message = { type: 'lockRequest', from: 1, resource: 'P1' };
        return { accel: ACCEL, nextTrack: 'P1', outbox: [{ msg, range: 'short' }], mode: 'blind' };
      },
    });
    const sim = new Sim({ program: program(asker, [granter]), timetable: [entry(1, 0)] });
    while (sim.trains.length === 0 || sim.trains[0]!.state.pos.track === 'A') sim.step();
    // The station actor hears nothing before x = 4300.
    const firstHeard = heardAt[0]!;
    const xWhenSent = sentAt.findIndex((t) => Math.abs(t - (firstHeard - TICK)) < 1e-9);
    expect(xWhenSent).toBeGreaterThan(0);
    expect(firstHeard).toBeGreaterThan(4300 / MAX_SPEED);
    expect(grantAt[0]!).toBeCloseTo(firstHeard + TICK, 9);
  });

  it('drops every train-to-train message when the radio slider is at 100%', () => {
    let heard = 0;
    const chatty: TrainAgentFactory = (id, timetable) => {
      const flatOut = reckless(id, timetable);
      return {
        decide: (input: TrainInput) => {
          heard += input.inbox.filter((m) => m.type === 'position').length;
          const msg: Message = { type: 'position', from: id, pos: input.self.pos, speed: input.self.speed, sentAt: input.now };
          return { ...flatOut.decide(input), outbox: [{ msg, range: 'long' }] };
        },
      };
    };
    const tt = [entry(1, 0), entry(2, 0, { entry: 'B', platform: 'P3', leader: null })];
    new Sim({ program: program(chatty), timetable: tt, start: { radioDrop: 1 } }).run(20);
    expect(heard).toBe(0);
    new Sim({ program: program(chatty), timetable: tt }).run(20);
    expect(heard).toBeGreaterThan(100);
  });
});
