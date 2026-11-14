import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CENTRE_OPTIONS,
  freeRunX,
  MAP_END_X,
  choosePlatform,
  initialMemory,
  isAvailable,
  isReadyToLeave,
  makeCentre,
  makePermit,
  nextRestartRelease,
  nextThroughJunction,
  nextTrackFor,
  reachOf,
  releaseHeld,
  untilXFor,
  updateMemory,
  type Alive,
  type CentreMemory,
  type CentreOptions,
  type Permit,
  type TrainPlan,
} from '../../src/baseline/centre';
import { createBaselineAgent } from '../../src/baseline/train';
import { BRAKE, MARGIN, MAX_SPEED, TRAIN_LENGTH } from '../../src/shared/constants';
import { JUNCTION_START_X, PLATFORM_STOP, TRACK_LENGTH, TRACK_START, xOf } from '../../src/shared/map';
import type {
  Message,
  PlatformId,
  ResourceId,
  SensorReadings,
  TimetableEntry,
  TrackId,
  TrainState,
} from '../../src/shared/types';
import { makeSim } from './sim';

// Rules: "Today's rule, for comparison" and "Following permits" in docs/design.md, plus
// "The map" and "Platform sensors switched off".

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
  { id: 3, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
  { id: 4, entry: 'A', enterAt: 120, platform: 'P1', leader: 2, dwell: 30 },
];

const clear: SensorReadings = {
  platformOccupied: { P1: false, P2: false, P3: false, P4: false },
  junctionOccupied: false,
  exitStartClear: true,
};

const allAlive: Alive = { station: true, merge: true };
const ours: CentreOptions = { serves: 'ours' };
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

/** The memory after one step that sees these trains. */
function seen(trains: TrainState[], now = 0, from = initialMemory(timetable)): CentreMemory {
  return updateMemory(from, now, trains, clear, allAlive);
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
    });
  });
});

describe('makeCentre', () => {
  it('defaults to serving baseline trains, with no slow restart', () => {
    expect(DEFAULT_CENTRE_OPTIONS).toEqual({ serves: 'baseline' });
  });
});

describe('step', () => {
  const trains = [train(1, 'A', 3000), train(2, 'A', 1000), train(3, 'B', 2000)];

  it('sends exactly one permit to each train in trains on every call', () => {
    for (const serves of ['baseline', 'ours'] as const) {
      const centre = makeCentre(timetable, { serves });
      for (let now = 0; now < 3; now++) {
        const to = centre.step(now, trains, clear, allAlive).map((msg) => (msg as Permit).to);
        expect(to.sort()).toEqual([1, 2, 3]);
      }
    }
  });

  it('addresses each permit to its train and sets sentAt to now', () => {
    const messages = makeCentre(timetable).step(7, trains, clear, allAlive);
    for (const t of trains) {
      const permit = permitFor(messages, t.id);
      expect(permit.sentAt).toBe(7);
      expect(permit.untilX).toBeGreaterThan(xOf(t.pos));
    }
  });

  it('sends only permit messages', () => {
    const messages = makeCentre(timetable).step(0, trains, clear, allAlive);
    expect(messages.every((msg) => msg.type === 'permit')).toBe(true);
  });

  it('keeps its memory from one call to the next', () => {
    const centre = makeCentre(timetable);
    expect(permitFor(centre.step(0, [train(1, 'A', 3000)], clear, allAlive), 1).nextTrack).toBe('P1');
    // Train 4 also defaults to P1. The centre remembers P1 is taken and sends it to P2.
    const both = [train(1, 'A', 3100), train(4, 'A', 100)];
    const second = centre.step(1, both, clear, allAlive);
    expect(permitFor(second, 1).nextTrack).toBe('P1');
    expect(permitFor(second, 4).nextTrack).toBe('P2');
  });

  it('sends a train that is not yet in trains no permit until it enters', () => {
    const centre = makeCentre(timetable);
    const first = centre.step(0, [train(1, 'A', 3000)], clear, allAlive);
    expect(first.map((msg) => (msg as Permit).to)).toEqual([1]);
    const second = centre.step(1, [train(1, 'A', 3020), train(2, 'A', 0)], clear, allAlive);
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
  const slow: CentreOptions = { serves: 'baseline', restartGap: 30 };
  const waiting = [stopped(1, 'A', 3000), stopped(2, 'A', 1000), stopped(3, 'B', 2000)];
  const held = (memory: CentreMemory) =>
    [...memory.plans.values()].filter((p) => p.heldForRestart).map((p) => p.id);

  it('treats a gap of more than 1.5 seconds since lastStepAt as a restart, so rounding in a 1 second step does not', () => {
    const first = seen(waiting, 10);
    expect(held(seen(waiting, 11.0000001, first))).toEqual([]);
    expect(held(seen(waiting, 11.5, first))).toEqual([]);
    expect(held(seen(waiting, 12, first))).toEqual([1, 2, 3]);
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
    centre.step(0, waiting, clear, allAlive);
    const moving = (now: number) =>
      centre
        .step(now, waiting, clear, allAlive)
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
    expect(untilXFor(waiting[0], waiting, memory, clear, allAlive)).toBeGreaterThan(3000);
    expect(untilXFor(waiting[1], waiting, memory, clear, allAlive)).toBe(1000);
    expect(untilXFor(waiting[2], waiting, memory, clear, allAlive)).toBe(2000);
  });

  it('records lastReleaseAt each time it releases a train', () => {
    const memory = seen(waiting, 100, seen(waiting, 10));
    const first = releaseHeld(memory, waiting, 100, slow);
    expect(first.lastReleaseAt).toBe(100);
    expect(releaseHeld(first, waiting, 110, slow).lastReleaseAt).toBe(100);
    expect(releaseHeld(first, waiting, 130, slow).lastReleaseAt).toBe(130);
  });

  it('resumes every train at once when restartGap is 0 or absent', () => {
    for (const options of [{ serves: 'baseline' }, { serves: 'baseline', restartGap: 0 }] as CentreOptions[]) {
      const centre = makeCentre(timetable, options);
      centre.step(0, waiting, clear, allAlive);
      for (const msg of centre.step(100, waiting, clear, allAlive)) {
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

  it('two trains that enter on one entry track during an outage do not collide', () => {
    // The centre goes off before train 2 enters, so train 2 never gets a permit.
    const sim = makeSim(pair, makeCentre(pair), createBaselineAgent, { centreOn: (now) => now < 15 });
    sim.runUntil(120);
    expect(sim.trains.map((t) => t.state.id)).toEqual([1, 2]);
    expect(sim.trains.every((t) => t.state.speed === 0)).toBe(true);
    expect(sim.overlaps).toBe(0);
    const gap = xOf(sim.train(1)!.pos) - TRAIN_LENGTH - xOf(sim.train(2)!.pos);
    expect(gap).toBeGreaterThanOrEqual(MARGIN);
  });

  it('a train that enters behind a train stopped near x 1000 does not hit it', () => {
    const sim = makeSim(pair, makeCentre(pair), createBaselineAgent);
    while (xOf(sim.train(1)?.pos ?? { track: 'A', offset: 0 }) < 1000) sim.tick();
    sim.breakDown(1);
    sim.runUntil(300);
    const gap = xOf(sim.train(1)!.pos) - TRAIN_LENGTH - xOf(sim.train(2)!.pos);
    expect(sim.train(2)!.speed).toBe(0);
    expect(gap).toBeGreaterThanOrEqual(MARGIN);
    expect(sim.overlaps).toBe(0);
  });
});

describe('isAvailable', () => {
  const memory = initialMemory(timetable);

  it('says a platform is available when its sensor reads empty and no train is sent to it', () => {
    for (const platform of ['P1', 'P2', 'P3', 'P4'] as const) {
      expect(isAvailable(platform, memory, clear, allAlive)).toBe(true);
    }
  });

  it('says a platform is unavailable when its sensor reads occupied', () => {
    expect(isAvailable('P1', memory, occupied('P1'), allAlive)).toBe(false);
    expect(isAvailable('P2', memory, occupied('P1'), allAlive)).toBe(true);
  });

  it('says a platform with a dead sensor is unavailable, because a dead sensor reads occupied', () => {
    const allDead = occupied('P1', 'P2', 'P3', 'P4');
    for (const platform of ['P1', 'P2', 'P3', 'P4'] as const) {
      expect(isAvailable(platform, memory, allDead, allAlive)).toBe(false);
    }
  });

  it('says a platform is available again once its sensor returns and reads empty', () => {
    expect(isAvailable('P3', memory, occupied('P3'), allAlive)).toBe(false);
    expect(isAvailable('P3', memory, clear, allAlive)).toBe(true);
  });

  it('says a platform another train is sent to is unavailable', () => {
    const taken = sentTo(memory, { 1: 'P1' });
    expect(isAvailable('P1', taken, clear, allAlive)).toBe(false);
    expect(isAvailable('P2', taken, clear, allAlive)).toBe(true);
  });

  it('says every platform is unavailable while alive.station is false', () => {
    for (const platform of ['P1', 'P2', 'P3', 'P4'] as const) {
      expect(isAvailable(platform, memory, clear, { station: false, merge: true })).toBe(false);
    }
  });

  it('says the junction is unavailable while junctionOccupied is true', () => {
    expect(isAvailable('JUNCTION', memory, { ...clear, junctionOccupied: true }, allAlive)).toBe(false);
  });

  it('says the junction is unavailable while exitStartClear is false (borrowed from the merge actor in "Leaving the station")', () => {
    expect(isAvailable('JUNCTION', memory, { ...clear, exitStartClear: false }, allAlive)).toBe(false);
  });

  it('says the junction is unavailable while another train holds it', () => {
    expect(isAvailable('JUNCTION', { ...memory, junctionHolder: 1 }, clear, allAlive)).toBe(false);
  });

  it('says the junction is unavailable while alive.merge is false', () => {
    expect(isAvailable('JUNCTION', memory, clear, { station: true, merge: false })).toBe(false);
  });

  it('says the junction is available again once alive.merge is true and the zone is clear', () => {
    expect(isAvailable('JUNCTION', memory, clear, allAlive)).toBe(true);
    const pieces: ResourceId[] = ['JUNCTION', 'P1'];
    expect(pieces.every((piece) => isAvailable(piece, memory, clear, allAlive))).toBe(true);
  });
});

describe('choosePlatform', () => {
  const memory = initialMemory(timetable);
  const baseline = DEFAULT_CENTRE_OPTIONS;
  const stationOff: Alive = { station: false, merge: true };

  it('picks a platform the entry track feeds: P1 or P2 from A, P3 or P4 from B', () => {
    for (const sensors of [clear, occupied('P1', 'P3')]) {
      expect(['P1', 'P2']).toContain(choosePlatform(train(1, 'A', 0), timetable[0], memory, sensors, allAlive, baseline));
      expect(['P3', 'P4']).toContain(choosePlatform(train(3, 'B', 0), timetable[2], memory, sensors, allAlive, baseline));
    }
  });

  it('picks the default platform from the timetable when it is available (the design leaves the choice to the centre)', () => {
    expect(choosePlatform(train(1, 'A', 0), timetable[0], memory, clear, allAlive, baseline)).toBe('P1');
    expect(choosePlatform(train(2, 'A', 0), timetable[1], memory, clear, allAlive, baseline)).toBe('P2');
  });

  it('picks the other platform of the pair when the default is unavailable (the design leaves the choice to the centre)', () => {
    expect(choosePlatform(train(2, 'A', 0), timetable[1], memory, occupied('P2'), allAlive, baseline)).toBe('P1');
    expect(choosePlatform(train(3, 'B', 0), timetable[2], sentTo(memory, { 9: 'P3' }), clear, allAlive, baseline)).toBe('P4');
  });

  it('returns null when neither platform of the pair is available', () => {
    expect(choosePlatform(train(1, 'A', 0), timetable[0], memory, occupied('P1', 'P2'), allAlive, baseline)).toBeNull();
  });

  it('never picks a platform whose sensor reads occupied, so a dead sensor rules it out', () => {
    const allDead = occupied('P1', 'P2', 'P3', 'P4');
    for (const entry of timetable) {
      expect(choosePlatform(train(entry.id, entry.entry, 0), entry, memory, allDead, allAlive, baseline)).toBeNull();
    }
  });

  it('returns null while alive.station is false', () => {
    expect(choosePlatform(train(1, 'A', 0), timetable[0], memory, clear, stationOff, baseline)).toBeNull();
  });

  it('keeps the platform it already chose for a train instead of switching it (borrowed from "Following permits")', () => {
    const chosen = sentTo(memory, { 1: 'P2' });
    expect(choosePlatform(train(1, 'A', 0), timetable[0], chosen, clear, allAlive, baseline)).toBe('P2');
    expect(choosePlatform(train(1, 'A', 0), timetable[0], chosen, occupied('P2'), stationOff, baseline)).toBe('P2');
  });

  it('never sends two trains to the same platform at once', () => {
    const centre = makeCentre(timetable);
    const trains = [train(1, 'A', 4000), train(2, 'A', 2000), train(4, 'A', 0)];
    const messages = centre.step(0, trains, clear, allAlive);
    expect(permitFor(messages, 1).nextTrack).toBe('P1');
    expect(permitFor(messages, 2).nextTrack).toBe('P2');
    expect(permitFor(messages, 4).nextTrack).toBeNull();
  });

  it("with serves: 'ours', suggests only platforms from the train's own pair", () => {
    const full = sentTo(memory, { 8: 'P1', 9: 'P2' });
    expect(choosePlatform(train(1, 'A', 0), timetable[0], memory, clear, allAlive, ours)).toBe('P1');
    expect(choosePlatform(train(1, 'A', 0), timetable[0], sentTo(memory, { 9: 'P1' }), clear, allAlive, ours)).toBe('P2');
    expect(choosePlatform(train(1, 'A', 0), timetable[0], full, clear, allAlive, ours)).toBeNull();
  });

  it("with serves: 'ours', skips the dead actor and dead sensor rules", () => {
    const allDead = occupied('P1', 'P2', 'P3', 'P4');
    expect(choosePlatform(train(1, 'A', 0), timetable[0], memory, allDead, stationOff, ours)).toBe('P1');
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
    centre.step(0, waiting, clear, allAlive);
    const leaving = (now: number, sensors: SensorReadings) =>
      centre.step(now, waiting, sensors, allAlive).filter((msg) => (msg as Permit).nextTrack === 'EXIT');
    expect(leaving(100, clear).map((msg) => (msg as Permit).to)).toEqual([1]);
    expect(leaving(101, clear).map((msg) => (msg as Permit).to)).toEqual([1]);
  });

  it('returns null while another train holds the junction', () => {
    expect(nextThroughJunction({ ...ready, junctionHolder: 3 }, waiting, clear, allAlive, 100)).toBeNull();
  });

  it('returns null while junctionOccupied is true', () => {
    expect(nextThroughJunction(ready, waiting, { ...clear, junctionOccupied: true }, allAlive, 100)).toBeNull();
  });

  it('returns null while exitStartClear is false (borrowed from the merge actor in "Leaving the station")', () => {
    expect(nextThroughJunction(ready, waiting, { ...clear, exitStartClear: false }, allAlive, 100)).toBeNull();
  });

  it('returns null while alive.merge is false', () => {
    expect(nextThroughJunction(ready, waiting, clear, { station: true, merge: false }, 100)).toBeNull();
  });

  it('picks only trains that are ready to leave', () => {
    const late = [stopped(1, 'P1', PLATFORM_STOP), train(2, 'P2', 100)];
    const memory = { ...seen(late, 1, seen([late[0]], 0)), junctionOrder: [2, 1] };
    expect(nextThroughJunction(memory, late, clear, allAlive, 100)).toBe(1);
  });

  it('picks the train first in junctionOrder', () => {
    expect(nextThroughJunction({ ...ready, junctionOrder: [3, 1, 2] }, waiting, clear, allAlive, 100)).toBe(3);
  });

  it('puts the lowest ID first in junctionOrder when two trains become ready in the same step (borrowed from the merge actor in "Leaving the station")', () => {
    const reversed = [...waiting].reverse();
    expect(seen(reversed, 100, seen(reversed, 0)).junctionOrder).toEqual([1, 2, 3]);
    // A train that was already waiting stays ahead of one that becomes ready later.
    const three = seen([waiting[2]], 100, seen([waiting[2]], 0));
    expect(seen(waiting, 200, seen(waiting, 101, three)).junctionOrder).toEqual([3, 1, 2]);
  });

  it('returns null when no train is waiting', () => {
    expect(nextThroughJunction(seen([train(1, 'A', 100)]), [train(1, 'A', 100)], clear, allAlive, 100)).toBeNull();
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
    expect(nextTrackFor(train(1, 'EXIT', 10), initialMemory(timetable), ours)).toBeNull();
  });

  it("with serves: 'ours', gives EXIT to every train in a platform, because the merge lock decides when", () => {
    expect(nextTrackFor(train(1, 'P1', 300), initialMemory(timetable), ours)).toBe('EXIT');
  });
});

describe('untilXFor', () => {
  const stationOff: Alive = { station: false, merge: true };
  const mergeOff: Alive = { station: true, merge: false };

  it("keeps a train's front at least MARGIN behind the rear of the train ahead on its path", () => {
    const trains = [train(1, 'A', 3000), train(2, 'A', 2000)];
    expect(untilXFor(trains[1], trains, seen(trains), clear, allAlive)).toBe(3000 - TRAIN_LENGTH - MARGIN);
    const exit = [train(1, 'EXIT', 1000), train(2, 'EXIT', 400)];
    expect(untilXFor(exit[1], exit, seen(exit), clear, allAlive)).toBe(
      TRACK_START.EXIT + 1000 - TRAIN_LENGTH - MARGIN,
    );
    // A train on the other entry track is not on its path.
    const apart = [train(3, 'B', 3000), train(2, 'A', 2000)];
    expect(untilXFor(apart[1], apart, seen(apart), clear, allAlive)).toBe(ENTRY_END_X);
  });

  it('uses the true position of the train ahead, however far it is', () => {
    const trains = [train(1, 'A', 5900), train(2, 'A', 10)];
    expect(untilXFor(trains[1], trains, seen(trains), clear, allAlive)).toBe(5900 - TRAIN_LENGTH - MARGIN);
  });

  it('keeps a train behind a broken-down train ahead of it', () => {
    const trains = [broken(1, 'A', 3000), train(2, 'A', 2000)];
    const memory = sentTo(seen(trains), { 2: 'P2' });
    expect(untilXFor(trains[1], trains, memory, clear, allAlive)).toBe(3000 - TRAIN_LENGTH - MARGIN);
  });

  it('keeps a train on A or B with no platform short of the end of its entry track, x 6000', () => {
    const t = train(1, 'A', 3000);
    expect(untilXFor(t, [t], seen([t]), clear, allAlive)).toBe(ENTRY_END_X);
  });

  it('lets a train with a platform run to offset 300 in that platform, x 6300', () => {
    const t = train(1, 'A', 3000);
    expect(untilXFor(t, [t], sentTo(seen([t]), { 1: 'P1' }), clear, allAlive)).toBe(STOP_X);
  });

  it('keeps a train short of a platform that is unavailable', () => {
    const t = train(1, 'A', 3000);
    const memory = sentTo(seen([t]), { 1: 'P1' });
    expect(untilXFor(t, [t], memory, occupied('P1'), allAlive)).toBe(ENTRY_END_X);
    expect(untilXFor(t, [t], memory, clear, stationOff)).toBe(ENTRY_END_X);
  });

  it('holds a train in its platform at x 6300 until it holds the junction', () => {
    const t = stopped(1, 'P1', PLATFORM_STOP - 0.01);
    const memory = seen([t]);
    expect(untilXFor(t, [t], memory, clear, allAlive)).toBe(STOP_X);
    expect(untilXFor(t, [t], { ...memory, junctionHolder: 1 }, clear, allAlive)).toBe(freeRunX());
  });

  it('holds every train short of the junction zone while the junction is unavailable', () => {
    const waiting = [stopped(1, 'P1', PLATFORM_STOP), stopped(2, 'P2', PLATFORM_STOP), stopped(3, 'P3', PLATFORM_STOP)];
    const centre = makeCentre(timetable);
    centre.step(0, waiting, clear, allAlive);
    for (const sensors of [{ ...clear, junctionOccupied: true }, { ...clear, exitStartClear: false }]) {
      for (const msg of centre.step(100, waiting, sensors, allAlive)) {
        expect((msg as Permit).untilX).toBe(JUNCTION_START_X);
      }
    }
    for (const msg of centre.step(101, waiting, clear, mergeOff)) {
      expect((msg as Permit).untilX).toBe(JUNCTION_START_X);
    }
  });

  it('keeps two trains from being in the junction zone at the same time', () => {
    const waiting = [stopped(1, 'P1', PLATFORM_STOP), stopped(2, 'P2', PLATFORM_STOP)];
    const centre = makeCentre(timetable);
    centre.step(0, waiting, clear, allAlive);
    const first = centre.step(100, waiting, clear, allAlive);
    expect(permitFor(first, 1).untilX).toBe(freeRunX());
    expect(permitFor(first, 2).untilX).toBe(JUNCTION_START_X);
    // Train 1 is in the zone. Train 2 stays out until train 1's rear has cleared it.
    const inZone = [train(1, 'EXIT', 250), waiting[1]];
    const busy = { ...clear, junctionOccupied: true, exitStartClear: false };
    expect(permitFor(centre.step(101, inZone, busy, allAlive), 2).untilX).toBe(JUNCTION_START_X);
    const through = [train(1, 'EXIT', 1000), waiting[1]];
    const second = permitFor(centre.step(102, through, clear, allAlive), 2);
    expect(second.nextTrack).toBe('EXIT');
    expect(second.untilX).toBe(TRACK_START.EXIT + 1000 - TRAIN_LENGTH - MARGIN);
  });

  it('gives a train on EXIT with nothing ahead freeRunX(), far enough past the end of EXIT that it leaves at full speed', () => {
    const t = train(1, 'EXIT', 10);
    expect(untilXFor(t, [t], seen([t]), clear, allAlive)).toBe(freeRunX());
    const braking = (MAX_SPEED * MAX_SPEED) / (2 * BRAKE);
    expect(freeRunX() - MAP_END_X).toBeGreaterThanOrEqual(braking);
  });

  it('holds a broken-down train where it is', () => {
    const t = broken(1, 'A', 1234);
    expect(untilXFor(t, [t], sentTo(seen([t]), { 1: 'P1' }), clear, allAlive)).toBe(1234);
    expect(untilXFor(t, [t], seen([t]), clear, allAlive, ours)).toBe(1234);
  });

  it('keeps a follower bound for P2 MARGIN behind the rear of a train whose front is in P1 and rear is still on A', () => {
    const trains = [train(1, 'P1', 60), train(2, 'A', 5500)];
    const memory = sentTo(seen(trains), { 2: 'P2' });
    expect(untilXFor(trains[1], trains, memory, clear, allAlive)).toBe(
      TRACK_START.P1 + 60 - TRAIN_LENGTH - MARGIN,
    );
    // Once the rear of train 1 is in P1, the way into P2 is clear.
    const inside = [train(1, 'P1', 150), train(2, 'A', 5500)];
    expect(untilXFor(inside[1], inside, sentTo(seen(inside), { 2: 'P2' }), clear, allAlive)).toBe(STOP_X);
  });

  it('for a train already past x 6000 or in the junction zone when the station or merge actor dies, lets it run clear', () => {
    const entering = train(1, 'P1', 50);
    expect(untilXFor(entering, [entering], promised(seen([entering]), 1, STOP_X), clear, stationOff)).toBe(STOP_X);
    const leaving = train(1, 'P1', 350);
    const holding = { ...promised(seen([leaving]), 1, freeRunX()), junctionHolder: 1 };
    const busy = { ...clear, junctionOccupied: true };
    expect(untilXFor(leaving, [leaving], holding, busy, mergeOff)).toBe(freeRunX());
  });

  it('never moves untilX closer than a running train can stop, when a platform or the junction becomes unavailable (the design does not say)', () => {
    // At 45 m/s and 1000 m out the train cannot stop before x 6000, so it keeps x 6300.
    const close = train(1, 'A', 5000, MAX_SPEED);
    const closeMemory = promised(sentTo(seen([close]), { 1: 'P1' }), 1, STOP_X);
    expect(reachOf(close)).toBeGreaterThan(ENTRY_END_X);
    expect(untilXFor(close, [close], closeMemory, clear, stationOff)).toBe(STOP_X);
    expect(untilXFor(close, [close], closeMemory, occupied('P1'), allAlive)).toBe(STOP_X);
    // Further back it can still stop, so the centre holds it at the end of its entry track.
    const far = train(1, 'A', 3000, MAX_SPEED);
    const farMemory = promised(sentTo(seen([far]), { 1: 'P1' }), 1, STOP_X);
    expect(untilXFor(far, [far], farMemory, clear, stationOff)).toBe(ENTRY_END_X);
    // Whatever the reason, untilX never drops below what was promised and is in reach.
    const fast = train(2, 'A', 2000, MAX_SPEED);
    const trains = [stopped(1, 'A', 2300), fast];
    const memory = promised(seen(trains), 2, 5000);
    expect(untilXFor(fast, trains, memory, clear, allAlive)).toBe(reachOf(fast));
  });

  it("with serves: 'ours', only keeps a train MARGIN behind the rear of the train ahead", () => {
    const trains = [train(1, 'A', 3000), train(2, 'A', 2000)];
    expect(untilXFor(trains[1], trains, seen(trains), clear, allAlive, ours)).toBe(3000 - TRAIN_LENGTH - MARGIN);
    expect(untilXFor(trains[0], trains, seen(trains), clear, allAlive, ours)).toBe(freeRunX());
  });

  it("with serves: 'ours', never holds a train at the end of its entry track, at the platform stop or for a dead actor", () => {
    const allDead = occupied('P1', 'P2', 'P3', 'P4');
    const dead: Alive = { station: false, merge: false };
    for (const t of [train(1, 'A', 5900), stopped(1, 'P1', PLATFORM_STOP), train(1, 'EXIT', 50)]) {
      expect(untilXFor(t, [t], seen([t]), allDead, dead, ours)).toBe(freeRunX());
    }
  });

  it("with serves: 'ours', does not hold a train on A or B behind a train standing in a platform", () => {
    // The station lock decides the platform, so the centre cannot know which one is ahead.
    const trains = [stopped(1, 'P1', PLATFORM_STOP), train(2, 'A', 5500)];
    const memory = sentTo(seen(trains), { 2: 'P1' });
    expect(untilXFor(trains[1], trains, memory, clear, allAlive, ours)).toBe(freeRunX());
  });

  it("with serves: 'ours', a step suggests a platform and never orders the junction", () => {
    const centre = makeCentre(timetable, ours);
    const trains = [stopped(1, 'P1', PLATFORM_STOP), train(2, 'A', 3000), train(4, 'A', 1000)];
    const messages = centre.step(0, trains, clear, { station: false, merge: false });
    expect(permitFor(messages, 1)).toMatchObject({ nextTrack: 'EXIT', untilX: freeRunX() });
    expect(permitFor(messages, 2).nextTrack).toBe('P2');
    expect(permitFor(messages, 4).nextTrack).toBeNull();
    expect(permitFor(messages, 4).untilX).toBe(3000 - TRAIN_LENGTH - MARGIN);
  });
});
