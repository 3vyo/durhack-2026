import { describe, expect, it } from 'vitest';
import { BRAKE, PERMIT_FRESH, SIGHT_SPEED, TICK, safeSpeed } from '../../src/shared/constants';
import type { Message, TrainState } from '../../src/shared/types';
import { createAgent } from '../../src/train/agent';
import { brakeLimit } from '../../src/train/follow';
import { STOP_SHORT, trainNumbers } from '../../src/train/numbers';
import {
  isPermitFresh,
  latestPermit,
  permitLimit,
  suggestedPlatform,
  type HeldPermit,
} from '../../src/train/permits';
import { platformToAsk } from '../../src/train/station';
import { requests, startRun, tick, ticks, timetable } from './sim';

const N = trainNumbers();

const permit: HeldPermit = { untilX: 6000, nextTrack: 'P1', sentAt: 9 };
const self: TrainState = { id: 1, pos: { track: 'A', offset: 1000 }, speed: 30, brokenDown: false };
const forMe: Message = { type: 'permit', to: 1, untilX: 6000, nextTrack: 'P1', sentAt: 9 };

function permitMsg(sentAt: number, untilX: number, nextTrack: HeldPermit['nextTrack'] = null, to = 1): Message {
  return { type: 'permit', to, untilX, nextTrack, sentAt };
}

describe('Following permits: reading permits', () => {
  it('keeps the newest permit addressed to this train', () => {
    const newer = permitMsg(10, 6200, 'P2');
    expect(latestPermit(null, [forMe], 1)).toEqual(permit);
    expect(latestPermit(permit, [newer], 1)).toEqual({ untilX: 6200, nextTrack: 'P2', sentAt: 10 });
    expect(latestPermit(null, [newer, forMe], 1)).toEqual({ untilX: 6200, nextTrack: 'P2', sentAt: 10 });
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

describe('Following permits: freshness', () => {
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

  it('when permits return after an outage, the train follows them on the next tick', () => {
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

describe('Following permits: untilX', () => {
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

  it('brakes one tick early for untilX, like a stop point', () => {
    expect(permitLimit(self, { ...permit, untilX: 1200 }, 10, N)).toBe(brakeLimit(200));
    expect(permitLimit(self, { ...permit, untilX: 1200 }, 10, N)).toBeLessThan(safeSpeed(200));
  });

  it('a permit that is not fresh adds no limit', () => {
    expect(permitLimit(self, { ...permit, untilX: 1000 }, 9 + PERMIT_FRESH, N)).toBe(Infinity);
  });

  it('no permit adds no limit', () => {
    expect(permitLimit(self, null, 10, N)).toBe(Infinity);
  });

  it('the untilX limit only lowers speed and never raises it above the other limits', () => {
    // Train 2 has never heard its leader, so it is held to SIGHT_SPEED. A generous permit
    // does not lift that.
    const run = startRun(createAgent(2, timetable), 2, { track: 'A', offset: 0 }, SIGHT_SPEED);
    for (let i = 0; i < 300; i++) tick(run, i % 10 === 0 ? [permitMsg(run.now - TICK, 12000, null, 2)] : []);
    expect(run.out?.mode).toBe('central');
    expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
  });

  it('an old but still fresh permit can hold the train back for up to 5 seconds', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 1000 }, 0);
    tick(run, [permitMsg(0, 1000)]);
    ticks(run, 48);
    expect(run.state.pos.offset).toBe(1000); // held by the last permit
    ticks(run, 20);
    expect(run.state.pos.offset).toBeGreaterThan(1000); // the permit went stale and the train carried on
  });
});

describe('Following permits: platform suggestion', () => {
  it('a fresh permit suggests its nextTrack as the platform to ask for', () => {
    expect(suggestedPlatform(permit, 10, 'A', N)).toBe('P1');
    expect(suggestedPlatform({ ...permit, nextTrack: 'P4' }, 10, 'B', N)).toBe('P4');
  });

  it('ignores a suggested platform from the other pair', () => {
    expect(suggestedPlatform({ ...permit, nextTrack: 'P3' }, 10, 'A', N)).toBeNull();
    expect(suggestedPlatform(permit, 10, 'B', N)).toBeNull();
  });

  it('ignores a nextTrack that is not a platform (A, B, EXIT or null)', () => {
    for (const nextTrack of ['A', 'B', 'EXIT', null] as const) {
      expect(suggestedPlatform({ ...permit, nextTrack }, 10, 'A', N)).toBeNull();
    }
  });

  it('a permit that is not fresh suggests nothing', () => {
    expect(suggestedPlatform(permit, 9 + PERMIT_FRESH, 'A', N)).toBeNull();
  });

  it('the station grant or alternative wins over the suggestion', () => {
    // The alternative wins on what to ask for.
    expect(platformToAsk('P1', 'P1', { kind: 'refuse', platform: 'P1', alternative: 'P2', at: 0 })).toBe('P2');
    // The grant wins on where to go: the permit says P1, the station grants P2.
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 20);
    tick(run, [permitMsg(0, 12000, 'P1')]);
    tick(run, [{ type: 'lockGrant', to: 1, resource: 'P2', follow: null }]);
    tick(run, [permitMsg(run.now - TICK, 12000, 'P1')]);
    expect(run.out?.nextTrack).toBe('P2');
  });
});

describe('Following permits: permits never replace the train rules', () => {
  /** A permit that allows everything, sent one tick ago. */
  function wideOpen(now: number, nextTrack: HeldPermit['nextTrack'], to = 1): Message {
    return permitMsg(now - TICK, 12400, nextTrack, to);
  }

  it('with a fresh permit the train still keeps its leader limit, sightAhead limit and stop points', () => {
    // Leader limit: train 2 has never heard train 1, so it stays at SIGHT_SPEED.
    const blind = startRun(createAgent(2, timetable), 2, { track: 'A', offset: 0 }, SIGHT_SPEED);
    for (let i = 0; i < 100; i++) tick(blind, [wideOpen(blind.now, 'P2', 2)]);
    expect(blind.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
    // sightAhead: an obstacle 60 m ahead means full brakes.
    const seeing = createAgent(1, timetable);
    expect(seeing.decide({ now: 0, self, inbox: [wideOpen(0, 'P1')], sightAhead: 60 }).accel).toBe(-BRAKE);
    // Stop point: with no platform, it stops before the end of A.
    const stopping = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5700 }, 20);
    for (let i = 0; i < 600 && stopping.state.speed > 0; i++) tick(stopping, [wideOpen(stopping.now, 'P1')]);
    expect(stopping.state.speed).toBe(0);
    expect(stopping.state.pos.track).toBe('A');
    expect(stopping.state.pos.offset).toBeLessThan(6000);
  });

  it('with a fresh permit the train still needs a platform lock before it passes the end of its entry track', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5900 }, 10);
    // The station refuses every two seconds, so it is alive and the train must wait.
    for (let i = 0; i < 600; i++) {
      const inbox: Message[] = [wideOpen(run.now, 'P1')];
      if (i % 20 === 0) inbox.push({ type: 'lockRefuse', to: 1, resource: 'P1', alternative: null });
      if (i % 10 === 0) inbox.push({ type: 'platformStatus', platform: 'P1', occupied: true, sentAt: run.now - TICK });
      tick(run, inbox);
      expect(run.out?.nextTrack).toBeNull();
    }
    expect(run.state.pos.track).toBe('A');
    expect(run.overruns).toBe(0);
  });

  it('with a fresh permit the train still needs a junction lock or an open slot to leave the platform', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'P1', offset: 290 }, 0);
    // The merge actor refuses, so the train never falls back to clock slots.
    for (let i = 0; i < 1500; i++) {
      const inbox: Message[] = [wideOpen(run.now, 'EXIT')];
      if (i % 20 === 0) inbox.push({ type: 'lockRefuse', to: 1, resource: 'JUNCTION', alternative: null });
      tick(run, inbox);
      expect(run.out?.nextTrack).toBeNull();
    }
    expect(run.state.pos.track).toBe('P1');
    expect(run.state.pos.offset).toBeLessThan(300);
    expect(requests(run)).toContain('JUNCTION');
  });

  it('after permits stop, the train drops the untilX limit and the suggestion and carries on', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 4700 }, 10);
    for (let i = 0; i < 30; i++) tick(run, [permitMsg(run.now - TICK, 4750, 'P2')]);
    expect(run.state.pos.offset).toBeLessThan(4750);
    ticks(run, 400);
    expect(run.state.pos.offset).toBeGreaterThan(4800);
    // Past the ask point with no fresh permit, it asks for its default platform.
    expect(requests(run)).toContain('P1');
    expect(requests(run)).not.toContain('P2');
  });

  it('when permits return, the train keeps the locks it holds', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 20);
    tick(run);
    tick(run, [{ type: 'lockGrant', to: 1, resource: 'P1', follow: null }]);
    ticks(run, 60);
    // Permits return and point somewhere else. The train still runs into P1.
    for (let i = 0; i < 1200; i++) tick(run, [wideOpen(run.now, 'P2')]);
    expect(run.state.pos.track).toBe('P1');
    expect(run.overruns).toBe(0);
  });

  it('when permits return, the train keeps a platform it has already chosen', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 20);
    tick(run);
    tick(run, [{ type: 'lockGrant', to: 1, resource: 'P1', follow: null }]);
    for (let i = 0; i < 100; i++) {
      tick(run, [wideOpen(run.now, 'P2')]);
      expect(run.out?.nextTrack).toBe('P1');
    }
    // It keeps asking for the platform it holds, not the one the permit suggests.
    expect(requests(run)).not.toContain('P2');
  });
});
