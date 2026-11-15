import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CENTRE_OPTIONS,
  freeRunX,
  MAP_END_X,
  choosePlatform,
  initialMemory,
  isAvailable,
  isRadioWorking,
  isReadyToLeave,
  makeCentre,
  makePermit,
  nextRestartRelease,
  nextThroughJunction,
  nextTrackFor,
  reachOf,
  releaseHeld,
  trainAhead,
  untilXFor,
  updateMemory,
  type CentreMemory,
  type CentreOptions,
  type Permit,
  type Routes,
  type TrainPlan,
} from '../../src/baseline/centre';
import { BRAKE, DEFAULT_CONSTANTS, MARGIN, MAX_SPEED, TRAIN_LENGTH, resetConstants, setConstants } from '../../src/shared/constants';
import {
  ALL_PLATFORMS,
  JUNCTION_END_X,
  JUNCTION_START_X,
  LAYOUT_IDS,
  PLATFORMS,
  PLATFORM_STOP,
  TRACK_LENGTH,
  TRACK_START,
  applyLayout,
  entryOf,
  isPlatform,
  pairOf,
  platformReadings,
  resetLayout,
  xOf,
} from '../../src/shared/map';
import type {
  Message,
  PlatformId,
  ResourceId,
  SensorReadings,
  TimetableEntry,
  TrackId,
  TrainState,
} from '../../src/shared/types';
import { Engine } from '../../src/engine/engine';
import type { TrainProgram } from '../../src/engine/ports';
import type { Press } from '../../src/engine/switches';
import { baselineProgram } from '../../src/baseline';

// Rules: "Today's rule, for comparison", "The centre comes first" and "Following permits"
// in docs/design.md, plus "The map".

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
  { id: 3, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
  { id: 4, entry: 'A', enterAt: 120, platform: 'P1', leader: 2, dwell: 30 },
];

/**
 * Readings with every platform of the layout in use empty, unless `occupied` says otherwise.
 * Platforms outside the layout read occupied. Call it after applyLayout.
 */
function readings(occupied: Partial<Record<PlatformId, boolean>> = {}): SensorReadings {
  return { platformOccupied: platformReadings(occupied), junctionOccupied: false, exitStartClear: true };
}

/** Clear readings for the default layout, which is the one in use when this file loads. */
const clear: SensorReadings = readings();

/** No train has set a route. */
const none: Routes = new Map();
const ENTRY_END_X = TRACK_START.A + TRACK_LENGTH.A;
const STOP_X = TRACK_START.P1 + PLATFORM_STOP;

function train(id: number, track: TrackId, offset: number, speed = 20): TrainState {
  return { id, pos: { track, offset }, speed, brokenDown: false };
}

function stopped(id: number, track: TrackId, offset: number): TrainState {
  return train(id, track, offset, 0);
}

function broken(id: number, track: TrackId, offset: number): TrainState {
  return { ...stopped(id, track, offset), brokenDown: true };
}

function plan(id: number): TrainPlan {
  return { id, untilX: 0, nextTrack: null, stoppedAt: null, heldForRestart: false };
}

function occupied(...platforms: PlatformId[]): SensorReadings {
  const platformOccupied = { ...clear.platformOccupied };
  for (const platform of platforms) platformOccupied[platform] = true;
  return { ...clear, platformOccupied };
}

/** The memory after one step that sees these trains, with these routes set. */
function seen(trains: TrainState[], now = 0, from = initialMemory(timetable), routes = none): CentreMemory {
  return updateMemory(from, now, trains, clear, routes);
}

function routes(set: Record<number, TrackId | null>): Routes {
  return new Map(Object.entries(set).map(([id, track]) => [Number(id), track]));
}

function sentTo(memory: CentreMemory, sent: Record<number, PlatformId>): CentreMemory {
  const platformFor = new Map(memory.platformFor);
  for (const [id, platform] of Object.entries(sent)) platformFor.set(Number(id), platform);
  return { ...memory, platformFor };
}

/** The memory once the centre has promised a train this untilX. */
function promised(memory: CentreMemory, id: number, untilX: number): CentreMemory {
  const plans = new Map(memory.plans);
  plans.set(id, { ...(plans.get(id) ?? plan(id)), untilX });
  return { ...memory, plans };
}

function permitFor(messages: Message[], id: number): Permit {
  const found = messages.find((msg) => msg.type === 'permit' && msg.to === id);
  if (!found || found.type !== 'permit') throw new Error(`no permit for train ${id}`);
  return found;
}

describe('initialMemory', () => {
  it('starts with the timetable, no plans, no platforms and an empty junction', () => {
    const memory = initialMemory(timetable);
    expect(memory.timetable).toBe(timetable);
    expect(memory.plans.size).toBe(0);
    expect(memory.platformFor.size).toBe(0);
    expect(memory.junctionOrder).toEqual([]);
    expect(memory.junctionHolder).toBeNull();
    expect(memory.lastStepAt).toBeNull();
    expect(memory.lastReleaseAt).toBeNull();
  });
});

describe('makePermit', () => {
  it('builds a permit message addressed to one train', () => {
    expect(makePermit(2, 6300, 'P2', 12)).toEqual({
      type: 'permit',
      to: 2,
      untilX: 6300,
      nextTrack: 'P2',
      sentAt: 12,
      leader: null,
    });
  });

  it('names the leader it is given', () => {
    expect(makePermit(2, 6300, 'P2', 12, 1).leader).toBe(1);
  });
});

describe('makeCentre', () => {
  it('defaults to no slow restart', () => {
    expect(DEFAULT_CENTRE_OPTIONS).toEqual({});
  });
});

describe('step', () => {
  const trains = [train(1, 'A', 3000), train(2, 'A', 1000), train(3, 'B', 2000)];

  it('sends exactly one permit to each train in trains on every call', () => {
    const centre = makeCentre(timetable);
    for (let now = 0; now < 3; now++) {
      const to = centre.step(now, trains, clear, none).map((msg) => (msg as Permit).to);
      expect(to.sort()).toEqual([1, 2, 3]);
    }
  });

  it('addresses each permit to its train and sets sentAt to now', () => {
    const messages = makeCentre(timetable).step(7, trains, clear, none);
    for (const t of trains) {
      const permit = permitFor(messages, t.id);
      expect(permit.sentAt).toBe(7);
      expect(permit.untilX).toBeGreaterThan(xOf(t.pos));
    }
  });

  it('sends only permit messages', () => {
    const messages = makeCentre(timetable).step(0, trains, clear, none);
    expect(messages.every((msg) => msg.type === 'permit')).toBe(true);
  });

  it('keeps its memory from one call to the next', () => {
    const centre = makeCentre(timetable);
    expect(permitFor(centre.step(0, [train(1, 'A', 3000)], clear, none), 1).nextTrack).toBe('P1');
    // Train 4 also defaults to P1. The centre remembers P1 is taken and sends it to P2.
    const both = [train(1, 'A', 3100), train(4, 'A', 100)];
    const second = centre.step(1, both, clear, none);
    expect(permitFor(second, 1).nextTrack).toBe('P1');
    expect(permitFor(second, 4).nextTrack).toBe('P2');
  });

  it('sends a train that is not yet in trains no permit until it enters', () => {
    const centre = makeCentre(timetable);
    const first = centre.step(0, [train(1, 'A', 3000)], clear, none);
    expect(first.map((msg) => (msg as Permit).to)).toEqual([1]);
    const second = centre.step(1, [train(1, 'A', 3020), train(2, 'A', 0)], clear, none);
    expect(second.map((msg) => (msg as Permit).to).sort()).toEqual([1, 2]);
  });
});

describe('updateMemory', () => {
  it('adds a plan for a train it sees for the first time', () => {
    const memory = seen([train(1, 'A', 1234)], 5);
    expect(memory.plans.get(1)).toEqual({
      id: 1,
      untilX: 1234,
      nextTrack: null,
      stoppedAt: null,
      heldForRestart: false,
    });
  });

  it('records stoppedAt when a train stops with its front at offset 300 in its platform', () => {
    expect(seen([stopped(1, 'P1', PLATFORM_STOP - 0.01)], 40).plans.get(1)?.stoppedAt).toBe(40);
    expect(seen([train(1, 'P1', PLATFORM_STOP - 0.01, 2)], 40).plans.get(1)?.stoppedAt).toBeNull();
    expect(seen([stopped(1, 'P1', 100)], 40).plans.get(1)?.stoppedAt).toBeNull();
    // It keeps the first time, so the dwell is counted once.
    const first = seen([stopped(1, 'P1', PLATFORM_STOP)], 40);
    expect(seen([stopped(1, 'P1', PLATFORM_STOP)], 41, first).plans.get(1)?.stoppedAt).toBe(40);
  });

  it('frees a platform once the train sent to it has left it', () => {
    const inPlatform = seen([train(1, 'P1', 350)]);
    expect(inPlatform.platformFor.get(1)).toBe('P1');
    const rearStillIn = seen([train(1, 'EXIT', TRAIN_LENGTH - 1)], 1, inPlatform);
    expect(rearStillIn.platformFor.get(1)).toBe('P1');
    const clearOfIt = seen([train(1, 'EXIT', TRAIN_LENGTH)], 2, rearStillIn);
    expect(clearOfIt.platformFor.has(1)).toBe(false);
  });

  it('adds a train to junctionOrder once its dwell is over', () => {
    const atStop = [stopped(1, 'P1', PLATFORM_STOP)];
    const arrived = seen(atStop, 100);
    expect(arrived.junctionOrder).toEqual([]);
    expect(seen(atStop, 129, arrived).junctionOrder).toEqual([]);
    expect(seen(atStop, 130, arrived).junctionOrder).toEqual([1]);
  });

  it('clears junctionHolder once the junction zone is empty again', () => {
    const holding = { ...seen([train(1, 'P1', 350)]), junctionHolder: 1 };
    const rearInZone = seen([train(1, 'EXIT', 299)], 1, holding);
    expect(rearInZone.junctionHolder).toBe(1);
    expect(seen([train(1, 'EXIT', 300)], 2, rearInZone).junctionHolder).toBeNull();
  });

  it('frees the junction when its holder breaks down before entering the zone', () => {
    const holding = { ...seen([stopped(1, 'P1', PLATFORM_STOP - 0.01)]), junctionHolder: 1 };
    expect(seen([broken(1, 'P1', PLATFORM_STOP - 0.01)], 1, holding).junctionHolder).toBeNull();
    expect(seen([broken(1, 'P1', 350)], 1, holding).junctionHolder).toBe(1);
  });

  it('forgets a train that has left the right-hand end of EXIT', () => {
    const before = { ...seen([train(1, 'EXIT', 5990), train(2, 'P2', 100)]), junctionHolder: 1 };
    const after = seen([train(2, 'P2', 120)], 1, before);
    expect(after.plans.has(1)).toBe(false);
    expect(after.platformFor.has(1)).toBe(false);
    expect(after.plans.has(2)).toBe(true);
  });

  it('sets lastStepAt to now on every step', () => {
    const first = seen([], 3);
    expect(first.lastStepAt).toBe(3);
    expect(seen([], 4, first).lastStepAt).toBe(4);
  });

  it('catches up after a gap of more than a second, since the engine skips step while the centre is off', () => {
    const before = sentTo(seen([train(1, 'A', 5000)], 10), { 1: 'P1' });
    const after = seen([stopped(1, 'P1', PLATFORM_STOP)], 100, before);
    expect(after.platformFor.get(1)).toBe('P1');
    expect(after.plans.get(1)?.stoppedAt).toBe(100);
    expect(after.lastStepAt).toBe(100);
  });

  it('frees the junction for a train that cleared the zone while the centre was off', () => {
    const before = { ...seen([train(1, 'P1', 350)], 10), junctionHolder: 1 };
    expect(seen([train(1, 'EXIT', 2000)], 100, before).junctionHolder).toBeNull();
    expect(seen([], 100, before).junctionHolder).toBeNull();
  });
});

describe('slow restart', () => {
  const slow: CentreOptions = { restartGap: 30 };
  const waiting = [stopped(1, 'A', 3000), stopped(2, 'A', 1000), stopped(3, 'B', 2000)];
  const held = (memory: CentreMemory) =>
    [...memory.plans.values()].filter((p) => p.heldForRestart).map((p) => p.id);

  it('treats a gap of more than 1.5 seconds since lastStepAt as a restart, so rounding in a 1 second step does not', () => {
    const first = seen(waiting, 10);
    expect(held(seen(waiting, 11.0000001, first))).toEqual([]);
    expect(held(seen(waiting, 11.5, first))).toEqual([]);
    expect(held(seen(waiting, 12, first))).toEqual([1, 2, 3]);
  });

  it('reads the gap from RESTART_GAP when no option is given, so a parameter file can turn it on', () => {
    setConstants({ RESTART_GAP: 30 });
    try {
      const centre = makeCentre(timetable);
      centre.step(0, waiting, clear, none);
      const back = centre.step(100, waiting, clear, none);
      const released = waiting.filter((t) => permitFor(back, t.id).untilX > xOf(t.pos));
      expect(released.map((t) => t.id)).toEqual([1]);
    } finally {
      resetConstants();
    }
  });

  it('is off by default: every train is released at once', () => {
    const centre = makeCentre(timetable);
    centre.step(0, waiting, clear, none);
    const back = centre.step(100, waiting, clear, none);
    expect(waiting.every((t) => permitFor(back, t.id).untilX > xOf(t.pos))).toBe(true);
  });

  it('does not treat the first step as a restart', () => {
    expect(held(seen(waiting, 500))).toEqual([]);
  });

  it('after a gap, marks every stopped train heldForRestart', () => {
    const trains = [stopped(1, 'A', 3000), train(2, 'A', 1000), broken(3, 'B', 2000)];
    // A moving train is not held. A broken-down train is held where it is anyway.
    expect(held(seen(trains, 100, seen(trains, 10)))).toEqual([1]);
  });

  it('after a gap, releases one held train every restartGap seconds', () => {
    const centre = makeCentre(timetable, slow);
    centre.step(0, waiting, clear, none);
    const moving = (now: number) =>
      centre
        .step(now, waiting, clear, none)
        .filter((msg) => (msg as Permit).untilX > xOf(waiting.find((t) => t.id === (msg as Permit).to)!.pos))
        .map((msg) => (msg as Permit).to)
        .sort();
    const at: Record<number, number[]> = {};
    for (let now = 100; now <= 160; now++) at[now] = moving(now);
    expect(at[100]).toEqual([1]);
    expect(at[129]).toEqual([1]);
    expect(at[130]).toEqual([1, 3]);
    expect(at[159]).toEqual([1, 3]);
    expect(at[160]).toEqual([1, 2, 3]);
  });

  it('releases the held train furthest along the x axis first, so no release waits behind a held train (the design does not say)', () => {
    const memory = seen(waiting, 100, seen(waiting, 10));
    expect(nextRestartRelease(memory, waiting, 100, slow)).toBe(1);
    const afterFirst = releaseHeld(memory, waiting, 100, slow);
    expect(nextRestartRelease(afterFirst, waiting, 130, slow)).toBe(3);
    expect(nextRestartRelease(afterFirst, waiting, 120, slow)).toBeNull();
  });

  it("keeps untilX at a held train's own x until its turn", () => {
    const memory = releaseHeld(seen(waiting, 100, seen(waiting, 10)), waiting, 100, slow);
    expect(untilXFor(waiting[0], waiting, memory, clear)).toBeGreaterThan(3000);
    expect(untilXFor(waiting[1], waiting, memory, clear)).toBe(1000);
    expect(untilXFor(waiting[2], waiting, memory, clear)).toBe(2000);
  });

  it('records lastReleaseAt each time it releases a train', () => {
    const memory = seen(waiting, 100, seen(waiting, 10));
    const first = releaseHeld(memory, waiting, 100, slow);
    expect(first.lastReleaseAt).toBe(100);
    expect(releaseHeld(first, waiting, 110, slow).lastReleaseAt).toBe(100);
    expect(releaseHeld(first, waiting, 130, slow).lastReleaseAt).toBe(130);
  });

  it('resumes every train at once when restartGap is 0 or absent', () => {
    for (const options of [{}, { restartGap: 0 }] as CentreOptions[]) {
      const centre = makeCentre(timetable, options);
      centre.step(0, waiting, clear, none);
      for (const msg of centre.step(100, waiting, clear, none)) {
        const permit = msg as Permit;
        expect(permit.untilX).toBeGreaterThan(xOf(waiting.find((t) => t.id === permit.to)!.pos));
      }
    }
  });
});

describe('entry (the engine lets a train in at SIGHT_SPEED only when the first 400 m is clear)', () => {
  const pair: TimetableEntry[] = [
    { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
    { id: 2, entry: 'A', enterAt: 0, platform: 'P2', leader: 1, dwell: 30 },
  ];
  const engineFor = (presses: Press[]) =>
    new Engine({ timetable: pair, program: baselineProgram, seed: 1, runLength: 400, presses });
  const frontX = (engine: Engine, id: number) => engine.snapshot().trains.find((t) => t.id === id)!.x;

  it('two trains that enter on one entry track during an outage do not collide', () => {
    // The centre goes off before train 2 enters, so train 2 never gets a permit.
    const engine = engineFor([{ at: 15, set: { centre: false } }]);
    while (engine.now < 120) engine.step();
    const trains = engine.snapshot().trains;
    expect(trains.map((t) => t.id)).toEqual([1, 2]);
    expect(trains.every((t) => t.speed === 0)).toBe(true);
    expect(engine.result().collisions).toBe(0);
    expect(frontX(engine, 1) - TRAIN_LENGTH - frontX(engine, 2)).toBeGreaterThanOrEqual(MARGIN);
  });

  it('a train that enters behind a train stopped near x 1000 does not hit it', () => {
    const engine = engineFor([]);
    while (engine.snapshot().trains.length === 0 || frontX(engine, 1) < 1000) engine.step();
    engine.breakDown(1);
    while (engine.now < 300) engine.step();
    const two = engine.snapshot().trains.find((t) => t.id === 2)!;
    expect(two.speed).toBe(0);
    expect(engine.result().collisions).toBe(0);
    expect(frontX(engine, 1) - TRAIN_LENGTH - frontX(engine, 2)).toBeGreaterThanOrEqual(MARGIN);
  });
});

describe('isAvailable', () => {
  const memory = initialMemory(timetable);

  it('says a platform is available when its sensor reads empty and no train is sent to it', () => {
    for (const platform of ['P1', 'P2', 'P3', 'P4'] as const) {
      expect(isAvailable(platform, memory, clear)).toBe(true);
    }
  });

  it('says a platform is unavailable when its sensor reads occupied', () => {
    expect(isAvailable('P1', memory, occupied('P1'))).toBe(false);
    expect(isAvailable('P2', memory, occupied('P1'))).toBe(true);
  });

  it('says a platform is available again once it reads empty', () => {
    expect(isAvailable('P3', memory, occupied('P3'))).toBe(false);
    expect(isAvailable('P3', memory, clear)).toBe(true);
  });

  it('says a platform another train is sent to is unavailable', () => {
    const taken = sentTo(memory, { 1: 'P1' });
    expect(isAvailable('P1', taken, clear)).toBe(false);
    expect(isAvailable('P2', taken, clear)).toBe(true);
  });

  it('says the junction is unavailable while junctionOccupied is true', () => {
    expect(isAvailable('JUNCTION', memory, { ...clear, junctionOccupied: true })).toBe(false);
  });

  it('says the junction is unavailable while exitStartClear is false (borrowed from the junction keeper in "Leaving the station")', () => {
    expect(isAvailable('JUNCTION', memory, { ...clear, exitStartClear: false })).toBe(false);
  });

  it('says the junction is unavailable while another train holds it', () => {
    expect(isAvailable('JUNCTION', { ...memory, junctionHolder: 1 }, clear)).toBe(false);
  });

  it('says the junction is available when the zone is clear and no train holds it', () => {
    expect(isAvailable('JUNCTION', memory, clear)).toBe(true);
    const pieces: ResourceId[] = ['JUNCTION', 'P1'];
    expect(pieces.every((piece) => isAvailable(piece, memory, clear))).toBe(true);
  });
});

describe('choosePlatform', () => {
  const memory = initialMemory(timetable);

  it('picks a platform the entry track feeds: P1 or P2 from A, P3 or P4 from B', () => {
    for (const sensors of [clear, occupied('P1', 'P3')]) {
      expect(['P1', 'P2']).toContain(choosePlatform(train(1, 'A', 0), timetable[0], memory, sensors));
      expect(['P3', 'P4']).toContain(choosePlatform(train(3, 'B', 0), timetable[2], memory, sensors));
    }
  });

  it('picks the default platform from the timetable when it is available (the design leaves the choice to the centre)', () => {
    expect(choosePlatform(train(1, 'A', 0), timetable[0], memory, clear)).toBe('P1');
    expect(choosePlatform(train(2, 'A', 0), timetable[1], memory, clear)).toBe('P2');
  });

  it('picks the other platform of the pair when the default is unavailable (the design leaves the choice to the centre)', () => {
    expect(choosePlatform(train(2, 'A', 0), timetable[1], memory, occupied('P2'))).toBe('P1');
    expect(choosePlatform(train(3, 'B', 0), timetable[2], sentTo(memory, { 9: 'P3' }), clear)).toBe('P4');
  });

  it('returns null when neither platform of the pair is available', () => {
    expect(choosePlatform(train(1, 'A', 0), timetable[0], memory, occupied('P1', 'P2'))).toBeNull();
  });

  it('keeps the platform it already chose for a train instead of switching it (borrowed from "Following permits")', () => {
    const chosen = sentTo(memory, { 1: 'P2' });
    expect(choosePlatform(train(1, 'A', 0), timetable[0], chosen, clear)).toBe('P2');
    expect(choosePlatform(train(1, 'A', 0), timetable[0], chosen, occupied('P2'))).toBe('P2');
  });

  it('never sends two trains to the same platform at once', () => {
    const centre = makeCentre(timetable);
    const trains = [train(1, 'A', 4000), train(2, 'A', 2000), train(4, 'A', 0)];
    const messages = centre.step(0, trains, clear, none);
    expect(permitFor(messages, 1).nextTrack).toBe('P1');
    expect(permitFor(messages, 2).nextTrack).toBe('P2');
    expect(permitFor(messages, 4).nextTrack).toBeNull();
  });
});

describe('isReadyToLeave', () => {
  const entry = timetable[0];
  const atStop = stopped(1, 'P1', PLATFORM_STOP);

  it('is false until the train has stopped in its platform', () => {
    expect(isReadyToLeave(train(1, 'P1', 200), entry, plan(1), 1000)).toBe(false);
    expect(isReadyToLeave(train(1, 'A', 5000), entry, plan(1), 1000)).toBe(false);
  });

  it('is false until dwell seconds have passed since stoppedAt', () => {
    expect(isReadyToLeave(atStop, entry, { ...plan(1), stoppedAt: 100 }, 100)).toBe(false);
    expect(isReadyToLeave(atStop, entry, { ...plan(1), stoppedAt: 100 }, 129)).toBe(false);
  });

  it('is true once dwell seconds have passed since stoppedAt', () => {
    expect(isReadyToLeave(atStop, entry, { ...plan(1), stoppedAt: 100 }, 130)).toBe(true);
    // The clock is a float, so a hair under the dwell still counts.
    expect(isReadyToLeave(atStop, entry, { ...plan(1), stoppedAt: 100 }, 129.99999999)).toBe(true);
  });

  it('is false while the train is broken down (the design does not say)', () => {
    const down = broken(1, 'P1', PLATFORM_STOP);
    expect(isReadyToLeave(down, entry, { ...plan(1), stoppedAt: 100 }, 1000)).toBe(false);
  });
});

describe('nextThroughJunction', () => {
  const waiting = [stopped(1, 'P1', PLATFORM_STOP), stopped(2, 'P2', PLATFORM_STOP), stopped(3, 'P3', PLATFORM_STOP)];
  // All three stopped at time 0 and their 30 second dwell is over by 100.
  const ready = { ...seen(waiting, 1, seen(waiting, 0)), junctionOrder: [1, 2, 3] };

  it('lets only one train into the junction zone at a time', () => {
    const centre = makeCentre(timetable);
    centre.step(0, waiting, clear, none);
    const leaving = (now: number, sensors: SensorReadings) =>
      centre.step(now, waiting, sensors, none).filter((msg) => (msg as Permit).nextTrack === 'EXIT');
    expect(leaving(100, clear).map((msg) => (msg as Permit).to)).toEqual([1]);
    expect(leaving(101, clear).map((msg) => (msg as Permit).to)).toEqual([1]);
  });

  it('returns null while another train holds the junction', () => {
    expect(nextThroughJunction({ ...ready, junctionHolder: 3 }, waiting, clear, 100)).toBeNull();
  });

  it('returns null while junctionOccupied is true', () => {
    expect(nextThroughJunction(ready, waiting, { ...clear, junctionOccupied: true }, 100)).toBeNull();
  });

  it('returns null while exitStartClear is false (borrowed from the junction keeper in "Leaving the station")', () => {
    expect(nextThroughJunction(ready, waiting, { ...clear, exitStartClear: false }, 100)).toBeNull();
  });

  it('picks only trains that are ready to leave', () => {
    const late = [stopped(1, 'P1', PLATFORM_STOP), train(2, 'P2', 100)];
    const memory = { ...seen(late, 1, seen([late[0]], 0)), junctionOrder: [2, 1] };
    expect(nextThroughJunction(memory, late, clear, 100)).toBe(1);
  });

  it('picks the train first in junctionOrder', () => {
    expect(nextThroughJunction({ ...ready, junctionOrder: [3, 1, 2] }, waiting, clear, 100)).toBe(3);
  });

  it('puts the lowest ID first in junctionOrder when two trains become ready in the same step (borrowed from the junction keeper in "Leaving the station")', () => {
    const reversed = [...waiting].reverse();
    expect(seen(reversed, 100, seen(reversed, 0)).junctionOrder).toEqual([1, 2, 3]);
    // A train that was already waiting stays ahead of one that becomes ready later.
    const three = seen([waiting[2]], 100, seen([waiting[2]], 0));
    expect(seen(waiting, 200, seen(waiting, 101, three)).junctionOrder).toEqual([3, 1, 2]);
  });

  it('returns null when no train is waiting', () => {
    expect(nextThroughJunction(seen([train(1, 'A', 100)]), [train(1, 'A', 100)], clear, 100)).toBeNull();
  });
});

describe('nextTrackFor', () => {
  it('gives a train on A or B the platform the centre chose for it', () => {
    const memory = sentTo(initialMemory(timetable), { 1: 'P2', 3: 'P3' });
    expect(nextTrackFor(train(1, 'A', 5000), memory)).toBe('P2');
    expect(nextTrackFor(train(3, 'B', 5000), memory)).toBe('P3');
  });

  it('gives null to a train on A or B with no platform yet', () => {
    expect(nextTrackFor(train(1, 'A', 5000), initialMemory(timetable))).toBeNull();
  });

  it('gives EXIT to a train in a platform only once it holds the junction', () => {
    const memory = { ...initialMemory(timetable), junctionHolder: 1 };
    expect(nextTrackFor(train(1, 'P1', 300), memory)).toBe('EXIT');
  });

  it('gives null to a train in a platform that does not hold the junction', () => {
    const memory = { ...initialMemory(timetable), junctionHolder: 2 };
    expect(nextTrackFor(train(1, 'P1', 300), memory)).toBeNull();
    expect(nextTrackFor(train(1, 'P1', 300), initialMemory(timetable))).toBeNull();
  });

  it('gives null to a train on EXIT', () => {
    expect(nextTrackFor(train(1, 'EXIT', 10), { ...initialMemory(timetable), junctionHolder: 1 })).toBeNull();
    expect(nextTrackFor(train(1, 'EXIT', 10), initialMemory(timetable))).toBeNull();
  });
});

describe('untilXFor', () => {
  it("keeps a train's front at least MARGIN behind the rear of the train ahead on its path", () => {
    const trains = [train(1, 'A', 3000), train(2, 'A', 2000)];
    expect(untilXFor(trains[1], trains, seen(trains), clear)).toBe(3000 - TRAIN_LENGTH - MARGIN);
    const exit = [train(1, 'EXIT', 1000), train(2, 'EXIT', 400)];
    expect(untilXFor(exit[1], exit, seen(exit), clear)).toBe(
      TRACK_START.EXIT + 1000 - TRAIN_LENGTH - MARGIN,
    );
    // A train on the other entry track is not on its path.
    const apart = [train(3, 'B', 3000), train(2, 'A', 2000)];
    expect(untilXFor(apart[1], apart, seen(apart), clear)).toBe(ENTRY_END_X);
  });

  it('uses the true position of the train ahead, however far it is', () => {
    const trains = [train(1, 'A', 5900), train(2, 'A', 10)];
    expect(untilXFor(trains[1], trains, seen(trains), clear)).toBe(5900 - TRAIN_LENGTH - MARGIN);
  });

  it('keeps a train behind a broken-down train ahead of it', () => {
    const trains = [broken(1, 'A', 3000), train(2, 'A', 2000)];
    const memory = sentTo(seen(trains), { 2: 'P2' });
    expect(untilXFor(trains[1], trains, memory, clear)).toBe(3000 - TRAIN_LENGTH - MARGIN);
  });

  it('keeps a train on A or B with no platform short of the end of its entry track, x 6000', () => {
    const t = train(1, 'A', 3000);
    expect(untilXFor(t, [t], seen([t]), clear)).toBe(ENTRY_END_X);
  });

  it('lets a train with a platform run to offset 300 in that platform, x 6300', () => {
    const t = train(1, 'A', 3000);
    expect(untilXFor(t, [t], sentTo(seen([t]), { 1: 'P1' }), clear)).toBe(STOP_X);
  });

  it('keeps a train short of a platform that is unavailable', () => {
    const t = train(1, 'A', 3000);
    const memory = sentTo(seen([t]), { 1: 'P1' });
    expect(untilXFor(t, [t], memory, occupied('P1'))).toBe(ENTRY_END_X);
  });

  it('holds a train in its platform at x 6300 until it holds the junction', () => {
    const t = stopped(1, 'P1', PLATFORM_STOP - 0.01);
    const memory = seen([t]);
    expect(untilXFor(t, [t], memory, clear)).toBe(STOP_X);
    expect(untilXFor(t, [t], { ...memory, junctionHolder: 1 }, clear)).toBe(freeRunX());
  });

  it('holds every train short of the junction zone while the junction is unavailable', () => {
    const waiting = [stopped(1, 'P1', PLATFORM_STOP), stopped(2, 'P2', PLATFORM_STOP), stopped(3, 'P3', PLATFORM_STOP)];
    const centre = makeCentre(timetable);
    centre.step(0, waiting, clear, none);
    for (const sensors of [{ ...clear, junctionOccupied: true }, { ...clear, exitStartClear: false }]) {
      for (const msg of centre.step(100, waiting, sensors, none)) {
        expect((msg as Permit).untilX).toBe(JUNCTION_START_X);
      }
    }
  });

  it('keeps two trains from being in the junction zone at the same time', () => {
    const waiting = [stopped(1, 'P1', PLATFORM_STOP), stopped(2, 'P2', PLATFORM_STOP)];
    const centre = makeCentre(timetable);
    centre.step(0, waiting, clear, none);
    const first = centre.step(100, waiting, clear, none);
    expect(permitFor(first, 1).untilX).toBe(freeRunX());
    expect(permitFor(first, 2).untilX).toBe(JUNCTION_START_X);
    // Train 1 is in the zone. Train 2 stays out until train 1's rear has cleared it.
    const inZone = [train(1, 'EXIT', 250), waiting[1]];
    const busy = { ...clear, junctionOccupied: true, exitStartClear: false };
    expect(permitFor(centre.step(101, inZone, busy, none), 2).untilX).toBe(JUNCTION_START_X);
    const through = [train(1, 'EXIT', 1000), waiting[1]];
    const second = permitFor(centre.step(102, through, clear, none), 2);
    expect(second.nextTrack).toBe('EXIT');
    expect(second.untilX).toBe(TRACK_START.EXIT + 1000 - TRAIN_LENGTH - MARGIN);
  });

  it('gives a train on EXIT with nothing ahead freeRunX(), far enough past the end of EXIT that it leaves at full speed', () => {
    const t = train(1, 'EXIT', 10);
    expect(untilXFor(t, [t], seen([t]), clear)).toBe(freeRunX());
    const braking = (MAX_SPEED * MAX_SPEED) / (2 * BRAKE);
    expect(freeRunX() - MAP_END_X).toBeGreaterThanOrEqual(braking);
  });

  it('holds a broken-down train where it is', () => {
    const t = broken(1, 'A', 1234);
    expect(untilXFor(t, [t], sentTo(seen([t]), { 1: 'P1' }), clear)).toBe(1234);
    expect(untilXFor(t, [t], seen([t]), clear)).toBe(1234);
  });

  it('keeps a follower bound for P2 MARGIN behind the rear of a train whose front is in P1 and rear is still on A', () => {
    const trains = [train(1, 'P1', 60), train(2, 'A', 5500)];
    const memory = sentTo(seen(trains), { 2: 'P2' });
    expect(untilXFor(trains[1], trains, memory, clear)).toBe(
      TRACK_START.P1 + 60 - TRAIN_LENGTH - MARGIN,
    );
    // Once the rear of train 1 is in P1, the way into P2 is clear.
    const inside = [train(1, 'P1', 150), train(2, 'A', 5500)];
    expect(untilXFor(inside[1], inside, sentTo(seen(inside), { 2: 'P2' }), clear)).toBe(STOP_X);
  });

  it('lets a train already in its platform or holding the junction run on when that track reads occupied', () => {
    const entering = train(1, 'P1', 50);
    expect(untilXFor(entering, [entering], promised(seen([entering]), 1, STOP_X), occupied('P1'))).toBe(STOP_X);
    const leaving = train(1, 'P1', 350);
    const holding = { ...promised(seen([leaving]), 1, freeRunX()), junctionHolder: 1 };
    const busy = { ...clear, junctionOccupied: true };
    expect(untilXFor(leaving, [leaving], holding, busy)).toBe(freeRunX());
  });

  it('never moves untilX closer than a running train can stop, when a platform or the junction becomes unavailable (the design does not say)', () => {
    // At 45 m/s and 1000 m out the train cannot stop before x 6000, so it keeps x 6300.
    const close = train(1, 'A', 5000, MAX_SPEED);
    const closeMemory = promised(sentTo(seen([close]), { 1: 'P1' }), 1, STOP_X);
    expect(reachOf(close)).toBeGreaterThan(ENTRY_END_X);
    expect(untilXFor(close, [close], closeMemory, occupied('P1'))).toBe(STOP_X);
    // Further back it can still stop, so the centre holds it at the end of its entry track.
    const far = train(1, 'A', 3000, MAX_SPEED);
    const farMemory = promised(sentTo(seen([far]), { 1: 'P1' }), 1, STOP_X);
    expect(untilXFor(far, [far], farMemory, occupied('P1'))).toBe(ENTRY_END_X);
    // Whatever the reason, untilX never drops below what was promised and is in reach.
    const fast = train(2, 'A', 2000, MAX_SPEED);
    const trains = [stopped(1, 'A', 2300), fast];
    const memory = promised(seen(trains), 2, 5000);
    expect(untilXFor(fast, trains, memory, clear)).toBe(reachOf(fast));
  });
});

describe('taking over from routes our trains set (design: "The centre comes first")', () => {
  const t = train(1, 'A', 5000);

  it('sends a train on A or B to the platform of its own pair its route is set into', () => {
    expect(seen([t], 0, initialMemory(timetable), routes({ 1: 'P2' })).platformFor.get(1)).toBe('P2');
  });

  it("adopts the route even over the centre's own earlier choice", () => {
    const chose = sentTo(seen([t]), { 1: 'P1' });
    expect(seen([t], 1, chose, routes({ 1: 'P2' })).platformFor.get(1)).toBe('P2');
    // With no route set, the earlier choice stands.
    expect(seen([t], 1, chose, routes({ 1: null })).platformFor.get(1)).toBe('P1');
  });

  it("ignores a route into the other pair's platform", () => {
    expect(seen([t], 0, initialMemory(timetable), routes({ 1: 'P3' })).platformFor.has(1)).toBe(false);
    const chose = sentTo(seen([t]), { 1: 'P1' });
    expect(seen([t], 1, chose, routes({ 1: 'P4' })).platformFor.get(1)).toBe('P1');
  });

  it('does not adopt a route once the train is past its entry track', () => {
    const inP1 = train(1, 'P1', 50);
    expect(seen([inP1], 0, initialMemory(timetable), routes({ 1: 'P2' })).platformFor.get(1)).toBe('P1');
    // Rear still in P1, front on EXIT.
    const leaving = train(1, 'EXIT', 50);
    const before = sentTo(seen([leaving]), { 1: 'P1' });
    expect(seen([leaving], 1, before, routes({ 1: 'P2' })).platformFor.get(1)).toBe('P1');
  });

  it('puts the adopted platform in the permit and sends no other train to it', () => {
    // Train 2 defaults to P2, so it goes to P1 once train 1 has taken P2.
    const trains = [t, train(2, 'A', 1000)];
    const messages = makeCentre(timetable).step(0, trains, clear, routes({ 1: 'P2' }));
    expect(permitFor(messages, 1)).toMatchObject({ nextTrack: 'P2', untilX: STOP_X });
    expect(permitFor(messages, 2).nextTrack).toBe('P1');
  });

  // "Platform keeper switched off": with the platform sensors off too, a train of ours standing
  // at the end of its entry track sets its route into each platform of its pair in turn, to
  // look into it. While both hold a train it goes on looking, one tick each. The centre comes
  // back on one of those ticks. Train 2 has broken down in P2 and never leaves it.
  describe('a route that is only a look into a platform another train is on', () => {
    const waiting = stopped(4, 'A', TRACK_LENGTH.A - 0.01);
    const stuck = broken(2, 'P2', PLATFORM_STOP);
    const lookingIntoP2 = routes({ 4: 'P2' });

    it('does not send a train stopped at the end of its entry track there', () => {
      const memory = updateMemory(initialMemory(timetable), 0, [stuck, waiting], occupied('P2'), lookingIntoP2);
      expect(memory.platformFor.has(4)).toBe(false);
    });

    it('gives the train no platform while both of its pair hold a train, and the other one as soon as it is empty', () => {
      const centre = makeCentre(timetable);
      const inP1 = stopped(1, 'P1', PLATFORM_STOP);
      const held = permitFor(centre.step(0, [inP1, stuck, waiting], occupied('P1', 'P2'), lookingIntoP2), 4);
      expect(held).toMatchObject({ nextTrack: null, untilX: ENTRY_END_X });
      // Train 1 has gone and P1 reads empty. The route still looks into P2, and the train is
      // sent to P1 all the same.
      const freed = permitFor(centre.step(1, [stuck, waiting], occupied('P2'), lookingIntoP2), 4);
      expect(freed).toMatchObject({ nextTrack: 'P1', untilX: STOP_X });
    });

    it('never gives the train the platform it looked into, however long the train there stays', () => {
      const centre = makeCentre(timetable);
      for (let now = 0; now < 30; now += 1) {
        const permit = permitFor(centre.step(now, [stuck, waiting], occupied('P1', 'P2'), lookingIntoP2), 4);
        expect(permit).toMatchObject({ nextTrack: null, untilX: ENTRY_END_X });
      }
    });

    it("leaves the centre's own earlier choice of the other platform standing", () => {
      const chose = sentTo(seen([waiting]), { 4: 'P1' });
      const memory = updateMemory(chose, 1, [stuck, waiting], occupied('P2'), lookingIntoP2);
      expect(memory.platformFor.get(4)).toBe('P1');
    });

    it('still takes over a route into an empty platform from a stopped train', () => {
      // The fixed split and the end of a creep both set off from a stand at the end of the track.
      const memory = updateMemory(initialMemory(timetable), 0, [stuck, waiting], occupied('P2'), routes({ 4: 'P1' }));
      expect(memory.platformFor.get(4)).toBe('P1');
    });

    it('still takes over a route into a platform another train is on from a train that can no longer stop', () => {
      // Train 2 is leaving P2 with its rear still in it. Train 4 has set off into P2 and cannot
      // stop before the end of A, so the centre must not point it anywhere else.
      const leaving = train(2, 'EXIT', 50);
      const running = train(4, 'A', TRACK_LENGTH.A - 5, 5);
      expect(reachOf(running)).toBeGreaterThan(ENTRY_END_X);
      const memory = updateMemory(initialMemory(timetable), 0, [leaving, running], occupied('P2'), lookingIntoP2);
      expect(memory.platformFor.get(4)).toBe('P2');
      expect(nextTrackFor(running, memory)).toBe('P2');
    });

    it('keeps a route the centre chose itself, which the train sets because its permits name it', () => {
      // The platform reads empty, as it does for as long as the centre stays on: no other train
      // is sent to a platform the centre has chosen for one.
      const far = stopped(4, 'A', 3000);
      const chose = sentTo(seen([far]), { 4: 'P2' });
      const memory = updateMemory(chose, 1, [far], clear, lookingIntoP2);
      expect(memory.platformFor.get(4)).toBe('P2');
    });

    it('sends the train to the other platform when the one it looked into holds only the tail of a train that is leaving', () => {
      // The end of a creep: train 4 sees no train in P1, because train 1's rear is in the last
      // 100 m, out of its sight. The centre's first step lands on that tick, with train 4 still
      // stopped. P2 is empty, so the centre sends it there and does not hold it for P1.
      const leaving = train(1, 'EXIT', 50);
      const permit = permitFor(makeCentre(timetable).step(0, [leaving, waiting], occupied('P1'), routes({ 4: 'P1' })), 4);
      expect(permit).toMatchObject({ nextTrack: 'P2', untilX: STOP_X });
    });
  });

  // The centre chose a platform for a train and was then switched off. A train of ours ahead
  // took that platform on its own rules, and the centre comes back to a choice that is out of
  // date. If it kept the choice, it would hold the train for a platform that may never empty.
  describe('an earlier choice of a platform another train has taken since', () => {
    const waiting = stopped(4, 'A', TRACK_LENGTH.A - 0.01);
    const stuck = broken(2, 'P1', PLATFORM_STOP);

    it('lets go of the choice for a train that can still stop', () => {
      const chose = sentTo(seen([waiting]), { 4: 'P1' });
      const memory = updateMemory(chose, 1, [stuck, waiting], occupied('P1'), none);
      expect(memory.platformFor.has(4)).toBe(false);
    });

    it('lets go of it whether the route names it, names the other platform or names none', () => {
      // The other platform holds a train too, so a route into either is only a look. A look
      // into P2, whose train will leave, must not leave the train held for P1.
      const chose = sentTo(seen([waiting]), { 4: 'P1' });
      const inP2 = stopped(1, 'P2', PLATFORM_STOP);
      for (const route of ['P1', 'P2', null] as const) {
        const memory = updateMemory(chose, 1, [inP2, stuck, waiting], occupied('P1', 'P2'), routes({ 4: route }));
        expect(memory.platformFor.has(4)).toBe(false);
      }
    });

    it('sends the train to the other platform of its pair when the centre comes back', () => {
      const centre = makeCentre(timetable);
      // The centre chooses P2 for train 2 and P1 for train 4, the default of each.
      const before = centre.step(0, [stopped(2, 'A', 5000), stopped(4, 'A', 4800)], clear, none);
      expect(permitFor(before, 2).nextTrack).toBe('P2');
      expect(permitFor(before, 4).nextTrack).toBe('P1');
      // While it is off, train 2 takes P1 on the fixed split and breaks down there.
      const back = centre.step(100, [stuck, waiting], occupied('P1'), none);
      expect(permitFor(back, 4)).toMatchObject({ nextTrack: 'P2', untilX: STOP_X });
    });

    it('keeps the choice for a train that can no longer stop before the end of its entry track', () => {
      const running = train(4, 'A', TRACK_LENGTH.A - 5, 5);
      expect(reachOf(running)).toBeGreaterThan(ENTRY_END_X);
      const chose = sentTo(seen([running]), { 4: 'P1' });
      const memory = updateMemory(chose, 1, [stuck, running], occupied('P1'), none);
      expect(memory.platformFor.get(4)).toBe('P1');
    });

    it('keeps the choice while the platform reads empty', () => {
      const chose = sentTo(seen([waiting]), { 4: 'P1' });
      const memory = updateMemory(chose, 1, [broken(2, 'P2', PLATFORM_STOP), waiting], occupied('P2'), none);
      expect(memory.platformFor.get(4)).toBe('P1');
    });
  });

  // Trains on one entry track cannot pass each other. When the front train lets go of its
  // platform, a train behind it must not go on holding the only free one of the pair.
  describe('dealing an entry track\'s platforms again, front train first', () => {
    // Three trains in a row on A, and one on B.
    const line: TimetableEntry[] = [
      { id: 1, entry: 'A', enterAt: 0, platform: 'P2', leader: null, dwell: 30 },
      { id: 2, entry: 'A', enterAt: 60, platform: 'P1', leader: 1, dwell: 30 },
      { id: 3, entry: 'A', enterAt: 120, platform: 'P2', leader: 2, dwell: 30 },
      { id: 4, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
    ];
    const stuck = broken(1, 'P1', PLATFORM_STOP);
    const front = stopped(2, 'A', TRACK_LENGTH.A - 0.01);
    const behind = stopped(3, 'A', TRACK_LENGTH.A - 150);
    const sent = (trains: TrainState[], to: Record<number, PlatformId>) => sentTo(seen(trains, 0, initialMemory(line)), to);

    it('takes the platform of a train behind one that has none, when both can still stop', () => {
      const memory = updateMemory(sent([front, behind], { 2: 'P1', 3: 'P2' }), 1, [stuck, front, behind], occupied('P1'), none);
      expect([...memory.platformFor]).toEqual([[1, 'P1']]);
    });

    it('gives the free platform to the front train and none to the train behind it', () => {
      const centre = makeCentre(line);
      // The centre chooses P2 for train 1 and P1 for train 2, the default of each.
      const before = centre.step(0, [stopped(1, 'A', 5000), stopped(2, 'A', 4800)], clear, none);
      expect(permitFor(before, 1).nextTrack).toBe('P2');
      expect(permitFor(before, 2).nextTrack).toBe('P1');
      // While it is off, train 1 takes P1 on the fixed split and breaks down there. The centre
      // comes back as train 2 rolls up to the end of A. By the centre's measure train 2 cannot
      // stop there, so its choice of P1 stands for now, and the free P2 goes to train 3.
      const rolling = train(2, 'A', TRACK_LENGTH.A - 5, 5);
      expect(reachOf(rolling)).toBeGreaterThan(ENTRY_END_X);
      const first = centre.step(100, [stuck, rolling, behind], occupied('P1'), none);
      expect(permitFor(first, 2)).toMatchObject({ nextTrack: 'P1', untilX: ENTRY_END_X });
      expect(permitFor(first, 3).nextTrack).toBe('P2');
      // Train 2 has stopped. It lets P1 go, and train 3 gives P2 up to it.
      const second = centre.step(101, [stuck, front, behind], occupied('P1'), routes({ 2: 'P1', 3: 'P2' }));
      expect(permitFor(second, 2)).toMatchObject({ nextTrack: 'P2', untilX: STOP_X });
      expect(permitFor(second, 3)).toMatchObject({ nextTrack: null, untilX: xOf(behind.pos) });
    });

    it('leaves a train behind its platform when the train in front has one', () => {
      const memory = updateMemory(sent([front, behind], { 2: 'P2', 3: 'P1' }), 1, [front, behind], clear, none);
      expect([...memory.platformFor]).toEqual([[2, 'P2'], [3, 'P1']]);
    });

    it('leaves a train on another entry track its platform', () => {
      const onB = stopped(4, 'B', TRACK_LENGTH.B - 150);
      const memory = updateMemory(sent([front, onB], { 2: 'P1', 4: 'P3' }), 1, [stuck, front, onB], occupied('P1'), none);
      expect([...memory.platformFor]).toEqual([[1, 'P1'], [4, 'P3']]);
    });

    it('leaves a train that can no longer stop its platform, though a train in front has none', () => {
      // This cannot happen on a safe railway, since the train behind would run into the one in
      // front. The centre still never takes a platform from a train that cannot stop.
      const running = train(3, 'A', TRACK_LENGTH.A - 5, 5);
      const ahead = stopped(2, 'A', TRACK_LENGTH.A - 1);
      const memory = updateMemory(sent([ahead, running], { 3: 'P2' }), 1, [ahead, running], clear, none);
      expect([...memory.platformFor]).toEqual([[3, 'P2']]);
    });
  });
});

describe('taking over a train already in the junction zone (design: "The centre comes first")', () => {
  it('makes a train past its platform stop, or on EXIT with its rear in the zone, the holder when there is none', () => {
    expect(seen([train(1, 'P1', PLATFORM_STOP + 50)]).junctionHolder).toBe(1);
    expect(seen([train(1, 'EXIT', 150)]).junctionHolder).toBe(1);
  });

  it('does not make a train the holder once it is clear of the zone, or still at its platform stop', () => {
    const clearOffset = JUNCTION_END_X - TRACK_START.EXIT + TRAIN_LENGTH;
    expect(seen([train(1, 'EXIT', clearOffset)]).junctionHolder).toBeNull();
    expect(seen([stopped(1, 'P1', PLATFORM_STOP)]).junctionHolder).toBeNull();
  });

  it('does not let another ready train into the junction until the adopted holder has cleared it', () => {
    const centre = makeCentre(timetable);
    const waiting = stopped(2, 'P2', PLATFORM_STOP);
    centre.step(0, [train(1, 'EXIT', 100), waiting], clear, none);
    // Train 2's dwell is over and the sensors read clear, so only the holder keeps it back.
    const blocked = permitFor(centre.step(100, [train(1, 'EXIT', 150), waiting], clear, none), 2);
    expect(blocked).toMatchObject({ nextTrack: null, untilX: JUNCTION_START_X });
    const freed = permitFor(centre.step(101, [train(1, 'EXIT', 1000), waiting], clear, none), 2);
    expect(freed.nextTrack).toBe('EXIT');
  });
});

describe('taking over a train that is setting off into the junction zone (design: "The centre comes first")', () => {
  const leaving = routes({ 1: 'EXIT' });

  it('makes a moving train with its route set to EXIT the holder, though its front is short of the zone', () => {
    expect(seen([train(1, 'P1', PLATFORM_STOP - 10, 5)], 0, undefined, leaving).junctionHolder).toBe(1);
  });

  it('does not take over a train that is arriving, which has no route out of its platform', () => {
    expect(seen([train(1, 'P1', PLATFORM_STOP - 10, 5)]).junctionHolder).toBeNull();
    expect(seen([train(1, 'P1', PLATFORM_STOP - 10, 5)], 0, undefined, routes({ 1: null })).junctionHolder).toBeNull();
  });

  it('does not take over a train that stands still with its route at EXIT, which is only looking', () => {
    expect(seen([stopped(1, 'P1', PLATFORM_STOP - 0.01)], 0, undefined, leaving).junctionHolder).toBeNull();
  });

  it('does not take over a broken-down train that is still rolling short of the zone', () => {
    const rolling = { ...train(1, 'P1', PLATFORM_STOP - 10, 5), brokenDown: true };
    expect(seen([rolling], 0, undefined, leaving).junctionHolder).toBeNull();
  });

  it('prefers a train already in the zone, then the train that would stop furthest along', () => {
    const inZone = train(3, 'P3', PLATFORM_STOP + 5, 1);
    const fast = train(2, 'P2', PLATFORM_STOP - 20, 6);
    const slow = train(1, 'P1', PLATFORM_STOP - 20, 2);
    const all = routes({ 1: 'EXIT', 2: 'EXIT', 3: 'EXIT' });
    expect(seen([slow, fast, inZone], 0, undefined, all).junctionHolder).toBe(3);
    expect(seen([slow, fast], 0, undefined, all).junctionHolder).toBe(2);
  });

  it('gives the junction to no other train, and lets the train it took over run out', () => {
    const centre = makeCentre(timetable);
    const waiting = stopped(2, 'P2', PLATFORM_STOP);
    centre.step(0, [waiting], clear, none);
    // Train 2's dwell is over. Train 1 set off on its own rules while the centre was off.
    const permits = centre.step(100, [train(1, 'P1', PLATFORM_STOP - 10, 5), waiting], clear, leaving);
    expect(permitFor(permits, 1)).toMatchObject({ nextTrack: 'EXIT', untilX: freeRunX() });
    expect(permitFor(permits, 2)).toMatchObject({ nextTrack: null, untilX: JUNCTION_START_X });
  });

  it('keeps its own holder that has set off, whatever another train does', () => {
    const holding = { ...seen([train(1, 'P1', PLATFORM_STOP - 5, 2)]), junctionHolder: 1 };
    const both = [train(1, 'P1', PLATFORM_STOP - 3, 3), train(2, 'P2', PLATFORM_STOP - 10, 5)];
    expect(seen(both, 1, holding, routes({ 1: 'EXIT', 2: 'EXIT' })).junctionHolder).toBe(1);
  });

  it('passes the turn from a holder that has not set off to a train that has the zone', () => {
    const holding = { ...seen([stopped(1, 'P1', PLATFORM_STOP - 0.01)]), junctionHolder: 1 };
    const settingOff = [stopped(1, 'P1', PLATFORM_STOP - 0.01), train(2, 'P2', PLATFORM_STOP - 10, 5)];
    expect(seen(settingOff, 1, holding, routes({ 1: 'EXIT', 2: 'EXIT' })).junctionHolder).toBe(2);
    const inZone = [stopped(1, 'P1', PLATFORM_STOP - 0.01), stopped(2, 'P2', PLATFORM_STOP + 0.3)];
    expect(seen(inZone, 1, holding).junctionHolder).toBe(2);
  });

  it('keeps a holder that has not set off while no other train has the zone', () => {
    const holding = { ...seen([stopped(1, 'P1', PLATFORM_STOP - 0.01)]), junctionHolder: 1 };
    const others = [stopped(1, 'P1', PLATFORM_STOP - 0.01), stopped(2, 'P2', PLATFORM_STOP - 0.01), train(4, 'P4', 100, 15)];
    expect(seen(others, 1, holding, routes({ 1: 'EXIT', 2: 'EXIT' })).junctionHolder).toBe(1);
  });
});

describe('leader in the permit (design: "The centre comes first")', () => {
  it('is null when nothing is ahead on the path', () => {
    const t = train(1, 'A', 3000);
    expect(trainAhead(t, [t], seen([t]))).toBeNull();
    expect(permitFor(makeCentre(timetable).step(0, [t], clear, none), 1).leader).toBeNull();
  });

  it('names the nearest train ahead when two are ahead', () => {
    const trains = [train(1, 'A', 4000), train(2, 'A', 3000), train(4, 'A', 1000)];
    expect(trainAhead(trains[2], trains, seen(trains))?.id).toBe(2);
    const messages = makeCentre(timetable).step(0, trains, clear, none);
    expect(permitFor(messages, 4).leader).toBe(2);
    expect(permitFor(messages, 2).leader).toBe(1);
    expect(permitFor(messages, 1).leader).toBeNull();
  });

  it('ignores a train that is not on the path', () => {
    const apart = [train(3, 'B', 3000), train(2, 'A', 2000)];
    expect(trainAhead(apart[1], apart, seen(apart))).toBeNull();
    // A train in P1 leads a train sent to P1, not one sent to P2.
    const trains = [stopped(1, 'P1', PLATFORM_STOP), train(2, 'A', 5500)];
    expect(trainAhead(trains[1], trains, sentTo(seen(trains), { 2: 'P1' }))?.id).toBe(1);
    expect(trainAhead(trains[1], trains, sentTo(seen(trains), { 2: 'P2' }))).toBeNull();
  });
});

describe('local failures', () => {
  it('sends the same permits whatever the platform keeper, junction keeper and platform sensors are doing', () => {
    // step has no input for them: the engine passes the true occupancy, not our sensors.
    const two: TimetableEntry[] = [
      { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
      { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
    ];
    const permitsWith = (presses: Press[]) => {
      const log: Message[][] = [];
      const program: TrainProgram = {
        ...baselineProgram,
        makeCentre: (tt) => {
          const centre = makeCentre(tt);
          return {
            step: (...args) => {
              const out = centre.step(...args);
              log.push(out);
              return out;
            },
          };
        },
      };
      const engine = new Engine({ timetable: two, program, seed: 1, runLength: 400, presses });
      while (engine.now < 400) engine.step();
      return log;
    };
    const healthy = permitsWith([]);
    const broken = permitsWith([{ at: 0, set: { platformKeeper: false, junctionKeeper: false, sensors: false } }]);
    expect(broken).toEqual(healthy);
    expect(healthy.flat().some((msg) => msg.type === 'permit' && msg.nextTrack === 'EXIT')).toBe(true);
  });
});

describe('radio working (design: "Radio working")', () => {
  const DELAY = DEFAULT_CONSTANTS.RADIO_WORKING_DELAY;
  const GAP = DEFAULT_CONSTANTS.RADIO_RELEASE_GAP;

  it('starts RADIO_WORKING_DELAY after the centre last stepped, and never before its first step', () => {
    const memory = { ...initialMemory(timetable), lastStepAt: 100 };
    expect(isRadioWorking(initialMemory(timetable), 1e6)).toBe(false);
    expect(isRadioWorking(memory, 100 + DELAY - 1)).toBe(false);
    expect(isRadioWorking(memory, 100 + DELAY)).toBe(true);
    expect(isRadioWorking({ ...memory, radioWorking: true }, 101)).toBe(true);
  });

  it('sends nothing until then', () => {
    const centre = makeCentre(timetable);
    const trains = [stopped(1, 'A', 3000)];
    centre.step(0, trains, clear, none);
    expect(centre.radioStep!(DELAY - 1, trains, clear, none)).toEqual([]);
  });

  it('then releases one stopped train at a time, furthest along first, with caution permits', () => {
    const centre = makeCentre(timetable);
    const trains = [stopped(1, 'A', 3000), stopped(2, 'A', 1000)];
    centre.step(0, trains, clear, none);
    const first = centre.radioStep!(DELAY, trains, clear, none);
    expect(first.every((m) => m.type === 'permit' && m.caution === true)).toBe(true);
    expect(permitFor(first, 1).untilX).toBeGreaterThan(xOf(trains[0].pos));
    expect(permitFor(first, 2).untilX).toBe(xOf(trains[1].pos));
    // The engine calls radioStep once a second. Train 2 waits its turn, RADIO_RELEASE_GAP later.
    let last: Message[] = first;
    for (let t = DELAY + 1; t < DELAY + GAP; t++) {
      last = centre.radioStep!(t, trains, clear, none);
      expect(permitFor(last, 2).untilX).toBe(xOf(trains[1].pos));
    }
    last = centre.radioStep!(DELAY + GAP, trains, clear, none);
    expect(permitFor(last, 2).untilX).toBeGreaterThan(xOf(trains[1].pos));
  });

  it('stops when the centre is back: its permits carry no caution and release every held train', () => {
    const centre = makeCentre(timetable);
    const trains = [stopped(1, 'A', 3000), stopped(2, 'A', 1000)];
    centre.step(0, trains, clear, none);
    centre.radioStep!(DELAY, trains, clear, none);
    const back = centre.step(DELAY + 1, trains, clear, none);
    expect(back.some((m) => m.type === 'permit' && m.caution)).toBe(false);
    expect(permitFor(back, 2).untilX).toBeGreaterThan(xOf(trains[1].pos));
  });
});

describe('layouts (design: "Layouts")', () => {
  afterEach(() => {
    resetLayout();
  });

  // Two trains for each of the four entry tracks. Train 4 defaults to P8, the others to the
  // first platform of their pair.
  const hub: TimetableEntry[] = [
    { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
    { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
    { id: 3, entry: 'C', enterAt: 0, platform: 'P5', leader: null, dwell: 30 },
    { id: 4, entry: 'D', enterAt: 0, platform: 'P8', leader: null, dwell: 30 },
    { id: 5, entry: 'C', enterAt: 60, platform: 'P6', leader: 3, dwell: 30 },
    { id: 6, entry: 'C', enterAt: 120, platform: 'P5', leader: 5, dwell: 30 },
    { id: 7, entry: 'D', enterAt: 60, platform: 'P7', leader: 4, dwell: 30 },
    { id: 8, entry: 'D', enterAt: 120, platform: 'P8', leader: 7, dwell: 30 },
  ];
  const entryOfTrain = (id: number) => hub.find((e) => e.id === id)!;

  /** The memory after one step that sees these trains on the hub timetable. */
  const seenOn = (trains: TrainState[], now = 0, from = initialMemory(hub), set = none) =>
    updateMemory(from, now, trains, readings(), set);

  /** Readings with the platforms these trains are on occupied, and the rest of the layout empty. */
  function readingsFor(trains: TrainState[]): SensorReadings {
    const taken: Partial<Record<PlatformId, boolean>> = {};
    for (const t of trains) {
      if (isPlatform(t.pos.track)) taken[t.pos.track] = true;
    }
    return readings(taken);
  }

  describe('choosing a platform', () => {
    it('on busy, sends a train on line C to P5 or P6 only', () => {
      applyLayout('busy');
      const memory = initialMemory(hub);
      const c = train(3, 'C', 0);
      expect(choosePlatform(c, entryOfTrain(3), memory, readings())).toBe('P5');
      expect(choosePlatform(c, entryOfTrain(3), memory, readings({ P5: true }))).toBe('P6');
      expect(choosePlatform(c, entryOfTrain(3), sentTo(memory, { 9: 'P5' }), readings())).toBe('P6');
      // P1 to P4 are empty, and it still waits for its own pair.
      expect(choosePlatform(c, entryOfTrain(3), memory, readings({ P5: true, P6: true }))).toBeNull();
    });

    it('on busy, sends three trains on line C to P5, P6 and nowhere, in that order', () => {
      applyLayout('busy');
      const trains = [train(3, 'C', 4000), train(5, 'C', 2000), train(6, 'C', 0)];
      const messages = makeCentre(hub).step(0, trains, readings(), none);
      expect(permitFor(messages, 3)).toMatchObject({ nextTrack: 'P5', untilX: STOP_X });
      expect(permitFor(messages, 5).nextTrack).toBe('P6');
      expect(permitFor(messages, 6).nextTrack).toBeNull();
    });

    it('on hub, sends a train on line D to P7 or P8 only', () => {
      applyLayout('hub');
      const memory = initialMemory(hub);
      const d = train(4, 'D', 0);
      expect(choosePlatform(d, entryOfTrain(4), memory, readings())).toBe('P8');
      expect(choosePlatform(d, entryOfTrain(4), memory, readings({ P8: true }))).toBe('P7');
      expect(choosePlatform(d, entryOfTrain(4), sentTo(memory, { 9: 'P8' }), readings())).toBe('P7');
      // P1 to P6 are empty, and it still waits for its own pair.
      expect(choosePlatform(d, entryOfTrain(4), memory, readings({ P7: true, P8: true }))).toBeNull();
    });

    it('on hub, sends three trains on line D to P8, P7 and nowhere, in that order', () => {
      applyLayout('hub');
      const trains = [train(4, 'D', 4000), train(7, 'D', 2000), train(8, 'D', 0)];
      const messages = makeCentre(hub).step(0, trains, readings(), none);
      expect(permitFor(messages, 4)).toMatchObject({ nextTrack: 'P8', untilX: STOP_X });
      expect(permitFor(messages, 7).nextTrack).toBe('P7');
      expect(permitFor(messages, 8).nextTrack).toBeNull();
    });

    it('on hub, sends the front train of each of the four lines to its own pair in one step', () => {
      applyLayout('hub');
      const trains = [train(1, 'A', 3000), train(2, 'B', 3000), train(3, 'C', 3000), train(4, 'D', 3000)];
      const messages = makeCentre(hub).step(0, trains, readings(), none);
      expect(trains.map((t) => permitFor(messages, t.id).nextTrack)).toEqual(['P1', 'P3', 'P5', 'P8']);
      // No line holds up another: each train may run to its own platform stop.
      expect(trains.map((t) => permitFor(messages, t.id).untilX)).toEqual([STOP_X, STOP_X, STOP_X, STOP_X]);
    });

    it('goes by the track the train is on, even when the timetable names another line', () => {
      applyLayout('hub');
      const onC = train(1, 'C', 0);
      expect(choosePlatform(onC, entryOfTrain(1), initialMemory(hub), readings())).toBe('P5');
    });

    it('on every layout, picks from the own pair of the line or picks nothing, whatever is occupied', () => {
      for (const layout of LAYOUT_IDS) {
        applyLayout(layout);
        for (const platform of PLATFORMS) {
          const line = entryOf(platform);
          const entry: TimetableEntry = { id: 1, entry: line, enterAt: 0, platform, leader: null, dwell: 30 };
          const [first, second] = pairOf(line);
          for (const taken of [[], [first], [second], [first, second]]) {
            // Every other platform of the layout is empty, so a wrong pick would be easy.
            const sensors = readings(Object.fromEntries(taken.map((p) => [p, true])));
            const chosen = choosePlatform(train(1, line, 0), entry, initialMemory([entry]), sensors);
            const free = pairOf(line).filter((p) => !taken.includes(p));
            if (free.length === 0) expect(chosen).toBeNull();
            else expect(free).toContain(chosen);
            if (free.includes(platform)) expect(chosen).toBe(platform);
          }
        }
      }
    });
  });

  describe('platforms outside the layout', () => {
    it('on branch, never sends a train to P3 or P4', () => {
      applyLayout('branch');
      const line: TimetableEntry[] = [
        { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
        { id: 2, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
        { id: 3, entry: 'A', enterAt: 120, platform: 'P1', leader: 2, dwell: 30 },
      ];
      const trains = [train(1, 'A', 4000), train(2, 'A', 2000), train(3, 'A', 0)];
      const centre = makeCentre(line);
      for (let now = 0; now < 5; now++) {
        const messages = centre.step(now, trains, readings(), none);
        // The third train waits on A for P1 or P2. It is never sent across to P3 or P4.
        expect(trains.map((t) => permitFor(messages, t.id).nextTrack)).toEqual(['P1', 'P2', null]);
        expect(permitFor(messages, 3).untilX).toBeLessThanOrEqual(ENTRY_END_X);
      }
    });

    it('on branch, says P3 and P4 are unavailable even if a reading wrongly shows them empty', () => {
      applyLayout('branch');
      const memory = initialMemory(timetable);
      const wrong = readings({ P3: false, P4: false });
      for (const platform of ['P3', 'P4'] as const) {
        expect(isAvailable(platform, memory, readings())).toBe(false);
        expect(isAvailable(platform, memory, wrong)).toBe(false);
      }
      // A train whose timetable entry is for line B gets no platform on branch.
      expect(choosePlatform(train(3, 'B', 0), timetable[2], memory, wrong)).toBeNull();
    });

    it('on branch, does not take over a route into P3 or P4', () => {
      applyLayout('branch');
      const from = initialMemory(timetable);
      expect(updateMemory(from, 0, [train(1, 'A', 5000)], readings(), routes({ 1: 'P3' })).platformFor.has(1)).toBe(false);
      expect(updateMemory(from, 0, [train(3, 'B', 5000)], readings(), routes({ 3: 'P3' })).platformFor.has(3)).toBe(false);
      expect(updateMemory(from, 0, [train(1, 'A', 5000)], readings(), routes({ 1: 'P2' })).platformFor.get(1)).toBe('P2');
    });

    it('on every layout, says exactly the platforms of the layout are available when all are empty', () => {
      for (const layout of LAYOUT_IDS) {
        applyLayout(layout);
        const memory = initialMemory(hub);
        const allEmpty = readings(Object.fromEntries(ALL_PLATFORMS.map((p) => [p, false])));
        for (const platform of ALL_PLATFORMS) {
          expect(isAvailable(platform, memory, readings())).toBe(PLATFORMS.includes(platform));
          expect(isAvailable(platform, memory, allEmpty)).toBe(PLATFORMS.includes(platform));
        }
      }
    });

    it('reads the layout when it decides, not when the file loaded', () => {
      const memory = initialMemory(hub);
      expect(isAvailable('P7', memory, readings())).toBe(false);
      applyLayout('hub');
      expect(isAvailable('P7', memory, readings())).toBe(true);
      resetLayout();
      expect(isAvailable('P7', memory, readings())).toBe(false);
    });

    it('keeps a train short of a platform outside the layout, even one it was told to take', () => {
      applyLayout('branch');
      const t = train(3, 'B', 3000);
      const memory = sentTo(updateMemory(initialMemory(timetable), 0, [t], readings()), { 3: 'P3' });
      expect(untilXFor(t, [t], memory, readings({ P3: false }))).toBe(ENTRY_END_X);
    });
  });

  describe('the junction', () => {
    it('on hub, lets one train at a time through when trains wait in P1, P5 and P8', () => {
      applyLayout('hub');
      const one = stopped(1, 'P1', PLATFORM_STOP);
      const three = stopped(3, 'P5', PLATFORM_STOP);
      const four = stopped(4, 'P8', PLATFORM_STOP);
      const centre = makeCentre(hub);
      /** The trains the centre lets into the zone on this step: any permitted past the platform stop. */
      const letIn = (now: number, trains: TrainState[], sensors: SensorReadings) => {
        const messages = centre.step(now, trains, sensors, none);
        return trains.filter((t) => t.pos.track !== 'EXIT' && permitFor(messages, t.id).untilX > JUNCTION_START_X).map((t) => t.id);
      };
      const zoneBusy = (trains: TrainState[]) => ({ ...readingsFor(trains), junctionOccupied: true, exitStartClear: false });

      expect(letIn(0, [one, three, four], readingsFor([one, three, four]))).toEqual([]);
      // All three dwells are over. The lowest ID goes first, and only that one.
      expect(letIn(100, [one, three, four], readingsFor([one, three, four]))).toEqual([1]);
      expect(letIn(101, [one, three, four], readingsFor([one, three, four]))).toEqual([1]);
      // Train 1 is in the zone, then on EXIT with its rear still in the zone.
      let trains = [train(1, 'P1', 350), three, four];
      expect(letIn(102, trains, zoneBusy(trains))).toEqual([1]);
      trains = [train(1, 'EXIT', 250), three, four];
      expect(letIn(103, trains, zoneBusy(trains))).toEqual([]);
      // Train 1 is clear. Train 3 in P5 is next, and train 4 in P8 still waits.
      trains = [train(1, 'EXIT', 1000), three, four];
      const messages = centre.step(104, trains, readingsFor(trains), none);
      expect(permitFor(messages, 3)).toMatchObject({ nextTrack: 'EXIT', leader: 1 });
      expect(permitFor(messages, 3).untilX).toBe(TRACK_START.EXIT + 1000 - TRAIN_LENGTH - MARGIN);
      expect(permitFor(messages, 4)).toMatchObject({ nextTrack: null, untilX: JUNCTION_START_X });
      trains = [train(1, 'EXIT', 2000), train(3, 'P5', 350), four];
      expect(letIn(105, trains, zoneBusy(trains))).toEqual([3]);
      // Train 3 is clear. Now train 4 in P8 goes.
      trains = [train(1, 'EXIT', 3000), train(3, 'EXIT', 1000), four];
      expect(letIn(106, trains, readingsFor(trains))).toEqual([4]);
    });

    it('on hub, sends trains from all eight platforms through one at a time, lowest ID first', () => {
      applyLayout('hub');
      // Train 8 is in P1 and train 1 in P8, so the order is by ID, not by platform.
      const eight: TimetableEntry[] = ALL_PLATFORMS.map((platform, i) => ({
        id: 8 - i,
        entry: entryOf(platform),
        enterAt: 0,
        platform,
        leader: null,
        dwell: 30,
      }));
      let trains = eight.map((e) => stopped(e.id, e.platform, PLATFORM_STOP));
      const centre = makeCentre(eight);
      centre.step(0, trains, readingsFor(trains), none);
      const order: number[] = [];
      for (let now = 100; now < 108; now++) {
        const messages = centre.step(now, trains, readingsFor(trains), none);
        const going = trains.filter((t) => permitFor(messages, t.id).nextTrack === 'EXIT').map((t) => t.id);
        expect(going).toHaveLength(1);
        order.push(going[0]);
        // That train runs out onto EXIT, clear of the zone and ahead of the next one out.
        trains = trains.map((t) => (t.id === going[0] ? train(t.id, 'EXIT', 5800 - 500 * order.length) : t));
      }
      expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('on hub, puts trains that become ready in P1, P5 and P8 in the same step in ID order', () => {
      applyLayout('hub');
      const waiting = [stopped(4, 'P8', PLATFORM_STOP), stopped(3, 'P5', PLATFORM_STOP), stopped(1, 'P1', PLATFORM_STOP)];
      expect(seenOn(waiting, 100, seenOn(waiting, 0)).junctionOrder).toEqual([1, 3, 4]);
    });

    it('on hub, holds every waiting train short of the zone while the junction is unavailable', () => {
      applyLayout('hub');
      const waiting = [stopped(1, 'P1', PLATFORM_STOP), stopped(3, 'P5', PLATFORM_STOP), stopped(4, 'P8', PLATFORM_STOP)];
      const centre = makeCentre(hub);
      centre.step(0, waiting, readingsFor(waiting), none);
      const busy = { ...readingsFor(waiting), junctionOccupied: true };
      for (const msg of centre.step(100, waiting, busy, none)) {
        expect(msg).toMatchObject({ nextTrack: null, untilX: JUNCTION_START_X });
      }
    });

    it('on hub, makes a train already past its stop in P8 the holder, and keeps a train in P1 out', () => {
      applyLayout('hub');
      const centre = makeCentre(hub);
      const one = stopped(1, 'P1', PLATFORM_STOP);
      centre.step(0, [train(4, 'P8', 350), one], readings({ P1: true, P8: true }), none);
      // Train 1's dwell is over and the readings are clear, so only the holder keeps it back.
      const blocked = permitFor(centre.step(100, [train(4, 'EXIT', 150), one], readings({ P1: true }), none), 1);
      expect(blocked).toMatchObject({ nextTrack: null, untilX: JUNCTION_START_X });
      const freed = permitFor(centre.step(101, [train(4, 'EXIT', 1000), one], readings({ P1: true }), none), 1);
      expect(freed.nextTrack).toBe('EXIT');
    });
  });

  describe('the train ahead', () => {
    it('on hub, does not hold a train on line C behind trains on A, B or D', () => {
      applyLayout('hub');
      const trains = [train(1, 'A', 3000), train(2, 'B', 3500), train(4, 'D', 4000), train(3, 'C', 2000)];
      const memory = seenOn(trains);
      expect(trainAhead(trains[3], trains, memory)).toBeNull();
      expect(untilXFor(trains[3], trains, memory, readings())).toBe(ENTRY_END_X);
      // A train in P7 leads a train sent to P7, not one sent to P8, and not one on line C.
      const station = [stopped(4, 'P7', PLATFORM_STOP), train(7, 'D', 5500), train(3, 'C', 5500)];
      expect(trainAhead(station[1], station, sentTo(seenOn(station), { 7: 'P7' }))?.id).toBe(4);
      expect(trainAhead(station[1], station, sentTo(seenOn(station), { 7: 'P8' }))).toBeNull();
      expect(trainAhead(station[2], station, sentTo(seenOn(station), { 3: 'P5' }))).toBeNull();
    });

    it('on busy, keeps a follower bound for P6 MARGIN behind a train whose front is in P5 and rear is still on C', () => {
      applyLayout('busy');
      const trains = [train(3, 'P5', 60), train(5, 'C', 5500)];
      const memory = sentTo(seenOn(trains), { 5: 'P6' });
      expect(untilXFor(trains[1], trains, memory, readings({ P5: true }))).toBe(TRACK_START.P5 + 60 - TRAIN_LENGTH - MARGIN);
      // The same train's rear is not on line A, so a train on A bound for P2 is not held.
      const other = [train(3, 'P5', 60), train(1, 'A', 5500)];
      expect(untilXFor(other[1], other, sentTo(seenOn(other), { 1: 'P2' }), readings({ P5: true }))).toBe(STOP_X);
      // Once the rear of train 3 is in P5, the way into P6 is clear.
      const inside = [train(3, 'P5', 150), train(5, 'C', 5500)];
      expect(untilXFor(inside[1], inside, sentTo(seenOn(inside), { 5: 'P6' }), readings({ P5: true }))).toBe(STOP_X);
    });

    it('on hub, treats a train on EXIT whose platform it does not know as still on every platform of the layout', () => {
      applyLayout('hub');
      // Train 1's front is on EXIT and its rear is still in some platform.
      const trains = [train(1, 'EXIT', 50), train(7, 'D', 5500)];
      const memory = sentTo(seenOn(trains), { 7: 'P8' });
      expect(memory.platformFor.has(1)).toBe(false);
      expect(trainAhead(trains[1], trains, memory)?.id).toBe(1);
    });
  });

  describe('taking over from routes our trains set', () => {
    it('on hub, sends a train on C or D to the platform of its own pair its route is set into', () => {
      applyLayout('hub');
      const c = train(3, 'C', 5000);
      const d = train(4, 'D', 5000);
      expect(seenOn([c], 0, initialMemory(hub), routes({ 3: 'P6' })).platformFor.get(3)).toBe('P6');
      expect(seenOn([d], 0, initialMemory(hub), routes({ 4: 'P7' })).platformFor.get(4)).toBe('P7');
      // A route into another line's pair is ignored.
      expect(seenOn([c], 0, initialMemory(hub), routes({ 3: 'P7' })).platformFor.has(3)).toBe(false);
      expect(seenOn([d], 0, initialMemory(hub), routes({ 4: 'P6' })).platformFor.has(4)).toBe(false);
      expect(seenOn([d], 0, initialMemory(hub), routes({ 4: 'P1' })).platformFor.has(4)).toBe(false);
    });

    it('on hub, puts the adopted platform in the permit and sends the next train on that line to the other one', () => {
      applyLayout('hub');
      // Train 7 defaults to P7, so it goes to P8 once train 4 has taken P7.
      const trains = [train(4, 'D', 5000), train(7, 'D', 1000)];
      const messages = makeCentre(hub).step(0, trains, readings(), routes({ 4: 'P7' }));
      expect(permitFor(messages, 4)).toMatchObject({ nextTrack: 'P7', untilX: STOP_X });
      expect(permitFor(messages, 7).nextTrack).toBe('P8');
    });

    it.each(LAYOUT_IDS)('on %s, does not take over a look into a platform another train is on, on any entry track', (layout) => {
      applyLayout(layout);
      for (const platform of PLATFORMS) {
        const entry = entryOf(platform);
        const other = pairOf(entry).find((p) => p !== platform)!;
        const id = hub.find((e) => e.entry === entry)!.id;
        const waiting = stopped(id, entry, TRACK_LENGTH[entry] - 0.01);
        const stuck = broken(99, platform, PLATFORM_STOP);
        const centre = makeCentre(hub);
        const look = routes({ [id]: platform });
        // The other platform of the pair holds a train too, then empties.
        const both = readings({ [platform]: true, [other]: true });
        expect(permitFor(centre.step(0, [stuck, waiting], both, look), id)).toMatchObject({ nextTrack: null, untilX: ENTRY_END_X });
        expect(permitFor(centre.step(1, [stuck, waiting], readings({ [platform]: true }), look), id)).toMatchObject({
          nextTrack: other,
          untilX: STOP_X,
        });
      }
    });
  });

  describe('slow restart and radio working', () => {
    const waiting = [stopped(1, 'A', 3000), stopped(2, 'B', 2000), stopped(3, 'C', 4000), stopped(4, 'D', 4000)];

    it('on hub, releases stopped trains on all four lines one at a time, furthest along first, lowest ID on a tie', () => {
      applyLayout('hub');
      const slow: CentreOptions = { restartGap: 30 };
      let memory = seenOn(waiting, 100, seenOn(waiting, 10));
      const order: number[] = [];
      for (let now = 100; now <= 190; now += 30) {
        expect(nextRestartRelease(memory, waiting, now - 1, slow)).toBe(now === 100 ? 3 : null);
        order.push(nextRestartRelease(memory, waiting, now, slow)!);
        memory = releaseHeld(memory, waiting, now, slow);
      }
      expect(order).toEqual([3, 4, 1, 2]);
    });

    it('on hub, a released train on line C or D is sent to its own pair, and a held one stays where it is', () => {
      applyLayout('hub');
      const centre = makeCentre(hub, { restartGap: 30 });
      centre.step(0, waiting, readings(), none);
      const back = centre.step(100, waiting, readings(), none);
      expect(permitFor(back, 3).nextTrack).toBe('P5');
      expect(permitFor(back, 3).untilX).toBe(STOP_X);
      expect(permitFor(back, 4)).toMatchObject({ nextTrack: 'P8', untilX: xOf(waiting[3].pos) });
      // The engine steps the centre once a second. Train 4's turn comes restartGap later.
      let later = back;
      for (let now = 101; now <= 130; now++) later = centre.step(now, waiting, readings(), none);
      expect(permitFor(later, 4).untilX).toBe(STOP_X);
      expect(permitFor(later, 1).untilX).toBe(xOf(waiting[0].pos));
    });

    it('on hub, staff working by radio release trains on C and D one at a time with caution permits into their own pairs', () => {
      applyLayout('hub');
      const DELAY = DEFAULT_CONSTANTS.RADIO_WORKING_DELAY;
      const GAP = DEFAULT_CONSTANTS.RADIO_RELEASE_GAP;
      const trains = [stopped(3, 'C', 3000), stopped(4, 'D', 1000)];
      const centre = makeCentre(hub);
      centre.step(0, trains, readings(), none);
      const first = centre.radioStep!(DELAY, trains, readings(), none);
      expect(first.every((m) => m.type === 'permit' && m.caution === true)).toBe(true);
      expect(permitFor(first, 3)).toMatchObject({ nextTrack: 'P5', untilX: STOP_X });
      expect(permitFor(first, 4).untilX).toBe(xOf(trains[1].pos));
      // The engine calls radioStep once a second. Train 4's turn comes RADIO_RELEASE_GAP later.
      let second = first;
      for (let now = DELAY + 1; now <= DELAY + GAP; now++) {
        expect(permitFor(second, 4).untilX).toBe(xOf(trains[1].pos));
        second = centre.radioStep!(now, trains, readings(), none);
      }
      expect(permitFor(second, 4)).toMatchObject({ nextTrack: 'P8', untilX: STOP_X, caution: true });
    });
  });

  describe('whole runs with the baseline program', () => {
    /** Two trains for each entry track of the layout in use, the second a minute behind the first. */
    function twoPerLine(): TimetableEntry[] {
      const out: TimetableEntry[] = [];
      for (const line of entryLines()) {
        const [first, second] = pairOf(line);
        const lead = out.length + 1;
        out.push({ id: lead, entry: line, enterAt: 0, platform: first, leader: null, dwell: 30 });
        out.push({ id: lead + 1, entry: line, enterAt: 60, platform: second, leader: lead, dwell: 30 });
      }
      return out;
    }

    /** The entry tracks of the layout in use, read from its platforms. */
    function entryLines() {
      return [...new Set(PLATFORMS.map((p) => entryOf(p)))];
    }

    /** Runs the baseline program to the end and returns the engine and every permit the centre sent. */
    function run(tt: TimetableEntry[], presses: Press[]) {
      const permits: Permit[] = [];
      const program: TrainProgram = {
        ...baselineProgram,
        makeCentre: (given) => {
          const centre = makeCentre(given);
          return {
            step: (...args) => {
              const out = centre.step(...args);
              permits.push(...(out as Permit[]));
              return out;
            },
          };
        },
      };
      const engine = new Engine({ timetable: tt, program, seed: 1, runLength: 2400, presses });
      while (!engine.finished && engine.now < 2400) engine.step();
      return { engine, permits };
    }

    for (const layout of LAYOUT_IDS) {
      it(`on ${layout}, every train gets out with no collision and is only ever sent to its own pair`, () => {
        applyLayout(layout);
        const tt = twoPerLine();
        const { engine, permits } = run(tt, []);
        const result = engine.result();
        expect(result.collisions).toBe(0);
        expect(result.finished).toBe(true);
        expect(result.exits.size).toBe(tt.length);
        for (const entry of tt) {
          const sent = new Set(permits.filter((p) => p.to === entry.id).map((p) => p.nextTrack));
          const allowed: (TrackId | null)[] = [...pairOf(entry.entry), 'EXIT', null];
          expect([...sent].filter((track) => !allowed.includes(track))).toEqual([]);
          // It was sent into a platform and then out through the junction.
          expect(pairOf(entry.entry).some((p) => sent.has(p))).toBe(true);
          expect(sent.has('EXIT')).toBe(true);
        }
      });

      it(`on ${layout}, trains stopped by a centre outage start again and all get out with no collision`, () => {
        applyLayout(layout);
        const tt = twoPerLine();
        const { engine } = run(tt, [
          { at: 150, set: { centre: false } },
          { at: 400, set: { centre: true } },
        ]);
        const result = engine.result();
        expect(result.collisions).toBe(0);
        expect(result.finished).toBe(true);
        expect(result.exits.size).toBe(tt.length);
      });
    }
  });
});
