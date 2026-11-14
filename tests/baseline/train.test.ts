import { describe, expect, it } from 'vitest';
import type { Permit } from '../../src/baseline/centre';
import {
  PERMIT_FRESH,
  accelFor,
  chooseNextTrack,
  createBaselineAgent,
  initialTrainMemory,
  isPermitFresh,
  latestPermit,
  modeFor,
  speedLimit,
  stopX,
} from '../../src/baseline/train';
import { ACCEL, BRAKE } from '../../src/shared/constants';
import type { TimetableEntry, TrainInput, TrainState } from '../../src/shared/types';

// Rules: "Today's rule, for comparison" in docs/design.md, plus the speed limit and
// mode table in "Following".
//
// Placeholder tests pin the safe values the frame returns for now. When a rule lands,
// delete its placeholder test and write real tests from its to-dos. Do not edit a
// placeholder test to make it pass.

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
];

const self: TrainState = { id: 1, pos: { track: 'A', offset: 1000 }, speed: 30, brokenDown: false };

const permit: Permit = { type: 'permit', to: 1, untilX: 6300, nextTrack: 'P1', sentAt: 10 };

function input(overrides: Partial<TrainInput> = {}): TrainInput {
  return { now: 10.1, self, inbox: [], sightAhead: null, ...overrides };
}

describe('constants and memory', () => {
  it('counts a permit as fresh for 5 seconds', () => {
    expect(PERMIT_FRESH).toBe(5);
  });

  it('starts with no permit and no next track', () => {
    expect(initialTrainMemory()).toEqual({ permit: null, nextTrack: null });
  });
});

describe('placeholders return the safest value', () => {
  it('latestPermit acts as if the train holds no permit', () => {
    expect(latestPermit(1, [permit], null)).toBeNull();
  });

  it('isPermitFresh counts even a brand-new permit as stale', () => {
    expect(isPermitFresh(permit, permit.sentAt)).toBe(false);
  });

  it('stopX is the train current x, so it may not move', () => {
    expect(stopX(self, permit)).toBe(1000);
    expect(stopX({ ...self, pos: { track: 'P1', offset: 100 } }, null)).toBe(6100);
  });

  it('speedLimit is 0, so the train may not move', () => {
    expect(speedLimit(self, 6300, true, null)).toBe(0);
  });

  it('accelFor holds the brakes on, within -BRAKE and ACCEL', () => {
    const accel = accelFor(0, 45);
    expect(accel).toBe(-BRAKE);
    expect(accel).toBeGreaterThanOrEqual(-BRAKE);
    expect(accel).toBeLessThanOrEqual(ACCEL);
  });

  it('chooseNextTrack ends the path at the end of the current track', () => {
    expect(chooseNextTrack(self, permit, 10.1, 'P1')).toBeNull();
  });

  it('modeFor reports blind', () => {
    expect(modeFor(permit, 10.1)).toBe('blind');
  });
});

describe('createBaselineAgent', () => {
  it('holds its brakes on, sets no next track, sends nothing and reports blind', () => {
    const agent = createBaselineAgent(1, timetable);
    expect(agent.decide(input())).toEqual({
      accel: -BRAKE,
      nextTrack: null,
      outbox: [],
      mode: 'blind',
    });
  });

  it('stays safe even with a fresh permit in its inbox', () => {
    const agent = createBaselineAgent(1, timetable);
    const out = agent.decide(input({ inbox: [permit] }));
    expect(out.accel).toBeGreaterThanOrEqual(-BRAKE);
    expect(out.accel).toBeLessThanOrEqual(ACCEL);
    expect(out.accel).toBe(-BRAKE);
  });

  it('never sends a lock request, because the baseline holds no locks', () => {
    const agent = createBaselineAgent(1, timetable);
    for (let tick = 0; tick < 50; tick++) {
      const out = agent.decide(input({ now: tick / 10, inbox: [permit] }));
      expect(out.outbox.some((o) => o.msg.type === 'lockRequest')).toBe(false);
    }
  });
});

describe('latestPermit', () => {
  it.todo('picks a permit addressed to this train');
  it.todo('ignores permits addressed to other trains');
  it.todo('picks the permit with the newest sentAt when the inbox holds several');
  it.todo('keeps the held permit when the inbox has none newer');
  it.todo('keeps a stale permit, because its untilX still applies');
  it.todo('ignores every message that is not a permit');
});

describe('isPermitFresh', () => {
  it.todo('is true for a permit under 5 seconds old');
  it.todo('is false for a permit 5 seconds old or older');
  it.todo('is false with no permit');
});

describe('stopX', () => {
  it.todo('is the untilX of a fresh permit');
  it.todo('is still the untilX of the newest permit once that permit is stale');
  it.todo('is the current x when the train has never had a permit');
});

describe('speedLimit', () => {
  it.todo('is 0 with no permit');
  it.todo('is 0 once the permit is 5 seconds old, so the train brakes to a stop');
  it.todo("is safeSpeed of the distance from the train's front to stopX while the permit is fresh");
  it.todo('starts braking one tick early, so the train stops a few centimetres short of stopX');
  it.todo('is 0 when the front is at or past stopX');
  it.todo('never exceeds MAX_SPEED');
  it.todo('rises again as soon as a fresh permit arrives');
  it.todo('obeys sightAhead as well as stopX (open design point; the centre must be safe without it)');
});

describe('accelFor', () => {
  it.todo('accelerates at ACCEL when well under the limit');
  it.todo('brakes when over the limit');
  it.todo('always returns a value between -BRAKE and ACCEL');
});

describe('chooseNextTrack', () => {
  it.todo('follows the nextTrack of a fresh permit');
  it.todo('keeps its last nextTrack while it waits for permits to return');
  it.todo('ignores a nextTrack that does not lead on from the current track, such as P1 while on P1');
  it.todo('ignores the timetable default platform and follows only permits');
});

describe('modeFor', () => {
  it.todo('reports central while the permit is under 5 seconds old');
  it.todo('reports blind with no fresh permit');
});

describe('decide', () => {
  it.todo('runs while it holds a fresh permit');
  it.todo('never lets its front pass untilX');
  it.todo('comes to rest at or before the untilX of its last permit when its permits stop at MAX_SPEED, 5 seconds of running included');
  it.todo('keeps nextTrack P1 when its permits stop near x 5500 at speed with untilX 6300, crosses onto P1 while braking, and stops at or before x 6300');
  it.todo('brakes to a stop after 5 seconds with no new permit');
  it.todo('waits stopped while it has no fresh permit');
  it.todo('carries on on the tick after permits return, since a message sent on tick t arrives on tick t + 1');
  it.todo('sends no messages');
});
