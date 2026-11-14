import { describe, expect, it } from 'vitest';
import {
  JUNCTION_KEEPER_TIMEOUT,
  REQUEST_REPEAT,
  SIGHT_SPEED,
  SLOT_COUNT,
  SLOT_LENGTH,
  SLOT_WINDOW,
  TICK,
} from '../../src/shared/constants';
import type { Message, PlatformId } from '../../src/shared/types';
import { createAgent } from '../../src/train/agent';
import {
  dwellDone,
  junctionRequest,
  mayStartInSlot,
  junctionKeeperReply,
  slotOpen,
  useClockSlots,
} from '../../src/train/depart';
import { trainNumbers } from '../../src/train/numbers';
import { requests, startRun, tick, ticks, timetable, type Run } from './sim';

const N = trainNumbers();

const grant: Message = { type: 'lockGrant', to: 1, resource: 'JUNCTION', follow: 7 };
const refuse: Message = { type: 'lockRefuse', to: 1, resource: 'JUNCTION', alternative: null };

function ask(over: Partial<Parameters<typeof junctionRequest>[0]> = {}) {
  return junctionRequest({ now: 100, id: 1, dwellDone: true, holdsJunction: false, lastSentAt: null, ...over }, N);
}

/** Train `id` stopped in its platform at the stop point, its dwell just started at `now`. */
function dwelling(id: number, platform: PlatformId, now = 0): Run {
  const run = startRun(createAgent(id, timetable), id, { track: platform, offset: 299.99 }, 0, now);
  tick(run);
  return run;
}

/** Steps until the train has sent its first junction request. The dwell is 30 seconds. */
function untilAsked(run: Run): void {
  for (let i = 0; i < 400 && !requests(run).includes('JUNCTION'); i++) tick(run);
  expect(requests(run)).toContain('JUNCTION');
}

describe('Leaving the station: dwell', () => {
  it('the dwell is done once dwell seconds have passed since the train stopped', () => {
    expect(dwellDone(100, 30, 130, N)).toBe(true);
    expect(dwellDone(100, 30, 500, N)).toBe(true);
  });

  it('the dwell is not done before dwell seconds have passed', () => {
    expect(dwellDone(100, 30, 100, N)).toBe(false);
    expect(dwellDone(100, 30, 129.9, N)).toBe(false);
  });

  it('judges the dwell with half a tick of slack', () => {
    expect(dwellDone(100, 30, 130 - 1e-9, N)).toBe(true);
    expect(dwellDone(100, 30, 130 - TICK + 1e-9, N)).toBe(false);
  });

  it('the dwell is not done when the dwell timer has not started', () => {
    expect(dwellDone(null, 30, 1000, N)).toBe(false);
    expect(dwellDone(null, 0, 1000, N)).toBe(false);
  });
});

describe('Leaving the station: asking for the junction', () => {
  it('sends no junction request before the dwell is done', () => {
    expect(ask({ dwellDone: false })).toBeNull();
    const run = dwelling(1, 'P1');
    ticks(run, 290);
    expect(requests(run)).not.toContain('JUNCTION');
  });

  it('sends a lockRequest for JUNCTION over short range once the dwell is done', () => {
    expect(ask()).toEqual({ msg: { type: 'lockRequest', from: 1, resource: 'JUNCTION' }, range: 'short' });
    const run = dwelling(1, 'P1');
    ticks(run, 301);
    expect(requests(run)).toEqual(['JUNCTION']);
  });

  it('repeats the junction request every 2 seconds', () => {
    expect(ask({ lastSentAt: 100 - REQUEST_REPEAT })).not.toBeNull();
    const run = dwelling(1, 'P1');
    untilAsked(run);
    ticks(run, 60);
    expect(requests(run)).toHaveLength(4);
  });

  it('does not repeat the junction request sooner than 2 seconds', () => {
    expect(ask({ lastSentAt: 100 - REQUEST_REPEAT + TICK })).toBeNull();
    expect(ask({ lastSentAt: 100 })).toBeNull();
  });

  it('repeats on the tick 2 seconds have passed even when now - lastSentAt is a rounding error short (half a tick of slack)', () => {
    expect(ask({ lastSentAt: 100 - REQUEST_REPEAT + 1e-9 })).not.toBeNull();
  });

  it('stops asking once it holds the junction lock', () => {
    expect(ask({ holdsJunction: true })).toBeNull();
    const run = dwelling(1, 'P1');
    untilAsked(run);
    tick(run, [{ ...grant, follow: null }]);
    const before = requests(run).length;
    ticks(run, 100);
    expect(requests(run)).toHaveLength(before);
  });

  it('a broken-down train sends no junction request when its dwell ends, and stays where it is', () => {
    const run = dwelling(1, 'P1');
    run.state.brokenDown = true;
    ticks(run, 600);
    expect(requests(run)).toEqual([]);
    expect(run.out?.nextTrack).toBeNull();
    expect(run.state.pos).toEqual({ track: 'P1', offset: 299.99 });
    // It still broadcasts its position.
    expect(run.sent.filter((o) => o.msg.type === 'position').length).toBeGreaterThan(50);
  });
});

describe('Leaving the station: junction keeper replies', () => {
  it('reads a lockGrant for JUNCTION addressed to itself', () => {
    expect(junctionKeeperReply([grant], 1)).toEqual({ kind: 'grant', follow: 7 });
  });

  it('reads a lockRefuse for JUNCTION addressed to itself', () => {
    expect(junctionKeeperReply([refuse], 1)).toEqual({ kind: 'refuse' });
  });

  it('ignores junction replies addressed to other trains', () => {
    expect(junctionKeeperReply([grant, refuse], 2)).toBeNull();
  });

  it('ignores platform grants and refusals when reading the junction keeper reply', () => {
    const inbox: Message[] = [
      { type: 'lockGrant', to: 1, resource: 'P1', follow: null },
      { type: 'lockRefuse', to: 1, resource: 'P1', alternative: 'P2' },
    ];
    expect(junctionKeeperReply(inbox, 1)).toBeNull();
  });

  it('when one inbox holds a junction grant and a refusal for this train, the grant wins', () => {
    expect(junctionKeeperReply([refuse, grant], 1)).toEqual({ kind: 'grant', follow: 7 });
    expect(junctionKeeperReply([grant, refuse], 1)).toEqual({ kind: 'grant', follow: 7 });
  });

  it('a JUNCTION refusal counts as a reply from the junction keeper', () => {
    // Refused every 2 seconds, the train never reaches the junction keeper timeout, even in its slot.
    const run = dwelling(1, 'P1', 4 * SLOT_LENGTH - 35);
    for (let i = 0; i < 600; i++) {
      tick(run, i % 20 === 0 ? [refuse] : []);
      expect(run.out?.nextTrack).toBeNull();
    }
  });

  it('keeps waiting in the platform while refusals keep coming', () => {
    const run = dwelling(1, 'P1');
    for (let i = 0; i < 3000; i++) tick(run, i % 20 === 0 ? [refuse] : []);
    expect(run.state.pos).toEqual({ track: 'P1', offset: 299.99 });
    expect(requests(run).length).toBeGreaterThan(100);
  });

  it('ignores a JUNCTION refusal once it holds the grant', () => {
    const run = dwelling(1, 'P1');
    untilAsked(run);
    tick(run, [{ ...grant, follow: null }]);
    for (let i = 0; i < 400; i++) {
      tick(run, [refuse]);
      expect(run.out?.nextTrack === 'EXIT' || run.state.pos.track === 'EXIT').toBe(true);
    }
    expect(run.state.pos.track).toBe('EXIT');
  });
});

describe('Leaving the station: the grant', () => {
  it('on a junction grant, sets nextTrack to EXIT and departs', () => {
    const run = dwelling(1, 'P1');
    untilAsked(run);
    const out = tick(run, [{ ...grant, follow: null }]);
    expect(out.nextTrack).toBe('EXIT');
    ticks(run, 300);
    expect(run.state.pos.track).toBe('EXIT');
    expect(run.overruns).toBe(0);
  });

  it('does not leave the platform without a junction grant or an open slot', () => {
    // P1's slot is slot 0. Start just after its window, so no slot opens for 225 seconds.
    const run = dwelling(1, 'P1', SLOT_WINDOW + 1);
    for (let i = 0; i < 2000; i++) {
      tick(run);
      expect(run.out?.nextTrack).toBeNull();
    }
    expect(run.state.pos).toEqual({ track: 'P1', offset: 299.99 });
  });

  it('ignores a junction grant it has not asked for', () => {
    const run = dwelling(1, 'P1');
    const out = tick(run, [grant]);
    expect(out.nextTrack).toBeNull();
    ticks(run, 100);
    expect(run.state.pos.track).toBe('P1');
  });

  it('treats the follow train in the grant as its leader on EXIT', () => {
    const run = dwelling(1, 'P1');
    untilAsked(run);
    // Train 7 is stopped on EXIT with its front at offset 2000. The limit point is at 1850.
    tick(run, [grant, { type: 'position', from: 7, pos: { track: 'EXIT', offset: 2000 }, speed: 0, sentAt: run.now - TICK }]);
    expect(run.out?.mode).toBe('full');
    let fastest = 0;
    for (let i = 0; i < 2500; i++) {
      tick(run);
      if (run.state.pos.track === 'EXIT' && run.state.pos.offset > 1850) fastest = Math.max(fastest, run.state.speed);
    }
    // Past the limit point only the SIGHT_SPEED floor is left.
    expect(fastest).toBeGreaterThan(0);
    expect(fastest).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
    expect(run.topSpeed).toBeGreaterThan(SIGHT_SPEED);
  });

  it('uses the newest report it has heard from the new leader', () => {
    const run = dwelling(1, 'P1');
    // Heard long before the grant, while train 7 was not yet the leader.
    tick(run, [{ type: 'position', from: 7, pos: { track: 'EXIT', offset: 500 }, speed: 20, sentAt: 0 }]);
    tick(run, [{ type: 'position', from: 7, pos: { track: 'EXIT', offset: 900 }, speed: 20, sentAt: 0.1 }]);
    untilAsked(run);
    const out = tick(run, [grant]);
    expect(out.mode).toBe('stale'); // it has a report, so it is not blind
  });

  it('with follow null in the grant, has leader none on EXIT and may run at full speed', () => {
    const run = dwelling(1, 'P1');
    untilAsked(run);
    tick(run, [{ ...grant, follow: null }]);
    expect(run.out?.mode).toBe('full');
    ticks(run, 1200);
    expect(run.topSpeed).toBeGreaterThan(SIGHT_SPEED);
  });

  it('with its own ID as follow in the grant, has leader unknown: mode blind, SIGHT_SPEED or below', () => {
    const run = dwelling(1, 'P1');
    untilAsked(run);
    tick(run, [{ ...grant, follow: 1 }]);
    expect(run.out?.mode).toBe('blind');
    ticks(run, 1200);
    expect(run.state.pos.track).toBe('EXIT');
    expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
    expect(run.out?.mode).toBe('blind');
  });
});

describe('Junction keeper switched off: when to use clock slots', () => {
  it('switches to clock slots after 10 seconds of asking with no reply', () => {
    expect(useClockSlots(100, null, 100 + JUNCTION_KEEPER_TIMEOUT, N)).toBe(true);
    expect(useClockSlots(100, null, 500, N)).toBe(true);
  });

  it('keeps waiting for the junction keeper before 10 seconds', () => {
    expect(useClockSlots(100, null, 100, N)).toBe(false);
    expect(useClockSlots(100, null, 100 + JUNCTION_KEEPER_TIMEOUT - TICK, N)).toBe(false);
    expect(useClockSlots(null, null, 1000, N)).toBe(false);
  });

  it('counts the 10 seconds from the later of its first junction request and the last junction keeper reply', () => {
    expect(useClockSlots(100, 104, 100 + JUNCTION_KEEPER_TIMEOUT, N)).toBe(false);
    expect(useClockSlots(100, 104, 104 + JUNCTION_KEEPER_TIMEOUT, N)).toBe(true);
    expect(useClockSlots(100, 90, 100 + JUNCTION_KEEPER_TIMEOUT - 1, N)).toBe(false);
    expect(useClockSlots(100, 90, 100 + JUNCTION_KEEPER_TIMEOUT, N)).toBe(true);
  });

  it('does not use clock slots after a reply in the last 10 seconds', () => {
    expect(useClockSlots(100, 495, 500, N)).toBe(false);
  });

  it('after one refusal and then silence, switches to clock slots 10 seconds after that refusal', () => {
    // P1's slot window is open from now 240 to 255. The first request goes out at about 236.
    const run = dwelling(1, 'P1', 4 * SLOT_LENGTH - 34);
    untilAsked(run);
    while (run.now < 4 * SLOT_LENGTH + 2 - TICK / 2) tick(run);
    tick(run, [refuse]);
    const refusedAt = run.now - TICK;
    let lookedAt: number | null = null;
    for (let i = 0; i < 150 && lookedAt === null; i++) {
      if (tick(run).nextTrack === 'EXIT') lookedAt = run.now - TICK;
    }
    expect(lookedAt).not.toBeNull();
    expect(lookedAt! - refusedAt).toBeCloseTo(JUNCTION_KEEPER_TIMEOUT, 6);
  });

  it('judges the 10 seconds with half a tick of slack', () => {
    expect(useClockSlots(100, null, 100 + JUNCTION_KEEPER_TIMEOUT - 1e-9, N)).toBe(true);
    expect(useClockSlots(100, null, 100 + JUNCTION_KEEPER_TIMEOUT - TICK + 1e-9, N)).toBe(false);
  });
});

describe('Junction keeper switched off: the slots', () => {
  const platforms: PlatformId[] = ['P1', 'P2', 'P3', 'P4'];

  /** The platforms whose slot is open at `now`. */
  function open(now: number): PlatformId[] {
    return platforms.filter((p) => slotOpen(p, now, N));
  }

  it('slot is floor(now / 60) mod 4', () => {
    for (const now of [0, 59, 60, 130, 185, 240, 250, 487, 12345]) {
      const slot = Math.floor(now / SLOT_LENGTH) % SLOT_COUNT;
      const inWindow = now % SLOT_LENGTH < SLOT_WINDOW;
      expect(open(now)).toEqual(inWindow ? [platforms[slot]] : []);
    }
  });

  it('P1 may start during the first 15 seconds of slot 0', () => {
    expect(open(0)).toEqual(['P1']);
    expect(open(SLOT_WINDOW - TICK)).toEqual(['P1']);
  });

  it('P2 may start during the first 15 seconds of slot 1', () => {
    expect(open(SLOT_LENGTH)).toEqual(['P2']);
    expect(open(SLOT_LENGTH + SLOT_WINDOW - TICK)).toEqual(['P2']);
  });

  it('P3 may start during the first 15 seconds of slot 2', () => {
    expect(open(2 * SLOT_LENGTH)).toEqual(['P3']);
    expect(open(2 * SLOT_LENGTH + SLOT_WINDOW - TICK)).toEqual(['P3']);
  });

  it('P4 may start during the first 15 seconds of slot 3', () => {
    expect(open(3 * SLOT_LENGTH)).toEqual(['P4']);
    expect(open(3 * SLOT_LENGTH + SLOT_WINDOW - TICK)).toEqual(['P4']);
  });

  it('the slot is closed from 15 seconds into it until the next one', () => {
    expect(open(SLOT_WINDOW)).toEqual([]);
    expect(open(SLOT_WINDOW + 20)).toEqual([]);
    expect(open(SLOT_LENGTH - TICK)).toEqual([]);
  });

  it('the slots repeat every 240 seconds', () => {
    const cycle = SLOT_LENGTH * SLOT_COUNT;
    for (const now of [0, 5, 70, 125, 190, 200]) {
      expect(open(now + cycle)).toEqual(open(now));
      expect(open(now + 7 * cycle)).toEqual(open(now));
    }
  });

  it('a now a rounding error short of a slot edge lands in the right slot (half a tick of slack)', () => {
    expect(open(SLOT_LENGTH - 1e-9)).toEqual(['P2']);
    expect(open(SLOT_WINDOW - 1e-9)).toEqual([]);
    // A clock built by adding TICK, as the engine's is.
    let now = 0;
    for (let i = 0; i < 600; i++) now += TICK;
    expect(open(now)).toEqual(['P2']);
  });
});

describe('Junction keeper switched off: starting', () => {
  /** Train 1 in P1, asking with no reply since about now 195. P1's slot opens at 240. */
  function waiting(): Run {
    const run = dwelling(1, 'P1', 4 * SLOT_LENGTH - 75);
    untilAsked(run);
    return run;
  }

  it('starts in its slot only if sightAhead shows the junction zone empty', () => {
    expect(mayStartInSlot('P1', 0, null, N)).toBe(true);
    const run = waiting();
    let started = false;
    for (let i = 0; i < 700; i++) {
      tick(run);
      started ||= run.state.speed > 0;
      if (!started) expect(run.now).toBeLessThan(4 * SLOT_LENGTH + 1);
    }
    expect(run.state.pos.track).toBe('EXIT');
  });

  it('looks along EXIT for one tick before it starts, because sightAhead follows the last nextTrack', () => {
    const run = waiting();
    while (run.out?.nextTrack !== 'EXIT') tick(run);
    // First tick pointing at EXIT: sightAhead still shows the old path, so it does not move.
    expect(run.out.accel).toBeLessThanOrEqual(0);
    expect(run.state.speed).toBe(0);
    tick(run);
    expect(run.out.accel).toBeGreaterThan(0);
  });

  it('does not start in its slot when sightAhead shows an obstacle in the junction zone', () => {
    expect(mayStartInSlot('P1', 0, 0.01, N)).toBe(false);
    expect(mayStartInSlot('P1', 0, 250, N)).toBe(false);
    const run = waiting();
    // Another train is in the zone, so the engine reports an obstacle at the zone's edge.
    for (let i = 0; i < 1200; i++) tick(run, [], 0.01);
    expect(run.state.pos).toEqual({ track: 'P1', offset: 299.99 });
    expect(run.out?.mode).not.toBe('blind'); // it has not started, so its leader is unchanged
  });

  it('does not start outside its slot even when the junction zone is empty', () => {
    expect(mayStartInSlot('P1', SLOT_WINDOW, null, N)).toBe(false);
    expect(mayStartInSlot('P1', SLOT_LENGTH, null, N)).toBe(false);
    // P2's train never starts in P1's slot.
    const run = dwelling(2, 'P2', 4 * SLOT_LENGTH - 75);
    untilAsked(run);
    while (run.now < 5 * SLOT_LENGTH - 1) {
      tick(run);
      expect(run.out?.nextTrack).toBeNull();
    }
    expect(run.state.speed).toBe(0);
  });

  it('on a slot start, sets nextTrack to EXIT', () => {
    const run = waiting();
    for (let i = 0; i < 500 && run.state.speed === 0; i++) tick(run);
    expect(run.out?.nextTrack).toBe('EXIT');
    // It keeps EXIT after the window closes, until its front is on EXIT.
    while (run.state.pos.track === 'P1') {
      expect(tick(run).nextTrack).toBe('EXIT');
    }
    expect(run.overruns).toBe(0);
  });

  it('a slot start sets the leader to unknown', () => {
    const run = waiting();
    expect(run.out?.mode).toBe('full');
    for (let i = 0; i < 500 && run.state.speed === 0; i++) tick(run);
    expect(run.out?.mode).toBe('blind');
  });

  it('stops asking for the junction once it has started in its slot', () => {
    const run = waiting();
    for (let i = 0; i < 500 && run.state.speed === 0; i++) tick(run);
    const before = requests(run).length;
    ticks(run, 200);
    expect(requests(run)).toHaveLength(before);
  });

  it('after a slot start, stays at SIGHT_SPEED or below on EXIT until it learns its leader', () => {
    const run = waiting();
    // A late grant naming a leader does not count: the train left on its slot, so it
    // cannot know that train is the one directly ahead.
    for (let i = 0; i < 3000; i++) tick(run, i === 2000 ? [grant] : []);
    expect(run.state.pos.track).toBe('EXIT');
    expect(run.state.pos.offset).toBeGreaterThan(1000);
    expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
    expect(run.out?.mode).toBe('blind');
  });
});
