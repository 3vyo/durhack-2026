import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine/engine';
import type { TrainProgram } from '../../src/engine/ports';
import type { Press, Switches } from '../../src/engine/switches';
import { DEFAULT_TIMETABLE, RUN_LENGTH, generateTimetable, type TimetableOptions } from '../../src/engine/timetable';
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
  entryOf,
  isEntryTrack,
  isPlatform,
  resetLayout,
  type LayoutId,
} from '../../src/shared/map';
import type { EntryId, PlatformId, TimetableEntry, TrackId, TrainId } from '../../src/shared/types';

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
  /** The timetable to draw from the seed, or one written out by hand. */
  trains: TimetableOptions | TimetableEntry[] = DEFAULT_TIMETABLE,
): Outcome {
  // The layout comes first: the timetable, the engine, the agents, the keepers and the centre
  // all read it.
  applyLayout(layout);
  const timetable = Array.isArray(trains) ? trains : generateTimetable(seed, trains);
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

// "The centre comes first": when the centre comes back it takes over from where the trains are,
// and sends a train to the platform its route is set into. A train that creeps sets its route
// too, into each platform of its pair in turn, only to look into it ("Platform keeper switched
// off"). A look is not a choice. If the centre took one over, it would hold the train to a
// platform another train is on, and if that train has broken down the whole entry line would
// stand behind it for good, with the other platform of the pair empty.
//
// Each run here breaks a train down at its platform stop. Later a train waits at the end of
// the same entry line, with a train in the other platform of the pair too. Then the centre,
// the platform keeper and the platform sensors go off for 20 seconds, so the waiting train
// creeps and finds a train in both platforms, and all three come back on while it is still
// looking. Every train but the broken-down one must still leave.

/** Our program, noting each train's route and the routes the centre is shown at each step. */
function watchingRoutes(): {
  program: TrainProgram;
  routeOf: Map<TrainId, TrackId | null>;
  /** The routes the centre saw on its latest step, and when that was. */
  centreSaw: { at: number; routes: Map<TrainId, TrackId | null> };
} {
  const routeOf = new Map<TrainId, TrackId | null>();
  const centreSaw = { at: -1, routes: new Map<TrainId, TrackId | null>() };
  const program: TrainProgram = {
    ...ourProgram,
    agentFactory: (id, timetable) => {
      const agent = ourProgram.agentFactory(id, timetable);
      return {
        decide(input) {
          const output = agent.decide(input);
          routeOf.set(id, output.nextTrack);
          return output;
        },
      };
    },
    makeCentre: (timetable) => {
      const centre = ourProgram.makeCentre(timetable);
      if (centre === null) return null;
      return {
        ...centre,
        step(now, trains, sensors, routes) {
          centreSaw.at = now;
          centreSaw.routes = new Map(routes);
          return centre.step(now, trains, sensors, routes);
        },
      };
    },
  };
  return { program, routeOf, centreSaw };
}

/** What the centre comes back to: where the waiting train is, and which platforms of its pair hold a train. */
interface Return {
  waitingOn: TrackId | null;
  waitingSpeed: number | null;
  pairHoldsATrain: boolean[];
}

type Seen = ReturnType<Engine['snapshot']>['trains'][number];

function whatTheCentreComesBackTo(trains: Seen[], waiting: TrainId, line: EntryId): Return {
  const train = trains.find((t) => t.id === waiting);
  return {
    waitingOn: train?.pos.track ?? null,
    waitingSpeed: train?.speed ?? null,
    pairHoldsATrain: PLATFORM_PAIRS[line].map((p) => trains.some((t) => t.pos.track === p)),
  };
}

/** True if the train stands at the stop of a platform. */
function standsAtStop(t: Seen): t is Seen & { pos: { track: PlatformId } } {
  return isPlatform(t.pos.track) && t.speed === 0 && t.pos.offset > PLATFORM_STOP - 1 && t.pos.offset <= PLATFORM_STOP;
}

/** True if the train stands at the end of this entry line. */
function standsAtEndOf(t: Seen, line: EntryId): boolean {
  return t.pos.track === line && t.speed === 0 && t.pos.offset > TRACK_LENGTH[line] - 1;
}

/** True if the train is on the second half of its run up to the stop of this platform. */
function isArrivingIn(t: Seen, platform: PlatformId): boolean {
  return t.pos.track === platform && t.pos.offset > PLATFORM_STOP / 2 && t.pos.offset < PLATFORM_STOP - 1;
}

/** Shifts of a train's entry, in seconds, that between them move its looks onto both ticks. */
const LOOK_SHIFTS = [0, 0.1, 0.2, 0.3, 0.4];

describe.each(LAYOUT_IDS)('a platform breakdown, then a short blackout with the sensors off, on the %s layout', (layout) => {
  const seed = 1;
  const BLACKOUT = 20;
  const ALL_THREE = { centre: false, platformKeeper: false, sensors: false };

  /**
   * The usual timetable with the trains closer together, so that trains queue behind the
   * breakdown. On hub that timetable spreads its 16 trains over four lines and none ever has to
   * wait like this, so there the 16 trains all come in on the last line, D.
   */
  function closeTogether(): TimetableOptions | TimetableEntry[] {
    if (layout !== 'hub') return { ...DEFAULT_TIMETABLE, minHeadway: 20 };
    const [first, second] = PLATFORM_PAIRS.D;
    return Array.from({ length: TRAINS }, (_, i) => ({
      id: i + 1,
      entry: 'D' as const,
      enterAt: 30 * i,
      platform: i % 2 === 0 ? second : first,
      leader: i === 0 ? null : i,
      dwell: DEFAULT_TIMETABLE.dwell,
    }));
  }

  /** What the run did, for the checks below. */
  interface Blackout {
    brokenDown: { id: TrainId; platform: PlatformId } | null;
    /** The train standing at the end of the entry line when everything went off. */
    waiting: TrainId | null;
    /** Every platform the waiting train set its route into while everything was off. */
    lookedInto: Set<TrackId>;
    /** What the centre came back to. Null if it never went off. */
    atReturn: Return | null;
  }

  /**
   * `which` is 0 for a breakdown in the first platform of a pair, 1 for the second. `off` is
   * what goes off, and comes back on 20 seconds later.
   */
  function blackoutAfterBreakdown(which: 0 | 1, off: Partial<Switches> = ALL_THREE): { outcome: Outcome; seen: Blackout } {
    const { program, routeOf } = watchingRoutes();
    const seen: Blackout = { brokenDown: null, waiting: null, lookedInto: new Set(), atReturn: null };
    const on = Object.fromEntries(Object.keys(off).map((key) => [key, true]));
    let offAt: number | null = null;
    const outcome = run(layout, program, seed, {}, LONG, (engine) => {
      const trains = engine.snapshot().trains;
      if (seen.brokenDown === null) {
        // The first train to stand at the stop of a first, or second, platform breaks down there.
        const standing = trains.filter(standsAtStop).find((t) => PLATFORM_PAIRS[entryOf(t.pos.track)][which] === t.pos.track);
        if (!standing) return;
        seen.brokenDown = { id: standing.id, platform: standing.pos.track };
        engine.breakDown(standing.id);
        return;
      }
      const line = entryOf(seen.brokenDown.platform);
      const other = PLATFORM_PAIRS[line].find((p) => p !== seen.brokenDown!.platform)!;
      if (offAt === null) {
        // A train stands at the end of the line, and another is just arriving in the other
        // platform, where it will stay for longer than the blackout lasts.
        const atEnd = trains.find((t) => standsAtEndOf(t, line));
        if (!atEnd || !trains.some((t) => isArrivingIn(t, other))) return;
        seen.waiting = atEnd.id;
        offAt = engine.now;
        engine.press(off);
        return;
      }
      if (seen.atReturn !== null) return;
      const route = routeOf.get(seen.waiting!) ?? null;
      if (route !== null) seen.lookedInto.add(route);
      if (engine.now < offAt + BLACKOUT - TICK / 2) return;
      seen.atReturn = whatTheCentreComesBackTo(trains, seen.waiting!, line);
      engine.press(on);
    }, closeTogether());
    return { outcome, seen };
  }

  /**
   * The run did reach the situation, and came out of it: the centre came back to a train still
   * standing at the end of its entry line, with a train in both platforms of its pair, which
   * had been looking into each of them in turn. Then every train but the broken-down one left.
   */
  function expectOnlyTheBreakdownLeft(o: Outcome, seen: Blackout, which: 0 | 1): void {
    expect(seen.brokenDown).not.toBeNull();
    const { id, platform } = seen.brokenDown!;
    const line = entryOf(platform);
    expect(PLATFORM_PAIRS[line][which]).toBe(platform);
    expect(seen.waiting).not.toBeNull();
    expect(seen.atReturn).toEqual({ waitingOn: line, waitingSpeed: 0, pairHoldsATrain: [true, true] });
    expect([...seen.lookedInto].sort()).toEqual([...PLATFORM_PAIRS[line]]);

    expectSafe(o);
    expectOnLayout(o, layout);
    // Only the broken-down train is still on the map, in its platform.
    expect(o.left).toEqual([expect.stringContaining(`train ${id} on ${platform} `)]);
    expect(o.through.has(id)).toBe(false);
    expect(o.through.size).toBe(TRAINS - 1);
  }

  it.each([
    ['second', 1],
    ['first', 0],
  ] as const)('ours, with the breakdown in the %s platform of a pair: every other train still leaves', (_name, which) => {
    const { outcome, seen } = blackoutAfterBreakdown(which);
    expectOnlyTheBreakdownLeft(outcome, seen, which);
  });

  // A run is slow and this one varies the blackout, not the map, so it runs on the default layout.
  if (layout !== 'junction') return;

  // With the platform keeper still on, it refuses every request while the sensors are off. A
  // train treats that as silence and creeps all the same ("Platform sensors switched off").
  it('ours, with only the centre and the sensors off: every other train still leaves', () => {
    const { outcome, seen } = blackoutAfterBreakdown(1, { centre: false, sensors: false });
    expectOnlyTheBreakdownLeft(outcome, seen, 1);
  });
});

// The same breakdown with five trains written out by hand on `branch`, one line and one pair of
// platforms, so that a run can be set up tick by tick. Each run ends with a train broken down
// in one platform. Every other train must still leave through the other one.
describe('a platform breakdown on the branch layout, with the trains written out by hand', () => {
  const [FIRST, SECOND] = PLATFORM_PAIRS.A;
  const UNTIL = 2500;
  const EVERYTHING_ON = { centre: true, platformKeeper: true, junctionKeeper: true, sensors: true };

  /** Trains on A, one for each time, with these default platforms. */
  function trainsOnA(enterAt: number[], platforms: PlatformId[], dwell = DEFAULT_TIMETABLE.dwell): TimetableEntry[] {
    return enterAt.map((at, i) => ({ id: i + 1, entry: 'A', enterAt: at, platform: platforms[i], leader: i === 0 ? null : i, dwell }));
  }

  /** Only the broken-down train is still on the map, in `platform`. Every other train left. */
  function expectOnlyThisOneLeft(o: Outcome, id: TrainId, platform: PlatformId): void {
    expectSafe(o);
    expectOnLayout(o, 'branch');
    expect(o.left).toEqual([expect.stringContaining(`train ${id} on ${platform} `)]);
    expect([...o.through].sort()).toEqual(o.timetable.map((e) => e.id).filter((other) => other !== id));
  }

  // A creeping train looks into one platform of its pair on one tick and the other on the next,
  // and the centre steps on whole seconds, so which look the centre sees is a matter of one
  // tick. In the runs above the trains obey the centre until the blackout, their timers start
  // on a whole second, and the centre always comes back to a look into the same platform. Here
  // the trains run on their own rules from the start and the centre is switched on for the
  // first time while a train looks. Moving that train's entry by a tick or two moves its looks.
  describe.each([
    ['second', 1],
    ['first', 0],
  ] as const)('the centre switched on while a train creeps, with the breakdown in the %s platform', (_name, which) => {
    const LOOKS_FOR = 3;
    const stuckIn = PLATFORM_PAIRS.A[which];
    const other = PLATFORM_PAIRS.A[1 - which];
    const WAITING = 3;

    /** `shift` moves the waiting train's entry, in seconds. Returns what the centre first saw. */
    function creepThenCentreOn(shift: number): { outcome: Outcome; atReturn: Return | null; lookedInto: Set<TrackId>; centreSaw: TrackId | null } {
      const { program, routeOf, centreSaw } = watchingRoutes();
      // A long stop in the platform, so that train 2 is still in it when the centre comes on.
      const timetable = trainsOnA([0, 40, 80 + shift, 140, 200], [stuckIn, other, stuckIn, other, stuckIn], 90);
      let broke = false;
      let offAt: number | null = null;
      let lookingSince: number | null = null;
      let atReturn: Return | null = null;
      let saw: TrackId | null | undefined;
      const lookedInto = new Set<TrackId>();
      const outcome = run('branch', program, 1, { start: { centre: false } }, UNTIL, (engine) => {
        const trains = engine.snapshot().trains;
        if (!broke && trains.some((t) => t.id === 1 && standsAtStop(t))) {
          broke = true;
          engine.breakDown(1);
        }
        if (offAt === null) {
          // Train 2 is arriving in the other platform. The platform keeper and the sensors go off.
          if (!broke || !trains.some((t) => t.id === 2 && isArrivingIn(t, other))) return;
          offAt = engine.now;
          engine.press({ platformKeeper: false, sensors: false });
          return;
        }
        if (atReturn !== null) {
          if (saw === undefined && centreSaw.at >= 0) saw = centreSaw.routes.get(WAITING) ?? null;
          return;
        }
        const route = routeOf.get(WAITING) ?? null;
        if (route !== null) lookedInto.add(route);
        // Train 3 has stopped at the end of A and looked into both platforms. A little later
        // the centre is switched on, with the platform keeper and the sensors.
        if (lookedInto.size === 2 && lookingSince === null) lookingSince = engine.now;
        if (lookingSince === null || engine.now < lookingSince + LOOKS_FOR - TICK / 2) return;
        atReturn = whatTheCentreComesBackTo(trains, WAITING, 'A');
        engine.press(EVERYTHING_ON);
      }, timetable);
      return { outcome, atReturn, lookedInto, centreSaw: saw ?? null };
    }

    it('ours: every other train still leaves, whichever platform the train is looking into', () => {
      const sawLookInto = new Set<TrackId | null>();
      for (const shift of LOOK_SHIFTS) {
        const { outcome, atReturn, lookedInto, centreSaw } = creepThenCentreOn(shift);
        // The centre came on to train 3 standing at the end of A, looking into each platform in
        // turn, with train 1 broken down in one and train 2 in the other.
        expect(atReturn).toEqual({ waitingOn: 'A', waitingSpeed: 0, pairHoldsATrain: [true, true] });
        expect([...lookedInto].sort()).toEqual([FIRST, SECOND]);
        expect([FIRST, SECOND]).toContain(centreSaw);
        sawLookInto.add(centreSaw);
        expectOnlyThisOneLeft(outcome, 1, stuckIn);
      }
      // Between them the runs had the centre see a look into each platform of the pair.
      expect([...sawLookInto].sort()).toEqual([FIRST, SECOND]);
    });
  });

  // The centre's own earlier choice can be out of date too. It chose a platform for a train,
  // went off, and a train ahead took that platform on its own rules and broke down there. The
  // centre must not hold the train behind for that platform when it comes back.
  describe('an earlier choice of the centre that is out of date when it comes back', () => {
    /** Runs these presses, and breaks train `id` down when it first stands at a platform stop. */
    function runWithBreakdown(timetable: TimetableEntry[], presses: Press[], id: TrainId, atLastPress: (trains: Seen[]) => void): { outcome: Outcome; brokeDownIn: PlatformId | null } {
      let brokeDownIn: PlatformId | null = null;
      let checked = false;
      const last = presses[presses.length - 1].at;
      const outcome = run('branch', ourProgram, 1, { presses }, UNTIL, (engine) => {
        const trains = engine.snapshot().trains;
        const standing = trains.filter(standsAtStop).find((t) => t.id === id);
        if (brokeDownIn === null && standing) {
          brokeDownIn = standing.pos.track;
          engine.breakDown(id);
        }
        if (!checked && engine.now >= last - TICK / 2) {
          checked = true;
          atLastPress(trains);
        }
      }, timetable);
      return { outcome, brokeDownIn };
    }

    it('ours: a train whose platform was taken during a blackout is sent to the other one', () => {
      // The centre chooses P2 for train 1 and P1 for train 2, the default of each. With the
      // centre and the platform keeper off, train 1 takes P1 on the fixed split, lowest number
      // first, and breaks down there. The centre comes back with train 2 still on its way.
      const timetable = trainsOnA([0, 40, 100, 160], [SECOND, FIRST, FIRST, SECOND]);
      const presses: Press[] = [
        { at: 60, set: { centre: false, platformKeeper: false } },
        { at: 185, set: { centre: true, platformKeeper: true } },
      ];
      let atReturn: Return | null = null;
      const { outcome, brokeDownIn } = runWithBreakdown(timetable, presses, 1, (trains) => {
        atReturn = whatTheCentreComesBackTo(trains, 2, 'A');
      });
      expect(brokeDownIn).toBe(FIRST);
      expect(atReturn).toMatchObject({ waitingOn: 'A', pairHoldsATrain: [true, false] });
      expectOnlyThisOneLeft(outcome, 1, FIRST);
    });

    it('ours: two blackouts in a row, with a train looking into the platform that will empty when the centre comes back', () => {
      // 1. The centre chooses P2 for train 1 and P1 for train 2.
      // 2. The centre and the platform keeper go off. Train 1 takes P1 on the fixed split.
      // 3. Both come back for four seconds, then go off again with the junction keeper and the
      //    sensors. Train 2 creeps into P2 and breaks down there.
      // 4. Train 3 stops at the end of A and looks into P1 and P2 in turn. Everything comes back.
      // Train 1 then leaves P1, and train 3 and the trains behind it must follow through P1.
      const timetable = trainsOnA([8, 48, 88, 148, 208], [SECOND, FIRST, FIRST, SECOND, FIRST]);
      const presses: Press[] = [
        { at: 98, set: { centre: false, platformKeeper: false } },
        { at: 194, set: { centre: true, platformKeeper: true } },
        { at: 198, set: { centre: false, platformKeeper: false, junctionKeeper: false, sensors: false } },
        { at: 328, set: EVERYTHING_ON },
      ];
      let atReturn: Return | null = null;
      const { outcome, brokeDownIn } = runWithBreakdown(timetable, presses, 2, (trains) => {
        atReturn = whatTheCentreComesBackTo(trains, 3, 'A');
      });
      expect(brokeDownIn).toBe(SECOND);
      expect(atReturn).toEqual({ waitingOn: 'A', waitingSpeed: 0, pairHoldsATrain: [true, true] });
      expectOnlyThisOneLeft(outcome, 2, SECOND);
    });
  });
});
