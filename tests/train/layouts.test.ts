// The train rules on every layout. docs/design.md, "Layouts": branch has entry A, junction
// A and B, busy A to C, hub A to D. Each entry track owns its own two platforms, and there is
// one clock slot for each platform of the layout in use.
//
// The expected tracks are written out here, not read from src/shared/map.ts, so these tests
// would catch a rule that only works for A and B or for P1 to P4.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SPEED,
  PLATFORM_KEEPER_TIMEOUT,
  SIGHT_SPEED,
  SLOT_LENGTH,
  SLOT_WINDOW,
  TICK,
  TRAIN_LENGTH,
} from '../../src/shared/constants';
import {
  ALL_PLATFORMS,
  ASK_POINT,
  JUNCTION_END_X,
  JUNCTION_START_X,
  PLATFORMS,
  PLATFORM_STOP,
  TRACK_LENGTH,
  applyLayout,
  resetLayout,
  xOf,
  type LayoutId,
} from '../../src/shared/map';
import type { EntryId, Message, PlatformId, TimetableEntry, TrainState } from '../../src/shared/types';
import { createAgent, initialMemory, isLeaving, remember } from '../../src/train/agent';
import { slotOpen } from '../../src/train/depart';
import { isPastPlatformStop, stopPointDistance } from '../../src/train/follow';
import { trainNumbers } from '../../src/train/numbers';
import { committedPlatform, permitRoute, type HeldPermit } from '../../src/train/permits';
import {
  creepStep,
  dwellStart,
  fixedSplitPlatform,
  ownPairOnly,
  platformRequest,
  refusalMeansSilence,
  sensorsSilent,
} from '../../src/train/station';
import { requests, sightTo, startRun, tick, ticks, type Run } from './sim';

const LAYOUTS: LayoutId[] = ['branch', 'junction', 'busy', 'hub'];

/** The platforms each layout has, lowest number first. */
const LAYOUT_PLATFORMS: Record<LayoutId, PlatformId[]> = {
  branch: ['P1', 'P2'],
  junction: ['P1', 'P2', 'P3', 'P4'],
  busy: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
  hub: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
};

/** Each entry track with the two platforms it owns. */
const LINES: { entry: EntryId; first: PlatformId; second: PlatformId }[] = [
  { entry: 'A', first: 'P1', second: 'P2' },
  { entry: 'B', first: 'P3', second: 'P4' },
  { entry: 'C', first: 'P5', second: 'P6' },
  { entry: 'D', first: 'P7', second: 'P8' },
];

/** Two trains on every entry track. Train k has platform Pk as its default. */
const timetable: TimetableEntry[] = LINES.flatMap(({ entry, first, second }, i) => [
  { id: 2 * i + 1, entry, enterAt: 0, platform: first, leader: null, dwell: 30 },
  { id: 2 * i + 2, entry, enterAt: 60, platform: second, leader: 2 * i + 1, dwell: 30 },
]);

/**
 * Every entry track of every layout: 1 on branch, 2 on junction, 3 on busy and 4 on hub.
 * `id` is the first train on that track. `foreign` is a platform another track owns.
 */
const CASES = LAYOUTS.flatMap((layout) =>
  LINES.slice(0, LAYOUT_PLATFORMS[layout].length / 2).map((line, i) => ({
    layout,
    ...line,
    id: 2 * i + 1,
    foreign: LINES[(i + 1) % LINES.length]!.first,
  })),
);

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

/** A reading for every platform of the layout in use, all the same, with some changed. */
function everyPlatform(value: boolean, over: Partial<Record<PlatformId, boolean>> = {}) {
  const out: Partial<Record<PlatformId, boolean>> = {};
  for (const p of PLATFORMS) out[p] = value;
  return { ...out, ...over };
}

/** Train `id` stopped at the end of its entry track, where it has just started asking. */
function atEnd(id: number, entry: EntryId): Run {
  return startRun(createAgent(id, timetable), id, { track: entry, offset: 5999.99 }, 0);
}

/** Train `id` stopped in its platform at the stop point, its dwell just started at `now`. */
function dwelling(id: number, platform: PlatformId, now = 0): Run {
  const run = startRun(createAgent(id, timetable), id, { track: platform, offset: 299.99 }, 0, now);
  tick(run);
  return run;
}

/**
 * True once the train stands still in `platform`. The loops below stop there, because a train
 * left alone for long enough finishes its dwell and leaves on its clock slot.
 */
function stoppedIn(run: Run, platform: PlatformId): boolean {
  return run.state.pos.track === platform && run.state.speed === 0;
}

/** Steps until the train has sent its first junction request. The dwell is 30 seconds. */
function untilAsked(run: Run): void {
  for (let i = 0; i < 400 && !requests(run).includes('JUNCTION'); i++) tick(run);
  expect(requests(run)).toContain('JUNCTION');
}

afterEach(() => resetLayout());

describe.each(LAYOUTS)('the numbers on the %s layout', (layout) => {
  beforeEach(() => applyLayout(layout));

  it('has one clock slot for each platform of the layout, lowest number first', () => {
    const n = trainNumbers();
    expect(n.slotOrder).toEqual(LAYOUT_PLATFORMS[layout]);
    expect(n.slotCount).toBe(LAYOUT_PLATFORMS[layout].length);
  });

  it('gives every entry track its own two platforms', () => {
    expect(trainNumbers().pairs).toEqual({ A: ['P1', 'P2'], B: ['P3', 'P4'], C: ['P5', 'P6'], D: ['P7', 'P8'] });
  });

  it('keeps the same ask point, entry length and platform stop for every entry track', () => {
    const n = trainNumbers();
    expect(n.askPoint).toBe(ASK_POINT);
    expect(n.platformStop).toBe(PLATFORM_STOP);
    for (const { entry } of LINES) expect(n.entryLength).toBe(TRACK_LENGTH[entry]);
  });
});

describe('the numbers follow the layout in use', () => {
  it('reads the layout afresh on each call, never a copy made when the file loaded', () => {
    expect(trainNumbers().slotCount).toBe(4);
    applyLayout('hub');
    expect(trainNumbers().slotCount).toBe(8);
    expect(trainNumbers().slotOrder).toEqual(LAYOUT_PLATFORMS.hub);
    applyLayout('branch');
    expect(trainNumbers().slotCount).toBe(2);
    expect(trainNumbers().slotOrder).toEqual(LAYOUT_PLATFORMS.branch);
    resetLayout();
    expect(trainNumbers().slotCount).toBe(4);
    expect(trainNumbers().slotOrder).toEqual(LAYOUT_PLATFORMS.junction);
  });
});

describe.each(LAYOUTS)('Junction keeper switched off: the slots on the %s layout', (layout) => {
  const platforms = LAYOUT_PLATFORMS[layout];
  const slotTicks = Math.round(SLOT_LENGTH / TICK);
  const windowTicks = Math.round(SLOT_WINDOW / TICK);
  const cycleTicks = slotTicks * platforms.length;

  beforeEach(() => applyLayout(layout));

  /** Every platform of any layout whose slot is open at tick `i`. */
  function open(i: number): PlatformId[] {
    const n = trainNumbers();
    return ALL_PLATFORMS.filter((p) => slotOpen(p, i * TICK, n));
  }

  it('platform Pk may start during the first 15 seconds of slot k - 1, and no other platform may', () => {
    const wrong: string[] = [];
    for (let i = 0; i < 2 * cycleTicks; i++) {
      const slot = Math.floor(i / slotTicks) % platforms.length;
      const want = i % slotTicks < windowTicks ? [platforms[slot]] : [];
      const got = open(i);
      if (got.join() !== want.join()) wrong.push(`tick ${i}: ${got.join()} open, expected ${want.join()}`);
    }
    expect(wrong).toEqual([]);
  });

  it('never has two platforms open at once', () => {
    let most = 0;
    for (let i = 0; i < 2 * cycleTicks; i++) most = Math.max(most, open(i).length);
    expect(most).toBe(1);
  });

  it('gives every platform of the layout exactly one window in each cycle', () => {
    for (const platform of platforms) {
      const n = trainNumbers();
      let openTicks = 0;
      let windows = 0;
      let was = false;
      for (let i = 0; i < cycleTicks; i++) {
        const is = slotOpen(platform, i * TICK, n);
        if (is) openTicks += 1;
        if (is && !was) windows += 1;
        was = is;
      }
      expect(windows).toBe(1);
      expect(openTicks).toBe(windowTicks);
    }
  });

  it('never opens a slot for a platform outside the layout', () => {
    const n = trainNumbers();
    const outside = ALL_PLATFORMS.filter((p) => !platforms.includes(p));
    expect(outside).toHaveLength(8 - platforms.length);
    for (const platform of outside) {
      for (let i = 0; i < 2 * cycleTicks; i++) expect(slotOpen(platform, i * TICK, n)).toBe(false);
    }
  });

  it('repeats after one slot for each platform of the layout', () => {
    for (let i = 0; i < cycleTicks; i += 7) expect(open(i + cycleTicks)).toEqual(open(i));
  });

  it("each platform's train starts in its own slot and is clear of the junction zone before the next slot", () => {
    platforms.forEach((platform, k) => {
      // The dwell ends at 30 and the junction keeper has been silent for 10 seconds at 40.
      const run = dwelling(k + 1, platform);
      let enteredAt: number | null = null;
      let clearAt: number | null = null;
      for (let i = 0; i < cycleTicks + 2 * slotTicks && clearAt === null; i++) {
        tick(run);
        const front = xOf(run.state.pos);
        if (enteredAt === null && front >= JUNCTION_START_X) enteredAt = run.now;
        if (front - TRAIN_LENGTH >= JUNCTION_END_X) clearAt = run.now;
      }
      expect(enteredAt).not.toBeNull();
      expect(clearAt).not.toBeNull();
      // Slot 0 has gone by the time the train may start, so P1 waits a whole cycle.
      const slot = Math.floor(enteredAt! / SLOT_LENGTH);
      expect(slot).toBe(k === 0 ? platforms.length : k);
      expect(slot % platforms.length).toBe(k);
      expect(enteredAt! - slot * SLOT_LENGTH).toBeLessThan(SLOT_WINDOW);
      expect(clearAt!).toBeLessThan((slot + 1) * SLOT_LENGTH);
      // It left without a leader, so it stays at SIGHT_SPEED or below.
      expect(run.out?.mode).toBe('blind');
      expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
      expect(run.overruns).toBe(0);
    });
  });

  it('a train that starts on the last tick of its window is still clear of the junction zone before the next slot', () => {
    // The worst case for "the windows never overlap": the later a train starts in its window,
    // the less of the slot is left for it to clear the zone. Each train below becomes ready a
    // tick later than the one before, from half a second before its window closes to after it.
    // The dwell is 30 seconds and the junction keeper's silence takes 10 more, so a train whose
    // dwell starts 40 seconds before a moment is ready to leave at about that moment.
    const READY_AFTER = 40;
    platforms.forEach((platform, k) => {
      // Slot 0 would need a dwell that starts before time 0, so P1 uses its second turn.
      const slot = k === 0 ? platforms.length : k;
      const slotStart = slot * SLOT_LENGTH;
      const nextSlot = slotStart + SLOT_LENGTH;
      let latestStart: number | null = null;
      let missed = 0;
      for (let late = 5; late >= -2; late--) {
        const run = dwelling(k + 1, platform, slotStart + SLOT_WINDOW - late * TICK - READY_AFTER);
        // The start is the decision that first moves the train, not its front crossing into
        // the zone: a train that starts on the last tick crosses after the window has closed.
        let startedAt: number | null = null;
        let clearAt: number | null = null;
        while (run.now < nextSlot + SLOT_WINDOW && clearAt === null) {
          const decidedAt = run.now;
          tick(run);
          if (startedAt === null && run.state.speed > 0) startedAt = decidedAt;
          if (xOf(run.state.pos) - TRAIN_LENGTH >= JUNCTION_END_X) clearAt = run.now;
        }
        if (startedAt === null) {
          // Too late for this window. It waits for its next turn, a whole cycle away.
          missed += 1;
          expect(run.state.pos).toEqual({ track: platform, offset: 299.99 });
          continue;
        }
        // It started inside its own window, and never after a train that was ready later.
        expect(startedAt).toBeGreaterThanOrEqual(slotStart - 1e-6);
        expect(startedAt - slotStart).toBeLessThan(SLOT_WINDOW - 1e-6);
        latestStart = Math.max(latestStart ?? startedAt, startedAt);
        // Its rear is past the end of the zone before the next platform's window opens.
        expect(clearAt).not.toBeNull();
        expect(clearAt!).toBeLessThan(nextSlot);
        expect(run.out?.nextTrack).toBeNull();
        expect(run.state.pos.track).toBe('EXIT');
        expect(run.out?.mode).toBe('blind');
        expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
        expect(run.overruns).toBe(0);
      }
      // The sweep reached the edge: one train started on the very last tick of the window, and
      // the trains that were ready after it did not start at all.
      expect(latestStart).not.toBeNull();
      expect(latestStart! - slotStart).toBeGreaterThan(SLOT_WINDOW - TICK - 1e-6);
      expect(missed).toBeGreaterThan(0);
    });
  });
});

describe.each(CASES)('$layout layout, a train on entry $entry', ({ layout, entry, first, second, id, foreign }) => {
  beforeEach(() => applyLayout(layout));

  it('sends no platform request before the ask point, then asks for its default platform', () => {
    const run = startRun(createAgent(id, timetable), id, { track: entry, offset: ASK_POINT - 100 }, SIGHT_SPEED);
    while (run.state.pos.offset < ASK_POINT) {
      expect(requests(run)).toEqual([]);
      tick(run);
    }
    tick(run);
    expect(requests(run)).toEqual([first]);
    expect(platformRequest({ now: 0, id, pos: { track: entry, offset: ASK_POINT }, asking: first, lastSentAt: null }, trainNumbers()))
      .toEqual({ msg: { type: 'lockRequest', from: id, resource: first }, range: 'short' });
  });

  it('stops at or before the end of its entry track while it has no platform', () => {
    expect(stopPointDistance({ track: entry, offset: 5000 }, null, false, trainNumbers())).toBe(1000);
    const run = startRun(createAgent(id, timetable), id, { track: entry, offset: 5200 }, 35);
    // The platform keeper refuses every 2 seconds and every sensor says occupied, so the train must wait.
    for (let i = 0; i < 2000; i++) {
      const inbox = sensors(run, i, everyPlatform(true));
      if (i % 20 === 0) inbox.push({ type: 'lockRefuse', to: id, resource: first, alternative: null });
      expect(tick(run, inbox).nextTrack).toBeNull();
      expect(run.state.pos.offset).toBeLessThan(6000);
    }
    expect(run.state.pos.track).toBe(entry);
    expect(run.state.pos.offset).toBeGreaterThan(6000 - 0.1);
    expect(run.state.speed).toBe(0);
    expect(run.overruns).toBe(0);
    expect(new Set(requests(run))).toEqual(new Set([first]));
  });

  it('stops from MAX_SPEED at the end of its entry track when nobody answers', () => {
    const run = startRun(createAgent(id, timetable), id, { track: entry, offset: 2000 }, MAX_SPEED);
    for (let i = 0; i < 3000 && run.state.speed > 0; i++) {
      tick(run);
      expect(run.state.pos.offset).toBeLessThan(6000);
    }
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.track).toBe(entry);
    expect(run.overruns).toBe(0);
  });

  it('on a grant runs into the platform the grant names and stops at offset 300 or just short', () => {
    const run = startRun(createAgent(id, timetable), id, { track: entry, offset: 4000 }, MAX_SPEED);
    let granted = false;
    for (let i = 0; i < 3000 && !(run.state.pos.track === second && run.state.speed === 0); i++) {
      // The platform keeper grants the other platform of the pair on the tick after the first request.
      const inbox: Message[] = !granted && requests(run).length > 0 ? [{ type: 'lockGrant', to: id, resource: second, follow: null }] : [];
      granted ||= inbox.length > 0;
      tick(run, inbox);
      if (run.state.pos.track === second) expect(run.state.pos.offset).toBeLessThan(300);
    }
    expect(run.state.pos.track).toBe(second);
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.offset).toBeGreaterThan(300 - 0.1);
    expect(run.overruns).toBe(0);
    // It asked for its default first, then kept asking for the granted platform on its way in.
    expect(requests(run)[0]).toBe(first);
    expect(new Set(requests(run))).toEqual(new Set([first, second]));
  });

  it('on a refusal with the other platform of its pair as the alternative, asks for that one', () => {
    const run = atEnd(id, entry);
    tick(run);
    tick(run, [{ type: 'lockRefuse', to: id, resource: first, alternative: second }]);
    ticks(run, 30);
    expect(requests(run).slice(0, 2)).toEqual([first, second]);
  });

  it('ignores a grant or an alternative for a platform another entry track owns', () => {
    const pair = trainNumbers().pairs[entry];
    expect(ownPairOnly({ kind: 'grant', platform: foreign }, pair)).toBeNull();
    expect(ownPairOnly({ kind: 'refuse', platform: first, alternative: foreign }, pair)).toEqual({
      kind: 'refuse',
      platform: first,
      alternative: null,
    });
    const run = atEnd(id, entry);
    // Under PLATFORM_KEEPER_TIMEOUT, so the train is not on the fixed split yet.
    for (let i = 0; i < 80; i++) {
      const out = tick(run, [
        { type: 'lockGrant', to: id, resource: foreign, follow: null },
        { type: 'lockRefuse', to: id, resource: first, alternative: foreign },
      ]);
      expect(out.nextTrack).toBeNull();
    }
    expect(new Set(requests(run))).toEqual(new Set([first]));
    expect(run.state.pos).toEqual({ track: entry, offset: 5999.99 });
  });

  it('on the fixed split takes the first platform of its own pair when the sensors say it is empty', () => {
    const fresh = { occupied: false, sentAt: 9 };
    expect(fixedSplitPlatform(entry, { [first]: fresh, [second]: fresh, [foreign]: fresh }, 10, trainNumbers())).toBe(first);
    const run = atEnd(id, entry);
    for (let i = 0; i < 1500 && !stoppedIn(run, first); i++) {
      const next = tick(run, sensors(run, i, everyPlatform(false))).nextTrack;
      if (run.state.pos.track === entry) expect([null, first]).toContain(next);
    }
    expect(run.state.pos.track).toBe(first);
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.offset).toBeGreaterThan(299);
    expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
    expect(run.overruns).toBe(0);
  });

  it('on the fixed split takes the second platform of its pair when the first says occupied', () => {
    const run = atEnd(id, entry);
    for (let i = 0; i < 1500 && !stoppedIn(run, second); i++) {
      const next = tick(run, sensors(run, i, everyPlatform(false, { [first]: true }))).nextTrack;
      if (run.state.pos.track === entry) expect([null, second]).toContain(next);
    }
    expect(run.state.pos.track).toBe(second);
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.offset).toBeGreaterThan(299);
    expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
    expect(run.overruns).toBe(0);
  });

  it('on the fixed split waits when both platforms of its pair say occupied, however many others are empty', () => {
    const empty = { occupied: false, sentAt: 9 };
    const full = { occupied: true, sentAt: 9 };
    const others = Object.fromEntries(ALL_PLATFORMS.filter((p) => p !== first && p !== second).map((p) => [p, empty]));
    expect(fixedSplitPlatform(entry, { ...others, [first]: full, [second]: full }, 10, trainNumbers())).toBeNull();
    const run = atEnd(id, entry);
    for (let i = 0; i < 600; i++) {
      const inbox = sensors(run, i, everyPlatform(false, { [first]: true, [second]: true }));
      expect(tick(run, inbox).nextTrack).toBeNull();
    }
    expect(run.state.pos).toEqual({ track: entry, offset: 5999.99 });
  });

  describe('creeping with the platform keeper and the sensors off', () => {
    /** The train at the end of its entry track, past the platform keeper timeout, with the sensors silent. */
    function creeping(): Run {
      const run = atEnd(id, entry);
      while (run.now < PLATFORM_KEEPER_TIMEOUT - TICK / 2) tick(run);
      return run;
    }

    it('only fresh statuses from its own pair count as hearing the sensors', () => {
      const n = trainNumbers();
      const heard = { occupied: true, sentAt: 9 };
      expect(sensorsSilent(entry, {}, 10, n)).toBe(true);
      expect(sensorsSilent(entry, { [foreign]: heard }, 10, n)).toBe(true);
      expect(sensorsSilent(entry, { [second]: heard }, 10, n)).toBe(false);
      const refused = { kind: 'refuse' as const, platform: first, alternative: null, at: 90 };
      const pos = { track: entry, offset: 5900 };
      expect(refusalMeansSilence({ lastReply: refused, statuses: { [foreign]: { occupied: false, sentAt: 99 } }, entry, pos, now: 100 }, n)).toBe(true);
      expect(refusalMeansSilence({ lastReply: refused, statuses: { [first]: { occupied: true, sentAt: 99 } }, entry, pos, now: 100 }, n)).toBe(false);
    });

    it('looks into the first platform of its own pair, then takes it if it sees no train', () => {
      const n = trainNumbers();
      expect(creepStep({ entry, probing: null, sightAhead: null }, n)).toEqual({ probe: first, take: null });
      expect(creepStep({ entry, probing: foreign, sightAhead: null }, n)).toEqual({ probe: first, take: null });
      expect(creepStep({ entry, probing: first, sightAhead: null }, n)).toEqual({ probe: first, take: first });
      const run = creeping();
      expect(run.out?.nextTrack).toBeNull();
      expect(tick(run).nextTrack).toBe(first);
      for (let i = 0; i < 1500 && !stoppedIn(run, first); i++) {
        const next = tick(run).nextTrack;
        if (run.state.pos.track === entry) expect(next).toBe(first);
      }
      expect(run.state.pos.track).toBe(first);
      expect(run.state.speed).toBe(0);
      expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
      expect(run.overruns).toBe(0);
    });

    it('switches to the other platform of its pair when it sees a train in the first', () => {
      const n = trainNumbers();
      expect(creepStep({ entry, probing: first, sightAhead: 200 }, n)).toEqual({ probe: second, take: null });
      expect(creepStep({ entry, probing: second, sightAhead: null }, n)).toEqual({ probe: second, take: second });
      const run = creeping();
      tick(run); // points at the first platform
      // A train is stopped in the first platform with its rear at x 6200. The second is empty.
      const sight = () => (run.out?.nextTrack === first ? sightTo(run, 6200) : null);
      expect(tick(run, [], sight()).nextTrack).toBe(second);
      for (let i = 0; i < 1500 && !stoppedIn(run, second); i++) {
        const next = tick(run, [], sight()).nextTrack;
        if (run.state.pos.track === entry) expect(next).toBe(second);
      }
      expect(run.state.pos.track).toBe(second);
      expect(run.state.speed).toBe(0);
      expect(run.topSpeed).toBeLessThanOrEqual(SIGHT_SPEED + 1e-9);
      expect(run.overruns).toBe(0);
    });

    it('waits when both platforms of its pair show a train, and looks nowhere else', () => {
      expect(creepStep({ entry, probing: second, sightAhead: 200 }, trainNumbers())).toEqual({ probe: first, take: null });
      const run = creeping();
      for (let i = 0; i < 600; i++) {
        const next = tick(run, [], run.out?.nextTrack ? sightTo(run, 6200) : null).nextTrack;
        expect([first, second]).toContain(next);
      }
      expect(run.state.pos).toEqual({ track: entry, offset: 5999.99 });
      expect(run.overruns).toBe(0);
    });
  });

  it('counts its dwell in either platform of its pair and then asks for the junction', () => {
    for (const [train, platform] of [[id, first], [id + 1, second]] as const) {
      const stopped: TrainState = { id: train, pos: { track: platform, offset: 299.99 }, speed: 0, brokenDown: false };
      expect(dwellStart(null, stopped, 50)).toBe(50);
      expect(dwellStart(null, { ...stopped, pos: { track: entry, offset: 5999.99 } }, 50)).toBeNull();
      const run = dwelling(train, platform);
      ticks(run, 290);
      expect(requests(run)).toEqual([]);
      ticks(run, 11);
      expect(requests(run)).toEqual(['JUNCTION']);
    }
  });

  it('on a junction grant leaves either platform of its pair for EXIT, and not before', () => {
    for (const [train, platform] of [[id, first], [id + 1, second]] as const) {
      const run = dwelling(train, platform);
      untilAsked(run);
      // The junction keeper refuses for a while. The train stays at its stop point.
      for (let i = 0; i < 300; i++) {
        const out = tick(run, i % 20 === 0 ? [{ type: 'lockRefuse', to: train, resource: 'JUNCTION', alternative: null }] : []);
        expect(out.nextTrack).toBeNull();
      }
      expect(run.state.pos).toEqual({ track: platform, offset: 299.99 });
      expect(isPastPlatformStop(run.state.pos, trainNumbers())).toBe(false);
      tick(run, [{ type: 'lockGrant', to: train, resource: 'JUNCTION', follow: null }]);
      expect(run.out?.nextTrack).toBe('EXIT');
      ticks(run, 600);
      expect(run.state.pos.track).toBe('EXIT');
      expect(run.out?.mode).toBe('full');
      expect(run.overruns).toBe(0);
    }
  });

  it('takes a platform keeper reply only on its entry track and a junction keeper reply only in a platform', () => {
    const onEntry = initialMemory(id, timetable);
    onEntry.firstJunctionRequestAt = 1;
    remember(onEntry, 4, { track: entry, offset: 5000 }, { kind: 'grant', platform: second }, { kind: 'grant', follow: 99 });
    expect(onEntry.platform).toBe(second);
    expect(onEntry.locks).toEqual([second]);
    expect(onEntry.lastJunctionKeeperReplyAt).toBeNull();
    expect(onEntry.leader).toBe('none');

    const inPlatform = initialMemory(id, timetable);
    inPlatform.firstJunctionRequestAt = 1;
    remember(inPlatform, 4, { track: first, offset: 200 }, { kind: 'grant', platform: second }, { kind: 'grant', follow: 99 });
    expect(inPlatform.platform).toBeNull();
    expect(inPlatform.locks).toEqual(['JUNCTION']);
    expect(inPlatform.lastJunctionKeeperReplyAt).toBe(4);
    expect(inPlatform.leader).toBe(99);
    expect(isLeaving(inPlatform)).toBe(true);
  });

  it('held at its stop point in either platform of its pair, drops an unused junction grant and asks again', () => {
    for (const [train, platform] of [[id, first], [id + 1, second]] as const) {
      const run = dwelling(train, platform);
      untilAsked(run);
      tick(run, [{ type: 'lockGrant', to: train, resource: 'JUNCTION', follow: null }]);
      expect(run.out?.nextTrack).toBe('EXIT');
      const asked = requests(run).length;
      // Something sits right in front of it, so it cannot move.
      for (let i = 0; i < 150; i++) {
        tick(run, [], 0.01);
        expect(run.state.pos.offset).toBeLessThan(300);
      }
      expect(run.out?.nextTrack).toBeNull();
      expect(requests(run).length).toBeGreaterThan(asked);
      // The way clears, but the old grant is gone. It does not move without a new one.
      for (let i = 0; i < 30; i++) tick(run, [{ type: 'lockRefuse', to: train, resource: 'JUNCTION', alternative: null }]);
      expect(run.state.pos).toEqual({ track: platform, offset: 299.99 });
    }
  });

  it('obeys a fresh permit into a platform of its pair and sends no lock request', () => {
    const run = startRun(createAgent(id, timetable), id, { track: entry, offset: 4700 }, 20);
    for (let i = 0; i < 3000 && !stoppedIn(run, second); i++) {
      tick(run, [{ type: 'permit', to: id, untilX: 6300, nextTrack: second, sentAt: run.now - TICK }]);
      expect(run.out?.mode).toBe('central');
    }
    expect(run.state.pos.track).toBe(second);
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.offset).toBeGreaterThan(299);
    expect(run.overruns).toBe(0);
    expect(requests(run)).toEqual([]);
  });

  it('does not take a permit into a platform another entry track owns', () => {
    const permit: HeldPermit = { untilX: 6300, nextTrack: foreign, sentAt: 9 };
    expect(permitRoute(entry, permit, null)).toBeNull();
    expect(permitRoute(entry, permit, second)).toBe(second);
    expect(permitRoute(entry, { ...permit, nextTrack: first }, null)).toBe(first);
    const run = startRun(createAgent(id, timetable), id, { track: entry, offset: 5200 }, 20);
    for (let i = 0; i < 600; i++) {
      const out = tick(run, [{ type: 'permit', to: id, untilX: 6300, nextTrack: foreign, sentAt: run.now - TICK }]);
      expect(out.nextTrack).toBeNull();
    }
    expect(run.state.pos.track).toBe(entry);
  });

  it('when the centre fails too late to stop, keeps the platform of its pair the last permit named', () => {
    const n = trainNumbers();
    const near: TrainState = { id, pos: { track: entry, offset: 5950 }, speed: 20, brokenDown: false };
    const sent: HeldPermit = { untilX: 6300, nextTrack: second, sentAt: 9 };
    expect(committedPlatform(near, sent, entry, n)).toBe(second);
    expect(committedPlatform({ ...near, speed: 0 }, sent, entry, n)).toBeNull();
    expect(committedPlatform(near, { ...sent, nextTrack: foreign }, entry, n)).toBeNull();
    expect(committedPlatform({ ...near, pos: { track: second, offset: 10 } }, sent, entry, n)).toBeNull();
    // The last permit is nearly 5 seconds old, so it goes stale on the next tick.
    const run = startRun(createAgent(id, timetable), id, { track: entry, offset: 5950 }, 21, 100);
    tick(run, [{ type: 'permit', to: id, untilX: 6300, nextTrack: second, sentAt: 100 - n.permitFresh + 0.2 }]);
    expect(run.out?.mode).toBe('central');
    ticks(run, 300); // the centre has gone quiet
    expect(run.state.pos.track).toBe(second);
    expect(run.overruns).toBe(0);
    expect(new Set(requests(run))).toEqual(new Set([second]));
  });

  it('when the centre fails with its front past the platform stop, carries on out without asking the junction keeper', () => {
    const n = trainNumbers();
    for (const [train, platform] of [[id, first], [id + 1, second]] as const) {
      expect(isPastPlatformStop({ track: platform, offset: 300.5 }, n)).toBe(true);
      expect(isPastPlatformStop({ track: platform, offset: 300 }, n)).toBe(false);
      expect(isPastPlatformStop({ track: entry, offset: 5000 }, n)).toBe(false);
      const run = startRun(createAgent(train, timetable), train, { track: platform, offset: 310 }, 5);
      tick(run, [{ type: 'permit', to: train, untilX: 12400, nextTrack: 'EXIT', sentAt: run.now - TICK, leader: null }]);
      ticks(run, 600);
      expect(run.state.pos.track).toBe('EXIT');
      expect(run.overruns).toBe(0);
      expect(requests(run)).not.toContain('JUNCTION');
      // Its last permit said nothing was ahead, so it runs at full speed, not SIGHT_SPEED.
      expect(run.out?.mode).toBe('full');
      expect(run.topSpeed).toBeGreaterThan(SIGHT_SPEED + 1);
    }
  });
});
