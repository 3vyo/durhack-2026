import { describe, expect, it } from 'vitest';
import { createBaselineAgent, makeCentre } from '../../src/baseline';
import type { TrainProgram } from '../../src/engine/ports';
import { ACCEL, BRAKE } from '../../src/shared/constants';
import type { SensorReadings, TimetableEntry } from '../../src/shared/types';

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'B', enterAt: 10, platform: 'P3', leader: null, dwell: 30 },
];

const clear: SensorReadings = {
  platformOccupied: { P1: false, P2: false, P3: false, P4: false },
  junctionOccupied: false,
  exitStartClear: true,
};

describe('makeCentre', () => {
  it('fits TrainProgram.makeCentre', () => {
    const fn: TrainProgram['makeCentre'] = makeCentre;
    expect(fn(timetable)).not.toBeNull();
  });

  it('returns a centre whose step returns an empty list for now', () => {
    const centre = makeCentre(timetable);
    const trains = [
      { id: 1, pos: { track: 'A' as const, offset: 100 }, speed: 20, brokenDown: false },
    ];
    expect(centre.step(0, trains, clear, { station: true, merge: true })).toEqual([]);
    expect(centre.step(1, trains, clear, { station: true, merge: true })).toEqual([]);
  });
});

describe('createBaselineAgent', () => {
  it('fits TrainProgram.agentFactory and returns a valid, safe output', () => {
    const factory: TrainProgram['agentFactory'] = createBaselineAgent;
    const agent = factory(1, timetable);
    const out = agent.decide({
      now: 0,
      self: { id: 1, pos: { track: 'A', offset: 0 }, speed: 0, brokenDown: false },
      inbox: [],
      sightAhead: null,
    });
    expect(out.accel).toBeGreaterThanOrEqual(-BRAKE);
    expect(out.accel).toBeLessThanOrEqual(ACCEL);
    expect(out).toEqual({ accel: -BRAKE, nextTrack: null, outbox: [], mode: 'blind' });
  });
});
