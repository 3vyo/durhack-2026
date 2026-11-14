import { describe, expect, it } from 'vitest';
import { baselineProgram, createBaselineAgent, makeCentre } from '../../src/baseline';
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

const trains = [{ id: 1, pos: { track: 'A' as const, offset: 100 }, speed: 20, brokenDown: false }];

describe('makeCentre', () => {
  it('fits TrainProgram.makeCentre', () => {
    const fn: TrainProgram['makeCentre'] = makeCentre;
    expect(fn(timetable)).not.toBeNull();
  });

  it('returns a centre whose step sends a permit to each train', () => {
    const centre = makeCentre(timetable);
    for (const now of [0, 1]) {
      const messages = centre.step(now, trains, clear, new Map());
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ type: 'permit', to: 1, nextTrack: 'P1', sentAt: now });
    }
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

describe('baselineProgram', () => {
  it('is named baseline, uses the baseline agent and has no local actors', () => {
    expect(baselineProgram.name).toBe('baseline');
    expect(baselineProgram.agentFactory).toBe(createBaselineAgent);
    expect(baselineProgram.makeActors(timetable)).toEqual([]);
  });

  it('builds a centre that serves baseline trains, whose agent obeys its permits', () => {
    const centre = baselineProgram.makeCentre(timetable);
    const permits = centre?.step(0, trains, clear, new Map()) ?? [];
    expect(permits).toHaveLength(1);
    const agent = baselineProgram.agentFactory(1, timetable);
    const out = agent.decide({ now: 0.1, self: trains[0], inbox: permits, sightAhead: null });
    expect(out).toEqual({ accel: ACCEL, nextTrack: 'P1', outbox: [], mode: 'central' });
  });
});
