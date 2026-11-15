import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine/engine';
import type { TrainProgram } from '../../src/engine/ports';
import type { Press, Switches } from '../../src/engine/switches';
import { DEFAULT_TIMETABLE, RUN_LENGTH, generateTimetable } from '../../src/engine/timetable';
import { baselineProgram, ourProgram } from '../../src/runner/programs';
import { BRAKE, PLATFORM_KEEPER_TIMEOUT, SIGHT_SPEED, SLOT_LENGTH, TICK } from '../../src/shared/constants';
import {
  ALL_PLATFORMS,
  LAYOUTS,
  LAYOUT_IDS,
  PLATFORMS,
  PLATFORM_PAIRS,
  PLATFORM_STOP,
  TRACK_LENGTH,
  applyLayout,
  isEntryTrack,
  isPlatform,
  resetLayout,
  type LayoutId,
} from '../../src/shared/map';
import type { EntryId, TimetableEntry, TrackId, TrainId } from '../../src/shared/types';

// The real programs on the real engine, on every layout: train agents, both keepers and the
// control centre running together on one to four entry lines. Design: "Layouts".
// tests/runner/programs.test.ts checks many more failures on the default layout. This file
// checks that the same rules hold when there are more, or fewer, lines to merge.

// Every test picks its own layout. Each starts again from the default one.
afterEach(() => resetLayout());

// A run is a few hundred thousand agent decisions, and the suite runs test files side by side.
vi.setConfig({ testTimeout: 30_000 });

const TRAINS = DEFAULT_TIMETABLE.trains;
const SEEDS = [1, 2];

/**
 * How long a run may last. The slowest way out is the clock slots on `hub`: one slot for each
 * of its 8 platforms, so a platform's turn comes round every 8 x 60 = 480 s, and an entry line
 * with two platforms sends out two trains a cycle. The worst timetable puts all 16 trains on
 * one line, which is 8 cycles. Before that the first train needs about 330 s to reach its
 * platform at sight speed and wait there, and may wait a whole cycle for its first slot. After
 * it, the last train needs about 290 s to run down EXIT at sight speed.
 */
function slowestRun(): number {
  const cycle = ALL_PLATFORMS.length * SLOT_LENGTH;
  const reachPlatform = (TRACK_LENGTH.A + PLATFORM_STOP) / SIGHT_SPEED + DEFAULT_TIMETABLE.dwell;
  const runOut = (TRACK_LENGTH.P1 - PLATFORM_STOP + TRACK_LENGTH.EXIT) / SIGHT_SPEED;
  return reachPlatform + cycle + (TRAINS / 2) * cycle + runOut;
}

/** The design's own run length. It leaves the slowest run above more than half an hour spare. */
const LONG = RUN_LENGTH;

/** A baseline run that cannot move is watched this long: enough for every train to have stopped. */
const STOPPED_BY = 2000;

interface Situation {
  name: string;
  start?: Partial<Switches>;
  presses?: Press[];
  /**
   * What today's rule does here. The centre does not use the keepers or the platform sensors,
   * so the baseline loses nothing when one of those fails. With the centre off for good and no
   * radio, no baseline train ever gets a permit.
   */
  baseline: 'every train leaves' | 'no train moves';
}

// The centre goes off about when the 8th train enters, when the station is busy, and stays off
// for 3 minutes.
const OFF_AT = 480;
const ON_AT = OFF_AT + 180;

const SITUATIONS: Situation[] = [
  { name: 'nothing failing', baseline: 'every train leaves' },
  {
    name: 'the centre off for 3 minutes mid-run, then back',
    presses: [
      { at: OFF_AT, set: { centre: false } },
      { at: ON_AT, set: { centre: true } },
    ],
    baseline: 'every train leaves',
  },
  {
    name: 'everything off from the start',
    start: { centre: false, platformKeeper: false, junctionKeeper: false, sensors: false, radioDrop: 1 },
    baseline: 'no train moves',
  },
  { name: 'the platform keeper off from the start', start: { platformKeeper: false }, baseline: 'every train leaves' },
  { name: 'the junction keeper off from the start', start: { junctionKeeper: false }, baseline: 'every train leaves' },
  { name: 'the platform sensors off from the start', start: { sensors: false }, baseline: 'every train leaves' },
];

/**
 * While the centre is on, our trains obey it and never ask a keeper, so the three local faults
 * above do not reach our own rules. These switch the centre off as well, so each rule has to
 * carry the whole run: the keepers alone, the fixed split, the clock slots, and the creep.
 */
const KEEPERS_ONLY: Pick<Situation, 'name' | 'start'> = {
  name: 'the centre off from the start, so the keepers do everything',
  start: { centre: false },
};

const OWN_RULES: Array<Pick<Situation, 'name' | 'start'>> = [
  KEEPERS_ONLY,
  { name: 'the centre and the platform keeper off, so trains use the fixed split', start: { centre: false, platformKeeper: false } },
  { name: 'the centre and the junction keeper off, so trains leave on clock slots', start: { centre: false, junctionKeeper: false } },
  { name: 'the centre and the platform sensors off, so trains creep in', start: { centre: false, sensors: false } },
];

interface Outcome {
  timetable: TimetableEntry[];
  through: Set<TrainId>;
  collisions: number;
  overruns: number;
  /** Where every train still on the map is, for a readable failure. */
  left: string[];
  /** What the trains were doing when a collision or overrun was first counted. */
  firstProblem: string[];
  speeds: number[];
  /** Every track each train's front was ever on, from engine.snapshot() on every tick. */
  tracksOf: Map<TrainId, Set<TrackId>>;
  /** The longest each train stood still in one go with its front on its entry line, in seconds. */
  longestStandOnEntry: Map<TrainId, number>;
  /** The fastest each train went on EXIT. */
  topSpeedOnExit: Map<TrainId, number>;
}

function describeTrains(engine: Engine): string[] {
  return engine
    .snapshot()
    .trains.map((t) => `train ${t.id} on ${t.pos.track} at ${t.pos.offset.toFixed(1)} m, ${t.speed.toFixed(1)} m/s, ${t.mode}`);
}

function run(
  layout: LayoutId,
  program: TrainProgram,
  seed: number,
  s: Pick<Situation, 'start' | 'presses'>,
  until = LONG,
  /** Called after every step, to watch for something a test needs. */
  eachTick?: (engine: Engine) => void,
): Outcome {
  // The layout comes first: the timetable, the engine, the agents, the keepers and the centre
  // all read it.
  applyLayout(layout);
  const timetable = generateTimetable(seed, DEFAULT_TIMETABLE);
  const presses: Press[] = [{ at: 0, set: s.start ?? {} }, ...(s.presses ?? [])];
  const engine = new Engine({ timetable, program, seed, runLength: until, presses });
  const tracksOf = new Map<TrainId, Set<TrackId>>(timetable.map((e) => [e.id, new Set<TrackId>()]));
  const standing = new Map<TrainId, number>();
  const longestStandOnEntry = new Map<TrainId, number>();
  const topSpeedOnExit = new Map<TrainId, number>();
  let firstProblem: string[] = [];
  while (!engine.finished && engine.now < until) {
    engine.step();
    for (const t of engine.snapshot().trains) {
      tracksOf.get(t.id)!.add(t.pos.track);
      const stood = isEntryTrack(t.pos.track) && t.speed === 0 ? (standing.get(t.id) ?? 0) + TICK : 0;
      standing.set(t.id, stood);
      longestStandOnEntry.set(t.id, Math.max(longestStandOnEntry.get(t.id) ?? 0, stood));
      if (t.pos.track === 'EXIT') topSpeedOnExit.set(t.id, Math.max(topSpeedOnExit.get(t.id) ?? 0, t.speed));
    }
    eachTick?.(engine);
    if (firstProblem.length === 0 && engine.now % 1 < 0.05) {
      const r = engine.result();
      if (r.collisions + r.overruns > 0) {
        firstProblem = [`${r.collisions} collision(s) and ${r.overruns} overrun(s) by ${engine.now.toFixed(1)} s`, ...describeTrains(engine)];
      }
    }
  }
  const r = engine.result();
  return {
    timetable,
    through: new Set(r.exits.keys()),
    collisions: r.collisions,
    overruns: r.overruns,
    left: describeTrains(engine),
    firstProblem,
    speeds: engine.snapshot().trains.map((t) => t.speed),
    tracksOf,
    longestStandOnEntry,
    topSpeedOnExit,
  };
}

/** Never a collision and never a train past a stop point, whatever else happened. */
function expectSafe(o: Outcome): void {
  expect(o.firstProblem).toEqual([]);
  expect({ collisions: o.collisions, overruns: o.overruns }).toEqual({ collisions: 0, overruns: 0 });
}

/**
 * Only this layout's entry lines and platforms were ever used. Each train enters on a line of
 * the layout and stays on that line, its own pair of platforms and EXIT, and a train that left
 * stood in exactly one platform on the way.
 */
function expectOnLayout(o: Outcome, layout: LayoutId): void {
  const entries = LAYOUTS[layout].entries;
  const strays: string[] = [];
  const platformsUsed: Array<{ train: TrainId; platforms: number }> = [];
  for (const e of o.timetable) {
    const seen = [...o.tracksOf.get(e.id)!];
    const allowed: TrackId[] = [e.entry, ...PLATFORM_PAIRS[e.entry], 'EXIT'];
    if (!entries.includes(e.entry)) strays.push(`train ${e.id} is timetabled on ${e.entry}`);
    for (const track of seen) if (!allowed.includes(track)) strays.push(`train ${e.id} was on ${track}`);
    if (o.through.has(e.id)) {
      const platforms = seen.filter(isPlatform).length;
      if (platforms !== 1) platformsUsed.push({ train: e.id, platforms });
    }
  }
  expect(strays).toEqual([]);
  expect(platformsUsed).toEqual([]);
}

/** Every train got through. */
function expectAllLeft(o: Outcome): void {
  expect(o.left).toEqual([]);
  expect(o.through.size).toBe(TRAINS);
}

it('allows the slowest fallback on the largest layout enough time, with margin', () => {
  expect(slowestRun()).toBeGreaterThan(4000);
  expect(LONG - slowestRun()).toBeGreaterThan(1800);
});

describe.each(LAYOUT_IDS)('the real programs on the %s layout', (layout) => {
  for (const situation of SITUATIONS) {
    it.each(SEEDS)(`ours, ${situation.name}: no collision, no overrun, and every train leaves (seed %i)`, (seed) => {
      const o = run(layout, ourProgram, seed, situation);
      expectSafe(o);
      expectOnLayout(o, layout);
      expectAllLeft(o);
    });

    if (situation.baseline === 'every train leaves') {
      it.each(SEEDS)(`the baseline, ${situation.name}: no collision, no overrun, and every train leaves (seed %i)`, (seed) => {
        const o = run(layout, baselineProgram, seed, situation);
        expectSafe(o);
        expectOnLayout(o, layout);
        expectAllLeft(o);
      });
    } else {
      it.each(SEEDS)(`the baseline, ${situation.name}: no collision, no overrun, and every train stopped on its entry line (seed %i)`, (seed) => {
        const o = run(layout, baselineProgram, seed, situation, STOPPED_BY);
        expectSafe(o);
        expectOnLayout(o, layout);
        // No permit ever arrives, so today's trains stop where they entered and stay there.
        expect(o.through.size).toBe(0);
        expect(o.speeds.length).toBeGreaterThan(0);
        expect(o.speeds.every((speed) => speed === 0)).toBe(true);
        const fronts = new Set([...o.tracksOf.values()].flatMap((tracks) => [...tracks]));
        expect([...fronts].sort()).toEqual([...LAYOUTS[layout].entries]);
      });
    }
  }

  for (const situation of OWN_RULES) {
    it.each(SEEDS)(`ours, ${situation.name}: no collision, no overrun, and every train leaves (seed %i)`, (seed) => {
      const o = run(layout, ourProgram, seed, situation);
      expectSafe(o);
      expectOnLayout(o, layout);
      expectAllLeft(o);
    });
  }

  // Every train getting out safely does not show the keepers were used: a train that ignored
  // their replies would still get out, on the fixed split and the clock slots. Those leave
  // marks. A train takes the fixed split only after standing at the end of its entry line with
  // no reply for PLATFORM_KEEPER_TIMEOUT, and a train that left on a clock slot does not know
  // its leader, so it never passes SIGHT_SPEED on EXIT.
  it.each(SEEDS)('ours, with the centre off, takes every platform and the junction from the keepers and never falls back (seed %i)', (seed) => {
    const o = run(layout, ourProgram, seed, KEEPERS_ONLY);
    expectAllLeft(o);
    const waited = o.timetable.filter((e) => o.longestStandOnEntry.get(e.id)! >= PLATFORM_KEEPER_TIMEOUT).map((e) => `train ${e.id} on ${e.entry}`);
    expect(waited).toEqual([]);
    const blindOnExit = o.timetable
      .filter((e) => !(o.topSpeedOnExit.get(e.id)! > SIGHT_SPEED + 1))
      .map((e) => `train ${e.id} from ${e.entry}`);
    expect(blindOnExit).toEqual([]);
  });

  // "The centre comes first": a train that can no longer stop before the end of its entry line
  // when the centre fails keeps the platform its last permit sent it to. Here the centre and
  // both keepers fail on the very tick a train on each line in turn is past that point, so
  // nothing but that rule can take it into a platform. Without it the train runs off the end
  // of its line.
  it('keeps every train safe when the centre and both keepers fail just as a train on each entry line can no longer stop', () => {
    const seed = 1;
    const cannotStopAt = new Map<EntryId, number>();
    run(layout, ourProgram, seed, {}, LONG, (engine) => {
      for (const t of engine.snapshot().trains) {
        if (!isEntryTrack(t.pos.track) || cannotStopAt.has(t.pos.track)) continue;
        const stoppingDistance = (t.speed * t.speed) / (2 * BRAKE);
        if (stoppingDistance > TRACK_LENGTH[t.pos.track] - t.pos.offset + 20) cannotStopAt.set(t.pos.track, engine.now);
      }
    });
    expect([...cannotStopAt.keys()].sort()).toEqual([...LAYOUTS[layout].entries]);
    for (const at of cannotStopAt.values()) {
      const blackout = { centre: false, platformKeeper: false, junctionKeeper: false };
      const o = run(layout, ourProgram, seed, { presses: [{ at, set: blackout }] });
      expectSafe(o);
      expectOnLayout(o, layout);
      expectAllLeft(o);
    }
  });

  // "Junction keeper switched off": a train starts on its clock slot only if sightAhead shows the
  // junction zone empty. Here a train breaks down inside the zone, and every other platform's
  // slot comes round twice while it sits there. It stops with its front still in its own
  // platform, so no other train can see it on EXIT: the engine's report of the zone's edge is
  // all that holds each waiting train, in whichever platform of the layout it stands.
  it('holds every waiting train in its platform while a broken-down train blocks the junction zone and the keepers are off', () => {
    const seed = 1;
    const clockSlots = { start: { centre: false, junctionKeeper: false } };
    // The first train to set off, and when its front is half way along the zone's part of its platform.
    let victim: { id: TrainId; at: number } | null = null;
    run(layout, ourProgram, seed, clockSlots, LONG, (engine) => {
      if (victim !== null) return;
      const half = (TRACK_LENGTH.P1 - PLATFORM_STOP) / 2;
      const inZone = engine.snapshot().trains.find((t) => isPlatform(t.pos.track) && t.pos.offset >= PLATFORM_STOP + half);
      if (inZone) victim = { id: inZone.id, at: engine.now };
    });
    expect(victim).not.toBeNull();
    const { id, at } = victim!;

    const cycle = PLATFORMS.length * SLOT_LENGTH;
    const lastEnters = Math.max(...generateTimetable(seed, DEFAULT_TIMETABLE).map((e) => e.enterAt));
    const until = Math.max(at + 2 * cycle, lastEnters + 600);
    const intruders = new Set<string>();
    let waiting: Array<{ id: TrainId; track: TrackId }> = [];
    const o = run(layout, ourProgram, seed, { ...clockSlots, presses: [{ at, set: {}, breakDown: id }] }, until, (engine) => {
      if (engine.now <= at) return;
      const trains = engine.snapshot().trains;
      // A train's front passes offset 300 in its platform to enter the zone.
      for (const t of trains) {
        if (t.id !== id && isPlatform(t.pos.track) && t.pos.offset > PLATFORM_STOP) intruders.add(`train ${t.id} from ${t.pos.track}`);
      }
      waiting = trains.filter((t) => t.id !== id && isPlatform(t.pos.track) && t.speed === 0).map((t) => ({ id: t.id, track: t.pos.track }));
    });
    expectSafe(o);
    expectOnLayout(o, layout);
    expect([...intruders]).toEqual([]);
    // The broken-down train is still in the zone, with its front in its platform.
    const blocker = o.timetable.find((e) => e.id === id)!;
    const stoodIn = [...o.tracksOf.get(id)!].filter(isPlatform);
    expect(stoodIn).toHaveLength(1);
    expect(PLATFORM_PAIRS[blocker.entry]).toContain(stoodIn[0]);
    expect(o.tracksOf.get(id)!.has('EXIT')).toBe(false);
    expect(o.through.has(id)).toBe(false);
    // By the end a train is standing in a platform of every entry line, so every line was held.
    const heldLines = new Set(waiting.map((w) => o.timetable.find((e) => e.id === w.id)!.entry));
    expect([...heldLines].sort()).toEqual([...LAYOUTS[layout].entries]);
  });

  // The checks above would pass on a run that only ever used line A. These seeds send trains
  // down every line and into every platform the layout has, in both programs.
  it.each([
    ['ours', ourProgram],
    ['the baseline', baselineProgram],
  ] as const)('%s uses every entry line and every platform of the layout, and no other track', (_name, program) => {
    const used = new Set<TrackId>();
    for (const seed of SEEDS) {
      const o = run(layout, program, seed, SITUATIONS[0]!);
      for (const tracks of o.tracksOf.values()) for (const track of tracks) used.add(track);
    }
    const entries = LAYOUTS[layout].entries;
    const expected: TrackId[] = [...entries, ...entries.flatMap((e) => PLATFORM_PAIRS[e]), 'EXIT'];
    expect([...used].sort()).toEqual([...expected].sort());
  });
});
