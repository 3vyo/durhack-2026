import { describe, expect, it } from 'vitest';
import type { Permit } from '../../src/baseline/centre';
import {
  accelFor,
  cautionLimit,
  chooseNextTrack,
  createBaselineAgent,
  initialTrainMemory,
  isPermitFresh,
  latestPermit,
  modeFor,
  speedLimit,
  stopX,
} from '../../src/baseline/train';
import {
  ACCEL,
  BRAKE,
  MARGIN,
  MAX_SPEED,
  PERMIT_FRESH,
  SIGHT_SPEED,
  TICK,
  safeSpeed,
} from '../../src/shared/constants';
import { TRACK_LENGTH, xOf } from '../../src/shared/map';
import type { Message, TimetableEntry, TrainAgent, TrainInput, TrainState } from '../../src/shared/types';

// Rules: "Today's rule, for comparison" in docs/design.md, plus the speed limit and
// mode table in "Following".

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
];

const self: TrainState = { id: 1, pos: { track: 'A', offset: 1000 }, speed: 30, brokenDown: false };

const permit: Permit = { type: 'permit', to: 1, untilX: 6300, nextTrack: 'P1', sentAt: 10 };

function input(overrides: Partial<TrainInput> = {}): TrainInput {
  return { now: 10.1, self, inbox: [], sightAhead: null, ...overrides };
}

function at(track: TrainState['pos']['track'], offset: number, speed: number): TrainState {
  return { id: 1, pos: { track, offset }, speed, brokenDown: false };
}

/**
 * Runs one train for a while with the engine's physics. `permitAt` says which permit, if
 * any, is in the inbox on a tick. Returns what happened on each tick.
 */
function drive(
  agent: TrainAgent,
  state: TrainState,
  seconds: number,
  permitAt: (now: number, state: TrainState) => Permit | null,
  startAt = 0,
) {
  const log: { now: number; x: number; speed: number; accel: number; mode: string }[] = [];
  const ticks = Math.round(seconds / TICK);
  let now = startAt;
  for (let i = 0; i < ticks; i++) {
    const arriving = permitAt(now, state);
    const out = agent.decide({
      now,
      self: { ...state, pos: { ...state.pos } },
      inbox: arriving ? [arriving] : [],
      sightAhead: null,
    });
    const accel = Math.max(-BRAKE, Math.min(ACCEL, out.accel));
    state.speed = Math.max(0, Math.min(MAX_SPEED, state.speed + accel * TICK));
    let offset = state.pos.offset + state.speed * TICK;
    let track = state.pos.track;
    if (offset >= TRACK_LENGTH[track] && out.nextTrack) {
      offset -= TRACK_LENGTH[track];
      track = out.nextTrack;
    }
    state.pos = { track, offset };
    log.push({ now, x: xOf(state.pos), speed: state.speed, accel: out.accel, mode: out.mode });
    now += TICK;
  }
  return log;
}

/** A permit sent once a second, as the centre does, until `until`. */
function everySecond(untilX: number, nextTrack: Permit['nextTrack'], until = Infinity) {
  return (now: number): Permit | null => {
    const onTheSecond = Math.abs(now - Math.round(now)) < TICK / 2;
    if (!onTheSecond || now > until) return null;
    return { type: 'permit', to: 1, untilX, nextTrack, sentAt: Math.round(now) };
  };
}

describe('memory', () => {
  it('starts with no permit and no next track', () => {
    expect(initialTrainMemory()).toEqual({ permit: null, nextTrack: null });
  });
});

describe('latestPermit', () => {
  const forOther: Permit = { ...permit, to: 2, sentAt: 20 };
  const newer: Permit = { ...permit, untilX: 6000, sentAt: 11 };

  it('picks a permit addressed to this train', () => {
    expect(latestPermit(1, [permit], null)).toBe(permit);
  });

  it('ignores permits addressed to other trains', () => {
    expect(latestPermit(1, [forOther], null)).toBeNull();
    expect(latestPermit(1, [forOther], permit)).toBe(permit);
  });

  it('picks the permit with the newest sentAt when the inbox holds several', () => {
    expect(latestPermit(1, [newer, permit], null)).toBe(newer);
    expect(latestPermit(1, [permit, newer], null)).toBe(newer);
  });

  it('keeps the held permit when the inbox has none newer', () => {
    expect(latestPermit(1, [], newer)).toBe(newer);
    expect(latestPermit(1, [permit], newer)).toBe(newer);
  });

  it('keeps a stale permit, because its untilX still applies', () => {
    const agent = createBaselineAgent(1, timetable);
    const state = at('A', 1000, 0);
    drive(agent, state, 60, (now) => (now === 0 ? { ...permit, untilX: 1100, sentAt: 0 } : null));
    expect(latestPermit(1, [], permit)).toBe(permit);
    expect(xOf(state.pos)).toBeLessThanOrEqual(1100);
  });

  it('ignores every message that is not a permit', () => {
    const others: Message[] = [
      { type: 'position', from: 1, pos: { track: 'A', offset: 0 }, speed: 0, sentAt: 99 },
      { type: 'lockGrant', to: 1, resource: 'P1', follow: null },
      { type: 'platformStatus', platform: 'P1', occupied: false, sentAt: 99 },
    ];
    expect(latestPermit(1, others, null)).toBeNull();
    expect(latestPermit(1, others, permit)).toBe(permit);
  });
});

describe('isPermitFresh', () => {
  it('is true for a permit under 5 seconds old', () => {
    expect(isPermitFresh(permit, permit.sentAt)).toBe(true);
    expect(isPermitFresh(permit, permit.sentAt + PERMIT_FRESH - 2 * TICK)).toBe(true);
  });

  it('is false for a permit 5 seconds old or older', () => {
    expect(isPermitFresh(permit, permit.sentAt + PERMIT_FRESH)).toBe(false);
    // The clock is a float, so a hair under 5 seconds counts as 5.
    expect(isPermitFresh(permit, permit.sentAt + PERMIT_FRESH - 1e-9)).toBe(false);
    expect(isPermitFresh(permit, permit.sentAt + 60)).toBe(false);
  });

  it('is false with no permit', () => {
    expect(isPermitFresh(null, 0)).toBe(false);
  });
});

describe('stopX', () => {
  it('is the untilX of a fresh permit', () => {
    expect(stopX(self, permit)).toBe(6300);
  });

  it('is still the untilX of the newest permit once that permit is stale', () => {
    // stopX does not look at the clock, so a stale permit gives the same answer.
    expect(isPermitFresh(permit, 1000)).toBe(false);
    expect(stopX(self, permit)).toBe(6300);
  });

  it('is the current x when the train has never had a permit', () => {
    expect(stopX(self, null)).toBe(1000);
    expect(stopX(at('P1', 100, 0), null)).toBe(6100);
  });
});

describe('speedLimit', () => {
  it('is 0 when fresh is false, so a train with no permit, or one 5 seconds old, brakes to a stop', () => {
    expect(speedLimit(self, 6300, false, null)).toBe(0);
    expect(speedLimit(self, 6300, false, 200)).toBe(0);
  });

  it("is safeSpeed of the distance from the train's front to stopX while the permit is fresh", () => {
    const slow = at('A', 5900, 10);
    const limit = speedLimit(slow, 6000, true, null);
    expect(limit).toBeLessThanOrEqual(safeSpeed(100));
    expect(limit).toBeGreaterThan(safeSpeed(100 - MAX_SPEED * TICK));
  });

  it('starts braking one tick early, so the train stops a few centimetres short of stopX', () => {
    const state = at('A', 4000, MAX_SPEED);
    drive(createBaselineAgent(1, timetable), state, 120, everySecond(6000, null));
    expect(state.speed).toBe(0);
    expect(state.pos.offset).toBeLessThanOrEqual(6000);
    expect(state.pos.offset).toBeGreaterThan(6000 - 0.1);
  });

  it('is 0 when the front is at or past stopX', () => {
    expect(speedLimit(at('A', 6000, 0), 6000, true, null)).toBe(0);
    expect(speedLimit(at('P1', 10, 5), 6000, true, null)).toBe(0);
  });

  it('never exceeds MAX_SPEED', () => {
    expect(speedLimit(self, 1e6, true, null)).toBe(MAX_SPEED);
    expect(speedLimit(self, Infinity, true, null)).toBe(MAX_SPEED);
  });

  it('rises again as soon as a fresh permit arrives', () => {
    expect(speedLimit(self, 6300, false, null)).toBe(0);
    expect(speedLimit(self, 6300, true, null)).toBe(MAX_SPEED);
  });

  it('obeys sightAhead as well as stopX, as a driver would (the centre is safe without it)', () => {
    const limit = speedLimit(self, 6300, true, 150);
    expect(limit).toBeLessThanOrEqual(safeSpeed(150 - MARGIN));
    expect(limit).toBeGreaterThan(0);
    expect(speedLimit(self, 6300, true, MARGIN)).toBe(0);
    expect(speedLimit(self, 6300, true, null)).toBe(MAX_SPEED);
  });
});

describe('accelFor', () => {
  it('accelerates at ACCEL when well under the limit', () => {
    expect(accelFor(10, MAX_SPEED)).toBe(ACCEL);
    expect(accelFor(0, 5)).toBe(ACCEL);
  });

  it('brakes when over the limit', () => {
    expect(accelFor(30, 20)).toBe(-BRAKE);
    expect(accelFor(30, 0)).toBe(-BRAKE);
    expect(accelFor(20.01, 20)).toBeLessThan(0);
  });

  it('always returns a value between -BRAKE and ACCEL', () => {
    for (const speed of [0, 0.01, 5, 21, 44.99, 45]) {
      for (const limit of [0, 0.001, 5, 20.99, 21, 45]) {
        const accel = accelFor(speed, limit);
        expect(accel).toBeGreaterThanOrEqual(-BRAKE);
        expect(accel).toBeLessThanOrEqual(ACCEL);
      }
    }
  });
});

describe('chooseNextTrack', () => {
  it('follows the nextTrack of a fresh permit', () => {
    expect(chooseNextTrack(self, permit, 10.1, null)).toBe('P1');
    expect(chooseNextTrack(self, { ...permit, nextTrack: 'P2' }, 10.1, 'P1')).toBe('P2');
    expect(chooseNextTrack(at('P1', 300, 0), { ...permit, nextTrack: 'EXIT' }, 10.1, null)).toBe('EXIT');
    expect(chooseNextTrack(self, { ...permit, nextTrack: null }, 10.1, 'P1')).toBeNull();
  });

  it('keeps its last nextTrack while it waits for permits to return', () => {
    expect(chooseNextTrack(self, permit, 100, 'P1')).toBe('P1');
    expect(chooseNextTrack(self, { ...permit, nextTrack: 'P2' }, 100, 'P1')).toBe('P1');
    expect(chooseNextTrack(self, null, 100, 'P1')).toBe('P1');
  });

  it('ignores a nextTrack that does not lead on from the current track, such as P1 while on P1', () => {
    // A permit sent while the train was on A can arrive once it is in P1.
    expect(chooseNextTrack(at('P1', 5, 20), permit, 10.1, 'P1')).toBeNull();
    expect(chooseNextTrack(at('P1', 5, 20), permit, 100, 'P1')).toBeNull();
    expect(chooseNextTrack(self, { ...permit, nextTrack: 'P3' }, 10.1, 'P1')).toBe('P1');
    expect(chooseNextTrack(at('EXIT', 5, 20), { ...permit, nextTrack: 'EXIT' }, 10.1, 'EXIT')).toBeNull();
  });

  it('ignores the timetable default platform and follows only permits', () => {
    const agent = createBaselineAgent(1, timetable);
    expect(agent.decide(input()).nextTrack).toBeNull();
    const toP2: Permit = { ...permit, nextTrack: 'P2' };
    expect(agent.decide(input({ inbox: [toP2] })).nextTrack).toBe('P2');
  });
});

describe('modeFor', () => {
  it('shows radio for a fresh radio working permit, and blind once it is stale', () => {
    expect(modeFor({ ...permit, caution: true }, 10.1)).toBe('radio');
    expect(modeFor({ ...permit, caution: true }, 15)).toBe('blind');
  });

  it('reports central while the permit is under 5 seconds old', () => {
    expect(modeFor(permit, 10.1)).toBe('central');
    expect(modeFor(permit, 14.8)).toBe('central');
  });

  it('reports blind with no fresh permit', () => {
    expect(modeFor(permit, 15)).toBe('blind');
    expect(modeFor(null, 0)).toBe('blind');
  });
});

describe('decide', () => {
  it('holds its brakes on, sets no next track and reports blind before its first permit', () => {
    const agent = createBaselineAgent(1, timetable);
    expect(agent.decide(input())).toEqual({ accel: -BRAKE, nextTrack: null, outbox: [], mode: 'blind' });
  });

  it('runs while it holds a fresh permit', () => {
    const agent = createBaselineAgent(1, timetable);
    const out = agent.decide(input({ inbox: [permit] }));
    expect(out).toEqual({ accel: ACCEL, nextTrack: 'P1', outbox: [], mode: 'central' });
    const state = at('A', 0, 21);
    const log = drive(createBaselineAgent(1, timetable), state, 60, everySecond(6300, 'P1'));
    expect(state.speed).toBe(MAX_SPEED);
    expect(log.every((entry) => entry.mode === 'central')).toBe(true);
  });

  it('never lets its front pass untilX', () => {
    for (const [offset, speed, untilX] of [[0, 21, 400], [3000, MAX_SPEED, 5000], [5990, 0, 6000], [100, 0, 100.5]]) {
      const state = at('A', offset, speed);
      const log = drive(createBaselineAgent(1, timetable), state, 200, everySecond(untilX, null));
      expect(Math.max(...log.map((entry) => entry.x))).toBeLessThanOrEqual(untilX);
      expect(state.speed).toBe(0);
      expect(xOf(state.pos)).toBeGreaterThan(untilX - 0.1);
    }
  });

  it('comes to rest at or before the untilX of its last permit when its permits stop at MAX_SPEED, 5 seconds of running included', () => {
    // 1125 m is the braking distance at MAX_SPEED. The last permit is the worst case: the
    // train runs on for 5 seconds at full speed before it brakes.
    for (const ahead of [1125, 1200, 1300, 2000]) {
      const state = at('A', 1000, MAX_SPEED);
      const untilX = 1000 + ahead;
      const log = drive(createBaselineAgent(1, timetable), state, 120, everySecond(untilX, null, 0));
      expect(state.speed).toBe(0);
      expect(Math.max(...log.map((entry) => entry.x))).toBeLessThanOrEqual(untilX);
    }
  });

  it('keeps nextTrack P1 when its permits stop at x 5500 and 35 m/s with untilX 6300, crosses onto P1 while braking, and stops at or before x 6300', () => {
    const state = at('A', 5500, 35);
    drive(createBaselineAgent(1, timetable), state, 120, everySecond(6300, 'P1', 0));
    expect(state.speed).toBe(0);
    expect(state.pos.track).toBe('P1');
    expect(xOf(state.pos)).toBeLessThanOrEqual(6300);
  });

  it('brakes to a stop after 5 seconds with no new permit', () => {
    const state = at('A', 1000, 30);
    const log = drive(createBaselineAgent(1, timetable), state, 60, everySecond(6300, 'P1', 0));
    const firstBrake = log.find((entry) => entry.accel === -BRAKE);
    expect(firstBrake?.now).toBeGreaterThan(PERMIT_FRESH - 2 * TICK);
    expect(firstBrake?.now).toBeLessThan(PERMIT_FRESH + TICK);
    expect(log.filter((entry) => entry.now < PERMIT_FRESH - 2 * TICK).every((entry) => entry.mode === 'central')).toBe(true);
    expect(state.speed).toBe(0);
    expect(log[log.length - 1].mode).toBe('blind');
  });

  it('waits stopped while it has no fresh permit', () => {
    const state = at('A', 1000, 0);
    const agent = createBaselineAgent(1, timetable);
    drive(agent, state, 60, () => null);
    expect(state).toEqual(at('A', 1000, 0));
    // A permit that is already stale when it arrives does not move it either.
    drive(agent, state, 10, (now) => (now === 0 ? permit : null), 100);
    expect(state).toEqual(at('A', 1000, 0));
  });

  it('carries on on the tick after permits return, since a message sent on tick t arrives on tick t + 1', () => {
    const agent = createBaselineAgent(1, timetable);
    const state = at('A', 1000, 20);
    drive(agent, state, 60, everySecond(6300, 'P1', 0));
    expect(state.speed).toBe(0);
    // The centre sends a permit at 60. It is in the inbox on the next tick, 60.1.
    const back: Permit = { ...permit, sentAt: 60 };
    const out = agent.decide({ now: 60.1, self: state, inbox: [back], sightAhead: null });
    expect(out).toEqual({ accel: ACCEL, nextTrack: 'P1', outbox: [], mode: 'central' });
  });

  it('sends no messages', () => {
    const agent = createBaselineAgent(1, timetable);
    for (let tick = 0; tick < 100; tick++) {
      const out = agent.decide(input({ now: 10 + tick * TICK, inbox: tick % 10 === 0 ? [permit] : [] }));
      expect(out.outbox).toEqual([]);
    }
  });
});

describe('radio working (design: "Radio working")', () => {
  it('a fresh caution permit keeps the train at SIGHT_SPEED or below', () => {
    expect(cautionLimit({ ...permit, caution: true }, true)).toBe(SIGHT_SPEED);
    expect(cautionLimit({ ...permit, caution: true }, false)).toBe(Infinity);
    expect(cautionLimit(permit, true)).toBe(Infinity);
    expect(cautionLimit(null, true)).toBe(Infinity);
  });

  it('a train released by radio never goes above SIGHT_SPEED', () => {
    const agent = createBaselineAgent(1, timetable);
    let state = at('A', 1000, 0);
    let top = 0;
    for (let i = 0; i < 600; i++) {
      const inbox: Message[] = i % 10 === 0 ? [{ ...permit, untilX: 6000, sentAt: i * TICK, caution: true }] : [];
      const out = agent.decide({ now: i * TICK, self: state, inbox, sightAhead: null });
      const speed = Math.min(MAX_SPEED, Math.max(0, state.speed + out.accel * TICK));
      state = { ...state, speed, pos: { ...state.pos, offset: state.pos.offset + speed * TICK } };
      top = Math.max(top, speed);
    }
    expect(top).toBeGreaterThan(SIGHT_SPEED - 1);
    expect(top).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
  });
});
