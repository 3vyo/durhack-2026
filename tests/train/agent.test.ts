import { describe, expect, it } from 'vitest';
import {
  ACCEL,
  BRAKE,
  MARGIN,
  MAX_SPEED,
  JUNCTION_KEEPER_TIMEOUT,
  POSITION_INTERVAL,
  REQUEST_REPEAT,
  SIGHT_SPEED,
  TICK,
  TRAIN_LENGTH,
} from '../../src/shared/constants';
import type { Message, Position, TrainInput, TrainOutput } from '../../src/shared/types';
import {
  accelFor,
  chooseRoute,
  clampAccel,
  createAgent,
  dropPlatformLocks,
  exitLeader,
  expireJunctionGrant,
  hold,
  initialMemory,
  isLeaving,
  lowestLimit,
  noteSent,
  remember,
} from '../../src/train/agent';
import { trainNumbers } from '../../src/train/numbers';
import { requests, sightTo, startRun, tick, ticks, timetable } from './sim';

const N = trainNumbers();

const onA: Position = { track: 'A', offset: 5000 };
const inP1: Position = { track: 'P1', offset: 200 };

function input(over: Partial<TrainInput> = {}): TrainInput {
  return {
    now: 0,
    self: { id: 2, pos: { track: 'A', offset: 1000 }, speed: 20, brokenDown: false },
    inbox: [],
    sightAhead: null,
    ...over,
  };
}

// Messages a real train could find in its inbox, all addressed to or about train 2.
const busyInbox: Message[] = [
  { type: 'position', from: 1, pos: { track: 'A', offset: 2000 }, speed: 30, sentAt: 0 },
  { type: 'permit', to: 2, untilX: 6000, nextTrack: 'P2', sentAt: 0 },
  { type: 'lockGrant', to: 2, resource: 'P2', follow: null },
  { type: 'lockGrant', to: 2, resource: 'JUNCTION', follow: 1 },
  { type: 'lockRefuse', to: 2, resource: 'P2', alternative: 'P1' },
  { type: 'lockRefuse', to: 2, resource: 'JUNCTION', alternative: null },
  { type: 'platformStatus', platform: 'P2', occupied: false, sentAt: 0 },
];

function expectHolding(out: TrainOutput): void {
  expect(out).toEqual({ accel: -BRAKE, nextTrack: null, outbox: [], mode: 'blind' });
}

describe('agent frame', () => {
  it('createAgent returns an agent with decide', () => {
    expect(typeof createAgent(2, timetable).decide).toBe('function');
    expect(typeof createAgent(2, timetable, trainNumbers).decide).toBe('function');
  });

  it('accel stays between -BRAKE and ACCEL in every situation', () => {
    const agent = createAgent(2, timetable);
    for (const speed of [0, 10, 21, 45, 60]) {
      for (const track of ['A', 'P2', 'EXIT'] as const) {
        for (const sightAhead of [null, 0, 80]) {
          const self = { id: 2, pos: { track, offset: 50 }, speed, brokenDown: false };
          const out = agent.decide(input({ self, sightAhead, inbox: busyInbox }));
          expect(out.accel).toBeGreaterThanOrEqual(-BRAKE);
          expect(out.accel).toBeLessThanOrEqual(ACCEL);
        }
      }
    }
  });

  it('a train missing from the timetable holds', () => {
    expectHolding(createAgent(99, timetable).decide(input({ inbox: busyInbox })));
  });

  it('hold returns a new braking output each call', () => {
    const a = hold();
    expectHolding(a);
    a.outbox.push({ msg: busyInbox[0], range: 'long' });
    expectHolding(hold());
  });

  it('a broken-down train brakes fully, keeps broadcasting its position and sends no lock requests', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 30);
    run.state.brokenDown = true;
    for (let i = 0; i < 100; i++) expect(tick(run).accel).toBe(-BRAKE);
    expect(requests(run)).toEqual([]);
    expect(run.sent.filter((o) => o.msg.type === 'position')).toHaveLength(10);
  });
});

describe('initialMemory', () => {
  it('takes the entry and leader from the timetable', () => {
    const m = initialMemory(2, timetable);
    expect(m.id).toBe(2);
    expect(m.entry).toEqual(timetable[1]);
    expect(m.leader).toBe(1);
  });

  it('starts with leader none when the timetable names no leader', () => {
    expect(initialMemory(1, timetable).leader).toBe('none');
  });

  it('starts with no reports, permit, locks, platform, dwell timer or replies', () => {
    const m = initialMemory(2, timetable);
    expect(m.reports).toEqual({});
    expect(m.permit).toBeNull();
    expect(m.locks).toEqual([]);
    expect(m.platform).toBeNull();
    expect(m.dwellStartedAt).toBeNull();
    expect(m.platformStatus).toEqual({});
    expect(m.lastNextTrack).toBeNull();
    expect(m.usingFallback).toBe(false);
    expect(m.lastPlatformKeeperReply).toBeNull();
    expect(m.platformKeeperHeardAt).toBeNull();
    expect(m.lastJunctionKeeperReplyAt).toBeNull();
    expect(m.junctionGrantAt).toBeNull();
    expect(m.slotStarted).toBe(false);
  });

  it('has no entry and an unknown leader for a train missing from the timetable', () => {
    const m = initialMemory(99, timetable);
    expect(m.entry).toBeNull();
    expect(m.leader).toBe('unknown');
  });
});

describe('lowestLimit', () => {
  it('takes the lowest limit', () => {
    expect(lowestLimit([30, 12, 40])).toBe(12);
  });

  it('is capped at MAX_SPEED', () => {
    expect(lowestLimit([Infinity, 100])).toBe(MAX_SPEED);
    expect(lowestLimit([])).toBe(MAX_SPEED);
  });

  it('never goes below 0 and treats NaN as 0', () => {
    expect(lowestLimit([-5, 10])).toBe(0);
    expect(lowestLimit([NaN, 10])).toBe(0);
  });
});

describe('clampAccel', () => {
  it('keeps values inside -BRAKE and ACCEL', () => {
    expect(clampAccel(5)).toBe(ACCEL);
    expect(clampAccel(-5)).toBe(-BRAKE);
    expect(clampAccel(0.2)).toBe(0.2);
  });

  it('turns NaN into full brakes', () => {
    expect(clampAccel(NaN)).toBe(-BRAKE);
  });
});

describe('exitLeader', () => {
  it('reads follow null as no train ahead', () => {
    expect(exitLeader(null, 2)).toBe('none');
  });

  it('takes the follow train as the leader', () => {
    expect(exitLeader(7, 2)).toBe(7);
  });

  it("reads the train's own ID as leader unknown, which is how the junction keeper says it does not know", () => {
    expect(exitLeader(2, 2)).toBe('unknown');
  });
});

describe('remember', () => {
  /** A memory for train 2 that has already asked for the junction. */
  function asked() {
    const m = initialMemory(2, timetable);
    m.firstJunctionRequestAt = 1;
    return m;
  }

  it('stores a platform grant on the entry track as the chosen platform, a held lock and the last reply', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, onA, { kind: 'grant', platform: 'P2' }, null);
    expect(m.platform).toBe('P2');
    expect(m.locks).toEqual(['P2']);
    expect(m.lastPlatformKeeperReply).toEqual({ kind: 'grant', platform: 'P2', at: 4 });
  });

  it('goes to the platform the grant names, even when it asked for the other one', () => {
    const m = initialMemory(2, timetable);
    m.asking = 'P2';
    remember(m, 4, onA, { kind: 'grant', platform: 'P1' }, null);
    expect(m.platform).toBe('P1');
    expect(m.locks).toEqual(['P1']);
  });

  it('stores a refusal with its alternative and time, and takes no lock', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, onA, { kind: 'refuse', platform: 'P2', alternative: 'P1' }, null);
    expect(m.lastPlatformKeeperReply).toEqual({ kind: 'refuse', platform: 'P2', alternative: 'P1', at: 4 });
    expect(m.locks).toEqual([]);
    expect(m.platform).toBeNull();
  });

  it('keeps the last platform keeper reply on ticks with no reply', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, onA, { kind: 'refuse', platform: 'P2', alternative: null }, null);
    remember(m, 5, onA, null, null);
    expect(m.lastPlatformKeeperReply).toEqual({ kind: 'refuse', platform: 'P2', alternative: null, at: 4 });
  });

  it('ignores a platform grant once the front has left the entry track, and does not store it as a reply', () => {
    const m = initialMemory(2, timetable);
    m.platform = 'P1';
    remember(m, 4, inP1, { kind: 'grant', platform: 'P2' }, null);
    expect(m.platform).toBe('P1');
    expect(m.locks).toEqual([]);
    expect(m.lastPlatformKeeperReply).toBeNull();
  });

  it('once it has a platform, ignores a refusal and a grant for another platform', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, onA, { kind: 'grant', platform: 'P2' }, null);
    remember(m, 5, onA, { kind: 'refuse', platform: 'P2', alternative: 'P1' }, null);
    remember(m, 6, onA, { kind: 'grant', platform: 'P1' }, null);
    expect(m.platform).toBe('P2');
    expect(m.locks).toEqual(['P2']);
    expect(m.lastPlatformKeeperReply).toEqual({ kind: 'grant', platform: 'P2', at: 4 });
  });

  it('stores a junction grant as a lock, a reply time, a grant time and its follow train as the new leader', () => {
    const m = asked();
    const report = { pos: { track: 'EXIT' as const, offset: 400 }, speed: 30, sentAt: 0 };
    m.reports = { 7: report };
    remember(m, 4, inP1, null, { kind: 'grant', follow: 7 });
    expect(m.locks).toEqual(['JUNCTION']);
    expect(m.leader).toBe(7);
    expect(m.lastJunctionKeeperReplyAt).toBe(4);
    expect(m.junctionGrantAt).toBe(4);
    expect(m.reports[7]).toBe(report);
  });

  it('stores a junction refusal as a reply time only', () => {
    const m = asked();
    remember(m, 4, inP1, null, { kind: 'refuse' });
    expect(m.lastJunctionKeeperReplyAt).toBe(4);
    expect(m.locks).toEqual([]);
    expect(m.leader).toBe(1);
  });

  it('a junction refusal does not take back a grant', () => {
    const m = asked();
    remember(m, 4, inP1, null, { kind: 'grant', follow: 7 });
    remember(m, 5, inP1, null, { kind: 'refuse' });
    expect(m.locks).toEqual(['JUNCTION']);
    expect(m.leader).toBe(7);
  });

  it('reads the follow of a junction grant through exitLeader', () => {
    const none = asked();
    remember(none, 4, inP1, null, { kind: 'grant', follow: null });
    expect(none.leader).toBe('none');
    const unknown = asked();
    remember(unknown, 4, inP1, null, { kind: 'grant', follow: 2 });
    expect(unknown.leader).toBe('unknown');
  });

  it('ignores a junction grant it has not asked for, one heard outside a platform, and one after a slot start', () => {
    const notAsked = initialMemory(2, timetable);
    remember(notAsked, 4, inP1, null, { kind: 'grant', follow: 7 });
    expect(notAsked.locks).toEqual([]);
    expect(notAsked.leader).toBe(1);

    const onExit = asked();
    remember(onExit, 4, { track: 'EXIT', offset: 50 }, null, { kind: 'grant', follow: 7 });
    expect(onExit.locks).toEqual([]);

    const onSlot = asked();
    onSlot.slotStarted = true;
    onSlot.leader = 'unknown';
    remember(onSlot, 4, inP1, null, { kind: 'grant', follow: 7 });
    expect(onSlot.locks).toEqual([]);
    expect(onSlot.leader).toBe('unknown');
  });

  it('does not store the same lock twice', () => {
    const m = asked();
    remember(m, 4, onA, { kind: 'grant', platform: 'P2' }, null);
    remember(m, 5, onA, { kind: 'grant', platform: 'P2' }, null);
    remember(m, 6, inP1, null, { kind: 'grant', follow: null });
    remember(m, 7, inP1, null, { kind: 'grant', follow: null });
    expect(m.locks).toEqual(['P2', 'JUNCTION']);
    expect(m.junctionGrantAt).toBe(6);
  });

  it('changes nothing with no replies', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, onA, null, null);
    expect(m).toEqual(initialMemory(2, timetable));
  });
});

describe('noteSent', () => {
  it('records when position, platform and junction messages went out', () => {
    const m = initialMemory(2, timetable);
    noteSent(
      m,
      [
        { msg: { type: 'position', from: 2, pos: { track: 'A', offset: 0 }, speed: 0, sentAt: 3 }, range: 'long' },
        { msg: { type: 'lockRequest', from: 2, resource: 'P2' }, range: 'short' },
        { msg: { type: 'lockRequest', from: 2, resource: 'JUNCTION' }, range: 'short' },
      ],
      3,
    );
    expect(m.lastPositionSentAt).toBe(3);
    expect(m.firstPlatformRequestAt).toBe(3);
    expect(m.lastPlatformRequestAt).toBe(3);
    expect(m.firstJunctionRequestAt).toBe(3);
    expect(m.lastJunctionRequestAt).toBe(3);
  });

  it('keeps the first request times when a request repeats', () => {
    const m = initialMemory(2, timetable);
    const junction = { msg: { type: 'lockRequest', from: 2, resource: 'JUNCTION' } as Message, range: 'short' as const };
    const platform = { msg: { type: 'lockRequest', from: 2, resource: 'P2' } as Message, range: 'short' as const };
    noteSent(m, [junction, platform], 3);
    noteSent(m, [junction, platform], 5);
    expect(m.firstJunctionRequestAt).toBe(3);
    expect(m.lastJunctionRequestAt).toBe(5);
    expect(m.firstPlatformRequestAt).toBe(3);
    expect(m.lastPlatformRequestAt).toBe(5);
  });
});

describe('the junction grant runs out', () => {
  const life = JUNCTION_KEEPER_TIMEOUT - REQUEST_REPEAT;

  /** Train 2 in P2 holding a junction grant first heard at now 100. */
  function granted() {
    const m = initialMemory(2, timetable);
    m.firstJunctionRequestAt = 90;
    remember(m, 100, { track: 'P2', offset: 299.99 }, null, { kind: 'grant', follow: null });
    return m;
  }

  function at(now: number, offset: number, speed: number, track: Position['track'] = 'P2'): TrainInput {
    return input({ now, self: { id: 2, pos: { track, offset }, speed, brokenDown: false } });
  }

  it('keeps a fresh grant while it can still reach the junction zone in time', () => {
    const m = granted();
    expireJunctionGrant(m, at(100.1, 299.99, 0), N);
    expect(isLeaving(m)).toBe(true);
  });

  it('drops a grant it has not used within JUNCTION_KEEPER_TIMEOUT less one REQUEST_REPEAT, and never enters on it', () => {
    const m = granted();
    expireJunctionGrant(m, at(100 + life, 299.99, 0), N);
    expect(isLeaving(m)).toBe(false);
    expect(m.locks).toEqual([]);
  });

  it('drops a grant at once if it is too far back to reach the zone in time', () => {
    const m = granted();
    // 50 m from the zone at a standstill is about 14 seconds away.
    expireJunctionGrant(m, at(100.1, 250, 0), N);
    expect(isLeaving(m)).toBe(false);
  });

  it('keeps going once its front is in the zone or on EXIT, however old the grant', () => {
    const inZone = granted();
    expireJunctionGrant(inZone, at(100 + 5 * life, 300, 0), N);
    expect(isLeaving(inZone)).toBe(true);
    const onExit = granted();
    expireJunctionGrant(onExit, at(100 + 5 * life, 50, 3, 'EXIT'), N);
    expect(isLeaving(onExit)).toBe(true);
  });

  it('a grant heard again within JUNCTION_KEEPER_TIMEOUT of the first is the same grant, and is dropped again', () => {
    const m = granted();
    expireJunctionGrant(m, at(100 + life, 299.99, 0), N);
    remember(m, 100 + life + 0.5, { track: 'P2', offset: 299.99 }, null, { kind: 'grant', follow: null });
    expect(m.junctionGrantAt).toBe(100);
    expireJunctionGrant(m, at(100 + life + 0.5, 299.99, 0), N);
    expect(isLeaving(m)).toBe(false);
  });

  it('a grant heard after JUNCTION_KEEPER_TIMEOUT is a new grant', () => {
    const m = granted();
    expireJunctionGrant(m, at(100 + life, 299.99, 0), N);
    expireJunctionGrant(m, at(100 + JUNCTION_KEEPER_TIMEOUT, 299.99, 0), N);
    expect(m.junctionGrantAt).toBeNull();
    remember(m, 100 + JUNCTION_KEEPER_TIMEOUT + 1, { track: 'P2', offset: 299.99 }, null, { kind: 'grant', follow: null });
    expireJunctionGrant(m, at(100 + JUNCTION_KEEPER_TIMEOUT + 1, 299.99, 0), N);
    expect(isLeaving(m)).toBe(true);
    expect(m.junctionGrantAt).toBe(100 + JUNCTION_KEEPER_TIMEOUT + 1);
  });

  it('a train held at its stop point drops the grant, stays out of the zone and asks again', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'P1', offset: 299.99 }, 0);
    while (!requests(run).includes('JUNCTION')) tick(run);
    tick(run, [{ type: 'lockGrant', to: 1, resource: 'JUNCTION', follow: null }]);
    const asked = requests(run).length;
    // Something sits right in front of it, so it cannot move.
    for (let i = 0; i < 150; i++) {
      tick(run, [], 0.01);
      expect(run.state.pos.offset).toBeLessThan(300);
    }
    expect(run.out?.nextTrack).toBeNull();
    expect(requests(run).length).toBeGreaterThan(asked);
    // The way clears, but the old grant is gone. It does not move without a new one.
    for (let i = 0; i < 30; i++) tick(run, [{ type: 'lockRefuse', to: 1, resource: 'JUNCTION', alternative: null }]);
    expect(run.state.pos).toEqual({ track: 'P1', offset: 299.99 });
  });
});

describe('dropPlatformLocks', () => {
  it('drops a platform lock from its memory once the train is on EXIT, and keeps the junction lock', () => {
    const m = initialMemory(2, timetable);
    m.locks = ['P2', 'JUNCTION'];
    dropPlatformLocks(m, { track: 'P2', offset: 350 });
    expect(m.locks).toEqual(['P2', 'JUNCTION']);
    dropPlatformLocks(m, { track: 'EXIT', offset: 1 });
    expect(m.locks).toEqual(['JUNCTION']);
  });
});

describe('Train rules: the agent as a whole', () => {
  const grantP2: Message = { type: 'lockGrant', to: 2, resource: 'P2', follow: null };
  const leaderAt = (offset: number, sentAt = 0): Message => ({
    type: 'position',
    from: 1,
    pos: { track: 'A', offset },
    speed: 0,
    sentAt,
  });

  it('the limit is the lowest of the leader, sightAhead, stop point, permit and fallback limits', () => {
    const cruising = { id: 2, pos: { track: 'A' as const, offset: 1000 }, speed: 30, brokenDown: false };
    // Nothing in the way: the leader is far ahead, so the train speeds up.
    const free = createAgent(2, timetable).decide(input({ self: cruising, inbox: [leaderAt(5000)] }));
    expect(free.accel).toBe(ACCEL);
    // Each limit on its own is enough to make it brake.
    const byLeader = createAgent(2, timetable).decide(input({ self: cruising, inbox: [leaderAt(1300)] }));
    expect(byLeader.accel).toBe(-BRAKE);
    const bySight = createAgent(2, timetable).decide(input({ self: cruising, inbox: [leaderAt(5000)], sightAhead: 100 }));
    expect(bySight.accel).toBe(-BRAKE);
    const nearEnd = { ...cruising, pos: { track: 'A' as const, offset: 5900 } };
    const byStopPoint = createAgent(2, timetable).decide(input({ self: nearEnd, inbox: [leaderAt(11000)] }));
    expect(byStopPoint.accel).toBe(-BRAKE);
    const permit: Message = { type: 'permit', to: 2, untilX: 1100, nextTrack: null, sentAt: 0 };
    const byPermit = createAgent(2, timetable).decide(input({ self: cruising, inbox: [leaderAt(5000), permit] }));
    expect(byPermit.accel).toBe(-BRAKE);
  });

  it('accelerates by at most ACCEL toward the limit and brakes by at most BRAKE', () => {
    expect(accelFor(0, 45)).toBe(ACCEL);
    expect(accelFor(45, 1)).toBe(-BRAKE);
    // Close to the limit it takes only what it needs, so it lands on the limit.
    expect(accelFor(20, 20.02)).toBeCloseTo(0.2, 9);
    expect(accelFor(20, 20)).toBeCloseTo(0, 9);
  });

  it('brakes when its speed is above the limit', () => {
    expect(accelFor(30, 20)).toBe(-BRAKE);
    expect(accelFor(20.05, 20)).toBeCloseTo(-0.5, 9);
    expect(accelFor(5, 0)).toBe(-BRAKE);
    expect(accelFor(0, 0)).toBe(-BRAKE);
    expect(accelFor(5, NaN)).toBe(-BRAKE);
  });

  it('does not accelerate on the tick it changes nextTrack', () => {
    const run = startRun(createAgent(2, timetable), 2, { track: 'A', offset: 5000 }, 10);
    expect(tick(run, [leaderAt(11000)]).accel).toBe(ACCEL);
    const out = tick(run, [grantP2]);
    expect(out.nextTrack).toBe('P2');
    expect(out.accel).toBeLessThanOrEqual(0);
    expect(tick(run).accel).toBe(ACCEL);
  });

  it('sets nextTrack to its chosen platform while on A or B', () => {
    const run = startRun(createAgent(2, timetable), 2, { track: 'A', offset: 5000 }, 10);
    expect(tick(run).nextTrack).toBeNull();
    tick(run, [grantP2]);
    while (run.state.pos.track === 'A') expect(tick(run).nextTrack).toBe('P2');
    expect(run.state.pos.track).toBe('P2');
  });

  it('sets nextTrack to EXIT in a platform once it holds the junction lock or may start in its slot', () => {
    const waiting = initialMemory(2, timetable);
    const stoppedInP2 = input({ now: 60.1, self: { id: 2, pos: { track: 'P2', offset: 299.99 }, speed: 0, brokenDown: false } });
    expect(chooseRoute(waiting, stoppedInP2, N).nextTrack).toBeNull();

    const locked = initialMemory(2, timetable);
    locked.locks = ['JUNCTION'];
    expect(chooseRoute(locked, stoppedInP2, N)).toEqual({ nextTrack: 'EXIT', platform: null, slotStart: false });

    // Asked at 40 with no reply, so by 60 it is on clock slots, and slot 1 is P2's.
    const silent = initialMemory(2, timetable);
    silent.firstJunctionRequestAt = 40;
    expect(chooseRoute(silent, stoppedInP2, N)).toEqual({ nextTrack: 'EXIT', platform: null, slotStart: false });
    silent.lastNextTrack = 'EXIT';
    expect(chooseRoute(silent, stoppedInP2, N).slotStart).toBe(true);
    expect(chooseRoute(silent, { ...stoppedInP2, sightAhead: 0.01 }, N).slotStart).toBe(false);
  });

  it('only starts in its slot from the stop point, so the junction sensor shows it straight away', () => {
    const silent = initialMemory(2, timetable);
    silent.firstJunctionRequestAt = 40;
    silent.lastNextTrack = 'EXIT';
    const back = input({ now: 60.1, self: { id: 2, pos: { track: 'P2', offset: 250 }, speed: 0, brokenDown: false } });
    expect(chooseRoute(silent, back, N)).toEqual({ nextTrack: null, platform: null, slotStart: false });
  });

  it('sets nextTrack to null on EXIT', () => {
    const m = initialMemory(2, timetable);
    m.locks = ['JUNCTION'];
    m.platform = 'P2';
    const onExit = input({ self: { id: 2, pos: { track: 'EXIT', offset: 10 }, speed: 10, brokenDown: false } });
    expect(chooseRoute(m, onExit, N).nextTrack).toBeNull();
    expect(createAgent(2, timetable).decide(onExit).nextTrack).toBeNull();
  });

  it('a reply sent on tick t is acted on in decide on tick t + 1', () => {
    // The engine puts a reply sent on tick t in the inbox on tick t + 1. The agent acts on
    // it in that same decide, with no further delay.
    const agent = createAgent(2, timetable);
    const self = { id: 2, pos: { track: 'A' as const, offset: 5000 }, speed: 10, brokenDown: false };
    expect(agent.decide(input({ now: 0, self })).nextTrack).toBeNull();
    expect(agent.decide(input({ now: TICK, self, inbox: [grantP2] })).nextTrack).toBe('P2');
  });

  it('a message in the inbox on two ticks is handled once and not double counted', () => {
    const m = initialMemory(2, timetable);
    remember(m, 1, onA, { kind: 'grant', platform: 'P2' }, null);
    remember(m, 1.1, onA, { kind: 'grant', platform: 'P2' }, null);
    expect(m.locks).toEqual(['P2']);
    // The same grant and report on every tick change nothing after the first.
    const once = startRun(createAgent(2, timetable), 2, { track: 'A', offset: 5000 }, 10);
    const every = startRun(createAgent(2, timetable), 2, { track: 'A', offset: 5000 }, 10);
    for (let i = 0; i < 300; i++) {
      tick(once, i === 0 ? [grantP2, leaderAt(11000)] : []);
      tick(every, [grantP2, leaderAt(11000)]);
    }
    expect(every.state).toEqual(once.state);
    expect(every.sent).toEqual(once.sent);
  });

  it('every timer allows half a tick of slack, so a now built by adding TICK does not make it fire a tick late', () => {
    // 100 seconds on a clock built by adding TICK, which drifts off the exact tenths.
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5999.99 }, 0);
    const refuse: Message = { type: 'lockRefuse', to: 1, resource: 'P1', alternative: null };
    const sentAt: Record<string, number[]> = { position: [], lockRequest: [] };
    for (let i = 0; i < 1000; i++) {
      const inbox: Message[] = i % 10 === 0 ? [{ type: 'platformStatus', platform: 'P1', occupied: true, sentAt: run.now }] : [];
      for (const o of tick(run, i % 20 === 1 ? [...inbox, refuse] : inbox).outbox) sentAt[o.msg.type]?.push(i);
    }
    expect(sentAt.position).toEqual(Array.from({ length: 100 }, (_, k) => k * Math.round(POSITION_INTERVAL / TICK)));
    expect(sentAt.lockRequest).toEqual(Array.from({ length: 50 }, (_, k) => k * Math.round(REQUEST_REPEAT / TICK)));
  });

  it('starts on A or B in mode blind with its timetable leader and no report', () => {
    const out = createAgent(2, timetable).decide(input({ self: { id: 2, pos: { track: 'A', offset: 0 }, speed: SIGHT_SPEED, brokenDown: false } }));
    expect(out.mode).toBe('blind');
    expect(out.nextTrack).toBeNull();
    expect(out.accel).toBeCloseTo(0, 9); // held at SIGHT_SPEED
  });

  it('a train with no leader starts in mode full and may run at MAX_SPEED', () => {
    const out = createAgent(1, timetable).decide(input({ self: { id: 1, pos: { track: 'A', offset: 0 }, speed: SIGHT_SPEED, brokenDown: false } }));
    expect(out.mode).toBe('full');
    expect(out.accel).toBe(ACCEL);
  });

  it('stores the platform chooseRoute picks under the fallback', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5999.99 }, 0);
    const status = (occupied: boolean): Message[] =>
      (['P1', 'P2'] as const).map((platform) => ({ type: 'platformStatus', platform, occupied, sentAt: run.now - TICK }));
    for (let i = 0; i < 200 && !run.out?.nextTrack; i++) tick(run, i % 10 === 0 ? status(false) : []);
    expect(run.out?.nextTrack).toBe('P1');
    // The sensors now say occupied, as they will once its own front is in. It keeps P1.
    for (let i = 0; i < 600; i++) {
      tick(run, i % 10 === 0 ? status(true) : []);
      if (run.state.pos.track === 'A') expect(run.out?.nextTrack).toBe('P1');
    }
    expect(run.state.pos.track).toBe('P1');
  });

  it('takes every map and timing number from src/shared, read afresh on each call', () => {
    expect(trainNumbers()).not.toBe(trainNumbers());
    expect(N.slack).toBe(TICK / 2);
    expect(N.positionEvery).toBe(POSITION_INTERVAL);
    expect(N.requestRepeat).toBe(REQUEST_REPEAT);
    expect(N.junctionKeeperTimeout).toBe(JUNCTION_KEEPER_TIMEOUT);
    expect(N.grantLife).toBe(JUNCTION_KEEPER_TIMEOUT - REQUEST_REPEAT);
  });
});

describe('End to end, with the engine physics in a small loop', () => {
  it('stops from MAX_SPEED at a stop point without passing it', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 2000 }, MAX_SPEED);
    for (let i = 0; i < 3000 && run.state.speed > 0; i++) {
      tick(run);
      expect(run.state.pos.offset).toBeLessThan(6000);
    }
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.track).toBe('A');
    expect(run.state.pos.offset).toBeGreaterThan(6000 - 0.1);
    expect(run.overruns).toBe(0);
  });

  it('runs into a granted platform and stops at offset 300 or just short', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 4000 }, MAX_SPEED);
    let granted = false;
    for (let i = 0; i < 3000 && !(run.state.pos.track === 'P1' && run.state.speed === 0); i++) {
      // The platform keeper grants on the tick after the first request.
      const inbox: Message[] = !granted && requests(run).length > 0 ? [{ type: 'lockGrant', to: 1, resource: 'P1', follow: null }] : [];
      granted ||= inbox.length > 0;
      tick(run, inbox);
      if (run.state.pos.track === 'P1') expect(run.state.pos.offset).toBeLessThan(300);
    }
    expect(run.state.pos.track).toBe('P1');
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.offset).toBeGreaterThan(300 - 0.1);
    expect(run.overruns).toBe(0);
  });

  it('a follower behind a stopped leader stops at least MARGIN behind its rear', () => {
    // Train 1 is stopped with its front at offset 3000. With reports, with stale reports
    // and with none at all, train 2 must stop MARGIN short of its rear.
    const rear = 3000 - TRAIN_LENGTH;
    for (const reports of ['every second', 'one, long ago', 'none'] as const) {
      const run = startRun(createAgent(2, timetable), 2, { track: 'A', offset: 0 }, SIGHT_SPEED);
      for (let i = 0; i < 3000; i++) {
        const heard = reports === 'every second' ? i % 10 === 0 : reports === 'one, long ago' ? i === 0 : false;
        const inbox: Message[] = heard ? [{ type: 'position', from: 1, pos: { track: 'A', offset: 3000 }, speed: 0, sentAt: run.now }] : [];
        tick(run, inbox, sightTo(run, rear));
        expect(rear - run.state.pos.offset).toBeGreaterThanOrEqual(MARGIN);
      }
      expect(run.state.speed).toBe(0);
      expect(rear - run.state.pos.offset).toBeLessThan(MARGIN + 1);
    }
  });

  it('a blind train never exceeds SIGHT_SPEED', () => {
    // Train 2 never hears train 1. It runs the whole map: A, a granted platform, then EXIT
    // on a grant whose follow it has never heard either.
    const run = startRun(createAgent(2, timetable), 2, { track: 'A', offset: 0 }, SIGHT_SPEED);
    let platformGranted = false;
    let junctionGranted = false;
    const farAlongExit = () => run.state.pos.track === 'EXIT' && run.state.pos.offset > 5000;
    for (let i = 0; i < 9000 && !farAlongExit(); i++) {
      const inbox: Message[] = [];
      if (!platformGranted && requests(run).includes('P2')) {
        inbox.push({ type: 'lockGrant', to: 2, resource: 'P2', follow: null });
        platformGranted = true;
      }
      if (!junctionGranted && requests(run).includes('JUNCTION')) {
        inbox.push({ type: 'lockGrant', to: 2, resource: 'JUNCTION', follow: 1 });
        junctionGranted = true;
      }
      expect(tick(run, inbox).mode).toBe('blind');
    }
    expect(run.state.pos.track).toBe('EXIT');
    expect(run.state.pos.offset).toBeGreaterThan(5000);
    expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
    expect(run.overruns).toBe(0);
  });
});
