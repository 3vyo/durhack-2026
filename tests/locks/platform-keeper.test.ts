import { afterEach, describe, expect, it } from 'vitest';
import {
  unlockedSettle,
  answerOrder,
  answerPlatformRequest,
  canGrantPlatform,
  canReleasePlatform,
  chooseAlternative,
  createPlatformKeeper,
  heldBy,
  initialPlatformKeeperMemory,
  observePlatform,
  ownPair,
  recordGrant,
  recordHolderRequests,
  recordWaiting,
  trainAheadIsWaiting,
  waitingSilence,
  resumePlatformKeeper,
  stepPlatformKeeper,
  type PlatformLock,
  type PlatformKeeperMemory,
} from '../../src/locks/platform-keeper';
import { REQUEST_REPEAT, RESUME_SETTLE, TICK } from '../../src/shared/constants';
import {
  ALL_PLATFORMS,
  LAYOUT_IDS,
  LAYOUTS,
  PLATFORMS,
  applyLayout,
  pairOf,
  platformReadings,
  resetLayout,
} from '../../src/shared/map';
import type {
  LocalActor,
  Message,
  Outgoing,
  PlatformId,
  SensorReadings,
  TimetableEntry,
  TrainId,
} from '../../src/shared/types';

// Trains 1, 3 and 5 enter on A in that order. Trains 2 and 4 enter on B.
const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
  { id: 3, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
  { id: 4, entry: 'B', enterAt: 60, platform: 'P4', leader: 2, dwell: 30 },
  { id: 5, entry: 'A', enterAt: 120, platform: 'P1', leader: 3, dwell: 30 },
];

const pairA: PlatformId[] = ['P1', 'P2'];

/**
 * Sensor readings with the named platforms occupied and the rest of the layout in use empty.
 * A platform outside the layout reads occupied. Built when called, so it follows the layout.
 */
function sensors(occupied: PlatformId[] = []): SensorReadings {
  const taken: Partial<Record<PlatformId, boolean>> = {};
  for (const platform of occupied) taken[platform] = true;
  return { platformOccupied: platformReadings(taken), junctionOccupied: false, exitStartClear: true };
}

// These two are built when this file loads, so they are for the default layout only. Tests
// that change the layout call sensors() after applyLayout.
const allEmpty = sensors();
/** Every sensor switched off reads occupied. */
const allDead = sensors([...PLATFORMS]);

const ask = (from: TrainId, resource: PlatformId | 'JUNCTION'): Message => ({
  type: 'lockRequest',
  from,
  resource,
});

const grant = (to: TrainId, resource: PlatformId): Outgoing => ({
  msg: { type: 'lockGrant', to, resource, follow: null },
  range: 'short',
});

const refuse = (to: TrainId, resource: PlatformId, alternative: PlatformId | null): Outgoing => ({
  msg: { type: 'lockRefuse', to, resource, alternative },
  range: 'short',
});

const lock: PlatformLock = { holder: 1, grantedAt: 10, seenArrive: true, lastRequestAt: 10 };

/** A memory where the named trains hold the named platforms, granted at time 0. */
function withLocks(held: Partial<Record<PlatformId, TrainId>>): PlatformKeeperMemory {
  let memory = initialPlatformKeeperMemory();
  for (const platform of PLATFORMS) {
    const train = held[platform];
    if (train !== undefined) memory = recordGrant(memory, train, platform, 0);
  }
  return memory;
}

/** Answers one request against a memory, outside any settle window. */
function answer(
  train: TrainId,
  platform: PlatformId,
  memory: PlatformKeeperMemory = initialPlatformKeeperMemory(),
  readings: SensorReadings = sensors(),
) {
  const pair = ownPair(timetable, train);
  return answerPlatformRequest({
    now: 100,
    train,
    platform,
    pair,
    memory,
    sensors: readings,
    settling: false,
  });
}

/**
 * Steps an actor tick by tick. Time is built by adding TICK, as the engine builds it.
 * `off` moves time on without stepping, as when the actor is switched off.
 */
function drive(actor: LocalActor) {
  let now = 0;
  return {
    get now() {
      return now;
    },
    step(inbox: Message[] = [], readings: SensorReadings = sensors()): Outgoing[] {
      const out = actor.step(now, inbox, readings);
      now += TICK;
      return out;
    },
    /** Steps with an empty inbox for this many seconds. Returns everything sent. */
    idle(seconds: number, readings: SensorReadings = sensors()): Outgoing[] {
      const out: Outgoing[] = [];
      for (let i = 0; i < Math.round(seconds / TICK); i++) out.push(...this.step([], readings));
      return out;
    },
    /**
     * Steps for this many seconds while a train repeats its request every REQUEST_REPEAT.
     * Returns everything sent.
     */
    repeat(seconds: number, request: Message, readings: SensorReadings = sensors()): Outgoing[] {
      const out: Outgoing[] = [];
      const every = Math.round(REQUEST_REPEAT / TICK);
      for (let i = 0; i < Math.round(seconds / TICK); i++) {
        out.push(...this.step(i % every === 0 ? [request] : [], readings));
      }
      return out;
    },
    off(seconds: number): void {
      for (let i = 0; i < Math.round(seconds / TICK); i++) now += TICK;
    },
  };
}

const newPlatformKeeper = () => drive(createPlatformKeeper(timetable));

describe('platform keeper frame', () => {
  it('has id platformKeeper', () => {
    expect(createPlatformKeeper(timetable).id).toBe('platformKeeper');
  });

  it('starts with no locks, no step seen and no resume', () => {
    const none = { P1: null, P2: null, P3: null, P4: null, P5: null, P6: null, P7: null, P8: null };
    expect(initialPlatformKeeperMemory()).toEqual({
      locks: none,
      unlockedOccupiedAt: none,
      lastStepAt: null,
      resumedAt: null,
    });
  });
});

describe('ownPair (Entering the station)', () => {
  it('returns P1 and P2 for a train that enters on A', () => {
    expect(ownPair(timetable, 1)).toEqual(['P1', 'P2']);
  });

  it('returns P3 and P4 for a train that enters on B', () => {
    expect(ownPair(timetable, 2)).toEqual(['P3', 'P4']);
  });

  it('returns no platforms for a train that is not in the timetable', () => {
    expect(ownPair(timetable, 99)).toEqual([]);
  });
});

describe('Entering the station: granting', () => {
  it('grants a platform whose sensor says empty and whose lock nobody holds', () => {
    expect(answer(1, 'P1')).toEqual({ kind: 'grant', platform: 'P1' });
  });

  it('refuses a platform whose sensor says occupied', () => {
    expect(answer(1, 'P1', initialPlatformKeeperMemory(), sensors(['P1'])).kind).toBe('refuse');
  });

  it('refuses a platform whose lock another train holds, even when its sensor says empty', () => {
    expect(answer(3, 'P1', withLocks({ P1: 1 })).kind).toBe('refuse');
  });

  it("never grants a platform outside the requesting train's own pair", () => {
    const check = { now: 100, train: 1, pair: pairA, memory: initialPlatformKeeperMemory(), sensors: allEmpty };
    expect(canGrantPlatform({ ...check, platform: 'P3' })).toBe(false);
    expect(canGrantPlatform({ ...check, platform: 'P4' })).toBe(false);
    expect(answer(1, 'P3').kind).toBe('refuse');
  });

  it('never grants a platform to a train that is not in the timetable', () => {
    for (const platform of PLATFORMS) {
      expect(answer(99, platform)).toEqual({ kind: 'refuse', alternative: null });
    }
  });

  it('grants the same platform again when its holder repeats the request', () => {
    const memory = withLocks({ P1: 1 });
    expect(answer(1, 'P1', memory)).toEqual({ kind: 'grant', platform: 'P1' });
    // Even when the train's own front makes the sensor read occupied.
    expect(answer(1, 'P1', memory, sensors(['P1']))).toEqual({ kind: 'grant', platform: 'P1' });
  });

  it('never gives one train locks on two platforms at once', () => {
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    keeper.step([ask(1, 'P2')]);
    // P2 is still free for the next train on A, so train 1 does not hold it.
    expect(keeper.step([ask(3, 'P2')])).toEqual([grant(3, 'P2')]);
    expect(canGrantPlatform({
      now: 100,
      train: 1,
      platform: 'P2',
      pair: pairA,
      memory: withLocks({ P1: 1 }),
      sensors: allEmpty,
    })).toBe(false);
  });

  it('keeps a holder on its current platform when it asks for the other platform of its pair', () => {
    expect(answer(1, 'P2', withLocks({ P1: 1 }))).toEqual({ kind: 'grant', platform: 'P1' });
  });

  it('when two trains ask for the same free platform on one tick, grants it to the train with the earlier enterAt', () => {
    const keeper = newPlatformKeeper();
    const out = keeper.step([ask(5, 'P1'), ask(3, 'P1')]);
    expect(out).toEqual([grant(3, 'P1'), refuse(5, 'P1', 'P2')]);
  });

  it('answerOrder puts the trains asking on one tick in order of enterAt, earliest first', () => {
    expect(answerOrder([5, 3, 1], timetable)).toEqual([1, 3, 5]);
  });

  it('answerOrder puts the lowest ID first when two trains have the same enterAt', () => {
    expect(answerOrder([4, 2, 1], timetable)).toEqual([1, 2, 4]);
  });

  it('answerOrder puts a train that is not in the timetable last', () => {
    expect(answerOrder([99, 5, 1], timetable)).toEqual([1, 5, 99]);
  });

  it('records the holder and the grant time in the lock table on a grant', () => {
    const memory = recordGrant(initialPlatformKeeperMemory(), 1, 'P1', 20);
    expect(memory.locks.P1).toEqual({ holder: 1, grantedAt: 20, seenArrive: false, lastRequestAt: 20 });
    expect(memory.locks.P2).toBeNull();
    expect(heldBy(memory, 1)).toBe('P1');
  });

  it('sends lockGrant to the requesting train with resource set to the platform and follow null', () => {
    expect(newPlatformKeeper().step([ask(2, 'P4')])).toEqual([
      { msg: { type: 'lockGrant', to: 2, resource: 'P4', follow: null }, range: 'short' },
    ]);
  });
});

describe('Entering the station: refusing', () => {
  it('refuses with the other platform of the pair as alternative when that one could be granted now', () => {
    expect(answer(1, 'P1', initialPlatformKeeperMemory(), sensors(['P1']))).toEqual({
      kind: 'refuse',
      alternative: 'P2',
    });
    expect(answer(2, 'P4', initialPlatformKeeperMemory(), sensors(['P4']))).toEqual({
      kind: 'refuse',
      alternative: 'P3',
    });
  });

  it('refuses with alternative null when neither platform of the pair could be granted', () => {
    expect(answer(1, 'P1', initialPlatformKeeperMemory(), sensors(['P1', 'P2']))).toEqual({
      kind: 'refuse',
      alternative: null,
    });
  });

  it("never offers a platform outside the requesting train's own pair as an alternative", () => {
    // P3 and P4 are free, but they belong to track B.
    const check = { now: 100, train: 1, pair: pairA, memory: initialPlatformKeeperMemory() };
    expect(chooseAlternative({ ...check, requested: 'P1', sensors: sensors(['P1', 'P2']) })).toBeNull();
    // A train that asks outside its pair is only ever offered its own platforms.
    expect(chooseAlternative({ ...check, requested: 'P3', sensors: sensors(['P1']) })).toBe('P2');
  });

  it('never offers an alternative whose lock another train holds', () => {
    const memory = withLocks({ P2: 3 });
    expect(answer(1, 'P1', memory, sensors(['P1']))).toEqual({ kind: 'refuse', alternative: null });
  });

  it('answers every repeat of a refused request, since the train repeats it every 2 seconds', () => {
    const keeper = newPlatformKeeper();
    const full = sensors(['P1', 'P2']);
    const out = keeper.repeat(3 * REQUEST_REPEAT, ask(1, 'P1'), full);
    expect(out).toEqual([refuse(1, 'P1', null), refuse(1, 'P1', null), refuse(1, 'P1', null)]);
  });

  it('grants the alternative when the train then asks for it and it is still free', () => {
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    expect(keeper.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', 'P2')]);
    expect(keeper.step([ask(3, 'P2')])).toEqual([grant(3, 'P2')]);
  });
});

describe('Entering the station: releasing', () => {
  const silent = REQUEST_REPEAT + 2 * TICK;
  const check = { resumedAt: null, settle: RESUME_SETTLE, repeat: REQUEST_REPEAT };

  it('records the arrival once the sensor shows occupied after the grant', () => {
    const fresh: PlatformLock = { ...lock, seenArrive: false };
    expect(observePlatform(fresh, false, 20).seenArrive).toBe(false);
    expect(observePlatform(fresh, true, 20).seenArrive).toBe(true);
    // Once seen, it stays seen after the train has left.
    expect(observePlatform(lock, false, 30).seenArrive).toBe(true);
  });

  it('releases the lock once the sensor has shown arrive then leave and the holder has not been heard for longer than one repeat plus two ticks', () => {
    const at = (now: number) => canReleasePlatform({ ...check, now, lock, occupied: false });
    expect(at(lock.lastRequestAt + silent)).toBe(false);
    expect(at(lock.lastRequestAt + silent + TICK)).toBe(true);
  });

  it("keeps the lock when the holder's last repeat was heard exactly one repeat plus one tick ago", () => {
    const now = lock.lastRequestAt + REQUEST_REPEAT + TICK;
    expect(canReleasePlatform({ ...check, now, lock, occupied: false })).toBe(false);
  });

  it('does not release the lock while the sensor still shows the train in the platform', () => {
    expect(canReleasePlatform({ ...check, now: 1000, lock, occupied: true })).toBe(false);
  });

  it('does not release the lock when the sensor shows empty before the train has arrived', () => {
    const fresh: PlatformLock = { ...lock, seenArrive: false };
    expect(canReleasePlatform({ ...check, now: 1000, lock: fresh, occupied: false })).toBe(false);
  });

  it('grants the platform to another train once the lock is released', () => {
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    keeper.idle(30, sensors(['P1']));
    expect(keeper.step([ask(3, 'P1')], sensors(['P1']))).toEqual([refuse(3, 'P1', 'P2')]);
    keeper.step([], allEmpty);
    expect(keeper.step([ask(3, 'P1')])).toEqual([grant(3, 'P1')]);
  });
});

describe('Platform sensors switched off', () => {
  it('treats a dead sensor as occupied and never grants that platform', () => {
    const keeper = newPlatformKeeper();
    const out = keeper.repeat(10 * REQUEST_REPEAT, ask(1, 'P1'), sensors(['P1', 'P2']));
    expect(out).toHaveLength(10);
    expect(out.every((o) => o.msg.type === 'lockRefuse')).toBe(true);
  });

  it('offers the other platform of the pair as alternative when one sensor is dead and the other platform is free', () => {
    expect(newPlatformKeeper().step([ask(1, 'P1')], sensors(['P1']))).toEqual([refuse(1, 'P1', 'P2')]);
  });

  it('refuses every request with alternative null when every sensor is dead', () => {
    const out = newPlatformKeeper().step([ask(1, 'P1'), ask(2, 'P3'), ask(3, 'P2'), ask(4, 'P4')], allDead);
    expect(out).toEqual([
      refuse(1, 'P1', null),
      refuse(2, 'P3', null),
      refuse(3, 'P2', null),
      refuse(4, 'P4', null),
    ]);
  });

  it('never releases a lock while its train could still be on its way in', () => {
    // Train 1 is granted P1 and keeps asking on its way in. The sensors die and come back
    // twice, which looks like a train arriving and leaving. Train 3 never gets P1.
    const keeper = newPlatformKeeper();
    const both = [ask(1, 'P1'), ask(3, 'P1')];
    const every = Math.round(REQUEST_REPEAT / TICK);
    const sent: Outgoing[] = [];
    for (let i = 0; i < 600; i++) {
      const dead = Math.floor(i / 100) % 2 === 1;
      sent.push(...keeper.step(i % every === 0 ? both : [], dead ? allDead : allEmpty));
    }
    const toTrain3 = sent.filter((o) => o.msg.type !== 'lockRequest' && 'to' in o.msg && o.msg.to === 3);
    expect(toTrain3.length).toBeGreaterThan(0);
    expect(toTrain3.every((o) => o.msg.type === 'lockRefuse')).toBe(true);
    expect(toTrain3.some((o) => o.msg.type === 'lockRefuse' && o.msg.alternative === 'P1')).toBe(false);
  });

  it('keeps the lock while it hears the holder repeat its request, which the train does after the grant until its front is in the platform', () => {
    const keeper = newPlatformKeeper();
    const out = keeper.repeat(60, ask(1, 'P1'));
    expect(out.every((o) => o.msg.type === 'lockGrant' && o.msg.to === 1)).toBe(true);
    expect(out).toHaveLength(60 / REQUEST_REPEAT);
    expect(keeper.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', 'P2')]);
  });

  it('answers the holder with the grant again, never a refusal, while a dead sensor reads occupied', () => {
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    const out = keeper.repeat(20, ask(1, 'P1'), allDead);
    expect(out).toHaveLength(20 / REQUEST_REPEAT);
    expect(out.every((o) => o.msg.type === 'lockGrant')).toBe(true);
  });

  it('does not release a lock when a sensor dies and comes back while the holder is still asking', () => {
    // The sensor has shown occupied and then empty, and the holder was heard a moment ago.
    const heard: PlatformLock = { holder: 1, grantedAt: 10, seenArrive: true, lastRequestAt: 50 };
    const check = { lock: heard, occupied: false, resumedAt: null, settle: RESUME_SETTLE, repeat: REQUEST_REPEAT };
    expect(canReleasePlatform({ ...check, now: 50 + TICK })).toBe(false);
    expect(canReleasePlatform({ ...check, now: 50 + REQUEST_REPEAT })).toBe(false);
  });

  it('does not grant a platform that a creeping train may be heading into when the sensors come back', () => {
    // The sensors are dead, so trains creep in without locks. The sensors come back and
    // P1 reads empty, but a creeping train may be about to roll onto it.
    const keeper = newPlatformKeeper();
    keeper.idle(20, allDead);
    const out = keeper.repeat(unlockedSettle(), ask(1, 'P1'));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => o.msg.type === 'lockRefuse' && o.msg.alternative === null)).toBe(true);
    keeper.idle(2 * TICK);
    expect(keeper.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
  });

  it('does not grant a platform that a train without a lock has just left until it has read empty for unlockedSettle()', () => {
    const memory: PlatformKeeperMemory = {
      ...initialPlatformKeeperMemory(),
      unlockedOccupiedAt: { ...initialPlatformKeeperMemory().unlockedOccupiedAt, P1: 100 },
    };
    const check = { train: 1, platform: 'P1' as const, pair: pairA, memory, sensors: allEmpty };
    expect(canGrantPlatform({ ...check, now: 100 + unlockedSettle() })).toBe(false);
    expect(canGrantPlatform({ ...check, now: 100 + unlockedSettle() + TICK })).toBe(true);
  });

  it('does not hold back a platform whose last train held its lock', () => {
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    keeper.idle(30, sensors(['P1']));
    keeper.step([], allEmpty);
    expect(keeper.step([ask(3, 'P1')])).toEqual([grant(3, 'P1')]);
  });
});

describe('Messages (The radio)', () => {
  it('sends every reply over short range', () => {
    const out = newPlatformKeeper().step([ask(1, 'P1'), ask(3, 'P1'), ask(5, 'P1'), ask(99, 'P1')]);
    expect(out).toHaveLength(4);
    expect(out.every((o) => o.range === 'short')).toBe(true);
  });

  it('replies on the tick it reads the request, so the train hears it on the next tick', () => {
    const keeper = newPlatformKeeper();
    expect(keeper.step([])).toEqual([]);
    expect(keeper.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
    expect(keeper.step([])).toEqual([]);
  });

  it('ignores lockRequest for JUNCTION, which is for the junction keeper', () => {
    expect(newPlatformKeeper().step([ask(1, 'JUNCTION')])).toEqual([]);
  });

  it('ignores every message that is not a lockRequest', () => {
    const inbox: Message[] = [
      { type: 'position', from: 1, pos: { track: 'A', offset: 5000 }, speed: 20, sentAt: 0 },
      { type: 'lockGrant', to: 1, resource: 'P1', follow: null },
      { type: 'lockRefuse', to: 1, resource: 'P1', alternative: null },
      { type: 'platformStatus', platform: 'P1', occupied: false, sentAt: 0 },
      { type: 'permit', to: 1, untilX: 6000, nextTrack: 'P1', sentAt: 0 },
    ];
    const keeper = newPlatformKeeper();
    expect(keeper.step(inbox)).toEqual([]);
    // None of them took a lock.
    expect(keeper.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
  });

  it('sends nothing on a tick with no requests', () => {
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    expect(keeper.idle(30, sensors(['P1']))).toEqual([]);
    expect(keeper.idle(30)).toEqual([]);
  });
});

describe('Switched back on (rule from the review on #31)', () => {
  const resumedAt = 50;
  const windowOver = resumedAt + RESUME_SETTLE;
  const check = { resumedAt, settle: RESUME_SETTLE, repeat: REQUEST_REPEAT };
  const unseen: PlatformLock = { holder: 1, grantedAt: 10, seenArrive: false, lastRequestAt: 12 };

  it('keeps its lock table across being switched off and on', () => {
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    keeper.off(60);
    keeper.repeat(RESUME_SETTLE + TICK, ask(1, 'P1'));
    // Train 1 still holds P1, so train 3 is offered P2.
    expect(keeper.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', 'P2')]);
  });

  it('sets lastStepAt to now on every step', () => {
    let memory = initialPlatformKeeperMemory();
    for (const now of [0, TICK, 2 * TICK, 40]) {
      memory = stepPlatformKeeper(memory, timetable, now, [], allEmpty).memory;
      expect(memory.lastStepAt).toBe(now);
    }
  });

  it('sets resumedAt to now when wasSwitchedOff says it was off', () => {
    let memory = stepPlatformKeeper(initialPlatformKeeperMemory(), timetable, 0, [], allEmpty).memory;
    memory = stepPlatformKeeper(memory, timetable, TICK, [], allEmpty).memory;
    expect(memory.resumedAt).toBeNull();
    memory = stepPlatformKeeper(memory, timetable, 30, [], allEmpty).memory;
    expect(memory.resumedAt).toBe(30);
    memory = stepPlatformKeeper(memory, timetable, 30 + TICK, [], allEmpty).memory;
    expect(memory.resumedAt).toBe(30);
  });

  it('counts its first step as coming back on when the run is already past time 0', () => {
    const memory = stepPlatformKeeper(initialPlatformKeeperMemory(), timetable, 30, [ask(1, 'P1')], allEmpty);
    expect(memory.memory.resumedAt).toBe(30);
    expect(memory.out).toEqual([refuse(1, 'P1', null)]);
  });

  it('keeps every lock when it comes back, since the gap itself releases nothing', () => {
    const before = withLocks({ P1: 1, P3: 2 });
    const after = resumePlatformKeeper(before, resumedAt);
    expect(after.locks).toEqual(before.locks);
    expect(after.resumedAt).toBe(resumedAt);
  });

  it('grants nothing until resumedAt + settle', () => {
    const keeper = newPlatformKeeper();
    keeper.step();
    keeper.off(60);
    const out = keeper.repeat(RESUME_SETTLE, ask(1, 'P1'));
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((o) => o.msg.type === 'lockGrant')).toBe(false);
    expect(keeper.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
  });

  it('refuses every platform request with alternative null until resumedAt + settle, so waiting trains stop falling back to the fixed split', () => {
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    keeper.off(60);
    // Train 1 holds P1 and is refused too. It keeps its lock and ignores the refusal.
    const first = keeper.step([ask(1, 'P1'), ask(2, 'P3'), ask(3, 'P2')]);
    expect(first).toEqual([refuse(1, 'P1', null), refuse(2, 'P3', null), refuse(3, 'P2', null)]);
    keeper.idle(RESUME_SETTLE - 2 * TICK);
    expect(keeper.step([ask(2, 'P3')])).toEqual([refuse(2, 'P3', null)]);
    expect(keeper.step([ask(2, 'P3'), ask(1, 'P1')])).toEqual([grant(1, 'P1'), grant(2, 'P3')]);
  });

  it('does not grant a platform that a train set off for by the fixed split, since that train shows on the sensor inside the window', () => {
    const keeper = newPlatformKeeper();
    keeper.step();
    keeper.off(60);
    // The train rolls onto P1 a second after the actor comes back.
    keeper.idle(1);
    const out = keeper.repeat(RESUME_SETTLE + 10, ask(3, 'P1'), sensors(['P1']));
    expect(out.some((o) => o.msg.type === 'lockGrant' && o.msg.resource === 'P1')).toBe(false);
  });

  it('releases a lock with seenArrive true by the normal rule, inside or after the window', () => {
    const seen: PlatformLock = { ...unseen, seenArrive: true };
    const at = (now: number) => canReleasePlatform({ ...check, now, lock: seen, occupied: false });
    // The silence counts from resumedAt, since the actor heard nothing while it was off.
    expect(at(resumedAt)).toBe(false);
    expect(at(resumedAt + REQUEST_REPEAT + 2 * TICK)).toBe(false);
    expect(at(resumedAt + REQUEST_REPEAT + 3 * TICK)).toBe(true);
    expect(at(windowOver + 10)).toBe(true);
  });

  it('releases a lock with seenArrive false once the window is over, its sensor reads empty and the holder was not heard during the whole window', () => {
    expect(canReleasePlatform({ ...check, now: windowOver, lock: unseen, occupied: false })).toBe(true);
  });

  it('keeps a lock with seenArrive false whose holder was heard during the window', () => {
    for (const lastRequestAt of [resumedAt, resumedAt + 2, windowOver - TICK]) {
      const heard: PlatformLock = { ...unseen, lastRequestAt };
      expect(canReleasePlatform({ ...check, now: windowOver + 10, lock: heard, occupied: false })).toBe(false);
    }
  });

  it('keeps a lock with seenArrive false whose sensor reads occupied, which includes a dead sensor', () => {
    expect(canReleasePlatform({ ...check, now: windowOver + 10, lock: unseen, occupied: true })).toBe(false);
  });

  it('keeps a lock with seenArrive false until the window is over, even if its sensor reads empty', () => {
    for (const now of [resumedAt, resumedAt + 1, windowOver - TICK]) {
      expect(canReleasePlatform({ ...check, now, lock: unseen, occupied: false })).toBe(false);
    }
  });

  it('never releases a lock with seenArrive false if it has never been switched off', () => {
    expect(
      canReleasePlatform({ ...check, resumedAt: null, now: 1000, lock: unseen, occupied: false }),
    ).toBe(false);
  });

  it('refuses a holder from before the gap while its platform reads occupied, and keeps its lock', () => {
    // A train may have taken P1 by the fixed split while the actor was off.
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    keeper.off(60);
    keeper.repeat(RESUME_SETTLE + TICK, ask(1, 'P1'), sensors(['P1']));
    expect(keeper.step([ask(1, 'P1')], sensors(['P1']))).toEqual([refuse(1, 'P1', null)]);
    expect(keeper.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
  });

  it('notes a request from a lock holder, whichever platform it asks for', () => {
    const memory = recordHolderRequests(withLocks({ P1: 1, P3: 2 }), [ask(1, 'P2'), ask(3, 'P1')], 20);
    expect(memory.locks.P1?.lastRequestAt).toBe(20);
    expect(memory.locks.P3?.lastRequestAt).toBe(0);
  });
});

describe('Scenarios', () => {
  it('a train granted P1 arrives and leaves, and the lock is released', () => {
    const keeper = newPlatformKeeper();
    // Train 1 asks at the ask point and keeps asking until its front is in the platform.
    const approach = keeper.repeat(40, ask(1, 'P1'));
    expect(approach.every((o) => o.msg.type === 'lockGrant' && o.msg.resource === 'P1')).toBe(true);
    // It stands in P1 for its dwell time. Train 3 asks for P1 and is sent to P2.
    keeper.idle(10, sensors(['P1']));
    expect(keeper.step([ask(3, 'P1')], sensors(['P1']))).toEqual([refuse(3, 'P1', 'P2')]);
    expect(keeper.step([ask(3, 'P2')], sensors(['P1']))).toEqual([grant(3, 'P2')]);
    keeper.idle(20, sensors(['P1']));
    // Train 1 leaves. The sensor reads empty and the lock is released on that tick.
    keeper.step([], allEmpty);
    expect(keeper.step([ask(5, 'P1')])).toEqual([grant(5, 'P1')]);
  });

  it('keeps the lock for one repeat plus two ticks after a holder that was just heard', () => {
    // The sensor flickers while train 1 is on its way in, then train 1 goes silent. The
    // lock stays for one repeat plus two ticks after its last request.
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    keeper.step([], sensors(['P1']));
    const ticks = Math.round(REQUEST_REPEAT / TICK) + 1;
    for (let i = 0; i < ticks; i++) {
      expect(keeper.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', 'P2')]);
    }
    expect(keeper.step([ask(3, 'P1')])).toEqual([grant(3, 'P1')]);
  });

  it('with P1 occupied, a train from track A is offered P2 and gets it', () => {
    const keeper = newPlatformKeeper();
    const p1Taken = sensors(['P1']);
    expect(keeper.step([ask(3, 'P1')], p1Taken)).toEqual([refuse(3, 'P1', 'P2')]);
    expect(keeper.step([ask(3, 'P2')], p1Taken)).toEqual([grant(3, 'P2')]);
    // With both taken, the next train on A is offered nothing and never a B platform.
    expect(keeper.step([ask(5, 'P1')], p1Taken)).toEqual([refuse(5, 'P1', null)]);
  });

  it('trains on A and B are granted their own platforms on the same tick', () => {
    const out = newPlatformKeeper().step([ask(4, 'P4'), ask(3, 'P2'), ask(2, 'P3'), ask(1, 'P1')]);
    expect(out).toEqual([grant(1, 'P1'), grant(2, 'P3'), grant(3, 'P2'), grant(4, 'P4')]);
  });

  it('the settle window after a resume', () => {
    const keeper = newPlatformKeeper();
    // Train 1 holds P1 and is on its way in. Train 3 arrived and left P2 before the gap.
    keeper.step([ask(1, 'P1'), ask(3, 'P2')]);
    keeper.repeat(10, ask(1, 'P1'), sensors(['P2']));
    keeper.off(30);
    // Back on. For RESUME_SETTLE every request is refused with no alternative.
    const both = [ask(1, 'P1'), ask(5, 'P2')];
    const every = Math.round(REQUEST_REPEAT / TICK);
    for (let i = 0; i < Math.round(RESUME_SETTLE / TICK); i++) {
      const out = keeper.step(i % every === 0 ? both : []);
      if (i % every === 0) expect(out).toEqual([refuse(1, 'P1', null), refuse(5, 'P2', null)]);
      else expect(out).toEqual([]);
    }
    // The window is over. Train 1 kept its lock. Train 3's lock on P2 was released, since
    // the sensor showed it arrive and the platform is empty.
    expect(keeper.step(both)).toEqual([grant(1, 'P1'), grant(5, 'P2')]);
  });

  it('a lock whose train never arrived is released after the window if the holder stays silent', () => {
    const keeper = newPlatformKeeper();
    keeper.step([ask(1, 'P1')]);
    keeper.off(120);
    keeper.idle(RESUME_SETTLE - TICK);
    expect(keeper.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', null)]);
    expect(keeper.step([ask(3, 'P1')])).toEqual([grant(3, 'P1')]);
  });
});

describe('the queue on an entry track', () => {
  // Trains 1, 3 and 5 enter track A in that order. Train 2 is on track B.
  const queue: TimetableEntry[] = [
    { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
    { id: 2, entry: 'B', enterAt: 10, platform: 'P3', leader: null, dwell: 30 },
    { id: 3, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
    { id: 5, entry: 'A', enterAt: 120, platform: 'P1', leader: 3, dwell: 30 },
  ];
  const free: SensorReadings = sensors();
  const asks = (train: number, resource: PlatformId): Message => ({ type: 'lockRequest', from: train, resource });
  const repliesTo = (out: Outgoing[], train: number) => out.map((o) => o.msg).filter((m) => 'to' in m && m.to === train);
  // The engine steps an actor every tick. A gap would look like the actor being switched
  // back on, so these tests step through every tick, with an empty inbox in between.
  const at = (tick: number) => tick * TICK;
  function stepAt(memory: PlatformKeeperMemory, from: number, tick: number, inbox: Message[], sensors: SensorReadings) {
    let m = memory;
    for (let t = from; t < tick; t++) m = stepPlatformKeeper(m, queue, at(t), [], sensors).memory;
    return stepPlatformKeeper(m, queue, at(tick), inbox, sensors);
  }

  it('says a train ahead is waiting only for an earlier train on the same entry track with no lock', () => {
    const memory = recordWaiting(initialPlatformKeeperMemory(), [asks(3, 'P2')], 100);
    expect(trainAheadIsWaiting(memory, queue, 5)).toBe(true);
    expect(trainAheadIsWaiting(memory, queue, 1)).toBe(false); // train 1 is ahead of train 3
    expect(trainAheadIsWaiting(memory, queue, 2)).toBe(false); // another entry track
    expect(trainAheadIsWaiting(memory, queue, 3)).toBe(false); // not behind itself
  });

  it('refuses a train further back while the train in front of it has no platform', () => {
    // P2 is taken, so train 3 at the front is refused. Train 5 behind it asks for the free P1.
    const busy = { ...free, platformOccupied: { ...free.platformOccupied, P2: true } };
    const first = stepAt(initialPlatformKeeperMemory(), 0, 5, [asks(3, 'P2'), asks(5, 'P1')], busy);
    expect(repliesTo(first.out, 5)).toEqual([{ type: 'lockRefuse', to: 5, resource: 'P1', alternative: null }]);
    expect(repliesTo(first.out, 3)).toEqual([{ type: 'lockRefuse', to: 3, resource: 'P2', alternative: 'P1' }]);
    // The front train takes the alternative, and only then can the one behind be served.
    const second = stepAt(first.memory, 6, 25, [asks(3, 'P1'), asks(5, 'P1')], busy);
    expect(repliesTo(second.out, 3)).toEqual([{ type: 'lockGrant', to: 3, resource: 'P1', follow: null }]);
    expect(heldBy(second.memory, 5)).toBeNull();
  });

  it('serves the train behind once the train in front holds a platform', () => {
    const first = stepAt(initialPlatformKeeperMemory(), 0, 5, [asks(3, 'P2')], free);
    expect(heldBy(first.memory, 3)).toBe('P2');
    const second = stepAt(first.memory, 6, 6, [asks(5, 'P1')], free);
    expect(repliesTo(second.out, 5)).toEqual([{ type: 'lockGrant', to: 5, resource: 'P1', follow: null }]);
  });

  it('does not hold up a train on the other entry track', () => {
    const busy = { ...free, platformOccupied: { ...free.platformOccupied, P1: true, P2: true } };
    const step = stepAt(initialPlatformKeeperMemory(), 0, 5, [asks(1, 'P1'), asks(2, 'P3')], busy);
    expect(repliesTo(step.out, 2)).toEqual([{ type: 'lockGrant', to: 2, resource: 'P3', follow: null }]);
  });

  it('stops counting a train as waiting once it has been silent for two repeats', () => {
    let memory = recordWaiting(initialPlatformKeeperMemory(), [asks(3, 'P2')], 100);
    memory = recordWaiting(memory, [], 100 + waitingSilence());
    expect(trainAheadIsWaiting(memory, queue, 5)).toBe(true);
    memory = recordWaiting(memory, [], 100 + waitingSilence() + 2 * TICK);
    expect(trainAheadIsWaiting(memory, queue, 5)).toBe(false);
  });

  it('keeps a lock holder its platform even when a train ahead starts waiting', () => {
    const first = stepAt(initialPlatformKeeperMemory(), 0, 5, [asks(5, 'P1')], free);
    expect(heldBy(first.memory, 5)).toBe('P1');
    const busy = { ...free, platformOccupied: { ...free.platformOccupied, P2: true } };
    const second = stepAt(first.memory, 6, 25, [asks(3, 'P2'), asks(5, 'P1')], busy);
    expect(repliesTo(second.out, 5)).toEqual([{ type: 'lockGrant', to: 5, resource: 'P1', follow: null }]);
  });
});

describe('Layouts', () => {
  afterEach(() => resetLayout());

  // Trains 1 to 4 are the first trains on A, B, C and D. Trains 5 to 8 are the second, and
  // trains 9 and 10 are the third on C and D.
  const everyLine: TimetableEntry[] = [
    { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
    { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
    { id: 3, entry: 'C', enterAt: 0, platform: 'P5', leader: null, dwell: 30 },
    { id: 4, entry: 'D', enterAt: 0, platform: 'P7', leader: null, dwell: 30 },
    { id: 5, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
    { id: 6, entry: 'B', enterAt: 60, platform: 'P4', leader: 2, dwell: 30 },
    { id: 7, entry: 'C', enterAt: 60, platform: 'P6', leader: 3, dwell: 30 },
    { id: 8, entry: 'D', enterAt: 60, platform: 'P8', leader: 4, dwell: 30 },
    { id: 9, entry: 'C', enterAt: 120, platform: 'P5', leader: 7, dwell: 30 },
    { id: 10, entry: 'D', enterAt: 120, platform: 'P7', leader: 8, dwell: 30 },
  ];

  /** Applies the layout and builds a keeper for the trains on that layout's entry tracks. */
  function keeperOn(layout: (typeof LAYOUT_IDS)[number]) {
    applyLayout(layout);
    const entries = LAYOUTS[layout].entries;
    return drive(createPlatformKeeper(everyLine.filter((e) => entries.includes(e.entry))));
  }

  /**
   * Readings where every platform reads empty, even one outside the layout. The engine never
   * sends this. It checks that the keeper does not lean on the readings to know the layout.
   */
  function everyPlatformReadsEmpty(): SensorReadings {
    const none: Partial<Record<PlatformId, boolean>> = {};
    for (const platform of ALL_PLATFORMS) none[platform] = false;
    return { platformOccupied: platformReadings(none), junctionOccupied: false, exitStartClear: true };
  }

  it('has a place in its memory for every platform, whichever layout is in use', () => {
    for (const layout of LAYOUT_IDS) {
      applyLayout(layout);
      const memory = initialPlatformKeeperMemory();
      expect(Object.keys(memory.locks)).toEqual([...ALL_PLATFORMS]);
      expect(Object.keys(memory.unlockedOccupiedAt)).toEqual([...ALL_PLATFORMS]);
      expect(Object.values(memory.locks).every((lock) => lock === null)).toBe(true);
    }
  });

  it('ownPair gives each entry track its own two platforms on hub', () => {
    applyLayout('hub');
    expect(ownPair(everyLine, 1)).toEqual(['P1', 'P2']);
    expect(ownPair(everyLine, 2)).toEqual(['P3', 'P4']);
    expect(ownPair(everyLine, 3)).toEqual(['P5', 'P6']);
    expect(ownPair(everyLine, 4)).toEqual(['P7', 'P8']);
  });

  it('ownPair gives no platforms to a train whose entry track is not in the layout', () => {
    applyLayout('branch');
    expect(ownPair(everyLine, 1)).toEqual(['P1', 'P2']);
    expect(ownPair(everyLine, 2)).toEqual([]);
    applyLayout('busy');
    expect(ownPair(everyLine, 3)).toEqual(['P5', 'P6']);
    expect(ownPair(everyLine, 4)).toEqual([]);
  });

  // ownPair already leaves out a platform outside the layout. This checks the grant rule's own
  // guard, by handing it a pair that names such a platform and readings that wrongly show it empty.
  it('never grants or offers a platform outside the layout, even when it is handed one as part of the pair', () => {
    applyLayout('junction');
    const check = { now: 100, train: 3, pair: [...pairOf('C')], memory: initialPlatformKeeperMemory(), sensors: everyPlatformReadsEmpty() };
    expect(canGrantPlatform({ ...check, platform: 'P5' })).toBe(false);
    expect(canGrantPlatform({ ...check, platform: 'P6' })).toBe(false);
    expect(chooseAlternative({ ...check, requested: 'P5' })).toBeNull();
    // The same check grants once the layout has line C.
    applyLayout('busy');
    expect(canGrantPlatform({ ...check, platform: 'P5' })).toBe(true);
    expect(chooseAlternative({ ...check, requested: 'P5' })).toBe('P6');
  });

  it('on busy, grants a train from C the platform of its pair that it asks for', () => {
    expect(keeperOn('busy').step([ask(3, 'P5')])).toEqual([grant(3, 'P5')]);
    expect(keeperOn('busy').step([ask(3, 'P6')])).toEqual([grant(3, 'P6')]);
  });

  it('on busy, offers a train from C the other platform of its pair, and nothing when both are taken', () => {
    expect(keeperOn('busy').step([ask(3, 'P5')], sensors(['P5']))).toEqual([refuse(3, 'P5', 'P6')]);
    expect(keeperOn('busy').step([ask(3, 'P6')], sensors(['P6']))).toEqual([refuse(3, 'P6', 'P5')]);
    // P1 to P4 are free, but they belong to A and B.
    expect(keeperOn('busy').step([ask(3, 'P5')], sensors(['P5', 'P6']))).toEqual([refuse(3, 'P5', null)]);
  });

  it('on hub, grants a train from D P7 or P8 and offers it nothing else', () => {
    expect(keeperOn('hub').step([ask(4, 'P7')])).toEqual([grant(4, 'P7')]);
    expect(keeperOn('hub').step([ask(4, 'P8')])).toEqual([grant(4, 'P8')]);
    expect(keeperOn('hub').step([ask(4, 'P7')], sensors(['P7']))).toEqual([refuse(4, 'P7', 'P8')]);
    expect(keeperOn('hub').step([ask(4, 'P7')], sensors(['P7', 'P8']))).toEqual([refuse(4, 'P7', null)]);
  });

  it("on every layout, never grants or offers a platform outside the layout or outside the asking train's pair", () => {
    let grants = 0;
    for (const layout of LAYOUT_IDS) {
      applyLayout(layout);
      for (const train of [1, 2, 3, 4]) {
        const entry = everyLine.find((e) => e.id === train)!.entry;
        const pair = pairOf(entry);
        const allowed = pair.filter((p) => PLATFORMS.includes(p));
        const readings = [sensors(), everyPlatformReadsEmpty(), sensors([pair[0]]), sensors([pair[1]])];
        for (const asked of ALL_PLATFORMS) {
          for (const reading of readings) {
            // The whole timetable, so a train from a track outside the layout asks too.
            const out = drive(createPlatformKeeper(everyLine)).step([ask(train, asked)], reading);
            expect(out).toHaveLength(1);
            const msg = out[0].msg;
            if (msg.type === 'lockGrant') {
              grants++;
              expect(msg.resource).toBe(asked);
              expect(allowed).toContain(msg.resource);
            } else if (msg.type === 'lockRefuse') {
              if (msg.alternative !== null) expect(allowed).toContain(msg.alternative);
            } else {
              throw new Error('the keeper sent something that is not a reply');
            }
          }
        }
      }
    }
    // The loop is not empty of grants: every train on a track of its layout gets some.
    expect(grants).toBeGreaterThan(0);
  });

  it('on every layout, grants each platform of the layout to the first train on its entry track', () => {
    for (const layout of LAYOUT_IDS) {
      applyLayout(layout);
      for (const platform of PLATFORMS) {
        const train = everyLine.find((e) => pairOf(e.entry).includes(platform))!.id;
        expect(drive(createPlatformKeeper(everyLine)).step([ask(train, platform)])).toEqual([grant(train, platform)]);
      }
    }
  });

  it('on busy, refuses a request for a platform outside the layout', () => {
    const keeper = keeperOn('busy');
    // P7 is not in busy. Train 3 is from C, so it is offered P5 from its own pair.
    expect(keeper.step([ask(3, 'P7')])).toEqual([refuse(3, 'P7', 'P5')]);
    expect(keeper.step([ask(3, 'P7')], everyPlatformReadsEmpty())).toEqual([refuse(3, 'P7', 'P5')]);
    expect(heldBy(recordGrant(initialPlatformKeeperMemory(), 3, 'P7', 0), 3)).toBeNull();
  });

  it('on busy, refuses a train from D, whose entry track is not in the layout', () => {
    applyLayout('busy');
    const keeper = drive(createPlatformKeeper(everyLine));
    expect(keeper.step([ask(4, 'P7')], everyPlatformReadsEmpty())).toEqual([refuse(4, 'P7', null)]);
    expect(keeper.step([ask(4, 'P5')], everyPlatformReadsEmpty())).toEqual([refuse(4, 'P5', null)]);
  });

  it("on busy, refuses a request for a platform outside the train's pair", () => {
    const keeper = keeperOn('busy');
    expect(keeper.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', 'P5')]);
    expect(keeper.step([ask(1, 'P5')])).toEqual([refuse(1, 'P5', 'P1')]);
    expect(keeper.step([ask(2, 'P6')])).toEqual([refuse(2, 'P6', 'P3')]);
  });

  it('on branch, serves A and refuses a request for P3', () => {
    const keeper = keeperOn('branch');
    expect(keeper.step([ask(1, 'P3')])).toEqual([refuse(1, 'P3', 'P1')]);
    expect(keeper.step([ask(1, 'P3')], everyPlatformReadsEmpty())).toEqual([refuse(1, 'P3', 'P1')]);
    expect(keeper.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
    expect(keeper.step([ask(5, 'P1')])).toEqual([refuse(5, 'P1', 'P2')]);
    expect(keeper.step([ask(5, 'P2')])).toEqual([grant(5, 'P2')]);
  });

  it('on branch, refuses a train from B, whose entry track is not in the layout', () => {
    applyLayout('branch');
    const keeper = drive(createPlatformKeeper(everyLine));
    expect(keeper.step([ask(2, 'P3')], everyPlatformReadsEmpty())).toEqual([refuse(2, 'P3', null)]);
    expect(keeper.step([ask(2, 'P1')], everyPlatformReadsEmpty())).toEqual([refuse(2, 'P1', null)]);
  });

  it('on hub, trains on all four entry tracks are granted their own platforms on the same tick', () => {
    const out = keeperOn('hub').step([ask(4, 'P7'), ask(3, 'P5'), ask(2, 'P3'), ask(1, 'P1')]);
    expect(out).toEqual([grant(1, 'P1'), grant(2, 'P3'), grant(3, 'P5'), grant(4, 'P7')]);
  });

  it('on hub, fills all eight platforms, one lock each', () => {
    const keeper = keeperOn('hub');
    keeper.step([ask(1, 'P1'), ask(2, 'P3'), ask(3, 'P5'), ask(4, 'P7')]);
    const out = keeper.step([ask(5, 'P2'), ask(6, 'P4'), ask(7, 'P6'), ask(8, 'P8')]);
    expect(out).toEqual([grant(5, 'P2'), grant(6, 'P4'), grant(7, 'P6'), grant(8, 'P8')]);
    // Every platform is locked now, so the third trains on C and D get nothing.
    expect(keeper.step([ask(9, 'P5'), ask(10, 'P7')])).toEqual([refuse(9, 'P5', null), refuse(10, 'P7', null)]);
  });

  it('on hub, serves trains on C and D independently', () => {
    const keeper = keeperOn('hub');
    const cFull = sensors(['P5', 'P6']);
    // Both platforms of C are taken. Train 3 waits at the front of C. D is not held up.
    expect(keeper.step([ask(3, 'P5'), ask(4, 'P7')], cFull)).toEqual([refuse(3, 'P5', null), grant(4, 'P7')]);
    expect(keeper.step([ask(3, 'P5'), ask(8, 'P8')], cFull)).toEqual([refuse(3, 'P5', null), grant(8, 'P8')]);
    // And the other way round: D is full now. C is served once its platforms have read
    // empty for unlockedSettle(), since they read occupied with no lock on them.
    keeper.idle(unlockedSettle() + 2 * TICK);
    expect(keeper.step([ask(3, 'P5'), ask(10, 'P7')])).toEqual([grant(3, 'P5'), refuse(10, 'P7', null)]);
  });

  it('on busy, refuses a train further back on C while the train in front of it has no platform', () => {
    const keeper = keeperOn('busy');
    const p6Taken = sensors(['P6']);
    // Train 7 is at the front of C and asks for P6, which is taken. Train 9 behind it asks
    // for the free P5 and is refused. Train 5 on A is not held up.
    expect(keeper.step([ask(9, 'P5'), ask(7, 'P6'), ask(5, 'P2')], p6Taken)).toEqual([
      grant(5, 'P2'),
      refuse(7, 'P6', 'P5'),
      refuse(9, 'P5', null),
    ]);
    // The front train takes the alternative. Nothing is left for the one behind.
    expect(keeper.step([ask(9, 'P5'), ask(7, 'P5')], p6Taken)).toEqual([grant(7, 'P5'), refuse(9, 'P5', null)]);
    // P6 is free again and the front train has its lock, so the train behind is served.
    keeper.idle(unlockedSettle() + 2 * TICK);
    expect(keeper.step([ask(9, 'P5')])).toEqual([refuse(9, 'P5', 'P6')]);
    expect(keeper.step([ask(9, 'P6')])).toEqual([grant(9, 'P6')]);
  });

  it('on busy, the queue rule on C uses the timetable order of C only', () => {
    applyLayout('busy');
    const memory = recordWaiting(initialPlatformKeeperMemory(), [ask(7, 'P6')], 100);
    expect(trainAheadIsWaiting(memory, everyLine, 9)).toBe(true); // behind train 7 on C
    expect(trainAheadIsWaiting(memory, everyLine, 3)).toBe(false); // ahead of train 7 on C
    expect(trainAheadIsWaiting(memory, everyLine, 5)).toBe(false); // on A
    expect(trainAheadIsWaiting(memory, everyLine, 6)).toBe(false); // on B
  });

  it('on hub, when two trains on D ask for P7 on one tick, grants it to the train with the earlier enterAt', () => {
    expect(keeperOn('hub').step([ask(10, 'P7'), ask(8, 'P7')])).toEqual([grant(8, 'P7'), refuse(10, 'P7', 'P8')]);
  });

  it('on hub, never gives a train from D locks on both P7 and P8', () => {
    const keeper = keeperOn('hub');
    keeper.step([ask(4, 'P7')]);
    expect(keeper.step([ask(4, 'P8')])).toEqual([grant(4, 'P7')]);
    expect(keeper.step([ask(8, 'P8')])).toEqual([grant(8, 'P8')]);
  });

  it('on hub, releases the lock on P7 once its train has arrived and left', () => {
    const keeper = keeperOn('hub');
    keeper.step([ask(4, 'P7')]);
    keeper.idle(30, sensors(['P7']));
    expect(keeper.step([ask(8, 'P7')], sensors(['P7']))).toEqual([refuse(8, 'P7', 'P8')]);
    keeper.step([]);
    expect(keeper.step([ask(8, 'P7')])).toEqual([grant(8, 'P7')]);
  });

  it('on busy, keeps the lock on P5 while its holder repeats its request and a dead sensor comes and goes', () => {
    const keeper = keeperOn('busy');
    keeper.step([ask(3, 'P5')]);
    const dead = sensors([...PLATFORMS]);
    expect(keeper.repeat(20, ask(3, 'P5'), dead).every((o) => o.msg.type === 'lockGrant')).toBe(true);
    // The sensors are back. P6 read occupied with no lock on it, so it must read empty for
    // unlockedSettle() before it is offered. Train 3 has kept P5 all along.
    keeper.repeat(unlockedSettle() + 2 * TICK, ask(3, 'P5'));
    expect(keeper.step([ask(7, 'P5')])).toEqual([refuse(7, 'P5', 'P6')]);
  });

  it('on hub, refuses every request with alternative null when every sensor is dead', () => {
    const keeper = keeperOn('hub');
    const out = keeper.step([ask(1, 'P1'), ask(2, 'P3'), ask(3, 'P5'), ask(4, 'P7')], sensors([...PLATFORMS]));
    expect(out).toEqual([refuse(1, 'P1', null), refuse(2, 'P3', null), refuse(3, 'P5', null), refuse(4, 'P7', null)]);
  });

  it('on busy, does not grant P5 after it read occupied with no lock until it has read empty for unlockedSettle()', () => {
    const keeper = keeperOn('busy');
    keeper.idle(20, sensors([...PLATFORMS]));
    const out = keeper.repeat(unlockedSettle(), ask(3, 'P5'));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => o.msg.type === 'lockRefuse' && o.msg.alternative === null)).toBe(true);
    keeper.idle(2 * TICK);
    expect(keeper.step([ask(3, 'P5')])).toEqual([grant(3, 'P5')]);
  });

  it('on hub, grants nothing on C and D until resumedAt + settle, and keeps the locks it had', () => {
    const keeper = keeperOn('hub');
    keeper.step([ask(3, 'P5')]);
    keeper.off(60);
    // Train 3 holds P5 and is refused too. It keeps its lock and ignores the refusal.
    const first = keeper.step([ask(3, 'P5'), ask(4, 'P7'), ask(7, 'P6')]);
    expect(first).toEqual([refuse(3, 'P5', null), refuse(4, 'P7', null), refuse(7, 'P6', null)]);
    keeper.idle(RESUME_SETTLE - 2 * TICK);
    expect(keeper.step([ask(4, 'P7')])).toEqual([refuse(4, 'P7', null)]);
    expect(keeper.step([ask(4, 'P7'), ask(3, 'P5')])).toEqual([grant(3, 'P5'), grant(4, 'P7')]);
    // Train 3 still holds P5, so train 7 behind it is offered P6.
    expect(keeper.step([ask(7, 'P5')])).toEqual([refuse(7, 'P5', 'P6')]);
  });

  it('on hub, releases a lock on P8 whose train never arrived, after the window, if the holder stays silent', () => {
    const keeper = keeperOn('hub');
    keeper.step([ask(4, 'P8')]);
    keeper.off(120);
    keeper.idle(RESUME_SETTLE - TICK);
    expect(keeper.step([ask(8, 'P8')])).toEqual([refuse(8, 'P8', null)]);
    expect(keeper.step([ask(8, 'P8')])).toEqual([grant(8, 'P8')]);
  });

  it('follows the layout in use when it steps, not the layout it was built on', () => {
    // Built on the default layout, then the layout is applied, as a careless caller might.
    const early = drive(createPlatformKeeper(everyLine));
    applyLayout('hub');
    expect(early.step([ask(4, 'P7')])).toEqual([grant(4, 'P7')]);
    // Built on hub, stepped on branch.
    const late = drive(createPlatformKeeper(everyLine));
    applyLayout('branch');
    expect(late.step([ask(2, 'P3')], everyPlatformReadsEmpty())).toEqual([refuse(2, 'P3', null)]);
    expect(late.step([ask(1, 'P2')])).toEqual([grant(1, 'P2')]);
  });
});
