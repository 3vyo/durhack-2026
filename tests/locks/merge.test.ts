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
  queuedToAnswer,
  recordJunctionRequests,
  resumeMerge,
  type JunctionHolder,
  type JunctionRequest,
} from '../../src/locks/merge';
import type { Message, SensorReadings } from '../../src/shared/types';

const clear: SensorReadings = {
  platformOccupied: { P1: false, P2: false, P3: false, P4: false },
  junctionOccupied: false,
  exitStartClear: true,
};

const queue: JunctionRequest[] = [
  { train: 3, firstHeardAt: 5, lastHeardAt: 9 },
  { train: 1, firstHeardAt: 7, lastHeardAt: 9 },
];

const holder: JunctionHolder = { train: 3, follow: null, grantedAt: 10, seenEnter: true };

describe('merge frame', () => {
  it('has id merge', () => {
    expect(createMergeActor().id).toBe('merge');
  });

  it('sends nothing yet, even when the junction is free and a train asks', () => {
    const actor = createMergeActor();
    const inbox: Message[] = [{ type: 'lockRequest', from: 1, resource: 'JUNCTION' }];
    expect(actor.step(0, inbox, clear)).toEqual([]);
    expect(actor.step(0.1, [], clear)).toEqual([]);
  });

  it('starts with no holder, an empty queue and nobody let into EXIT', () => {
    expect(initialMergeMemory()).toEqual({
      holder: null,
      queue: [],
      lastIntoExit: null,
      lastStepAt: null,
    });
  });

  it('placeholder recordJunctionRequests adds nobody', () => {
    const inbox: Message[] = [{ type: 'lockRequest', from: 2, resource: 'JUNCTION' }];
    const before = structuredClone(queue);
    expect(recordJunctionRequests(queue, inbox, 10)).toEqual(before);
  });

  it('placeholder dropSilentRequests drops nobody', () => {
    const before = structuredClone(queue);
    expect(dropSilentRequests(queue, 1000)).toEqual(before);
  });

  it('placeholder queuedToAnswer answers nobody', () => {
    expect(queuedToAnswer({ ...initialMergeMemory(), queue }, 30)).toEqual([]);
  });

  it('placeholder nextForJunction picks nobody', () => {
    expect(nextForJunction(queue)).toBeNull();
  });

  it('placeholder canGrantJunction never grants', () => {
    expect(canGrantJunction(null, clear)).toBe(false);
  });

  it('placeholder followFor names no leader', () => {
    expect(followFor({ ...initialMergeMemory(), lastIntoExit: 4 })).toBeNull();
  });

  it('placeholder observeJunction records nothing', () => {
    const fresh: JunctionHolder = { ...holder, seenEnter: false };
    expect(observeJunction(fresh, { ...clear, junctionOccupied: true })).toEqual(fresh);
  });

  it('placeholder canReleaseJunction never releases, even after the holder entered and left', () => {
    expect(canReleaseJunction(holder, clear)).toBe(false);
  });

  it('placeholder resumeMerge keeps the memory as it was', () => {
    const memory = { holder, queue, lastIntoExit: 2, lastStepAt: 10 };
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

describe('Merge switched off: what the alive actor must not cause', () => {
  it.todo('sends lockRefuse for JUNCTION with alternative null to each queued train it does not grant, so none waits 10 seconds without a reply (design gap, see pull request)');
  it.todo('never lets a train that fell back to clock slots and a granted train into the junction zone together');
});

describe('Messages (The radio)', () => {
  it.todo('ignores every message that is not a lockRequest');
  it.todo('sends nothing on a tick when it grants nobody');
});

describe('Switched back on (not in the design yet)', () => {
  it.todo('keeps its memory across being switched off and on');
  it.todo('notices from the gap since lastStepAt that it was switched off');
  it.todo('sets lastStepAt to now on every step');
  it.todo('does not name a stale train in follow, since trains may have joined EXIT by clock slots while it was off');
  it.todo('handles queued requests heard before it was switched off (rule not decided)');
  it.todo('handles a holder that entered and left the zone while the actor was off (rule not decided)');
  it.todo('does not grant while a train that started in a clock slot is in the junction zone');
});
