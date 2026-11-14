import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CENTRE_OPTIONS,
  choosePlatform,
  initialMemory,
  isAvailable,
  isReadyToLeave,
  makeCentre,
  makePermit,
  nextThroughJunction,
  nextTrackFor,
  untilXFor,
  updateMemory,
  type Alive,
  type TrainPlan,
} from '../../src/baseline/centre';
import type {
  ResourceId,
  SensorReadings,
  TimetableEntry,
  TrainState,
} from '../../src/shared/types';

// Rules: "Today's rule, for comparison" in docs/design.md, plus "The map" and
// "Platform sensors switched off".

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
  { id: 3, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
];

const clear: SensorReadings = {
  platformOccupied: { P1: false, P2: false, P3: false, P4: false },
  junctionOccupied: false,
  exitStartClear: true,
};

const allAlive: Alive = { station: true, merge: true };

function train(id: number, track: TrainState['pos']['track'], offset: number): TrainState {
  return { id, pos: { track, offset }, speed: 20, brokenDown: false };
}

function plan(id: number): TrainPlan {
  return { id, untilX: 0, nextTrack: null, stoppedAt: null };
}

describe('initialMemory', () => {
  it('starts with the timetable, no plans, no platforms and an empty junction', () => {
    const memory = initialMemory(timetable);
    expect(memory.timetable).toBe(timetable);
    expect(memory.plans.size).toBe(0);
    expect(memory.platformFor.size).toBe(0);
    expect(memory.junctionOrder).toEqual([]);
    expect(memory.junctionHolder).toBeNull();
  });
});

describe('makePermit', () => {
  it('builds a permit message addressed to one train', () => {
    expect(makePermit(2, 6300, 'P2', 12)).toEqual({
      type: 'permit',
      to: 2,
      untilX: 6300,
      nextTrack: 'P2',
      sentAt: 12,
    });
  });
});

describe('placeholders return the safest value', () => {
  const memory = initialMemory(timetable);

  it('updateMemory returns the memory unchanged', () => {
    expect(updateMemory(memory, 1, [train(1, 'A', 100)], clear, allAlive)).toBe(memory);
  });

  it('isAvailable says no piece of track is available, even when all is clear', () => {
    const pieces: ResourceId[] = ['P1', 'P2', 'P3', 'P4', 'JUNCTION'];
    for (const piece of pieces) {
      expect(isAvailable(piece, memory, clear, allAlive)).toBe(false);
    }
  });

  it('choosePlatform sends the train nowhere', () => {
    expect(
      choosePlatform(train(1, 'A', 5000), timetable[0], memory, clear, allAlive, DEFAULT_CENTRE_OPTIONS),
    ).toBeNull();
  });

  it('isReadyToLeave says no train is ready to leave', () => {
    const stopped = { ...train(1, 'P1', 300), speed: 0 };
    expect(isReadyToLeave(stopped, timetable[0], { ...plan(1), stoppedAt: 0 }, 1000)).toBe(false);
  });

  it('nextThroughJunction lets no train through', () => {
    expect(nextThroughJunction(memory, [train(1, 'P1', 300)], clear, allAlive, 100)).toBeNull();
  });

  it('nextTrackFor ends the path at the end of the current track', () => {
    expect(nextTrackFor(train(1, 'A', 5000), memory)).toBeNull();
  });

  it('untilXFor returns the train current x, so it may not move', () => {
    expect(untilXFor(train(1, 'A', 1234), [], memory, clear, allAlive)).toBe(1234);
    expect(untilXFor(train(1, 'P2', 150), [], memory, clear, allAlive)).toBe(6150);
    expect(untilXFor(train(1, 'EXIT', 10), [], memory, clear, allAlive)).toBe(6410);
  });
});

describe('makeCentre', () => {
  it('defaults to serving baseline trains', () => {
    expect(DEFAULT_CENTRE_OPTIONS).toEqual({ serves: 'baseline' });
  });

  it('returns a centre whose step sends no permits for now, with either option', () => {
    const trains = [train(1, 'A', 100), train(3, 'B', 100)];
    for (const serves of ['baseline', 'ours'] as const) {
      const centre = makeCentre(timetable, { serves });
      expect(centre.step(0, trains, clear, allAlive)).toEqual([]);
    }
  });
});

describe('step', () => {
  it.todo('sends exactly one permit to each train in trains on every call');
  it.todo('addresses each permit to its train and sets sentAt to now');
  it.todo('sends only permit messages');
  it.todo('keeps its memory from one call to the next');
  it.todo('sends a train that is not yet in trains no permit until it enters');
});

describe('updateMemory', () => {
  it.todo('adds a plan for a train it sees for the first time');
  it.todo('records stoppedAt when a train stops with its front at offset 300 in its platform');
  it.todo('frees a platform once the train sent to it has left it');
  it.todo('adds a train to junctionOrder once its dwell is over');
  it.todo('clears junctionHolder once the junction zone is empty again');
  it.todo('forgets a train that has left the right-hand end of EXIT');
  it.todo('catches up after a gap of more than a second, since the engine skips step while the centre is off');
  it.todo('frees the junction for a train that cleared the zone while the centre was off');
});

describe('isAvailable', () => {
  it.todo('says a platform is available when its sensor reads empty and no train is sent to it');
  it.todo('says a platform is unavailable when its sensor reads occupied');
  it.todo('says a platform with a dead sensor is unavailable, because a dead sensor reads occupied');
  it.todo('says a platform is available again once its sensor returns and reads empty');
  it.todo('says a platform another train is sent to is unavailable');
  it.todo('says every platform is unavailable while alive.station is false');
  it.todo('says the junction is unavailable while junctionOccupied is true');
  it.todo('says the junction is unavailable while exitStartClear is false (borrowed from the merge actor in "Leaving the station")');
  it.todo('says the junction is unavailable while another train holds it');
  it.todo('says the junction is unavailable while alive.merge is false');
  it.todo('says the junction is available again once alive.merge is true and the zone is clear');
});

describe('choosePlatform', () => {
  it.todo('picks a platform the entry track feeds: P1 or P2 from A, P3 or P4 from B');
  it.todo('picks the default platform from the timetable when it is available (the design leaves the choice to the centre)');
  it.todo('picks the other platform of the pair when the default is unavailable (the design leaves the choice to the centre)');
  it.todo('returns null when neither platform of the pair is available');
  it.todo('never picks a platform whose sensor reads occupied, so a dead sensor rules it out');
  it.todo('returns null while alive.station is false');
  it.todo('keeps the platform it already chose for a train instead of switching it (borrowed from "Following permits")');
  it.todo('never sends two trains to the same platform at once');
  it.todo("with serves: 'ours', suggests only platforms from the train's own pair");
  it.todo("with serves: 'ours', applies or skips the dead actor rules, once the team decides which");
});

describe('isReadyToLeave', () => {
  it.todo('is false until the train has stopped in its platform');
  it.todo('is false until dwell seconds have passed since stoppedAt');
  it.todo('is true once dwell seconds have passed since stoppedAt');
  it.todo('is false while the train is broken down (the design does not say)');
});

describe('nextThroughJunction', () => {
  it.todo('lets only one train into the junction zone at a time');
  it.todo('returns null while another train holds the junction');
  it.todo('returns null while junctionOccupied is true');
  it.todo('returns null while exitStartClear is false (borrowed from the merge actor in "Leaving the station")');
  it.todo('returns null while alive.merge is false');
  it.todo('picks only trains that are ready to leave');
  it.todo('picks the train first in junctionOrder');
  it.todo('puts the lowest ID first in junctionOrder when two trains become ready in the same step (borrowed from the merge actor in "Leaving the station")');
  it.todo('returns null when no train is waiting');
});

describe('nextTrackFor', () => {
  it.todo('gives a train on A or B the platform the centre chose for it');
  it.todo('gives null to a train on A or B with no platform yet');
  it.todo('gives EXIT to a train in a platform only once it holds the junction');
  it.todo('gives null to a train in a platform that does not hold the junction');
  it.todo('gives null to a train on EXIT');
});

describe('untilXFor', () => {
  it.todo("keeps a train's front at least MARGIN behind the rear of the train ahead on its path");
  it.todo('uses the true position of the train ahead, however far it is');
  it.todo('keeps a train behind a broken-down train ahead of it');
  it.todo('keeps a train on A or B with no platform short of the end of its entry track, x 6000');
  it.todo('lets a train with a platform run to offset 300 in that platform, x 6300');
  it.todo('keeps a train short of a platform that is unavailable');
  it.todo('holds a train in its platform at x 6300 until it holds the junction');
  it.todo('holds every train short of the junction zone while the junction is unavailable');
  it.todo('keeps two trains from being in the junction zone at the same time');
  it.todo('lets a train on EXIT run to the end of EXIT, x 12400, when nothing is ahead');
  it.todo('holds a broken-down train where it is');
  it.todo('never moves untilX closer than a running train can stop, when a platform or the junction becomes unavailable (the design does not say)');
});
