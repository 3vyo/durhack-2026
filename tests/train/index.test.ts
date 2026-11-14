// Each test under a "placeholders" describe pins a placeholder's value. Delete it in the
// commit that writes its rule. Do not edit it to pass.

import { describe, expect, it } from 'vitest';
import { ACCEL, BRAKE } from '../../src/shared/constants';
import type { TimetableEntry, TrainInput } from '../../src/shared/types';
import { createTrainAgent } from '../../src/train';

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
];

const firstTick: TrainInput = {
  now: 0,
  self: { id: 1, pos: { track: 'A', offset: 0 }, speed: 0, brokenDown: false },
  inbox: [],
  sightAhead: null,
};

describe('createTrainAgent', () => {
  it('returns an agent with decide', () => {
    expect(typeof createTrainAgent(1, timetable).decide).toBe('function');
  });

  it('returns a valid output', () => {
    const out = createTrainAgent(1, timetable).decide(firstTick);
    expect(out.accel).toBeGreaterThanOrEqual(-BRAKE);
    expect(out.accel).toBeLessThanOrEqual(ACCEL);
    expect(Array.isArray(out.outbox)).toBe(true);
    expect(['central', 'full', 'stale', 'blind']).toContain(out.mode);
  });

  it('builds a separate agent for each train', () => {
    expect(createTrainAgent(1, timetable)).not.toBe(createTrainAgent(2, timetable));
  });
});

describe('createTrainAgent placeholders (delete when the rules are written)', () => {
  it('holds its brakes on, sets nextTrack to null, sends nothing and reports blind', () => {
    expect(createTrainAgent(1, timetable).decide(firstTick)).toEqual({
      accel: -BRAKE,
      nextTrack: null,
      outbox: [],
      mode: 'blind',
    });
  });
});
