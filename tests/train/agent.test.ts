// Each test under a "placeholders" describe pins a placeholder's value. Delete it in the
// commit that writes its rule. Do not edit it to pass. The other real tests check memory
// and bookkeeping that stay. Each it.todo becomes a real test when its rule is written.

import { describe, expect, it } from 'vitest';
import { ACCEL, BRAKE, MAX_SPEED } from '../../src/shared/constants';
import type { Message, Position, TimetableEntry, TrainInput, TrainOutput } from '../../src/shared/types';
import {
  accelFor,
  chooseRoute,
  clampAccel,
  createAgent,
  exitLeader,
  hold,
  initialMemory,
  lowestLimit,
  noteSent,
  remember,
} from '../../src/train/agent';
import { PENDING_NUMBERS as N } from '../../src/train/numbers';

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
  { id: 3, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
];

const onA: Position = { track: 'A', offset: 5000 };
const inP1: Position = { track: 'P1', offset: 200 };

function input(over: Partial<TrainInput> = {}): TrainInput {
  return {
    now: 0,
    self: { id: 2, pos: { track: 'A', offset: 1000 }, speed: 30, brokenDown: false },
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
    expect(typeof createAgent(2, timetable, N).decide).toBe('function');
  });

  it('accel stays between -BRAKE and ACCEL in every situation the frame can meet', () => {
    const agent = createAgent(2, timetable);
    for (const speed of [0, 10, 21, 45, 60]) {
      for (const track of ['A', 'P2', 'EXIT'] as const) {
        const out = agent.decide(input({ self: { id: 2, pos: { track, offset: 50 }, speed, brokenDown: false } }));
        expect(out.accel).toBeGreaterThanOrEqual(-BRAKE);
        expect(out.accel).toBeLessThanOrEqual(ACCEL);
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
});

describe('agent placeholders (delete each when its rule is written)', () => {
  it('decide holds its brakes on, sets nextTrack to null, sends nothing and reports blind', () => {
    expectHolding(createAgent(2, timetable).decide(input()));
  });

  it('decide keeps holding over many ticks with a busy inbox, a stopped train and an obstacle', () => {
    const agent = createAgent(2, timetable);
    for (let tick = 0; tick < 200; tick++) {
      const out = agent.decide(
        input({
          now: tick * 0.1,
          inbox: busyInbox,
          sightAhead: tick % 2 ? 80 : null,
          self: { id: 2, pos: { track: 'A', offset: 4800 + tick }, speed: tick % 3 ? 0 : 40, brokenDown: false },
        }),
      );
      expectHolding(out);
    }
  });

  it('accelFor is full brakes', () => {
    expect(accelFor(0, 45)).toBe(-BRAKE);
    expect(accelFor(30, 0)).toBe(-BRAKE);
  });

  it('chooseRoute sets no nextTrack, keeps the platform and starts no slot', () => {
    const m = initialMemory(2, timetable);
    m.platform = 'P2';
    expect(chooseRoute(m, input(), N)).toEqual({ nextTrack: null, platform: 'P2', slotStart: false });
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
    expect(m.lastStationReply).toBeNull();
    expect(m.lastMergeReplyAt).toBeNull();
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
    expect(exitLeader(null)).toBe('none');
  });

  it('takes the follow train as the leader', () => {
    expect(exitLeader(7)).toBe(7);
  });
});

describe('remember', () => {
  it('stores a platform grant on the entry track as the chosen platform, a held lock and the last reply', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, onA, { kind: 'grant', platform: 'P2' }, null);
    expect(m.platform).toBe('P2');
    expect(m.locks).toEqual(['P2']);
    expect(m.lastStationReply).toEqual({ kind: 'grant', platform: 'P2', at: 4 });
  });

  it('stores a refusal with its alternative and time, and takes no lock', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, onA, { kind: 'refuse', platform: 'P2', alternative: 'P1' }, null);
    expect(m.lastStationReply).toEqual({ kind: 'refuse', platform: 'P2', alternative: 'P1', at: 4 });
    expect(m.locks).toEqual([]);
    expect(m.platform).toBeNull();
  });

  it('keeps the last station reply on ticks with no reply', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, onA, { kind: 'refuse', platform: 'P2', alternative: null }, null);
    remember(m, 5, onA, null, null);
    expect(m.lastStationReply).toEqual({ kind: 'refuse', platform: 'P2', alternative: null, at: 4 });
  });

  it('ignores a platform grant once the front has left the entry track', () => {
    const m = initialMemory(2, timetable);
    m.platform = 'P1';
    remember(m, 4, inP1, { kind: 'grant', platform: 'P2' }, null);
    expect(m.platform).toBe('P1');
    expect(m.locks).toEqual([]);
  });

  it('stores a junction grant as a lock, a reply time and its follow train as the new leader', () => {
    const m = initialMemory(2, timetable);
    const report = { pos: { track: 'EXIT' as const, offset: 400 }, speed: 30, sentAt: 0 };
    m.reports = { 7: report };
    remember(m, 4, inP1, null, { kind: 'grant', follow: 7 });
    expect(m.locks).toEqual(['JUNCTION']);
    expect(m.leader).toBe(7);
    expect(m.lastMergeReplyAt).toBe(4);
    expect(m.reports[7]).toBe(report);
  });

  it('stores a junction refusal as a reply time only', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, inP1, null, { kind: 'refuse' });
    expect(m.lastMergeReplyAt).toBe(4);
    expect(m.locks).toEqual([]);
    expect(m.leader).toBe(1);
  });

  it('reads a junction grant with follow null through exitLeader', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, inP1, null, { kind: 'grant', follow: null });
    expect(m.leader).toBe(exitLeader(null));
  });

  it('does not store the same lock twice', () => {
    const m = initialMemory(2, timetable);
    remember(m, 4, onA, { kind: 'grant', platform: 'P2' }, null);
    remember(m, 5, onA, { kind: 'grant', platform: 'P2' }, null);
    remember(m, 6, inP1, null, { kind: 'grant', follow: null });
    remember(m, 7, inP1, null, { kind: 'grant', follow: null });
    expect(m.locks).toEqual(['P2', 'JUNCTION']);
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
    expect(m.lastPlatformRequestAt).toBe(3);
    expect(m.firstJunctionRequestAt).toBe(3);
    expect(m.lastJunctionRequestAt).toBe(3);
  });

  it('keeps the first junction request time when the request repeats', () => {
    const m = initialMemory(2, timetable);
    const req = { msg: { type: 'lockRequest', from: 2, resource: 'JUNCTION' } as Message, range: 'short' as const };
    noteSent(m, [req], 3);
    noteSent(m, [req], 5);
    expect(m.firstJunctionRequestAt).toBe(3);
    expect(m.lastJunctionRequestAt).toBe(5);
  });
});

describe('Train rules: the agent as a whole', () => {
  it.todo('the limit is the lowest of the leader, sightAhead, stop point, permit and fallback limits');
  it.todo('accelerates by at most ACCEL toward the limit and brakes by at most BRAKE');
  it.todo('brakes when its speed is above the limit');
  it.todo('does not accelerate on the tick it changes nextTrack');
  it.todo('sets nextTrack to its chosen platform while on A or B');
  it.todo('sets nextTrack to EXIT in a platform once it holds the junction lock or may start in its slot');
  it.todo('sets nextTrack to null on EXIT');
  it.todo('a reply sent on tick t is acted on in decide on tick t + 1');
  it.todo('a message in the inbox on two ticks is handled once and not double counted');
  it.todo('every timer allows half a tick of slack, so a now built by adding TICK does not make it fire a tick late');
  it.todo('starts on A or B in mode blind with its timetable leader and no report');
  it.todo('stores the platform chooseRoute picks under the fallback');
  it.todo('drops a platform lock from its memory once it has left the platform (the design does not say when)');
  it.todo('takes every map and timing number from src/shared once #34 merges, in place of PENDING_NUMBERS');
});
