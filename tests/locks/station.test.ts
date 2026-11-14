// Placeholder tests: each test named "placeholder ..." or "sends nothing yet" checks a
// placeholder's safe value. Delete it in the commit that fills its rule. Do not edit it
// to pass. Turn each it.todo into a real test when you write its rule.

import { describe, expect, it } from 'vitest';
import {
  PLATFORM_PAIRS,
  answerOrder,
  answerPlatformRequest,
  canGrantPlatform,
  canReleasePlatform,
  chooseAlternative,
  createStationActor,
  initialStationMemory,
  observePlatform,
  ownPair,
  recordGrant,
  recordHolderRequests,
  resumeStation,
  type PlatformLock,
} from '../../src/locks/station';
import type { Message, SensorReadings, TimetableEntry } from '../../src/shared/types';

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
];

const allEmpty: SensorReadings = {
  platformOccupied: { P1: false, P2: false, P3: false, P4: false },
  junctionOccupied: false,
  exitStartClear: true,
};

// Test values for the inputs that wait on REQUEST_REPEAT and RESUME_SETTLE.
const settle = 1;
const repeat = 1;

const lock: PlatformLock = { holder: 1, grantedAt: 10, seenArrive: true, lastRequestAt: 10 };

describe('station frame', () => {
  it('has id station', () => {
    expect(createStationActor(timetable).id).toBe('station');
  });

  it('sends nothing yet, even for a request it could grant', () => {
    const actor = createStationActor(timetable);
    const inbox: Message[] = [{ type: 'lockRequest', from: 1, resource: 'P1' }];
    expect(actor.step(0, inbox, allEmpty)).toEqual([]);
    expect(actor.step(0.1, inbox, allEmpty)).toEqual([]);
  });

  it('starts with no locks, no step seen and no resume', () => {
    expect(initialStationMemory()).toEqual({
      locks: { P1: null, P2: null, P3: null, P4: null },
      lastStepAt: null,
      resumedAt: null,
    });
  });

  it('gives A the pair P1, P2 and B the pair P3, P4', () => {
    expect(PLATFORM_PAIRS).toEqual({ A: ['P1', 'P2'], B: ['P3', 'P4'] });
  });

  it('placeholder ownPair offers no platforms', () => {
    expect(ownPair(timetable, 1)).toEqual([]);
  });

  it('placeholder answerOrder answers nobody', () => {
    expect(answerOrder([2, 1], timetable)).toEqual([]);
  });

  it('placeholder canGrantPlatform never grants', () => {
    const memory = initialStationMemory();
    expect(
      canGrantPlatform({ train: 1, platform: 'P1', pair: ['P1', 'P2'], memory, sensors: allEmpty }),
    ).toBe(false);
  });

  it('placeholder chooseAlternative offers nothing', () => {
    const memory = initialStationMemory();
    expect(
      chooseAlternative({ train: 1, requested: 'P1', pair: ['P1', 'P2'], memory, sensors: allEmpty }),
    ).toBeNull();
  });

  it('placeholder answerPlatformRequest says nothing', () => {
    const memory = initialStationMemory();
    expect(
      answerPlatformRequest({
        now: 0,
        train: 1,
        platform: 'P1',
        pair: ['P1', 'P2'],
        memory,
        sensors: allEmpty,
        settling: false,
      }),
    ).toBeNull();
  });

  it('placeholder recordGrant records nothing', () => {
    const memory = initialStationMemory();
    expect(recordGrant(memory, 1, 'P1', 20)).toEqual(initialStationMemory());
  });

  it('placeholder recordHolderRequests records nothing', () => {
    const memory = initialStationMemory();
    memory.locks.P1 = lock;
    const before = structuredClone(memory);
    const inbox: Message[] = [{ type: 'lockRequest', from: 1, resource: 'P1' }];
    expect(recordHolderRequests(memory, inbox, 20)).toEqual(before);
  });

  it('placeholder observePlatform records nothing', () => {
    const fresh: PlatformLock = { ...lock, seenArrive: false };
    const before = structuredClone(fresh);
    expect(observePlatform(fresh, true, 20)).toEqual(before);
  });

  it('placeholder canReleasePlatform never releases, even after arrive then leave', () => {
    expect(
      canReleasePlatform({ now: 100, lock, occupied: false, resumedAt: null, settle, repeat }),
    ).toBe(false);
  });

  it('placeholder resumeStation changes nothing', () => {
    const memory = initialStationMemory();
    memory.locks.P1 = lock;
    memory.lastStepAt = 10;
    const before = structuredClone(memory);
    expect(resumeStation(memory, 50)).toEqual(before);
  });
});

describe('ownPair (Entering the station)', () => {
  it.todo('returns P1 and P2 for a train that enters on A');
  it.todo('returns P3 and P4 for a train that enters on B');
  it.todo('returns no platforms for a train that is not in the timetable');
});

describe('Entering the station: granting', () => {
  it.todo('grants a platform whose sensor says empty and whose lock nobody holds');
  it.todo('refuses a platform whose sensor says occupied');
  it.todo('refuses a platform whose lock another train holds, even when its sensor says empty');
  it.todo('never grants a platform outside the requesting train\'s own pair');
  it.todo('never grants a platform to a train that is not in the timetable');
  it.todo('grants the same platform again when its holder repeats the request');
  it.todo('never gives one train locks on two platforms at once');
  it.todo('keeps a holder on its current platform when it asks for the other platform of its pair');
  it.todo('when two trains ask for the same free platform on one tick, grants it to the train with the earlier enterAt');
  it.todo('answerOrder puts the trains asking on one tick in order of enterAt, earliest first');
  it.todo('answerOrder puts the lowest ID first when two trains have the same enterAt');
  it.todo('records the holder and the grant time in the lock table on a grant');
  it.todo('sends lockGrant to the requesting train with resource set to the platform and follow null');
});

describe('Entering the station: refusing', () => {
  it.todo('refuses with the other platform of the pair as alternative when that one could be granted now');
  it.todo('refuses with alternative null when neither platform of the pair could be granted');
  it.todo('never offers a platform outside the requesting train\'s own pair as an alternative');
  it.todo('never offers an alternative whose lock another train holds');
  it.todo('answers every repeat of a refused request, since the train repeats it every 2 seconds');
  it.todo('grants the alternative when the train then asks for it and it is still free');
});

describe('Entering the station: releasing', () => {
  it.todo('records the arrival once the sensor shows occupied after the grant');
  it.todo('releases the lock once the sensor has shown arrive then leave and the holder has not been heard for longer than one repeat plus two ticks');
  it.todo('keeps the lock when the holder\'s last repeat was heard exactly one repeat plus one tick ago');
  it.todo('does not release the lock while the sensor still shows the train in the platform');
  it.todo('does not release the lock when the sensor shows empty before the train has arrived');
  it.todo('grants the platform to another train once the lock is released');
});

describe('Platform sensors switched off', () => {
  it.todo('treats a dead sensor as occupied and never grants that platform');
  it.todo('offers the other platform of the pair as alternative when one sensor is dead and the other platform is free');
  it.todo('refuses every request with alternative null when every sensor is dead');
  it.todo('never releases a lock while its train could still be on its way in');
  it.todo('keeps the lock while it hears the holder repeat its request, which the train does after the grant until its front is in the platform');
  it.todo('does not release a lock when a sensor dies and comes back while the holder is still asking');
  it.todo('does not grant a platform that a creeping train may be heading into when the sensors come back');
});

describe('Messages (The radio)', () => {
  it.todo('sends every reply over short range');
  it.todo('replies on the tick it reads the request, so the train hears it on the next tick');
  it.todo('ignores lockRequest for JUNCTION, which is for the merge actor');
  it.todo('ignores every message that is not a lockRequest');
  it.todo('sends nothing on a tick with no requests');
});

describe('Switched back on (rule from the review on #31)', () => {
  it.todo('keeps its lock table across being switched off and on');
  it.todo('sets lastStepAt to now on every step');
  it.todo('sets resumedAt to now when wasSwitchedOff says it was off');
  it.todo('keeps every lock when it comes back, since the gap itself releases nothing');
  it.todo('grants nothing until resumedAt + settle');
  it.todo('refuses every platform request with alternative null until resumedAt + settle, so waiting trains stop falling back to the fixed split');
  it.todo('does not grant a platform that a train set off for by the fixed split, since that train shows on the sensor inside the window');
  it.todo('releases a lock with seenArrive true by the normal rule, inside or after the window');
  it.todo('releases a lock with seenArrive false once the window is over, its sensor reads empty and the holder was not heard during the whole window');
  it.todo('keeps a lock with seenArrive false whose holder was heard during the window');
  it.todo('keeps a lock with seenArrive false whose sensor reads occupied, which includes a dead sensor');
  it.todo('keeps a lock with seenArrive false until the window is over, even if its sensor reads empty');
});
