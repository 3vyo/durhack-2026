// The platform keeper with the cross links switched on. docs/design.md, "Cross links" and
// "Entering the station".
//
// Two things are tested. The keeper never uses a cross link: it grants and offers platforms
// of the asking train's own pair only. And it releases a lock whose holder asks for a
// different platform, which it does only with the switch on.
//
// The expected platforms are written out here, not read from src/shared/map.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  answerPlatformRequest,
  createPlatformKeeper,
  heldBy,
  initialPlatformKeeperMemory,
  ownPair,
  recordGrant,
  releaseDroppedLocks,
  stepPlatformKeeper,
  unlockedSettle,
  type PlatformKeeperMemory,
} from '../../src/locks/platform-keeper';
import { REQUEST_REPEAT, RESUME_SETTLE, TICK } from '../../src/shared/constants';
import {
  applyCrossLines,
  applyLayout,
  crossPlatforms,
  platformReadings,
  resetLayout,
  type LayoutId,
} from '../../src/shared/map';
import type {
  EntryId,
  Message,
  Outgoing,
  PlatformId,
  SensorReadings,
  TimetableEntry,
  TrainId,
} from '../../src/shared/types';

// Two trains on every entry track. Trains 1 and 2 enter on A, 3 and 4 on B, 5 and 6 on C, 7
// and 8 on D. The first train of each line has the second platform of its pair as its
// default, so a train can hold one platform of its pair and ask for the other.
const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P2', leader: null, dwell: 30 },
  { id: 2, entry: 'A', enterAt: 60, platform: 'P1', leader: 1, dwell: 30 },
  { id: 3, entry: 'B', enterAt: 0, platform: 'P4', leader: null, dwell: 30 },
  { id: 4, entry: 'B', enterAt: 60, platform: 'P3', leader: 3, dwell: 30 },
  { id: 5, entry: 'C', enterAt: 0, platform: 'P6', leader: null, dwell: 30 },
  { id: 6, entry: 'C', enterAt: 60, platform: 'P5', leader: 5, dwell: 30 },
  { id: 7, entry: 'D', enterAt: 0, platform: 'P8', leader: null, dwell: 30 },
  { id: 8, entry: 'D', enterAt: 60, platform: 'P7', leader: 7, dwell: 30 },
];

/** Every line that has a cross link, on the smallest layout that has it. */
const LINKS: { layout: LayoutId; entry: EntryId; train: TrainId; first: PlatformId; second: PlatformId; cross: PlatformId }[] = [
  { layout: 'junction', entry: 'A', train: 1, first: 'P1', second: 'P2', cross: 'P3' },
  { layout: 'busy', entry: 'B', train: 3, first: 'P3', second: 'P4', cross: 'P5' },
  { layout: 'hub', entry: 'C', train: 5, first: 'P5', second: 'P6', cross: 'P7' },
];

/** Sensor readings with the named platforms occupied and the rest of the layout in use empty. */
function sensors(occupied: PlatformId[] = []): SensorReadings {
  const taken: Partial<Record<PlatformId, boolean>> = {};
  for (const platform of occupied) taken[platform] = true;
  return { platformOccupied: platformReadings(taken), junctionOccupied: false, exitStartClear: true };
}

const ask = (from: TrainId, resource: PlatformId): Message => ({ type: 'lockRequest', from, resource });

const grant = (to: TrainId, resource: PlatformId): Outgoing => ({
  msg: { type: 'lockGrant', to, resource, follow: null },
  range: 'short',
});

const refuse = (to: TrainId, resource: PlatformId, alternative: PlatformId | null): Outgoing => ({
  msg: { type: 'lockRefuse', to, resource, alternative },
  range: 'short',
});

/**
 * Steps the platform keeper tick by tick from time 0, as the engine does, and keeps its
 * memory where a test can read it. `off` moves time on without stepping.
 */
function keeper() {
  let memory = initialPlatformKeeperMemory();
  let now = 0;
  return {
    get memory(): PlatformKeeperMemory {
      return memory;
    },
    get now(): number {
      return now;
    },
    step(inbox: Message[] = [], readings: SensorReadings = sensors()): Outgoing[] {
      const result = stepPlatformKeeper(memory, timetable, now, inbox, readings);
      memory = result.memory;
      now += TICK;
      return result.out;
    },
    idle(seconds: number, readings: SensorReadings = sensors()): Outgoing[] {
      const out: Outgoing[] = [];
      for (let i = 0; i < Math.round(seconds / TICK); i++) out.push(...this.step([], readings));
      return out;
    },
    off(seconds: number): void {
      for (let i = 0; i < Math.round(seconds / TICK); i++) now += TICK;
    },
  };
}

afterEach(() => resetLayout());

describe.each(LINKS)(
  'Cross links on, $layout layout: the platform keeper never sends a train from $entry across to $cross',
  ({ layout, entry, train, first, second, cross }) => {
    beforeEach(() => {
      applyLayout(layout);
      applyCrossLines(true);
    });

    it('the switch is on and the map has the link, so these tests are not empty', () => {
      expect(crossPlatforms(entry)).toEqual([cross]);
    });

    it("a train's own pair is still its two platforms, without the cross platform", () => {
      expect(ownPair(timetable, train)).toEqual([first, second]);
    });

    it('refuses a request for the cross platform when it is empty, and offers the own pair', () => {
      const k = keeper();
      expect(k.step([ask(train, cross)])).toEqual([refuse(train, cross, first)]);
      expect(k.memory.locks[cross]).toBeNull();
      expect(heldBy(k.memory, train)).toBeNull();
    });

    it('offers no alternative when both platforms of the pair are occupied and the cross platform is empty', () => {
      const full = sensors([first, second]);
      const k = keeper();
      // The train asks for its first platform, its second and the cross platform in turn.
      const out: Outgoing[] = [];
      for (let i = 0; i < 300; i++) {
        const asked = [first, second, cross][Math.floor(i / 20) % 3]!;
        out.push(...k.step(i % 20 === 0 ? [ask(train, asked)] : [], full));
      }
      expect(out.length).toBeGreaterThan(0);
      for (const { msg } of out) {
        expect(msg.type).toBe('lockRefuse');
        if (msg.type === 'lockRefuse') expect(msg.alternative).toBeNull();
      }
      expect(k.memory.locks[cross]).toBeNull();
      expect(heldBy(k.memory, train)).toBeNull();
    });

    it('never names the cross platform in a grant or an alternative, whatever is occupied', () => {
      const readings = [sensors(), sensors([first]), sensors([second]), sensors([first, second]), sensors([cross])];
      for (const reading of readings) {
        for (const asked of [first, second, cross]) {
          const reply = answerPlatformRequest({
            now: 100,
            train,
            platform: asked,
            pair: ownPair(timetable, train),
            memory: initialPlatformKeeperMemory(),
            sensors: reading,
            settling: false,
          });
          if (reply.kind === 'grant') expect([first, second]).toContain(reply.platform);
          else expect([first, second, null]).toContain(reply.alternative);
        }
      }
    });

    it('a train that keeps asking for the cross platform is still granted nothing there after a long wait', () => {
      const k = keeper();
      const every = Math.round(REQUEST_REPEAT / TICK);
      for (let i = 0; i < 600; i++) {
        for (const { msg } of k.step(i % every === 0 ? [ask(train, cross)] : [])) {
          expect(msg.type).toBe('lockRefuse');
        }
        expect(k.memory.locks[cross]).toBeNull();
      }
    });

    it('still grants the cross platform to a train of the line that owns it', () => {
      const owner = train + 2; // the first train of the next line down
      const k = keeper();
      expect(k.step([ask(owner, cross)])).toEqual([grant(owner, cross)]);
      expect(heldBy(k.memory, owner)).toBe(cross);
    });
  },
);

describe('Cross links on: a lock holder that asks for a different platform has dropped its grant', () => {
  beforeEach(() => applyCrossLines(true));

  it('releases the lock and answers the request afresh, so the train gets the platform it asked for', () => {
    const k = keeper();
    expect(k.step([ask(3, 'P3')])).toEqual([grant(3, 'P3')]);
    k.idle(1);
    expect(k.step([ask(3, 'P4')])).toEqual([grant(3, 'P4')]);
    expect(k.memory.locks.P3).toBeNull();
    expect(k.memory.locks.P4?.holder).toBe(3);
    expect(heldBy(k.memory, 3)).toBe('P4');
  });

  it('does not give the old grant again when a train from another line now stands in that platform', () => {
    // The collision from the plan: train 3 took a grant for P3 on the tick the centre came
    // back, the centre sent it to P4 and sent a line A train across to P3, and the centre
    // failed again. Train 3 has forgotten P3 and asks for P4.
    const k = keeper();
    expect(k.step([ask(3, 'P3')])).toEqual([grant(3, 'P3')]);
    k.idle(3, sensors(['P3']));
    const out = k.step([ask(3, 'P4')], sensors(['P3']));
    expect(out).toEqual([grant(3, 'P4')]);
    expect(k.memory.locks.P3).toBeNull();
  });

  it('refuses with no alternative when the platform it asks for is taken and its old one has a train in it', () => {
    const k = keeper();
    k.step([ask(3, 'P3')]);
    k.idle(3, sensors(['P3', 'P4']));
    expect(k.step([ask(3, 'P4')], sensors(['P3', 'P4']))).toEqual([refuse(3, 'P4', null)]);
    expect(k.memory.locks.P3).toBeNull();
    expect(heldBy(k.memory, 3)).toBeNull();
  });

  it('treats the released platform as one a train entered without a lock, so it must read empty for the settle time', () => {
    const k = keeper();
    k.step([ask(3, 'P3')]);
    k.idle(1, sensors(['P3', 'P4']));
    k.step([ask(3, 'P4')], sensors(['P3', 'P4']));
    expect(k.memory.unlockedOccupiedAt.P3).not.toBeNull();
    // P3 reads empty again. Train 4 is refused it until it has read empty for unlockedSettle().
    k.idle(4); // train 3 goes quiet, so train 4 is the front of its queue
    expect(k.step([ask(4, 'P3')], sensors(['P4']))).toEqual([refuse(4, 'P3', null)]);
    k.idle(unlockedSettle());
    expect(k.step([ask(4, 'P3')], sensors(['P4']))).toEqual([grant(4, 'P3')]);
  });

  it('offers the released platform as the alternative when it is free and the one asked for is not', () => {
    const k = keeper();
    k.step([ask(3, 'P3')]);
    k.idle(1, sensors(['P4']));
    expect(k.step([ask(3, 'P4')], sensors(['P4']))).toEqual([refuse(3, 'P4', 'P3')]);
    expect(heldBy(k.memory, 3)).toBeNull();
    // Nothing was promised by the offer. The train asks for P3 and gets a new grant.
    k.idle(REQUEST_REPEAT - TICK, sensors(['P4']));
    expect(k.step([ask(3, 'P3')], sensors(['P4']))).toEqual([grant(3, 'P3')]);
  });

  it('counts the train as waiting again, so a train behind it on the same line is refused', () => {
    const k = keeper();
    k.step([ask(3, 'P3')]);
    k.idle(1, sensors(['P4']));
    // Train 3 drops P3 and is refused P4. Train 4, behind it, asks for the freed P3 on the same tick.
    const out = k.step([ask(4, 'P3'), ask(3, 'P4')], sensors(['P4']));
    expect(out).toEqual([refuse(3, 'P4', 'P3'), refuse(4, 'P3', null)]);
    expect(k.memory.locks.P3).toBeNull();
  });

  it('never releases the lock of a holder that asks for the platform it holds, on its way in', () => {
    const k = keeper();
    const every = Math.round(REQUEST_REPEAT / TICK);
    expect(k.step([ask(3, 'P3')])).toEqual([grant(3, 'P3')]);
    for (let i = 1; i <= 300; i++) {
      // Its own front makes the sensor read occupied for the last few seconds.
      const readings = i > 250 ? sensors(['P3']) : sensors();
      const out = k.step(i % every === 0 ? [ask(3, 'P3')] : [], readings);
      if (i % every === 0) expect(out).toEqual([grant(3, 'P3')]);
      expect(k.memory.locks.P3?.holder).toBe(3);
    }
  });

  it('leaves every other lock alone', () => {
    const k = keeper();
    k.step([ask(1, 'P1'), ask(3, 'P3')]);
    k.idle(1);
    k.step([ask(3, 'P4')]);
    expect(k.memory.locks.P1?.holder).toBe(1);
    expect(k.memory.locks.P4?.holder).toBe(3);
    expect(k.memory.locks.P3).toBeNull();
  });

  it('releases the lock even while it is settling after being switched back on, and grants nothing', () => {
    const k = keeper();
    k.step([ask(3, 'P3')]);
    k.off(60);
    expect(k.step([ask(3, 'P4')])).toEqual([refuse(3, 'P4', null)]);
    expect(k.memory.locks.P3).toBeNull();
    expect(heldBy(k.memory, 3)).toBeNull();
    // Once the settle time is over the request is answered by the normal rules.
    k.idle(RESUME_SETTLE);
    expect(k.step([ask(3, 'P4')])).toEqual([grant(3, 'P4')]);
  });

  it('releaseDroppedLocks ignores junction requests, trains with no lock and requests for the held platform', () => {
    const held = recordGrant(initialPlatformKeeperMemory(), 3, 'P3', 0);
    const junction: Message = { type: 'lockRequest', from: 3, resource: 'JUNCTION' };
    expect(releaseDroppedLocks(held, [junction, ask(3, 'P3'), ask(4, 'P4'), ask(1, 'P3')])).toBe(held);
    expect(releaseDroppedLocks(held, [ask(3, 'P4')]).locks.P3).toBeNull();
    expect(held.locks.P3?.holder).toBe(3); // the memory passed in is not changed
  });

  it('does the same on a layout with no cross link, because the switch is what turns it on', () => {
    applyLayout('branch');
    const k = keeper();
    expect(k.step([ask(1, 'P1')])).toEqual([grant(1, 'P1')]);
    k.idle(1);
    expect(k.step([ask(1, 'P2')])).toEqual([grant(1, 'P2')]);
    expect(k.memory.locks.P1).toBeNull();
  });
});

describe('Cross links off: the platform keeper is as it was', () => {
  it('the switch is off unless a run turns it on', () => {
    expect(crossPlatforms('A')).toEqual([]);
  });

  it('a lock holder that asks for a different platform gets the grant it holds again, and keeps its lock', () => {
    const k = keeper();
    expect(k.step([ask(3, 'P3')])).toEqual([grant(3, 'P3')]);
    k.idle(1);
    expect(k.step([ask(3, 'P4')])).toEqual([grant(3, 'P3')]);
    expect(k.memory.locks.P3?.holder).toBe(3);
    expect(k.memory.locks.P4).toBeNull();
    // Even with a train in that platform, which is why the switch-on rule exists.
    k.idle(1, sensors(['P3']));
    expect(k.step([ask(3, 'P4')], sensors(['P3']))).toEqual([grant(3, 'P3')]);
    expect(k.memory.locks.P3?.holder).toBe(3);
  });

  it('releaseDroppedLocks returns the memory it was given, untouched', () => {
    const held = recordGrant(initialPlatformKeeperMemory(), 3, 'P3', 0);
    expect(releaseDroppedLocks(held, [ask(3, 'P4')])).toBe(held);
  });

  it('steps to the same memory and replies as with the switch on, when no holder asks for another platform', () => {
    // The same script twice: grants, repeats, an arrival, a departure and a queue.
    function script(): { out: Outgoing[]; memory: PlatformKeeperMemory } {
      const k = keeper();
      const out: Outgoing[] = [];
      const every = Math.round(REQUEST_REPEAT / TICK);
      for (let i = 0; i < 400; i++) {
        const inbox: Message[] = [];
        if (i % every === 0 && i < 100) inbox.push(ask(1, 'P1'), ask(3, 'P3'));
        if (i % every === 0 && i >= 20) inbox.push(ask(2, 'P1'));
        if (i % every === 0 && i >= 200) inbox.push(ask(4, 'P3'));
        const occupied: PlatformId[] = i >= 90 && i < 250 ? ['P1', 'P3'] : [];
        out.push(...k.step(inbox, sensors(occupied)));
      }
      return { out, memory: k.memory };
    }
    const off = script();
    applyCrossLines(true);
    const on = script();
    expect(on.out).toEqual(off.out);
    expect(on.memory).toEqual(off.memory);
  });

  it('the actor built by createPlatformKeeper follows the switch at each step, not when it was built', () => {
    const actor = createPlatformKeeper(timetable);
    expect(actor.step(0, [ask(3, 'P3')], sensors())).toEqual([grant(3, 'P3')]);
    expect(actor.step(TICK, [ask(3, 'P4')], sensors())).toEqual([grant(3, 'P3')]);
    applyCrossLines(true);
    expect(actor.step(2 * TICK, [ask(3, 'P4')], sensors())).toEqual([grant(3, 'P4')]);
  });
});
