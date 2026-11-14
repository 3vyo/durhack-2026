import { describe, expect, it } from 'vitest';
import { BRAKE, MAX_SPEED, PERMIT_FRESH, SIGHT_SPEED, TICK, safeSpeed } from '../../src/shared/constants';
import type { Message, TrainState } from '../../src/shared/types';
import { createAgent } from '../../src/train/agent';
import { brakeLimit } from '../../src/train/follow';
import { STOP_SHORT, trainNumbers } from '../../src/train/numbers';
import {
  committedPlatform,
  isPermitFresh,
  latestPermit,
  permitLeader,
  permitLimit,
  permitRoute,
  type HeldPermit,
} from '../../src/train/permits';
import { requests, startRun, tick, ticks, timetable } from './sim';

const N = trainNumbers();

const permit: HeldPermit = { untilX: 6000, nextTrack: 'P1', sentAt: 9 };
const self: TrainState = { id: 1, pos: { track: 'A', offset: 1000 }, speed: 30, brokenDown: false };
const forMe: Message = { type: 'permit', to: 1, untilX: 6000, nextTrack: 'P1', sentAt: 9 };

function permitMsg(
  sentAt: number,
  untilX: number,
  nextTrack: HeldPermit['nextTrack'] = null,
  to = 1,
  leader?: number | null,
): Message {
  const msg: Message = { type: 'permit', to, untilX, nextTrack, sentAt };
  return leader === undefined ? msg : { ...msg, leader };
}

/** A permit that allows everything, sent one tick ago. */
function wideOpen(now: number, nextTrack: HeldPermit['nextTrack'], to = 1, leader?: number | null): Message {
  return permitMsg(now - TICK, 12400, nextTrack, to, leader);
}

describe('The centre comes first: reading permits', () => {
  it('keeps the newest permit addressed to this train', () => {
    const newer = permitMsg(10, 6200, 'P2');
    expect(latestPermit(null, [forMe], 1)).toEqual(permit);
    expect(latestPermit(permit, [newer], 1)).toEqual({ untilX: 6200, nextTrack: 'P2', sentAt: 10 });
    expect(latestPermit(null, [newer, forMe], 1)).toEqual({ untilX: 6200, nextTrack: 'P2', sentAt: 10 });
  });

  it('keeps the leader the permit names, null included', () => {
    expect(latestPermit(null, [permitMsg(9, 6000, null, 1, 7)], 1)?.leader).toBe(7);
    expect(latestPermit(null, [permitMsg(9, 6000, null, 1, null)], 1)?.leader).toBeNull();
    expect(latestPermit(null, [permitMsg(9, 6000, null, 1)], 1)).not.toHaveProperty('leader');
  });

  it('ignores a radio working permit, because by then it is running on its own rules', () => {
    const radio: Message = { ...permitMsg(10, 6200, 'P2'), caution: true } as Message;
    expect(latestPermit(null, [radio], 1)).toBeNull();
    expect(latestPermit(permit, [radio], 1)).toBe(permit);
  });

  it('ignores permits addressed to other trains', () => {
    expect(latestPermit(null, [permitMsg(9, 6000, 'P1', 2)], 1)).toBeNull();
    expect(latestPermit(permit, [permitMsg(20, 100, 'P2', 2)], 1)).toBe(permit);
  });

  it('ignores a permit with an older sentAt than the one it holds', () => {
    expect(latestPermit(permit, [permitMsg(8, 100, 'P2')], 1)).toBe(permit);
  });

  it('keeps its last permit when the inbox has none', () => {
    expect(latestPermit(permit, [], 1)).toBe(permit);
  });
});

describe('The centre comes first: freshness', () => {
  it('a permit is fresh while it is under 5 seconds old', () => {
    expect(isPermitFresh(permit, 9, N)).toBe(true);
    expect(isPermitFresh(permit, 9 + PERMIT_FRESH - 0.1, N)).toBe(true);
  });

  it('a permit 5 seconds old or older is not fresh', () => {
    expect(isPermitFresh(permit, 9 + PERMIT_FRESH, N)).toBe(false);
    expect(isPermitFresh(permit, 9 + PERMIT_FRESH + 60, N)).toBe(false);
  });

  it('judges the 5 seconds with half a tick of slack, so rounding in now does not shift it by a tick', () => {
    expect(isPermitFresh(permit, 9 + PERMIT_FRESH - 1e-9, N)).toBe(false);
    expect(isPermitFresh(permit, 9 + PERMIT_FRESH - TICK + 1e-9, N)).toBe(true);
  });

  it('no permit is not fresh', () => {
    expect(isPermitFresh(null, 10, N)).toBe(false);
  });

  it('when permits return after an outage, the train obeys them on the next tick', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 1000 }, SIGHT_SPEED);
    tick(run, [permitMsg(0, 6000)]);
    expect(run.out?.mode).toBe('central');
    ticks(run, 60); // six seconds with no permit
    expect(run.out?.mode).toBe('full');
    expect(run.out?.accel).toBeGreaterThan(0);
    // A permit comes back, with untilX right in front of the train.
    const out = tick(run, [permitMsg(run.now - TICK, run.state.pos.offset + 5)]);
    expect(out.mode).toBe('central');
    expect(out.accel).toBe(-BRAKE);
  });
});

describe('The centre comes first: untilX', () => {
  it('a fresh permit limits speed so the train stops at or before untilX', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 1000 }, 40);
    for (let i = 0; i < 1500; i++) {
      // The centre sends a permit every second. Messages arrive one tick late.
      const inbox = i % 10 === 0 ? [permitMsg(run.now - TICK, 3000)] : [];
      tick(run, inbox);
      expect(run.state.pos.offset).toBeLessThan(3000);
    }
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.offset).toBeGreaterThan(3000 - 0.1);
  });

  it('the untilX limit is safeSpeed of the distance from the train x to untilX, braked one tick early', () => {
    const early = (BRAKE * TICK) / 2;
    expect(permitLimit(self, { ...permit, untilX: 1200 }, 10, N)).toBeCloseTo(safeSpeed(200 - STOP_SHORT) - early, 9);
    const inPlatform: TrainState = { ...self, pos: { track: 'P1', offset: 100 } };
    expect(permitLimit(inPlatform, { ...permit, untilX: 6300 }, 10, N)).toBeCloseTo(brakeLimit(200), 9);
  });

  it('the untilX limit is 0 at or past untilX', () => {
    expect(permitLimit(self, { ...permit, untilX: 1000 }, 10, N)).toBe(0);
    expect(permitLimit(self, { ...permit, untilX: 400 }, 10, N)).toBe(0);
  });

  it('a permit that is not fresh adds no limit', () => {
    expect(permitLimit(self, { ...permit, untilX: 1000 }, 9 + PERMIT_FRESH, N)).toBe(Infinity);
  });

  it('no permit adds no limit', () => {
    expect(permitLimit(self, null, 10, N)).toBe(Infinity);
  });

  it('an old but still fresh permit holds the train back for up to 5 seconds', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 1000 }, 0);
    tick(run, [permitMsg(0, 1000)]);
    ticks(run, 48);
    expect(run.state.pos.offset).toBe(1000); // held by the last permit
    ticks(run, 20);
    expect(run.state.pos.offset).toBeGreaterThan(1000); // the permit went stale and the train carried on
  });
});

describe('The centre comes first: obeying a fresh permit', () => {
  it("takes the permit's nextTrack, not its default platform", () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 20);
    expect(tick(run, [wideOpen(run.now, 'P2')]).nextTrack).toBe('P2');
  });

  it('ignores a nextTrack that does not lead on from its track, and keeps the last one that did', () => {
    expect(permitRoute('A', { ...permit, nextTrack: 'P3' }, null)).toBeNull();
    expect(permitRoute('A', { ...permit, nextTrack: 'P3' }, 'P2')).toBe('P2');
    expect(permitRoute('A', { ...permit, nextTrack: 'EXIT' }, null)).toBeNull();
    expect(permitRoute('P1', { ...permit, nextTrack: 'EXIT' }, null)).toBe('EXIT');
    expect(permitRoute('A', { ...permit, nextTrack: null }, 'P1')).toBeNull();
  });

  it('runs into the platform the centre sends it to and sends no lock request', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 4700 }, 20);
    for (let i = 0; i < 600; i++) tick(run, [permitMsg(run.now - TICK, 6300, 'P2')]);
    expect(run.state.pos.track).toBe('P2');
    expect(run.overruns).toBe(0);
    expect(requests(run)).toEqual([]);
  });

  it('waits in its platform until the centre sends it on, and never asks the junction keeper', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'P1', offset: 299 }, 0);
    for (let i = 0; i < 600; i++) tick(run, [permitMsg(run.now - TICK, 6300, null)]);
    expect(run.state.pos.track).toBe('P1');
    expect(requests(run)).toEqual([]);
  });

  it('still broadcasts its position every second', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 1000 }, 20);
    for (let i = 0; i < 30; i++) tick(run, [wideOpen(run.now, null)]);
    expect(run.sent.filter((o) => o.msg.type === 'position')).toHaveLength(3);
  });

  it('still brakes for what its own sensor sees', () => {
    const agent = createAgent(1, timetable);
    expect(agent.decide({ now: 0, self, inbox: [wideOpen(0, 'P1')], sightAhead: 60 }).accel).toBe(-BRAKE);
  });

  it('needs no position reports from the train ahead, so a radio failure does not slow it', () => {
    // Train 2 has never heard train 1. On its own rules it would stay at SIGHT_SPEED.
    const run = startRun(createAgent(2, timetable), 2, { track: 'A', offset: 0 }, SIGHT_SPEED);
    for (let i = 0; i < 600; i++) tick(run, [wideOpen(run.now, null, 2)]);
    expect(run.out?.mode).toBe('central');
    expect(run.topSpeed).toBeGreaterThan(SIGHT_SPEED + 10);
    expect(run.topSpeed).toBeLessThanOrEqual(MAX_SPEED);
  });

  it('when permits return it drops a junction grant and lets the centre decide when it leaves', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'P1', offset: 299.995 }, 0, 100);
    ticks(run, 330); // dwell, then ask
    expect(requests(run)).toContain('JUNCTION');
    tick(run, [{ type: 'lockGrant', to: 1, resource: 'JUNCTION', follow: null }]);
    // The centre is back and says stay.
    for (let i = 0; i < 200; i++) tick(run, [permitMsg(run.now - TICK, 6300, null)]);
    expect(run.state.pos.track).toBe('P1');
    expect(run.out?.nextTrack).toBeNull();
  });
});

describe('The centre comes first: carrying on when the centre fails', () => {
  it('reads the leader from its last permit', () => {
    expect(permitLeader({ ...permit, leader: 4 })).toBe(4);
    expect(permitLeader({ ...permit, leader: null })).toBe('none');
    expect(permitLeader(permit)).toBe('unknown');
    expect(permitLeader(null)).toBe('unknown');
  });

  it('keeps the platform its last permit sent it to only if it can no longer stop before the end of its track', () => {
    const near: TrainState = { ...self, pos: { track: 'A', offset: 5950 }, speed: 20 };
    const sent: HeldPermit = { ...permit, nextTrack: 'P2' };
    expect(committedPlatform(near, sent, 'A', N)).toBe('P2');
    expect(committedPlatform({ ...near, pos: { track: 'A', offset: 5000 } }, sent, 'A', N)).toBeNull();
    expect(committedPlatform({ ...near, speed: 0 }, sent, 'A', N)).toBeNull();
    expect(committedPlatform(near, { ...permit, nextTrack: 'P3' }, 'A', N)).toBeNull();
    expect(committedPlatform(near, { ...permit, nextTrack: null }, 'A', N)).toBeNull();
    expect(committedPlatform({ ...near, pos: { track: 'P2', offset: 10 } }, sent, 'A', N)).toBeNull();
    expect(committedPlatform(near, null, 'A', N)).toBeNull();
  });

  it('a train that can no longer stop runs into the platform the centre gave it and asks the platform keeper for it', () => {
    // The last permit is nearly 5 seconds old, so it goes stale on the next tick.
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5950 }, 21, 100);
    tick(run, [permitMsg(100 - PERMIT_FRESH + 0.2, 6300, 'P2')]);
    expect(run.out?.mode).toBe('central');
    ticks(run, 300); // the centre has gone quiet
    expect(run.state.pos.track).toBe('P2');
    expect(run.overruns).toBe(0);
    expect(requests(run)).toContain('P2');
    expect(requests(run)).not.toContain('P1');
  });

  it('a train that can still stop stops at the end of its track and asks for its default platform', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 4000 }, 20);
    tick(run, [permitMsg(run.now - TICK, 6300, 'P2')]);
    for (let i = 0; i < 2000 && !(run.state.speed === 0 && run.state.pos.offset > 5000); i++) tick(run);
    expect(run.state.pos.track).toBe('A');
    expect(run.state.speed).toBe(0);
    expect(requests(run)[0]).toBe('P1');
  });

  it('a train the centre let into the junction zone carries on out without asking the junction keeper', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'P1', offset: 310 }, 5);
    tick(run, [permitMsg(run.now - TICK, 12400, 'EXIT', 1, null)]);
    ticks(run, 600);
    expect(run.state.pos.track).toBe('EXIT');
    expect(run.overruns).toBe(0);
    expect(requests(run)).not.toContain('JUNCTION');
    // Its last permit said nothing was ahead, so it runs at full speed, not SIGHT_SPEED.
    expect(run.out?.mode).toBe('full');
    expect(run.topSpeed).toBeGreaterThan(SIGHT_SPEED + 1);
  });

  it('a train on EXIT follows the train its last permit named', () => {
    const speedAfterReport = (leader: number | null): number => {
      const run = startRun(createAgent(2, timetable), 2, { track: 'EXIT', offset: 1000 }, 30);
      tick(run, [permitMsg(run.now - TICK, 12400, null, 2, leader)]);
      ticks(run, 60);
      // Train 7 reports it has stopped about 300 m ahead.
      const report: Message = { type: 'position', from: 7, pos: { track: 'EXIT', offset: 1600 }, speed: 0, sentAt: run.now - TICK };
      tick(run, [report]);
      ticks(run, 150);
      return run.state.speed;
    };
    // Following train 7, it slows to SIGHT_SPEED near train 7's limit point.
    expect(speedAfterReport(7)).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
    // Told nothing was ahead, the same report means nothing to it.
    expect(speedAfterReport(null)).toBeGreaterThan(SIGHT_SPEED + 1);
  });

  it('a train in its platform, not yet past the stop, waits and asks the junction keeper as usual', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'P1', offset: 250 }, 0);
    tick(run, [permitMsg(run.now - TICK, 6300, null, 1, null)]);
    ticks(run, 500);
    expect(run.state.pos.track).toBe('P1');
    expect(run.state.pos.offset).toBeLessThan(300);
    expect(requests(run)).toContain('JUNCTION');
  });
});
