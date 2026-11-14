import { describe, expect, it } from 'vitest';
import { FRESH, REQUEST_REPEAT, SIGHT_SPEED, PLATFORM_KEEPER_TIMEOUT, TICK } from '../../src/shared/constants';
import { ASK_POINT, PLATFORM_PAIRS } from '../../src/shared/map';
import type { Message, PlatformId, TrainState } from '../../src/shared/types';
import { createAgent } from '../../src/train/agent';
import { trainNumbers } from '../../src/train/numbers';
import {
  creepStep,
  dwellStart,
  fallbackLimit,
  fixedSplitPlatform,
  hasFreshStatus,
  ownPairOnly,
  pathJustChanged,
  platformRequest,
  platformToAsk,
  recordPlatformStatus,
  refusalMeansSilence,
  sensorsSilent,
  shouldUseFallback,
  platformKeeperReply,
  type HeardPlatformKeeperReply,
  type PlatformStatusLog,
} from '../../src/train/station';
import { requests, sightTo, startRun, tick, ticks, timetable, type Run } from './sim';

const N = trainNumbers();

const stopped: TrainState = { id: 1, pos: { track: 'A', offset: 5999.99 }, speed: 0, brokenDown: false };
const inPlatform: TrainState = { id: 1, pos: { track: 'P1', offset: 299.99 }, speed: 0, brokenDown: false };
const grant: Message = { type: 'lockGrant', to: 1, resource: 'P1', follow: null };
const refuse: Message = { type: 'lockRefuse', to: 1, resource: 'P1', alternative: null };
const status: Message = { type: 'platformStatus', platform: 'P1', occupied: false, sentAt: 9 };
const refused: HeardPlatformKeeperReply = { kind: 'refuse', platform: 'P1', alternative: null, at: 90 };

function request(over: Partial<Parameters<typeof platformRequest>[0]> = {}) {
  return platformRequest(
    { now: 100, id: 1, pos: { track: 'A', offset: ASK_POINT }, asking: 'P1', lastSentAt: null, ...over },
    N,
  );
}

function fallback(over: Partial<Parameters<typeof shouldUseFallback>[0]> = {}): boolean {
  return shouldUseFallback(
    { self: stopped, now: 100, firstAskedAt: 50, lastReplyAt: null, usingFallback: false, ...over },
    N,
  );
}

function silence(over: Partial<Parameters<typeof refusalMeansSilence>[0]> = {}): boolean {
  return refusalMeansSilence(
    { lastReply: refused, statuses: {}, entry: 'A', pos: { track: 'A', offset: 5900 }, now: 100, ...over },
    N,
  );
}

/** What the platform sensors broadcast this tick: one status per platform, once a second. */
function sensors(run: Run, i: number, occupied: Partial<Record<PlatformId, boolean>>): Message[] {
  if (i % 10 !== 0) return [];
  return Object.entries(occupied).map(([platform, value]) => ({
    type: 'platformStatus' as const,
    platform: platform as PlatformId,
    occupied: value,
    sentAt: run.now - TICK,
  }));
}

/** Train `id` stopped at the end of its entry track, where it has just started asking. */
function atEnd(id = 1, entry: 'A' | 'B' = 'A'): Run {
  return startRun(createAgent(id, timetable), id, { track: entry, offset: 5999.99 }, 0);
}

describe('Entering the station: no platform, no entry', () => {
  it('a train with no platform stops at or before the end of A or B', () => {
    for (const [id, track] of [[1, 'A'], [3, 'B']] as const) {
      const run = startRun(createAgent(id, timetable), id, { track, offset: 5200 }, 35);
      // The platform keeper refuses every 2 seconds and the sensors say occupied, so the train must wait.
      for (let i = 0; i < 2000; i++) {
        const inbox = sensors(run, i, { P1: true, P2: true, P3: true, P4: true });
        if (i % 20 === 0) inbox.push({ type: 'lockRefuse', to: id, resource: id === 1 ? 'P1' : 'P3', alternative: null });
        tick(run, inbox);
        expect(run.state.pos.offset).toBeLessThan(6000);
      }
      expect(run.state.pos.track).toBe(track);
      expect(run.state.speed).toBe(0);
      expect(run.overruns).toBe(0);
    }
  });

  it('a train with no platform never sets nextTrack to a platform', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5200 }, 35);
    for (let i = 0; i < 2000; i++) {
      const inbox = sensors(run, i, { P1: true, P2: true });
      if (i % 20 === 0) inbox.push(refuse);
      expect(tick(run, inbox).nextTrack).toBeNull();
    }
  });
});

describe('Entering the station: asking', () => {
  it('sends no platform request before the ask point at offset 4800', () => {
    expect(request({ pos: { track: 'A', offset: ASK_POINT - 0.1 } })).toBeNull();
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 0 }, SIGHT_SPEED);
    while (run.state.pos.offset < ASK_POINT) {
      expect(requests(run)).toEqual([]);
      tick(run);
    }
    tick(run);
    expect(requests(run)).toEqual(['P1']);
  });

  it('sends a lockRequest for a platform over short range at the ask point', () => {
    expect(request()).toEqual({ msg: { type: 'lockRequest', from: 1, resource: 'P1' }, range: 'short' });
  });

  it('repeats the request every 2 seconds', () => {
    expect(request({ lastSentAt: 100 - REQUEST_REPEAT })).not.toBeNull();
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: ASK_POINT }, 0);
    ticks(run, 61);
    expect(requests(run)).toEqual(['P1', 'P1', 'P1', 'P1']);
  });

  it('does not repeat the request sooner than 2 seconds', () => {
    expect(request({ lastSentAt: 100 })).toBeNull();
    expect(request({ lastSentAt: 100 - REQUEST_REPEAT + TICK })).toBeNull();
  });

  it('repeats on the tick 2 seconds have passed even when now - lastSentAt is a rounding error short (half a tick of slack)', () => {
    expect(request({ lastSentAt: 100 - REQUEST_REPEAT + 1e-9 })).not.toBeNull();
  });

  it('sends no request while it obeys a fresh permit, because the centre picks the platform', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: ASK_POINT }, 0);
    tick(run, [{ type: 'permit', to: 1, untilX: 12400, nextTrack: 'P2', sentAt: 0 }]);
    expect(requests(run)).toEqual([]);
  });

  it('asks for its default platform when it has no fresh permit', () => {
    expect(platformToAsk('P1', null)).toBe('P1');
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: ASK_POINT }, 0, 100);
    tick(run, [{ type: 'permit', to: 1, untilX: 12400, nextTrack: 'P2', sentAt: 10 }]);
    expect(requests(run)).toEqual(['P1']);
  });

  it('keeps repeating its request for the granted platform after the grant, until its front is in the platform', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 20);
    tick(run);
    tick(run, [{ type: 'lockGrant', to: 1, resource: 'P2', follow: null }]);
    let sentOnA = 0;
    while (run.state.pos.track === 'A') {
      const out = tick(run);
      sentOnA += out.outbox.filter((o) => o.msg.type === 'lockRequest').length;
    }
    expect(sentOnA).toBeGreaterThan(5);
    // After the grant it asks only for the platform it holds.
    expect(requests(run).slice(1).every((r) => r === 'P2')).toBe(true);
  });

  it('stops repeating the platform request once its front is in the platform', () => {
    expect(request({ pos: { track: 'P1', offset: 0 } })).toBeNull();
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5990 }, 10);
    tick(run, [grant]);
    while (run.state.pos.track === 'A') tick(run);
    const before = requests(run).length;
    ticks(run, 100);
    expect(requests(run)).toHaveLength(before);
  });

  it('a broken-down train sends no platform request', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 0);
    run.state.brokenDown = true;
    ticks(run, 100);
    expect(requests(run)).toEqual([]);
    expect(run.sent.filter((o) => o.msg.type === 'position')).toHaveLength(10);
  });
});

describe('Entering the station: replies', () => {
  it('reads a lockGrant for a platform addressed to itself', () => {
    expect(platformKeeperReply([grant], 1)).toEqual({ kind: 'grant', platform: 'P1' });
  });

  it('reads a lockRefuse for a platform addressed to itself', () => {
    expect(platformKeeperReply([refuse], 1)).toEqual({ kind: 'refuse', platform: 'P1', alternative: null });
    expect(platformKeeperReply([{ ...refuse, alternative: 'P2' }], 1)).toEqual({
      kind: 'refuse',
      platform: 'P1',
      alternative: 'P2',
    });
  });

  it('ignores grants and refusals addressed to other trains', () => {
    expect(platformKeeperReply([grant, refuse], 2)).toBeNull();
  });

  it('ignores a JUNCTION grant or refusal when reading platform keeper replies', () => {
    const inbox: Message[] = [
      { type: 'lockGrant', to: 1, resource: 'JUNCTION', follow: null },
      { type: 'lockRefuse', to: 1, resource: 'JUNCTION', alternative: null },
    ];
    expect(platformKeeperReply(inbox, 1)).toBeNull();
  });

  it('when one inbox holds a grant and a refusal for this train, the grant wins', () => {
    expect(platformKeeperReply([refuse, grant], 1)).toEqual({ kind: 'grant', platform: 'P1' });
    expect(platformKeeperReply([grant, refuse], 1)).toEqual({ kind: 'grant', platform: 'P1' });
  });

  it('drops a grant for a platform outside its own pair, and an alternative outside it', () => {
    const pair = PLATFORM_PAIRS.A;
    expect(ownPairOnly({ kind: 'grant', platform: 'P3' }, pair)).toBeNull();
    expect(ownPairOnly({ kind: 'grant', platform: 'P2' }, pair)).toEqual({ kind: 'grant', platform: 'P2' });
    expect(ownPairOnly({ kind: 'refuse', platform: 'P1', alternative: 'P4' }, pair)).toEqual({
      kind: 'refuse',
      platform: 'P1',
      alternative: null,
    });
    expect(ownPairOnly(null, pair)).toBeNull();
  });

  it('on a lockGrant, sets nextTrack to the granted platform and runs in', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 30);
    tick(run);
    expect(tick(run, [grant]).nextTrack).toBe('P1');
    ticks(run, 1500);
    expect(run.state.pos.track).toBe('P1');
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.offset).toBeLessThan(300);
    expect(run.state.pos.offset).toBeGreaterThan(300 - 0.1);
  });

  it('on a lockRefuse with an alternative, requests the alternative', () => {
    expect(platformToAsk('P1', { kind: 'refuse', platform: 'P1', alternative: 'P2', at: 0 })).toBe('P2');
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 0);
    tick(run);
    tick(run, [{ ...refuse, alternative: 'P2' }]);
    ticks(run, 20);
    expect(requests(run)).toEqual(['P1', 'P2']);
  });

  it('on a lockRefuse with no alternative, keeps braking and keeps asking', () => {
    expect(platformToAsk('P1', { kind: 'refuse', platform: 'P1', alternative: null, at: 0 })).toBe('P1');
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5500 }, 28);
    for (let i = 0; i < 600; i++) tick(run, [...sensors(run, i, { P1: true, P2: true }), ...(i % 20 === 1 ? [refuse] : [])]);
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.track).toBe('A');
    expect(requests(run).length).toBeGreaterThanOrEqual(30);
  });

  it('ignores a later refusal for a platform it holds', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 30);
    tick(run);
    tick(run, [grant]);
    for (let i = 0; i < 1500; i++) tick(run, [refuse, { ...refuse, alternative: 'P2' }]);
    expect(run.state.pos.track).toBe('P1');
    expect(requests(run)).not.toContain('P2');
  });

  it('with no reply at all, stops before the end of its entry track (silence means no)', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 40);
    for (let i = 0; i < 3000 && run.state.speed > 0; i++) {
      expect(tick(run).nextTrack).toBeNull();
    }
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.track).toBe('A');
    expect(run.state.pos.offset).toBeLessThan(6000);
  });

  it('may change nextTrack on any tick until its front crosses the end of the track, and not after', () => {
    // A grant one metre before the end still switches the route.
    const late = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5999 }, 0.5);
    expect(tick(late, [{ ...grant, resource: 'P2' }]).nextTrack).toBe('P2');
    // Once in P2, a grant for P1 changes nothing.
    ticks(late, 100);
    expect(late.state.pos.track).toBe('P2');
    tick(late, [grant]);
    ticks(late, 600);
    expect(late.state.pos.track).toBe('P2');
    expect(late.out?.nextTrack).toBeNull();
    // And a second grant for another platform, while still on A, does not move a chosen platform.
    const twice = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 20);
    tick(twice, [grant]);
    expect(tick(twice, [{ ...grant, resource: 'P2' }]).nextTrack).toBe('P1');
  });
});

describe('Entering the station: dwell', () => {
  it('starts the dwell timer at the moment it stops in its platform', () => {
    expect(dwellStart(null, inPlatform, 100)).toBe(100);
  });

  it('does not start the dwell timer while still moving in the platform', () => {
    expect(dwellStart(null, { ...inPlatform, speed: 0.4 }, 100)).toBeNull();
  });

  it('does not start the dwell timer when stopped on an entry track', () => {
    expect(dwellStart(null, stopped, 100)).toBeNull();
    expect(dwellStart(null, { ...stopped, pos: { track: 'EXIT', offset: 10 } }, 100)).toBeNull();
  });

  it('does not restart the dwell timer once started', () => {
    expect(dwellStart(100, inPlatform, 130)).toBe(100);
    expect(dwellStart(100, { ...inPlatform, speed: 3 }, 130)).toBe(100);
  });
});

describe('Platform keeper switched off: when to use the fallback', () => {
  it('uses the fallback when stopped at the end of its entry track with no reply', () => {
    expect(fallback()).toBe(true);
    expect(fallback({ self: { ...stopped, pos: { track: 'B', offset: 5999.99 } } })).toBe(true);
  });

  it('does not use the fallback while still moving', () => {
    expect(fallback({ self: { ...stopped, speed: 2 } })).toBe(false);
  });

  it('does not use the fallback when stopped further back, behind another train', () => {
    expect(fallback({ self: { ...stopped, pos: { track: 'A', offset: 5850 } } })).toBe(false);
    // "At the end" means within a metre of it, so the platform sensor shows the train
    // within a second or two of it setting off.
    expect(fallback({ self: { ...stopped, pos: { track: 'A', offset: 5998 } } })).toBe(false);
    expect(fallback({ self: { ...stopped, pos: { track: 'A', offset: 5999.5 } } })).toBe(true);
  });

  it('does not use the fallback before it has asked', () => {
    expect(fallback({ firstAskedAt: null })).toBe(false);
  });

  it('does not use the fallback after a platform keeper reply, unless the stored refusal counts as silence', () => {
    // The agent leaves a refusal that counts as silence out of lastReplyAt.
    expect(fallback({ lastReplyAt: 99 })).toBe(false);
    const run = atEnd();
    for (let i = 0; i < 600; i++) {
      // Sensors on, platform keeper refusing: a real reply every 2 seconds.
      tick(run, [...sensors(run, i, { P1: true, P2: true }), ...(i % 20 === 1 ? [refuse] : [])]);
      expect(run.out?.nextTrack).toBeNull();
    }
    expect(run.state.pos.offset).toBe(5999.99);
  });

  it('uses the fallback after a refusal that counts as silence, on the ticks after the refusal too', () => {
    const run = atEnd();
    // Sensors off, platform keeper refusing. The refusals do not reset the platform keeper timeout.
    for (let i = 0; i < 200; i++) tick(run, i % 20 === 1 ? [refuse] : []);
    expect(run.state.pos.track).toBe('P1');
  });

  it('counts as no reply when the platform keeper has not replied for PLATFORM_KEEPER_TIMEOUT, even after an earlier reply, with half a tick of slack', () => {
    expect(fallback({ firstAskedAt: 50, lastReplyAt: 100 - PLATFORM_KEEPER_TIMEOUT })).toBe(true);
    expect(fallback({ firstAskedAt: 50, lastReplyAt: 100 - PLATFORM_KEEPER_TIMEOUT + 1e-9 })).toBe(true);
    expect(fallback({ firstAskedAt: 50, lastReplyAt: 100 - PLATFORM_KEEPER_TIMEOUT + TICK })).toBe(false);
    // The count runs from the later of the first request and the last reply.
    expect(fallback({ firstAskedAt: 100 - PLATFORM_KEEPER_TIMEOUT + 1, lastReplyAt: null })).toBe(false);
    expect(fallback({ firstAskedAt: 100 - PLATFORM_KEEPER_TIMEOUT + 1, lastReplyAt: 20 })).toBe(false);
  });

  it('keeps using the fallback while it moves into the platform it picked', () => {
    const moving: TrainState = { ...stopped, speed: 5 };
    expect(fallback({ self: moving, usingFallback: true })).toBe(true);
    expect(fallback({ self: { ...inPlatform, speed: 12 }, usingFallback: true })).toBe(true);
    expect(fallback({ self: { ...inPlatform, speed: 12 }, usingFallback: false })).toBe(false);
    // It ends on EXIT, so the SIGHT_SPEED cap does not follow the train out.
    expect(fallback({ self: { ...stopped, pos: { track: 'EXIT', offset: 5 } }, usingFallback: true })).toBe(false);
  });

  it('a broken-down train does not take a platform under the fallback', () => {
    const run = atEnd();
    run.state.brokenDown = true;
    for (let i = 0; i < 300; i++) expect(tick(run, sensors(run, i, { P1: false, P2: false })).nextTrack).toBeNull();
  });
});

describe('Platform keeper switched off: fixed split', () => {
  const fresh = (occupied: boolean) => ({ occupied, sentAt: 9 });

  it('track A owns P1 and P2', () => {
    expect(N.pairs.A).toEqual(['P1', 'P2']);
    expect(fixedSplitPlatform('A', { P1: fresh(false), P2: fresh(false), P3: fresh(false) }, 10, N)).toBe('P1');
  });

  it('track B owns P3 and P4', () => {
    expect(N.pairs.B).toEqual(['P3', 'P4']);
    expect(fixedSplitPlatform('B', { P1: fresh(false), P3: fresh(false), P4: fresh(false) }, 10, N)).toBe('P3');
  });

  it('takes the lowest-numbered platform of its pair whose sensor says empty', () => {
    const run = atEnd();
    for (let i = 0; i < 400; i++) tick(run, sensors(run, i, { P1: false, P2: false }));
    expect(run.state.pos.track).toBe('P1');
  });

  it('takes the second platform when the first says occupied and the second says empty', () => {
    expect(fixedSplitPlatform('A', { P1: fresh(true), P2: fresh(false) }, 10, N)).toBe('P2');
    const run = atEnd(3, 'B');
    for (let i = 0; i < 400; i++) tick(run, sensors(run, i, { P3: true, P4: false }));
    expect(run.state.pos.track).toBe('P4');
  });

  it('waits when both platforms of its pair say occupied', () => {
    expect(fixedSplitPlatform('A', { P1: fresh(true), P2: fresh(true) }, 10, N)).toBeNull();
    const run = atEnd();
    for (let i = 0; i < 600; i++) {
      expect(tick(run, sensors(run, i, { P1: true, P2: true, P3: false, P4: false })).nextTrack).toBeNull();
    }
    expect(run.state.pos.offset).toBe(5999.99);
  });

  it('never takes a platform from the other pair', () => {
    expect(fixedSplitPlatform('A', { P1: fresh(true), P2: fresh(true), P3: fresh(false), P4: fresh(false) }, 10, N)).toBeNull();
    expect(fixedSplitPlatform('B', { P1: fresh(false), P2: fresh(false), P3: fresh(true), P4: fresh(true) }, 10, N)).toBeNull();
  });

  it('does not treat a platform with no fresh status as empty', () => {
    expect(fixedSplitPlatform('A', { P1: fresh(false) }, 9 + FRESH, N)).toBeNull();
    expect(fixedSplitPlatform('A', { P2: fresh(false) }, 10, N)).toBe('P2');
    expect(fixedSplitPlatform('A', {}, 10, N)).toBeNull();
    // One sensor of the pair alive and saying occupied, the other dead: the train waits.
    const run = atEnd();
    for (let i = 0; i < 400; i++) expect(tick(run, sensors(run, i, { P1: true })).nextTrack).toBeNull();
  });

  it('enters a fallback platform at SIGHT_SPEED or below', () => {
    expect(fallbackLimit(true)).toBe(SIGHT_SPEED);
    expect(fallbackLimit(false)).toBe(Infinity);
    // Start far enough back that the stop points alone would allow more than SIGHT_SPEED.
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5960 }, 0);
    for (let i = 0; i < 1500; i++) tick(run, sensors(run, i, { P1: false, P2: false }));
    expect(run.state.pos.track).toBe('P1');
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.offset).toBeGreaterThan(299);
    expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
  });

  it('waits the full PLATFORM_KEEPER_TIMEOUT from its first request before it takes a platform', () => {
    const run = atEnd();
    let tookAt: number | null = null;
    for (let i = 0; i < 300 && tookAt === null; i++) {
      if (tick(run, sensors(run, i, { P1: false, P2: false })).nextTrack !== null) tookAt = run.now - TICK;
    }
    expect(tookAt).toBeCloseTo(PLATFORM_KEEPER_TIMEOUT, 6);
  });

  it('a grant while it waits on the fallback wins over the fixed split', () => {
    const run = atEnd();
    for (let i = 0; i < 150; i++) tick(run, sensors(run, i, { P1: true, P2: true }));
    tick(run, [{ ...grant, resource: 'P2' }]);
    expect(run.out?.nextTrack).toBe('P2');
  });
});

describe('Platform keeper switched off: creeping with the sensors off too', () => {
  /** Train 1 at the end of A, past the platform keeper timeout, with the sensors silent. */
  function creeping(): Run {
    const run = atEnd();
    while (run.now < PLATFORM_KEEPER_TIMEOUT - TICK / 2) tick(run);
    return run;
  }

  it('creeps when it has no fresh status from either platform of its pair', () => {
    expect(sensorsSilent('A', {}, 10, N)).toBe(true);
    expect(sensorsSilent('A', { P3: { occupied: false, sentAt: 9 } }, 10, N)).toBe(true);
    expect(sensorsSilent('A', { P2: { occupied: true, sentAt: 9 } }, 10, N)).toBe(false);
    const run = creeping();
    ticks(run, 300);
    expect(run.state.pos.track).toBe('P1');
  });

  it('first sets nextTrack to the first platform of its pair to look into it', () => {
    expect(creepStep({ entry: 'A', probing: null, sightAhead: null }, N)).toEqual({ probe: 'P1', take: null });
    expect(creepStep({ entry: 'B', probing: null, sightAhead: 120 }, N)).toEqual({ probe: 'P3', take: null });
    const run = creeping();
    expect(run.out?.nextTrack).toBeNull();
    expect(tick(run).nextTrack).toBe('P1');
  });

  it('takes the probed platform when sightAhead on the next tick shows no train in it', () => {
    expect(creepStep({ entry: 'A', probing: 'P1', sightAhead: null }, N)).toEqual({ probe: 'P1', take: 'P1' });
    expect(creepStep({ entry: 'A', probing: 'P2', sightAhead: null }, N)).toEqual({ probe: 'P2', take: 'P2' });
  });

  it('switches nextTrack to the other platform when sightAhead shows a train in the first', () => {
    expect(creepStep({ entry: 'A', probing: 'P1', sightAhead: 200 }, N)).toEqual({ probe: 'P2', take: null });
    const run = creeping();
    tick(run); // points at P1
    // A train is stopped in P1 with its rear at x 6200. P2 is empty.
    const sight = () => (run.out?.nextTrack === 'P1' ? sightTo(run, 6200) : null);
    expect(tick(run, [], sight()).nextTrack).toBe('P2');
    for (let i = 0; i < 600; i++) tick(run, [], sight());
    expect(run.state.pos.track).toBe('P2');
    expect(run.state.speed).toBe(0);
  });

  it('waits when both platforms show a train', () => {
    expect(creepStep({ entry: 'A', probing: 'P2', sightAhead: 200 }, N)).toEqual({ probe: 'P1', take: null });
    const run = creeping();
    for (let i = 0; i < 600; i++) tick(run, [], run.out?.nextTrack ? sightTo(run, 6200) : null);
    expect(run.state.pos).toEqual({ track: 'A', offset: 5999.99 });
    expect(run.overruns).toBe(0);
  });

  it('does not judge a platform from sightAhead on the tick it changed nextTrack', () => {
    const run = creeping();
    // sightAhead is null on the tick it first points at P1. That reading is for the old
    // path, so it must not take P1 yet: it does not move and its stop point holds.
    const out = tick(run, [], null);
    expect(out.nextTrack).toBe('P1');
    expect(out.accel).toBeLessThanOrEqual(0);
    // The next reading is for P1 and shows a train, so it never entered.
    expect(tick(run, [], 200).nextTrack).toBe('P2');
    expect(run.state.pos).toEqual({ track: 'A', offset: 5999.99 });
  });

  it('does not accelerate on the tick it changes nextTrack, because sightAhead still reports the old path', () => {
    expect(pathJustChanged(null, 'P1')).toBe(true);
    expect(pathJustChanged('P1', 'P2')).toBe(true);
    expect(pathJustChanged('P1', null)).toBe(true);
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 10);
    expect(tick(run).accel).toBeGreaterThan(0);
    expect(tick(run, [grant]).accel).toBeLessThanOrEqual(0);
  });

  it('may accelerate again on the tick after it changed nextTrack', () => {
    expect(pathJustChanged('P1', 'P1')).toBe(false);
    expect(pathJustChanged(null, null)).toBe(false);
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5000 }, 10);
    tick(run);
    tick(run, [grant]);
    expect(tick(run).accel).toBeGreaterThan(0);
  });

  it('creeps at SIGHT_SPEED or below', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5960 }, 0);
    ticks(run, 1500);
    expect(run.state.pos.track).toBe('P1');
    expect(run.state.pos.offset).toBeGreaterThan(299);
    expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
  });

  it('stops MARGIN short of a train it sees in the platform after it has taken it', () => {
    const run = creeping();
    // P1 looks empty from the end of A, then a train shows up with its rear at x 6250.
    for (let i = 0; i < 900; i++) tick(run, [], run.state.pos.track === 'P1' ? sightTo(run, 6250) : null);
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.track).toBe('P1');
    expect(run.state.pos.offset).toBeLessThanOrEqual(200);
  });
});

describe('Platform sensors switched off', () => {
  const log: PlatformStatusLog = { P1: { occupied: false, sentAt: 9 } };

  it('records the newest platformStatus for each platform', () => {
    const next = recordPlatformStatus(log, [
      { ...status, occupied: true, sentAt: 10 },
      { type: 'platformStatus', platform: 'P3', occupied: true, sentAt: 10 },
    ]);
    expect(next).toEqual({ P1: { occupied: true, sentAt: 10 }, P3: { occupied: true, sentAt: 10 } });
  });

  it('ignores a platformStatus older than the one it holds', () => {
    expect(recordPlatformStatus(log, [{ ...status, occupied: true, sentAt: 8 }])).toBe(log);
    expect(recordPlatformStatus(log, [])).toBe(log);
  });

  it('a platformStatus under FRESH seconds old is fresh', () => {
    expect(hasFreshStatus(log, 'P1', 9, N)).toBe(true);
    expect(hasFreshStatus(log, 'P1', 9 + FRESH - 0.1, N)).toBe(true);
  });

  it('a platformStatus FRESH seconds old or older is not fresh', () => {
    expect(hasFreshStatus(log, 'P1', 9 + FRESH, N)).toBe(false);
    expect(hasFreshStatus(log, 'P1', 500, N)).toBe(false);
    expect(hasFreshStatus(log, 'P2', 9, N)).toBe(false);
  });

  it('judges FRESH for a platformStatus with half a tick of slack', () => {
    expect(hasFreshStatus(log, 'P1', 9 + FRESH - 1e-9, N)).toBe(false);
    expect(hasFreshStatus(log, 'P1', 9 + FRESH - TICK + 1e-9, N)).toBe(true);
  });

  it('between x 5500 and 6400, a platform with no fresh status counts as having no sensor', () => {
    expect(silence({ pos: { track: 'A', offset: 5500 } })).toBe(true);
    expect(silence({ pos: { track: 'A', offset: 5999.99 } })).toBe(true);
    expect(silence({ statuses: { P1: { occupied: true, sentAt: 100 - FRESH } } })).toBe(true);
  });

  it('before x 5500, hearing no status is normal and does not count as a dead sensor', () => {
    expect(silence({ pos: { track: 'A', offset: 5499 } })).toBe(false);
    expect(silence({ pos: { track: 'A', offset: 4800 } })).toBe(false);
  });

  it('a stored refusal with no alternative and no fresh platformStatus from its pair counts as silence', () => {
    expect(silence()).toBe(true);
    expect(silence({ now: 500 })).toBe(true); // the stored reply, long after it arrived
  });

  it('a stored refusal with no alternative and a fresh platformStatus from its pair does not count as silence', () => {
    expect(silence({ statuses: { P1: { occupied: true, sentAt: 99 } } })).toBe(false);
    expect(silence({ statuses: { P2: { occupied: false, sentAt: 99 } } })).toBe(false);
  });

  it('a refusal with an alternative never counts as silence', () => {
    expect(silence({ lastReply: { ...refused, alternative: 'P2' } as HeardPlatformKeeperReply })).toBe(false);
  });

  it('a last reply that is a grant never counts as silence', () => {
    expect(silence({ lastReply: { kind: 'grant', platform: 'P1', at: 90 } })).toBe(false);
    expect(silence({ lastReply: null })).toBe(false);
  });

  it('a fresh platformStatus from the other pair does not stop a refusal counting as silence', () => {
    expect(silence({ statuses: { P3: { occupied: false, sentAt: 99 }, P4: { occupied: true, sentAt: 99 } } })).toBe(true);
  });

  it('after a refusal that counts as silence, uses the rule for a switched-off platform keeper and creeps', () => {
    // Platform keeper alive and refusing everything, sensors off. P1 has a train in it, P2 is empty.
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 5700 }, 20);
    let fastestIn = 0;
    for (let i = 0; i < 1500; i++) {
      const sight = run.out?.nextTrack === 'P1' ? sightTo(run, 6200) : null;
      tick(run, i % 20 === 1 ? [refuse] : [], sight);
      if (run.state.pos.track === 'P2') fastestIn = Math.max(fastestIn, run.state.speed);
    }
    expect(run.state.pos.track).toBe('P2');
    expect(run.state.speed).toBe(0);
    expect(fastestIn).toBeGreaterThan(0);
    expect(fastestIn).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
    expect(run.overruns).toBe(0);
  });

  it('when the sensors die while the platform keeper keeps refusing, falls back PLATFORM_KEEPER_TIMEOUT after the last reply that counted', () => {
    const run = atEnd();
    // 30 seconds with the sensors on and the platform keeper refusing, then the sensors go quiet.
    for (let i = 0; i < 300; i++) tick(run, [...sensors(run, i, { P1: true, P2: true }), ...(i % 20 === 1 ? [refuse] : [])]);
    expect(run.out?.nextTrack).toBeNull();
    let lookedAt: number | null = null;
    for (let i = 300; i < 600 && lookedAt === null; i++) {
      if (tick(run, i % 20 === 1 ? [refuse] : []).nextTrack !== null) lookedAt = run.now - TICK;
    }
    // The last status was sent at 29.0 and the last refusal that counted arrived at 32.1,
    // while a status was still fresh. The fallback starts PLATFORM_KEEPER_TIMEOUT after that.
    expect(lookedAt).toBeCloseTo(32.1 + PLATFORM_KEEPER_TIMEOUT, 6);
  });
});
