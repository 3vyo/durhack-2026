import { describe, expect, it } from 'vitest';
import {
  unlockedSettle,
  answerOrder,
  answerPlatformRequest,
  canGrantPlatform,
  canReleasePlatform,
  chooseAlternative,
  createStationActor,
  heldBy,
  initialStationMemory,
  observePlatform,
  ownPair,
  recordGrant,
  recordHolderRequests,
  recordWaiting,
  trainAheadIsWaiting,
  waitingSilence,
  resumeStation,
  stepStation,
  type PlatformLock,
  type StationMemory,
} from '../../src/locks/station';
import { REQUEST_REPEAT, RESUME_SETTLE, TICK } from '../../src/shared/constants';
import { PLATFORMS } from '../../src/shared/map';
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

/** Sensor readings with the named platforms occupied and the rest empty. */
function sensors(occupied: PlatformId[] = []): SensorReadings {
  return {
    platformOccupied: {
      P1: occupied.includes('P1'),
      P2: occupied.includes('P2'),
      P3: occupied.includes('P3'),
      P4: occupied.includes('P4'),
    },
    junctionOccupied: false,
    exitStartClear: true,
  };
}

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
function withLocks(held: Partial<Record<PlatformId, TrainId>>): StationMemory {
  let memory = initialStationMemory();
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
  memory: StationMemory = initialStationMemory(),
  readings: SensorReadings = allEmpty,
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
    step(inbox: Message[] = [], readings: SensorReadings = allEmpty): Outgoing[] {
      const out = actor.step(now, inbox, readings);
      now += TICK;
      return out;
    },
    /** Steps with an empty inbox for this many seconds. Returns everything sent. */
    idle(seconds: number, readings: SensorReadings = allEmpty): Outgoing[] {
      const out: Outgoing[] = [];
      for (let i = 0; i < Math.round(seconds / TICK); i++) out.push(...this.step([], readings));
      return out;
    },
    /**
     * Steps for this many seconds while a train repeats its request every REQUEST_REPEAT.
     * Returns everything sent.
     */
    repeat(seconds: number, request: Message, readings: SensorReadings = allEmpty): Outgoing[] {
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

const newStation = () => drive(createStationActor(timetable));

describe('station frame', () => {
  it('has id station', () => {
    expect(createStationActor(timetable).id).toBe('station');
  });

  it('starts with no locks, no step seen and no resume', () => {
    expect(initialStationMemory()).toEqual({
      locks: { P1: null, P2: null, P3: null, P4: null },
      unlockedOccupiedAt: { P1: null, P2: null, P3: null, P4: null },
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
    expect(answer(1, 'P1', initialStationMemory(), sensors(['P1'])).kind).toBe('refuse');
  });

  it('refuses a platform whose lock another train holds, even when its sensor says empty', () => {
    expect(answer(3, 'P1', withLocks({ P1: 1 })).kind).toBe('refuse');
  });

  it("never grants a platform outside the requesting train's own pair", () => {
    const check = { now: 100, train: 1, pair: pairA, memory: initialStationMemory(), sensors: allEmpty };
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
    const station = newStation();
    station.step([ask(1, 'P1')]);
    station.step([ask(1, 'P2')]);
    // P2 is still free for the next train on A, so train 1 does not hold it.
    expect(station.step([ask(3, 'P2')])).toEqual([grant(3, 'P2')]);
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
    const station = newStation();
    const out = station.step([ask(5, 'P1'), ask(3, 'P1')]);
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
    const memory = recordGrant(initialStationMemory(), 1, 'P1', 20);
    expect(memory.locks.P1).toEqual({ holder: 1, grantedAt: 20, seenArrive: false, lastRequestAt: 20 });
    expect(memory.locks.P2).toBeNull();
    expect(heldBy(memory, 1)).toBe('P1');
  });

  it('sends lockGrant to the requesting train with resource set to the platform and follow null', () => {
    expect(newStation().step([ask(2, 'P4')])).toEqual([
      { msg: { type: 'lockGrant', to: 2, resource: 'P4', follow: null }, range: 'short' },
    ]);
  });
});

describe('Entering the station: refusing', () => {
  it('refuses with the other platform of the pair as alternative when that one could be granted now', () => {
    expect(answer(1, 'P1', initialStationMemory(), sensors(['P1']))).toEqual({
      kind: 'refuse',
      alternative: 'P2',
    });
    expect(answer(2, 'P4', initialStationMemory(), sensors(['P4']))).toEqual({
      kind: 'refuse',
      alternative: 'P3',
    });
  });

  it('refuses with alternative null when neither platform of the pair could be granted', () => {
    expect(answer(1, 'P1', initialStationMemory(), sensors(['P1', 'P2']))).toEqual({
      kind: 'refuse',
      alternative: null,
    });
  });

  it("never offers a platform outside the requesting train's own pair as an alternative", () => {
    // P3 and P4 are free, but they belong to track B.
    const check = { now: 100, train: 1, pair: pairA, memory: initialStationMemory() };
    expect(chooseAlternative({ ...check, requested: 'P1', sensors: sensors(['P1', 'P2']) })).toBeNull();
    // A train that asks outside its pair is only ever offered its own platforms.
    expect(chooseAlternative({ ...check, requested: 'P3', sensors: sensors(['P1']) })).toBe('P2');
  });

  it('never offers an alternative whose lock another train holds', () => {
    const memory = withLocks({ P2: 3 });
    expect(answer(1, 'P1', memory, sensors(['P1']))).toEqual({ kind: 'refuse', alternative: null });
  });

  it('answers every repeat of a refused request, since the train repeats it every 2 seconds', () => {
    const station = newStation();
    const full = sensors(['P1', 'P2']);
    const out = station.repeat(3 * REQUEST_REPEAT, ask(1, 'P1'), full);
    expect(out).toEqual([refuse(1, 'P1', null), refuse(1, 'P1', null), refuse(1, 'P1', null)]);
  });

  it('grants the alternative when the train then asks for it and it is still free', () => {
    const station = newStation();
    station.step([ask(1, 'P1')]);
    expect(station.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', 'P2')]);
    expect(station.step([ask(3, 'P2')])).toEqual([grant(3, 'P2')]);
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
    const station = newStation();
    station.step([ask(1, 'P1')]);
    station.idle(30, sensors(['P1']));
    expect(station.step([ask(3, 'P1')], sensors(['P1']))).toEqual([refuse(3, 'P1', 'P2')]);
    station.step([], allEmpty);
    expect(station.step([ask(3, 'P1')])).toEqual([grant(3, 'P1')]);
  });
});

describe('Platform sensors switched off', () => {
  it('treats a dead sensor as occupied and never grants that platform', () => {
    const station = newStation();
    const out = station.repeat(10 * REQUEST_REPEAT, ask(1, 'P1'), sensors(['P1', 'P2']));
    expect(out).toHaveLength(10);
    expect(out.every((o) => o.msg.type === 'lockRefuse')).toBe(true);
  });

  it('offers the other platform of the pair as alternative when one sensor is dead and the other platform is free', () => {
    expect(newStation().step([ask(1, 'P1')], sensors(['P1']))).toEqual([refuse(1, 'P1', 'P2')]);
  });

  it('refuses every request with alternative null when every sensor is dead', () => {
    const out = newStation().step([ask(1, 'P1'), ask(2, 'P3'), ask(3, 'P2'), ask(4, 'P4')], allDead);
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
    const station = newStation();
    const both = [ask(1, 'P1'), ask(3, 'P1')];
    const every = Math.round(REQUEST_REPEAT / TICK);
    const sent: Outgoing[] = [];
    for (let i = 0; i < 600; i++) {
      const dead = Math.floor(i / 100) % 2 === 1;
      sent.push(...station.step(i % every === 0 ? both : [], dead ? allDead : allEmpty));
    }
    const toTrain3 = sent.filter((o) => o.msg.type !== 'lockRequest' && 'to' in o.msg && o.msg.to === 3);
    expect(toTrain3.length).toBeGreaterThan(0);
    expect(toTrain3.every((o) => o.msg.type === 'lockRefuse')).toBe(true);
    expect(toTrain3.some((o) => o.msg.type === 'lockRefuse' && o.msg.alternative === 'P1')).toBe(false);
  });

  it('keeps the lock while it hears the holder repeat its request, which the train does after the grant until its front is in the platform', () => {
    const station = newStation();
    const out = station.repeat(60, ask(1, 'P1'));
    expect(out.every((o) => o.msg.type === 'lockGrant' && o.msg.to === 1)).toBe(true);
    expect(out).toHaveLength(60 / REQUEST_REPEAT);
    expect(station.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', 'P2')]);
  });

  it('answers the holder with the grant again, never a refusal, while a dead sensor reads occupied', () => {
    const station = newStation();
    station.step([ask(1, 'P1')]);
    const out = station.repeat(20, ask(1, 'P1'), allDead);
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
    const station = newStation();
    station.idle(20, allDead);
    const out = station.repeat(unlockedSettle(), ask(1, 'P1'));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => o.msg.type === 'lockRefuse' && o.msg.alternative === null)).toBe(true);
    station.idle(2 * TICK);
    expect(station.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
  });

  it('does not grant a platform that a train without a lock has just left until it has read empty for unlockedSettle()', () => {
    const memory: StationMemory = {
      ...initialStationMemory(),
      unlockedOccupiedAt: { P1: 100, P2: null, P3: null, P4: null },
    };
    const check = { train: 1, platform: 'P1' as const, pair: pairA, memory, sensors: allEmpty };
    expect(canGrantPlatform({ ...check, now: 100 + unlockedSettle() })).toBe(false);
    expect(canGrantPlatform({ ...check, now: 100 + unlockedSettle() + TICK })).toBe(true);
  });

  it('does not hold back a platform whose last train held its lock', () => {
    const station = newStation();
    station.step([ask(1, 'P1')]);
    station.idle(30, sensors(['P1']));
    station.step([], allEmpty);
    expect(station.step([ask(3, 'P1')])).toEqual([grant(3, 'P1')]);
  });
});

describe('Messages (The radio)', () => {
  it('sends every reply over short range', () => {
    const out = newStation().step([ask(1, 'P1'), ask(3, 'P1'), ask(5, 'P1'), ask(99, 'P1')]);
    expect(out).toHaveLength(4);
    expect(out.every((o) => o.range === 'short')).toBe(true);
  });

  it('replies on the tick it reads the request, so the train hears it on the next tick', () => {
    const station = newStation();
    expect(station.step([])).toEqual([]);
    expect(station.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
    expect(station.step([])).toEqual([]);
  });

  it('ignores lockRequest for JUNCTION, which is for the merge actor', () => {
    expect(newStation().step([ask(1, 'JUNCTION')])).toEqual([]);
  });

  it('ignores every message that is not a lockRequest', () => {
    const inbox: Message[] = [
      { type: 'position', from: 1, pos: { track: 'A', offset: 5000 }, speed: 20, sentAt: 0 },
      { type: 'lockGrant', to: 1, resource: 'P1', follow: null },
      { type: 'lockRefuse', to: 1, resource: 'P1', alternative: null },
      { type: 'platformStatus', platform: 'P1', occupied: false, sentAt: 0 },
      { type: 'permit', to: 1, untilX: 6000, nextTrack: 'P1', sentAt: 0 },
    ];
    const station = newStation();
    expect(station.step(inbox)).toEqual([]);
    // None of them took a lock.
    expect(station.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
  });

  it('sends nothing on a tick with no requests', () => {
    const station = newStation();
    station.step([ask(1, 'P1')]);
    expect(station.idle(30, sensors(['P1']))).toEqual([]);
    expect(station.idle(30)).toEqual([]);
  });
});

describe('Switched back on (rule from the review on #31)', () => {
  const resumedAt = 50;
  const windowOver = resumedAt + RESUME_SETTLE;
  const check = { resumedAt, settle: RESUME_SETTLE, repeat: REQUEST_REPEAT };
  const unseen: PlatformLock = { holder: 1, grantedAt: 10, seenArrive: false, lastRequestAt: 12 };

  it('keeps its lock table across being switched off and on', () => {
    const station = newStation();
    station.step([ask(1, 'P1')]);
    station.off(60);
    station.repeat(RESUME_SETTLE + TICK, ask(1, 'P1'));
    // Train 1 still holds P1, so train 3 is offered P2.
    expect(station.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', 'P2')]);
  });

  it('sets lastStepAt to now on every step', () => {
    let memory = initialStationMemory();
    for (const now of [0, TICK, 2 * TICK, 40]) {
      memory = stepStation(memory, timetable, now, [], allEmpty).memory;
      expect(memory.lastStepAt).toBe(now);
    }
  });

  it('sets resumedAt to now when wasSwitchedOff says it was off', () => {
    let memory = stepStation(initialStationMemory(), timetable, 0, [], allEmpty).memory;
    memory = stepStation(memory, timetable, TICK, [], allEmpty).memory;
    expect(memory.resumedAt).toBeNull();
    memory = stepStation(memory, timetable, 30, [], allEmpty).memory;
    expect(memory.resumedAt).toBe(30);
    memory = stepStation(memory, timetable, 30 + TICK, [], allEmpty).memory;
    expect(memory.resumedAt).toBe(30);
  });

  it('counts its first step as coming back on when the run is already past time 0', () => {
    const memory = stepStation(initialStationMemory(), timetable, 30, [ask(1, 'P1')], allEmpty);
    expect(memory.memory.resumedAt).toBe(30);
    expect(memory.out).toEqual([refuse(1, 'P1', null)]);
  });

  it('keeps every lock when it comes back, since the gap itself releases nothing', () => {
    const before = withLocks({ P1: 1, P3: 2 });
    const after = resumeStation(before, resumedAt);
    expect(after.locks).toEqual(before.locks);
    expect(after.resumedAt).toBe(resumedAt);
  });

  it('grants nothing until resumedAt + settle', () => {
    const station = newStation();
    station.step();
    station.off(60);
    const out = station.repeat(RESUME_SETTLE, ask(1, 'P1'));
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((o) => o.msg.type === 'lockGrant')).toBe(false);
    expect(station.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
  });

  it('refuses every platform request with alternative null until resumedAt + settle, so waiting trains stop falling back to the fixed split', () => {
    const station = newStation();
    station.step([ask(1, 'P1')]);
    station.off(60);
    // Train 1 holds P1 and is refused too. It keeps its lock and ignores the refusal.
    const first = station.step([ask(1, 'P1'), ask(2, 'P3'), ask(3, 'P2')]);
    expect(first).toEqual([refuse(1, 'P1', null), refuse(2, 'P3', null), refuse(3, 'P2', null)]);
    station.idle(RESUME_SETTLE - 2 * TICK);
    expect(station.step([ask(2, 'P3')])).toEqual([refuse(2, 'P3', null)]);
    expect(station.step([ask(2, 'P3'), ask(1, 'P1')])).toEqual([grant(1, 'P1'), grant(2, 'P3')]);
  });

  it('does not grant a platform that a train set off for by the fixed split, since that train shows on the sensor inside the window', () => {
    const station = newStation();
    station.step();
    station.off(60);
    // The train rolls onto P1 a second after the actor comes back.
    station.idle(1);
    const out = station.repeat(RESUME_SETTLE + 10, ask(3, 'P1'), sensors(['P1']));
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
    const station = newStation();
    station.step([ask(1, 'P1')]);
    station.off(60);
    station.repeat(RESUME_SETTLE + TICK, ask(1, 'P1'), sensors(['P1']));
    expect(station.step([ask(1, 'P1')], sensors(['P1']))).toEqual([refuse(1, 'P1', null)]);
    expect(station.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
  });

  it('notes a request from a lock holder, whichever platform it asks for', () => {
    const memory = recordHolderRequests(withLocks({ P1: 1, P3: 2 }), [ask(1, 'P2'), ask(3, 'P1')], 20);
    expect(memory.locks.P1?.lastRequestAt).toBe(20);
    expect(memory.locks.P3?.lastRequestAt).toBe(0);
  });
});

describe('Scenarios', () => {
  it('a train granted P1 arrives and leaves, and the lock is released', () => {
    const station = newStation();
    // Train 1 asks at the ask point and keeps asking until its front is in the platform.
    const approach = station.repeat(40, ask(1, 'P1'));
    expect(approach.every((o) => o.msg.type === 'lockGrant' && o.msg.resource === 'P1')).toBe(true);
    // It stands in P1 for its dwell time. Train 3 asks for P1 and is sent to P2.
    station.idle(10, sensors(['P1']));
    expect(station.step([ask(3, 'P1')], sensors(['P1']))).toEqual([refuse(3, 'P1', 'P2')]);
    expect(station.step([ask(3, 'P2')], sensors(['P1']))).toEqual([grant(3, 'P2')]);
    station.idle(20, sensors(['P1']));
    // Train 1 leaves. The sensor reads empty and the lock is released on that tick.
    station.step([], allEmpty);
    expect(station.step([ask(5, 'P1')])).toEqual([grant(5, 'P1')]);
  });

  it('keeps the lock for one repeat plus two ticks after a holder that was just heard', () => {
    // The sensor flickers while train 1 is on its way in, then train 1 goes silent. The
    // lock stays for one repeat plus two ticks after its last request.
    const station = newStation();
    station.step([ask(1, 'P1')]);
    station.step([], sensors(['P1']));
    const ticks = Math.round(REQUEST_REPEAT / TICK) + 1;
    for (let i = 0; i < ticks; i++) {
      expect(station.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', 'P2')]);
    }
    expect(station.step([ask(3, 'P1')])).toEqual([grant(3, 'P1')]);
  });

  it('with P1 occupied, a train from track A is offered P2 and gets it', () => {
    const station = newStation();
    const p1Taken = sensors(['P1']);
    expect(station.step([ask(3, 'P1')], p1Taken)).toEqual([refuse(3, 'P1', 'P2')]);
    expect(station.step([ask(3, 'P2')], p1Taken)).toEqual([grant(3, 'P2')]);
    // With both taken, the next train on A is offered nothing and never a B platform.
    expect(station.step([ask(5, 'P1')], p1Taken)).toEqual([refuse(5, 'P1', null)]);
  });

  it('trains on A and B are granted their own platforms on the same tick', () => {
    const out = newStation().step([ask(4, 'P4'), ask(3, 'P2'), ask(2, 'P3'), ask(1, 'P1')]);
    expect(out).toEqual([grant(1, 'P1'), grant(2, 'P3'), grant(3, 'P2'), grant(4, 'P4')]);
  });

  it('the settle window after a resume', () => {
    const station = newStation();
    // Train 1 holds P1 and is on its way in. Train 3 arrived and left P2 before the gap.
    station.step([ask(1, 'P1'), ask(3, 'P2')]);
    station.repeat(10, ask(1, 'P1'), sensors(['P2']));
    station.off(30);
    // Back on. For RESUME_SETTLE every request is refused with no alternative.
    const both = [ask(1, 'P1'), ask(5, 'P2')];
    const every = Math.round(REQUEST_REPEAT / TICK);
    for (let i = 0; i < Math.round(RESUME_SETTLE / TICK); i++) {
      const out = station.step(i % every === 0 ? both : []);
      if (i % every === 0) expect(out).toEqual([refuse(1, 'P1', null), refuse(5, 'P2', null)]);
      else expect(out).toEqual([]);
    }
    // The window is over. Train 1 kept its lock. Train 3's lock on P2 was released, since
    // the sensor showed it arrive and the platform is empty.
    expect(station.step(both)).toEqual([grant(1, 'P1'), grant(5, 'P2')]);
  });

  it('a lock whose train never arrived is released after the window if the holder stays silent', () => {
    const station = newStation();
    station.step([ask(1, 'P1')]);
    station.off(120);
    station.idle(RESUME_SETTLE - TICK);
    expect(station.step([ask(3, 'P1')])).toEqual([refuse(3, 'P1', null)]);
    expect(station.step([ask(3, 'P1')])).toEqual([grant(3, 'P1')]);
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
  const free: SensorReadings = {
    platformOccupied: { P1: false, P2: false, P3: false, P4: false },
    junctionOccupied: false,
    exitStartClear: true,
  };
  const asks = (train: number, resource: PlatformId): Message => ({ type: 'lockRequest', from: train, resource });
  const repliesTo = (out: Outgoing[], train: number) => out.map((o) => o.msg).filter((m) => 'to' in m && m.to === train);
  // The engine steps an actor every tick. A gap would look like the actor being switched
  // back on, so these tests step through every tick, with an empty inbox in between.
  const at = (tick: number) => tick * TICK;
  function stepAt(memory: StationMemory, from: number, tick: number, inbox: Message[], sensors: SensorReadings) {
    let m = memory;
    for (let t = from; t < tick; t++) m = stepStation(m, queue, at(t), [], sensors).memory;
    return stepStation(m, queue, at(tick), inbox, sensors);
  }

  it('says a train ahead is waiting only for an earlier train on the same entry track with no lock', () => {
    const memory = recordWaiting(initialStationMemory(), [asks(3, 'P2')], 100);
    expect(trainAheadIsWaiting(memory, queue, 5)).toBe(true);
    expect(trainAheadIsWaiting(memory, queue, 1)).toBe(false); // train 1 is ahead of train 3
    expect(trainAheadIsWaiting(memory, queue, 2)).toBe(false); // another entry track
    expect(trainAheadIsWaiting(memory, queue, 3)).toBe(false); // not behind itself
  });

  it('refuses a train further back while the train in front of it has no platform', () => {
    // P2 is taken, so train 3 at the front is refused. Train 5 behind it asks for the free P1.
    const busy = { ...free, platformOccupied: { ...free.platformOccupied, P2: true } };
    const first = stepAt(initialStationMemory(), 0, 5, [asks(3, 'P2'), asks(5, 'P1')], busy);
    expect(repliesTo(first.out, 5)).toEqual([{ type: 'lockRefuse', to: 5, resource: 'P1', alternative: null }]);
    expect(repliesTo(first.out, 3)).toEqual([{ type: 'lockRefuse', to: 3, resource: 'P2', alternative: 'P1' }]);
    // The front train takes the alternative, and only then can the one behind be served.
    const second = stepAt(first.memory, 6, 25, [asks(3, 'P1'), asks(5, 'P1')], busy);
    expect(repliesTo(second.out, 3)).toEqual([{ type: 'lockGrant', to: 3, resource: 'P1', follow: null }]);
    expect(heldBy(second.memory, 5)).toBeNull();
  });

  it('serves the train behind once the train in front holds a platform', () => {
    const first = stepAt(initialStationMemory(), 0, 5, [asks(3, 'P2')], free);
    expect(heldBy(first.memory, 3)).toBe('P2');
    const second = stepAt(first.memory, 6, 6, [asks(5, 'P1')], free);
    expect(repliesTo(second.out, 5)).toEqual([{ type: 'lockGrant', to: 5, resource: 'P1', follow: null }]);
  });

  it('does not hold up a train on the other entry track', () => {
    const busy = { ...free, platformOccupied: { ...free.platformOccupied, P1: true, P2: true } };
    const step = stepAt(initialStationMemory(), 0, 5, [asks(1, 'P1'), asks(2, 'P3')], busy);
    expect(repliesTo(step.out, 2)).toEqual([{ type: 'lockGrant', to: 2, resource: 'P3', follow: null }]);
  });

  it('stops counting a train as waiting once it has been silent for two repeats', () => {
    let memory = recordWaiting(initialStationMemory(), [asks(3, 'P2')], 100);
    memory = recordWaiting(memory, [], 100 + waitingSilence());
    expect(trainAheadIsWaiting(memory, queue, 5)).toBe(true);
    memory = recordWaiting(memory, [], 100 + waitingSilence() + 2 * TICK);
    expect(trainAheadIsWaiting(memory, queue, 5)).toBe(false);
  });

  it('keeps a lock holder its platform even when a train ahead starts waiting', () => {
    const first = stepAt(initialStationMemory(), 0, 5, [asks(5, 'P1')], free);
    expect(heldBy(first.memory, 5)).toBe('P1');
    const busy = { ...free, platformOccupied: { ...free.platformOccupied, P2: true } };
    const second = stepAt(first.memory, 6, 25, [asks(3, 'P2'), asks(5, 'P1')], busy);
    expect(repliesTo(second.out, 5)).toEqual([{ type: 'lockGrant', to: 5, resource: 'P1', follow: null }]);
  });
});
