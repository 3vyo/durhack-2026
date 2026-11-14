import { describe, expect, it } from 'vitest';
import { ACCEL, BRAKE } from '../../src/shared/constants';
import type { TimetableEntry } from '../../src/shared/types';
import { createTrainAgent } from '../../src/train';

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
];

describe('createTrainAgent', () => {
  it('returns an agent with decide', () => {
    expect(typeof createTrainAgent(1, timetable).decide).toBe('function');
  });

  it('returns a valid, safe output', () => {
    const out = createTrainAgent(1, timetable).decide({
      now: 0,
      self: { id: 1, pos: { track: 'A', offset: 0 }, speed: 0, brokenDown: false },
      inbox: [],
      sightAhead: null,
    });
    expect(out.accel).toBeGreaterThanOrEqual(-BRAKE);
    expect(out.accel).toBeLessThanOrEqual(ACCEL);
    expect(out).toEqual({ accel: -BRAKE, nextTrack: null, outbox: [], mode: 'blind' });
  });

  it('builds a separate agent for each train', () => {
    expect(createTrainAgent(1, timetable)).not.toBe(createTrainAgent(2, timetable));
  });
});
