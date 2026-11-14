import { describe, expect, it } from 'vitest';
import { ACCEL, BRAKE, MAX_SPEED } from '../../src/shared/constants';
import type { Message, TimetableEntry, TrainInput, TrainOutput } from '../../src/shared/types';
import {
  accelFor,
  clampAccel,
  createAgent,
  hold,
  initialMemory,
  lowestLimit,
  nextTrackFor,
  noteSent,
  remember,
} from '../../src/train/agent';

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
  { id: 3, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
];

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
  { type: 'platformStatus', platform: 'P2', occupied: false, sentAt: 0 },
];

function expectHolding(out: TrainOutput): void {
  expect(out).toEqual({ accel: -BRAKE, nextTrack: null, outbox: [], mode: 'blind' });
}

describe('agent frame', () => {
  it('createAgent returns an agent with decide', () => {
    expect(typeof createAgent(2, timetable).decide).toBe('function');
  });

  it('decide holds its brakes on, sets nextTrack to null, sends nothing and reports blind', () => {
    expectHolding(createAgent(2, timetable).decide(input()));
  });

  it('decide keeps holding over many ticks with a busy inbox, a stopped train and an obstacle', () => {
    const agent = createAgent(2, timetable);
    for (let tick = 0; tick < 200; tick++) {
      const now = tick * 0.1;
      const out = agent.decide(
        input({
          now,
          inbox: busyInbox,
          sightAhead: tick % 2 ? 80 : null,
          self: { id: 2, pos: { track: 'A', offset: 4800 + tick }, speed: tick % 3 ? 0 : 40, brokenDown: false },
        }),
      );
      expectHolding(out);
    }
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

  it('a train missing from the timetable still holds', () => {
    expectHolding(createAgent(99, timetable).decide(input()));
  });

  it('hold returns a new braking output each call', () => {
    const a = hold();
    expectHolding(a);
    a.outbox.push({ msg: busyInbox[0], range: 'long' });
    expectHolding(hold());
  });
});

describe('initialMemory', () => {
  it('takes the entry and leader from the timetable', () => {
    const m = initialMemory(2, timetable);
    expect(m.id).toBe(2);
    expect(m.entry).toEqual(timetable[1]);
    expect(m.leader).toBe(1);
  });

  it('starts with no report, permit, locks, platform or dwell timer', () => {
    const m = initialMemory(2, timetable);
    expect(m.leaderReport).toBeNull();
    expect(m.permit).toBeNull();
    expect(m.locks).toEqual([]);
    expect(m.platform).toBeNull();
    expect(m.dwellStartedAt).toBeNull();
    expect(m.platformStatus).toEqual({});
    expect(m.lastNextTrack).toBeNull();
  });

  it('has no entry and no leader for a train missing from the timetable', () => {
    const m = initialMemory(99, timetable);
    expect(m.entry).toBeNull();
    expect(m.leader).toBeNull();
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

describe('agent placeholders', () => {
  it('accelFor is full brakes', () => {
    expect(accelFor(0, 45)).toBe(-BRAKE);
    expect(accelFor(30, 0)).toBe(-BRAKE);
  });

  it('nextTrackFor is null', () => {
    const m = initialMemory(2, timetable);
    m.platform = 'P2';
    expect(nextTrackFor(m, input())).toBeNull();
  });
});

describe('remember', () => {
  it('stores a platform grant as the chosen platform and a held lock', () => {
    const m = initialMemory(2, timetable);
    m.alternative = 'P1';
    remember(m, { kind: 'grant', platform: 'P2' }, null);
    expect(m.platform).toBe('P2');
    expect(m.locks).toEqual(['P2']);
    expect(m.alternative).toBeNull();
    expect(m.heardStationReply).toBe(true);
  });

  it('stores the alternative from a refusal and takes no lock', () => {
    const m = initialMemory(2, timetable);
    remember(m, { kind: 'refuse', platform: 'P2', alternative: 'P1' }, null);
    expect(m.alternative).toBe('P1');
    expect(m.locks).toEqual([]);
    expect(m.platform).toBeNull();
    expect(m.heardStationReply).toBe(true);
  });

  it('stores a junction grant as a lock and its follow train as the new leader', () => {
    const m = initialMemory(2, timetable);
    m.leaderReport = { pos: { track: 'A', offset: 2000 }, speed: 30, sentAt: 0 };
    remember(m, null, { follow: 7 });
    expect(m.locks).toEqual(['JUNCTION']);
    expect(m.leader).toBe(7);
    expect(m.leaderReport).toBeNull();
    expect(m.heardMergeReply).toBe(true);
  });

  it('keeps the leader report when the junction grant names the same leader', () => {
    const m = initialMemory(2, timetable);
    const report = { pos: { track: 'EXIT' as const, offset: 400 }, speed: 30, sentAt: 0 };
    m.leaderReport = report;
    remember(m, null, { follow: 1 });
    expect(m.leaderReport).toBe(report);
  });

  it('does not store the same lock twice', () => {
    const m = initialMemory(2, timetable);
    remember(m, { kind: 'grant', platform: 'P2' }, { follow: null });
    remember(m, { kind: 'grant', platform: 'P2' }, { follow: null });
    expect(m.locks).toEqual(['P2', 'JUNCTION']);
  });

  it('changes nothing with no replies', () => {
    const m = initialMemory(2, timetable);
    remember(m, null, null);
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
  it.todo('starts on A or B in mode blind with its timetable leader and no report');
});
