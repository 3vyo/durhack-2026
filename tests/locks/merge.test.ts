// Placeholder tests: each test named "placeholder ..." or "sends nothing yet" checks a
// placeholder's safe value. Delete it in the commit that fills its rule. Do not edit it
// to pass. Turn each it.todo into a real test when you write its rule.

import { describe, expect, it } from 'vitest';
import {
  canGrantJunction,
  canReleaseJunction,
  createMergeActor,
  dropSilentRequests,
  followFor,
  initialMergeMemory,
  nextForJunction,
  observeJunction,
  observeZone,
  queuedToAnswer,
  recordJunctionRequests,
  resumeMerge,
  type JunctionHolder,
  type JunctionRequest,
  type MergeMemory,
} from '../../src/locks/merge';
import type { Message, SensorReadings } from '../../src/shared/types';

const clear: SensorReadings = {
  platformOccupied: { P1: false, P2: false, P3: false, P4: false },
  junctionOccupied: false,
  exitStartClear: true,
};

// A test value for the input that waits on RESUME_SETTLE from pull request #34.
const settle = 1;

const queue: JunctionRequest[] = [
  { train: 3, firstHeardAt: 5, lastHeardAt: 9 },
  { train: 1, firstHeardAt: 7, lastHeardAt: 9 },
];

const holder: JunctionHolder = { train: 3, follow: null, grantedAt: 10, seenEnter: true };

const junctionRequest: Message[] = [{ type: 'lockRequest', from: 2, resource: 'JUNCTION' }];

describe('merge frame', () => {
  it('has id merge', () => {
    expect(createMergeActor().id).toBe('merge');
  });

  it('sends nothing yet, even when the junction is free and a train asks', () => {
    const actor = createMergeActor();
    expect(actor.step(0, junctionRequest, clear)).toEqual([]);
    expect(actor.step(0.1, [], clear)).toEqual([]);
  });

  it('starts with no holder, an empty queue, nobody let into EXIT and no resume', () => {
    expect(initialMergeMemory()).toEqual({
      holder: null,
      queue: [],
      lastIntoExit: null,
      lastStepAt: null,
      resumedAt: null,
      zoneOccupiedSinceResume: false,
    });
  });

  it('placeholder recordJunctionRequests adds nobody', () => {
    const before = structuredClone(queue);
    expect(recordJunctionRequests(queue, junctionRequest, 10)).toEqual(before);
  });

  it('placeholder dropSilentRequests drops nobody', () => {
    const before = structuredClone(queue);
    expect(dropSilentRequests(queue, 1000)).toEqual(before);
  });

  it('placeholder queuedToAnswer answers nobody', () => {
    expect(queuedToAnswer({ ...initialMergeMemory(), queue }, junctionRequest, false)).toEqual([]);
  });

  it('placeholder nextForJunction picks nobody', () => {
    expect(nextForJunction(queue)).toBeNull();
  });

  it('placeholder canGrantJunction never grants', () => {
    expect(canGrantJunction(null, clear, false)).toBe(false);
  });

  it('placeholder followFor names no leader', () => {
    expect(followFor({ ...initialMergeMemory(), lastIntoExit: 4 })).toBeNull();
  });

  it('placeholder observeJunction records nothing', () => {
    const fresh: JunctionHolder = { ...holder, seenEnter: false };
    const before = structuredClone(fresh);
    expect(observeJunction(fresh, { ...clear, junctionOccupied: true })).toEqual(before);
  });

  it('placeholder observeZone changes nothing', () => {
    const memory: MergeMemory = { ...initialMergeMemory(), lastIntoExit: 4 };
    const before = structuredClone(memory);
    expect(observeZone(memory, { ...clear, junctionOccupied: true })).toEqual(before);
  });

  it('placeholder canReleaseJunction never releases, even after the holder entered and left', () => {
    expect(
      canReleaseJunction({
        now: 100,
        holder,
        sensors: clear,
        resumedAt: null,
        zoneOccupiedSinceResume: false,
        settle,
      }),
    ).toBe(false);
  });

  it('placeholder resumeMerge changes nothing', () => {
    const memory: MergeMemory = {
      holder,
      queue,
      lastIntoExit: 2,
      lastStepAt: 10,
      resumedAt: null,
      zoneOccupiedSinceResume: false,
    };
    const before = structuredClone(memory);
    expect(resumeMerge(memory, 50)).toEqual(before);
  });
});

describe('Leaving the station: the queue', () => {
  it.todo('adds a train to the queue the first time it hears a JUNCTION lockRequest from it');
  it.todo('keeps the first-heard time when the same train repeats its request');
  it.todo('updates lastHeardAt when the same train repeats its request');
  it.todo('never lists the same train twice');
  it.todo('ignores lockRequests for platforms, which are for the station actor');
  it.todo('removes a train from the queue when it is granted');
  it.todo('does not put the holder back in the queue when it repeats its request');
  it.todo('ignores a late JUNCTION request from a train it already let into EXIT');
  it.todo('drops a request whose train has stopped asking, for example one that left by clock slot');
});

describe('Leaving the station: who is next', () => {
  it.todo('picks the request heard first');
  it.todo('picks the lowest ID when two requests were first heard on the same tick');
  it.todo('picks nobody from an empty queue');
});

describe('Leaving the station: granting', () => {
  it.todo('grants when nobody holds the lock, junctionOccupied is false and exitStartClear is true');
  it.todo('grants one train at a time');
  it.todo('does not grant while another train holds the lock');
  it.todo('does not grant while junctionOccupied is true');
  it.todo('does not grant while exitStartClear is false, even when the junction zone is empty');
  it.todo('sends lockGrant to the train with resource JUNCTION over short range');
  it.todo('names the last train it let into EXIT in follow');
  it.todo('names follow null for the first train it lets into EXIT');
  it.todo('sets lastIntoExit to the train it just granted');
  it.todo('sets lastIntoExit to null whenever junctionOccupied is true and nobody holds the lock');
  it.todo('answers a repeat request from the holder with the same grant and the same follow');
  it.todo('grants on the tick the conditions hold, so the train hears it on the next tick');
});

describe('Leaving the station: releasing', () => {
  it.todo('records the holder entering once junctionOccupied turns true after the grant');
  it.todo('releases the lock when the junction zone is empty again after the holder entered');
  it.todo('does not release the lock before the holder has entered the zone');
  it.todo('keeps the lock if the holder never enters, for example after it breaks down in the platform');
  it.todo('grants the next train once the lock is released and the conditions hold again');
});

describe('Merge switched off: refusing queued trains (rule from the review on #31)', () => {
  it.todo('sends lockRefuse for JUNCTION with alternative null, over short range, to each train whose request it hears and does not grant on that tick');
  it.todo('answers each request on the tick it hears it, not on every tick');
  it.todo('does not refuse the train it grants on that tick, or the holder repeating its request');
  it.todo('never lets a train that fell back to clock slots and a granted train into the junction zone together');
});

describe('Messages (The radio)', () => {
  it.todo('ignores every message that is not a lockRequest');
  it.todo('sends nothing on a tick when it hears no request and grants nobody');
});

describe('Switched back on (rule from the review on #31)', () => {
  it.todo('keeps its memory across being switched off and on');
  it.todo('sets lastStepAt to now on every step');
  it.todo('sets resumedAt to now and zoneOccupiedSinceResume to false when wasSwitchedOff says it was off');
  it.todo('sets lastIntoExit to null when it comes back, so no grant names a stale follow');
  it.todo('keeps the queue and its order when it comes back');
  it.todo('sets every lastHeardAt in the queue to now when it comes back, so dropSilentRequests clears trains that left by clock slot');
  it.todo('grants nothing until resumedAt + settle');
  it.todo('refuses every JUNCTION request it hears until resumedAt + settle');
  it.todo('sets zoneOccupiedSinceResume once junctionOccupied reads true after resumedAt');
  it.todo('releases a holder with seenEnter false once the window is over, if the zone read empty for the whole window');
  it.todo('keeps a holder with seenEnter false if the zone read occupied at any step in the window');
  it.todo('does not grant while a train that started in a clock slot is in the junction zone');
});
