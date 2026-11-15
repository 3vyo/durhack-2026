// The train rules with the cross links switched on. docs/design.md, "Cross links", "The
// centre comes first" and "Platform keeper switched off".
//
// A train takes a cross link only on a permit: no authority, no crossing. So these tests
// check three things. A train the centre has already started across finishes the move. A
// train that starts obeying the centre forgets a platform it chose itself. And nothing in
// the train's own rules ever points it at the platform its link leads to.
//
// The expected tracks are written out here, not read from src/shared/map.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_SPEED, PERMIT_FRESH, PLATFORM_KEEPER_TIMEOUT, REQUEST_REPEAT, TICK } from '../../src/shared/constants';
import {
  applyCrossLines,
  applyLayout,
  crossPlatforms,
  resetLayout,
  successors,
  type LayoutId,
} from '../../src/shared/map';
import type { EntryId, Message, PlatformId, TimetableEntry, TrackId, TrainState } from '../../src/shared/types';
import { createAgent, enterCentral, forgetChosenPlatform, initialMemory } from '../../src/train/agent';
import { trainNumbers } from '../../src/train/numbers';
import { committedPlatform, permitRoute, type HeldPermit } from '../../src/train/permits';
import { creepStep, fixedSplitPlatform, ownPairOnly } from '../../src/train/station';
import { requests, startRun, tick, type Run } from './sim';

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
 * Every line that has a cross link, on the smallest layout that has it. `id` is the first
 * train on the line, `cross` the platform its link leads to, and `above` the first platform
 * of the line above, which no link reaches.
 */
const LINKS: {
  layout: LayoutId;
  entry: EntryId;
  id: number;
  first: PlatformId;
  second: PlatformId;
  cross: PlatformId;
  below: EntryId;
}[] = [
  { layout: 'junction', entry: 'A', id: 1, first: 'P1', second: 'P2', cross: 'P3', below: 'B' },
  { layout: 'busy', entry: 'B', id: 3, first: 'P3', second: 'P4', cross: 'P5', below: 'C' },
  { layout: 'hub', entry: 'C', id: 5, first: 'P5', second: 'P6', cross: 'P7', below: 'D' },
];

function permitMsg(to: number, sentAt: number, untilX: number, nextTrack: TrackId | null): Message {
  return { type: 'permit', to, untilX, nextTrack, sentAt };
}

/** What the platform sensors broadcast this tick: one status per platform, once a second. */
function statuses(run: Run, i: number, occupied: Partial<Record<PlatformId, boolean>>): Message[] {
  if (i % 10 !== 0) return [];
  return Object.entries(occupied).map(([platform, value]) => ({
    type: 'platformStatus' as const,
    platform: platform as PlatformId,
    occupied: value,
    sentAt: run.now - TICK,
  }));
}

/** Train `id` stopped at the end of its entry track, where it has just started asking. */
function atEnd(id: number, entry: EntryId): Run {
  return startRun(createAgent(id, timetable), id, { track: entry, offset: 5999.99 }, 0);
}

afterEach(() => resetLayout());

describe.each(LINKS)(
  'Cross links on, $layout layout, a train on entry $entry',
  ({ layout, entry, id, first, second, cross, below }) => {
    beforeEach(() => {
      applyLayout(layout);
      applyCrossLines(true);
    });

    it('the switch is on and the map has the link, so these tests are not empty', () => {
      expect(crossPlatforms(entry)).toEqual([cross]);
      expect(successors(entry)).toEqual([first, second, cross]);
    });

    describe('The centre comes first', () => {
      const permit: HeldPermit = { untilX: 6300, nextTrack: cross, sentAt: 9 };
      const near: TrainState = { id, pos: { track: entry, offset: 5950 }, speed: 30, brokenDown: false };

      it('takes the cross platform from a permit, and no platform a link does not reach', () => {
        expect(permitRoute(entry, permit, null)).toBe(cross);
        // The link runs one way: the line below does not lead back up.
        expect(permitRoute(below, { ...permit, nextTrack: first }, null)).toBeNull();
        // And it reaches the first platform of the next line only.
        const beyond = LINES.find((l) => l.entry === below)!.second;
        expect(permitRoute(entry, { ...permit, nextTrack: beyond }, null)).toBeNull();
      });

      it('keeps the cross platform of its last permit when it can no longer stop', () => {
        const n = trainNumbers();
        expect(committedPlatform(near, permit, entry, n)).toBe(cross);
        // Its own pair still counts, as before.
        expect(committedPlatform(near, { ...permit, nextTrack: second }, entry, n)).toBe(second);
      });

      it('keeps nothing when it can still stop, or the permit named a platform no link reaches', () => {
        const n = trainNumbers();
        expect(committedPlatform({ ...near, speed: 0 }, permit, entry, n)).toBeNull();
        expect(committedPlatform({ ...near, pos: { track: entry, offset: 5000 } }, permit, entry, n)).toBeNull();
        expect(committedPlatform({ ...near, pos: { track: cross, offset: 10 } }, permit, entry, n)).toBeNull();
        const beyond = LINES.find((l) => l.entry === below)!.second;
        expect(committedPlatform(near, { ...permit, nextTrack: beyond }, entry, n)).toBeNull();
        // One direction only: a train of the line below never keeps a platform of this line.
        const other: TrainState = { ...near, pos: { track: below, offset: 5950 } };
        expect(committedPlatform(other, { ...permit, nextTrack: first }, below, n)).toBeNull();
      });

      it('a train the centre has started across finishes the move when the centre goes quiet', () => {
        // The last permit is nearly 5 seconds old, so it goes stale on the next tick.
        const run = startRun(createAgent(id, timetable), id, { track: entry, offset: 5950 }, 21, 100);
        expect(tick(run, [permitMsg(id, 100 - PERMIT_FRESH + 0.2, 6300, cross)]).nextTrack).toBe(cross);
        expect(run.out?.mode).toBe('central');
        for (let i = 0; i < 400; i++) {
          // The platform keeper refuses the cross platform and offers the train's own pair.
          const inbox: Message[] = i % 20 === 5 ? [{ type: 'lockRefuse', to: id, resource: cross, alternative: first }] : [];
          tick(run, inbox);
          if (run.state.pos.track === entry) expect(run.out?.nextTrack).toBe(cross);
          if (run.state.pos.track === cross) expect(run.state.pos.offset).toBeLessThan(300);
        }
        expect(run.out?.mode).not.toBe('central');
        expect(run.state.pos.track).toBe(cross);
        expect(run.state.speed).toBe(0);
        expect(run.state.pos.offset).toBeGreaterThan(300 - 0.1);
        expect(run.overruns).toBe(0);
        // It asked for the platform it was running into, and never for another.
        expect(new Set(requests(run))).toEqual(new Set([cross]));
      });

      it('a train that can still stop does not start across when the centre goes quiet', () => {
        // Standing at the end of its line, sent across by a permit that goes stale before it moves.
        const run = atEnd(id, entry);
        tick(run, [permitMsg(id, -PERMIT_FRESH + TICK, 5999.99, cross)]);
        expect(run.out?.mode).toBe('central');
        // Both platforms of its own pair say occupied, so the fallback has nowhere to go either.
        for (let i = 0; i < 300; i++) {
          const out = tick(run, statuses(run, i, { [first]: true, [second]: true, [cross]: false }));
          expect(out.mode).not.toBe('central');
          expect(out.nextTrack).toBeNull();
        }
        expect(run.state.pos).toEqual({ track: entry, offset: 5999.99 });
        expect(requests(run)).not.toContain(cross);
      });
    });

    describe('no authority, no crossing', () => {
      it('ignores a grant for the cross platform, and an alternative that names it', () => {
        const pair = trainNumbers().pairs[entry];
        expect(pair).toEqual([first, second]);
        expect(ownPairOnly({ kind: 'grant', platform: cross }, pair)).toBeNull();
        expect(ownPairOnly({ kind: 'refuse', platform: first, alternative: cross }, pair)).toEqual({
          kind: 'refuse',
          platform: first,
          alternative: null,
        });
        expect(ownPairOnly({ kind: 'refuse', platform: cross, alternative: null }, pair)).toBeNull();

        // Under PLATFORM_KEEPER_TIMEOUT, so the train is not on the fixed split yet.
        const granted = atEnd(id, entry);
        for (let i = 0; i < 80; i++) {
          const out = tick(granted, [{ type: 'lockGrant', to: id, resource: cross, follow: null }]);
          expect(out.nextTrack).toBeNull();
        }
        expect(new Set(requests(granted))).toEqual(new Set([first]));
        expect(granted.state.pos).toEqual({ track: entry, offset: 5999.99 });

        const offered = atEnd(id, entry);
        for (let i = 0; i < 80; i++) {
          const out = tick(offered, [{ type: 'lockRefuse', to: id, resource: first, alternative: cross }]);
          expect(out.nextTrack).toBeNull();
        }
        expect(new Set(requests(offered))).toEqual(new Set([first]));
        expect(offered.state.pos).toEqual({ track: entry, offset: 5999.99 });
      });

      it('on the fixed split waits when its own pair is occupied, with the cross platform empty', () => {
        const empty = { occupied: false, sentAt: 9 };
        const full = { occupied: true, sentAt: 9 };
        expect(fixedSplitPlatform(entry, { [first]: full, [second]: full, [cross]: empty }, 10, trainNumbers())).toBeNull();

        // The platform keeper is silent. The sensors say both platforms of the pair are occupied.
        const run = atEnd(id, entry);
        for (let i = 0; i < 900; i++) {
          const out = tick(run, statuses(run, i, { [first]: true, [second]: true, [cross]: false }));
          expect(out.nextTrack).toBeNull();
        }
        expect(run.now).toBeGreaterThan(PLATFORM_KEEPER_TIMEOUT);
        expect(run.state.pos).toEqual({ track: entry, offset: 5999.99 });
        expect(new Set(requests(run))).toEqual(new Set([first]));
      });

      it('on the fixed split still takes a platform of its own pair when one says empty', () => {
        const run = atEnd(id, entry);
        for (let i = 0; i < 1500 && !(run.state.pos.track === second && run.state.speed === 0); i++) {
          const next = tick(run, statuses(run, i, { [first]: true, [second]: false, [cross]: false })).nextTrack;
          if (run.state.pos.track === entry) expect([null, second]).toContain(next);
        }
        expect(run.state.pos.track).toBe(second);
        expect(run.overruns).toBe(0);
      });

      it('creeping with the sensors off looks into its own pair only, and waits with a train in both', () => {
        const n = trainNumbers();
        // Looking at the cross platform is not a step of the creep: it starts again at the pair.
        expect(creepStep({ entry, probing: cross, sightAhead: null }, n)).toEqual({ probe: first, take: null });
        expect(creepStep({ entry, probing: first, sightAhead: 50 }, n)).toEqual({ probe: second, take: null });
        expect(creepStep({ entry, probing: second, sightAhead: 50 }, n)).toEqual({ probe: first, take: null });

        // The platform keeper and the sensors are silent. A train stands in each platform of the
        // pair, and the cross platform is empty, so sightAhead would show nothing along it.
        const run = atEnd(id, entry);
        const looked = new Set<TrackId | null>();
        for (let i = 0; i < 900; i++) {
          const path = run.out?.nextTrack ?? null;
          const sight = path === first || path === second ? 50 : null;
          const out = tick(run, [], sight);
          looked.add(out.nextTrack);
          expect(out.nextTrack).not.toBe(cross);
        }
        expect(run.now).toBeGreaterThan(PLATFORM_KEEPER_TIMEOUT);
        // It did creep, and looked into both platforms of its own pair.
        expect(looked).toEqual(new Set([null, first, second]));
        expect(run.state.pos).toEqual({ track: entry, offset: 5999.99 });
        expect(new Set(requests(run))).toEqual(new Set([first]));
      });
    });
  },
);

describe('Cross links: a train that starts obeying the centre forgets the platform it chose', () => {
  // Train 4 is on B with P4 as its default. Its leader is train 3, which it has never heard.
  // The collision from the plan: the train takes a keeper grant for P3 on the tick the centre
  // comes back. The centre cannot see that route yet, so it sends the train to P4 and may send
  // a line A train across to P3. Then the centre fails again.
  const id = 4;

  /**
   * Train 4 at `speed`, just past the ask point. It is refused P4, offered P3 and granted P3.
   * On the next tick the centre takes over and sends it to P4, for two permits. Then the
   * centre goes quiet. Returns the run on the tick the train goes back to its own rules.
   */
  function takenOverThenLeft(speed: number): Run {
    const run = startRun(createAgent(id, timetable), id, { track: 'B', offset: 4850 }, speed, 100);
    tick(run);
    expect(requests(run)).toEqual(['P4']);
    tick(run, [{ type: 'lockRefuse', to: id, resource: 'P4', alternative: 'P3' }]);
    while (requests(run).length < 2) tick(run);
    expect(requests(run)).toEqual(['P4', 'P3']);
    expect(tick(run, [{ type: 'lockGrant', to: id, resource: 'P3', follow: null }]).nextTrack).toBe('P3');

    // The centre's first permit arrives on the tick after the grant.
    expect(tick(run, [permitMsg(id, run.now - TICK, 6300, 'P4')]).nextTrack).toBe('P4');
    expect(run.out?.mode).toBe('central');
    for (let i = 0; i < 9; i++) tick(run);
    tick(run, [permitMsg(id, run.now - TICK, 6300, 'P4')]);
    for (let i = 0; i < 100 && run.out?.mode === 'central'; i++) {
      tick(run);
      if (run.out?.mode === 'central') expect(run.out.nextTrack).toBe('P4');
    }
    expect(run.out?.mode).not.toBe('central');
    expect(run.state.pos.track).toBe('B');
    return run;
  }

  /** Steps until the train stands still, for at most 150 seconds. */
  function untilStopped(run: Run): void {
    for (let i = 0; i < 1500 && run.state.speed > 0; i++) {
      tick(run);
      expect(run.out?.nextTrack).not.toBe('P3');
    }
    expect(run.state.speed).toBe(0);
  }

  describe('with the switch on', () => {
    beforeEach(() => applyCrossLines(true));

    it('forgets the platform and its lock while its front is on its entry track', () => {
      const memory = initialMemory(id, timetable);
      memory.platform = 'P3';
      memory.locks = ['P3'];
      enterCentral(memory);
      forgetChosenPlatform(memory, { track: 'B', offset: 5000 });
      expect(memory.platform).toBeNull();
      expect(memory.locks).toEqual([]);
    });

    it('keeps the platform once its front is in it', () => {
      const memory = initialMemory(id, timetable);
      memory.platform = 'P3';
      memory.locks = ['P3'];
      enterCentral(memory);
      forgetChosenPlatform(memory, { track: 'P3', offset: 0 });
      expect(memory.platform).toBe('P3');
      expect(memory.locks).toEqual(['P3']);
      forgetChosenPlatform(memory, { track: 'EXIT', offset: 10 });
      expect(memory.platform).toBe('P3');
    });

    it('a train that can no longer stop keeps the platform of its last permit, not the one it chose before', () => {
      const run = takenOverThenLeft(MAX_SPEED);
      expect(run.out?.nextTrack).toBe('P4');
      untilStopped(run);
      expect(run.state.pos.track).toBe('P4');
      expect(run.state.pos.offset).toBeGreaterThan(300 - 0.1);
      expect(run.state.pos.offset).toBeLessThan(300);
      expect(run.overruns).toBe(0);
      // It asks the platform keeper for the platform it is running into.
      expect(requests(run).slice(2).length).toBeGreaterThan(0);
      expect(new Set(requests(run).slice(2))).toEqual(new Set(['P4']));
    });

    it('a train that can still stop has no platform, stops at the end of its line and asks for its default', () => {
      const run = takenOverThenLeft(15);
      expect(run.out?.nextTrack).toBeNull();
      // Under PLATFORM_KEEPER_TIMEOUT from its first new request, so it is not on the fixed split.
      const until = run.now + PLATFORM_KEEPER_TIMEOUT - REQUEST_REPEAT;
      while (run.now < until) {
        expect(tick(run).nextTrack).toBeNull();
        expect(run.state.pos.track).toBe('B');
      }
      expect(run.overruns).toBe(0);
      expect(requests(run).slice(2).length).toBeGreaterThan(0);
      expect(new Set(requests(run).slice(2))).toEqual(new Set(['P4']));
    });

    it('takes a new grant after it has forgotten the old one', () => {
      const run = takenOverThenLeft(15);
      expect(tick(run, [{ type: 'lockGrant', to: id, resource: 'P4', follow: null }]).nextTrack).toBe('P4');
      untilStopped(run);
      expect(run.state.pos.track).toBe('P4');
      expect(run.overruns).toBe(0);
    });
  });

  describe('with the switch off, as before', () => {
    it('forgetChosenPlatform changes nothing', () => {
      const memory = initialMemory(id, timetable);
      memory.platform = 'P3';
      memory.locks = ['P3'];
      enterCentral(memory);
      forgetChosenPlatform(memory, { track: 'B', offset: 5000 });
      expect(memory.platform).toBe('P3');
      expect(memory.locks).toEqual(['P3']);
    });

    it.each([MAX_SPEED, 15])('a train at %d m/s goes back to the platform it chose before the centre took over', (speed) => {
      const run = takenOverThenLeft(speed);
      expect(run.out?.nextTrack).toBe('P3');
      for (let i = 0; i < 1500 && run.state.speed > 0; i++) tick(run);
      expect(run.state.pos.track).toBe('P3');
      expect(run.overruns).toBe(0);
    });

    it('a permit that names the platform of another line is not a route, and is not kept', () => {
      const n = trainNumbers();
      const permit: HeldPermit = { untilX: 6300, nextTrack: 'P3', sentAt: 9 };
      const near: TrainState = { id: 1, pos: { track: 'A', offset: 5950 }, speed: 30, brokenDown: false };
      expect(crossPlatforms('A')).toEqual([]);
      expect(permitRoute('A', permit, null)).toBeNull();
      expect(committedPlatform(near, permit, 'A', n)).toBeNull();
      expect(committedPlatform(near, { ...permit, nextTrack: 'P2' }, 'A', n)).toBe('P2');
    });
  });
});
