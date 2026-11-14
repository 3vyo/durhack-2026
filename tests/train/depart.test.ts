import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/shared/types';
import {
  dwellDone,
  junctionRequest,
  mayStartInSlot,
  mergeGrant,
  slotOpen,
  useClockSlots,
} from '../../src/train/depart';

const grant: Message = { type: 'lockGrant', to: 1, resource: 'JUNCTION', follow: 7 };

describe('depart.ts placeholders', () => {
  it('dwellDone is never true', () => {
    expect(dwellDone(0, 30, 1000)).toBe(false);
    expect(dwellDone(null, 30, 1000)).toBe(false);
  });

  it('junctionRequest asks for nothing', () => {
    expect(
      junctionRequest({ now: 100, id: 1, dwellDone: true, holdsJunction: false, lastSentAt: null }),
    ).toBeNull();
  });

  it('mergeGrant hears nothing', () => {
    expect(mergeGrant([grant], 1)).toBeNull();
  });

  it('useClockSlots is false', () => {
    expect(useClockSlots(0, false, 1000)).toBe(false);
  });

  it('slotOpen is false for every platform', () => {
    for (const p of ['P1', 'P2', 'P3', 'P4'] as const) expect(slotOpen(p, 0)).toBe(false);
  });

  it('mayStartInSlot is false', () => {
    expect(mayStartInSlot('P1', 0, null)).toBe(false);
  });
});

describe('Leaving the station: dwell', () => {
  it.todo('the dwell is done once dwell seconds have passed since the train stopped');
  it.todo('the dwell is not done before dwell seconds have passed');
  it.todo('the dwell is not done when the dwell timer has not started');
});

describe('Leaving the station: asking for the junction', () => {
  it.todo('sends no junction request before the dwell is done');
  it.todo('sends a lockRequest for JUNCTION over short range once the dwell is done');
  it.todo('repeats the junction request every 2 seconds');
  it.todo('does not repeat the junction request sooner than 2 seconds');
  it.todo('stops asking once it holds the junction lock');
});

describe('Leaving the station: the grant', () => {
  it.todo('reads a lockGrant for JUNCTION addressed to itself');
  it.todo('ignores junction grants addressed to other trains');
  it.todo('ignores platform grants when reading the merge reply');
  it.todo('on a junction grant, sets nextTrack to EXIT and departs');
  it.todo('does not leave the platform without a junction grant or an open slot');
  it.todo('treats the follow train in the grant as its leader on EXIT');
  it.todo('drops the old leader report when the grant names a new leader');
  it.todo('with follow null in the grant, has no leader and stays at SIGHT_SPEED or below');
});

describe('Merge switched off: when to use clock slots', () => {
  it.todo('switches to clock slots after 10 seconds of asking with no reply');
  it.todo('keeps waiting for the merge actor before 10 seconds');
  it.todo('counts the 10 seconds from its first junction request');
  it.todo('does not use clock slots after any reply from the merge actor');
});

describe('Merge switched off: the slots', () => {
  it.todo('slot is floor(now / 60) mod 4');
  it.todo('P1 may start during the first 15 seconds of slot 0');
  it.todo('P2 may start during the first 15 seconds of slot 1');
  it.todo('P3 may start during the first 15 seconds of slot 2');
  it.todo('P4 may start during the first 15 seconds of slot 3');
  it.todo('the slot is closed from 15 seconds into it until the next one');
  it.todo('the slots repeat every 240 seconds');
});

describe('Merge switched off: starting', () => {
  it.todo('starts in its slot only if sightAhead shows the junction zone empty');
  it.todo('does not start in its slot when sightAhead shows an obstacle in the junction zone');
  it.todo('does not start outside its slot even when the junction zone is empty');
  it.todo('on a slot start, sets nextTrack to EXIT');
  it.todo('after a slot start, has no leader on EXIT and stays at SIGHT_SPEED until it hears one');
});
