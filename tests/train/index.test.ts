import { describe, expect, it } from 'vitest';
import { ACCEL, BRAKE, SIGHT_SPEED } from '../../src/shared/constants';
import type { TimetableEntry, TrainInput } from '../../src/shared/types';
import { createTrainAgent } from '../../src/train';

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
];

const firstTick: TrainInput = {
  now: 0,
  self: { id: 1, pos: { track: 'A', offset: 0 }, speed: SIGHT_SPEED, brokenDown: false },
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

  it('on its first tick a train with no leader speeds up, broadcasts its position and has no route yet', () => {
    expect(createTrainAgent(1, timetable).decide(firstTick)).toEqual({
      accel: ACCEL,
      nextTrack: null,
      outbox: [
        { msg: { type: 'position', from: 1, pos: { track: 'A', offset: 0 }, speed: SIGHT_SPEED, sentAt: 0 }, range: 'long' },
      ],
      mode: 'full',
    });
  });

  it('keeps each train to its own memory', () => {
    const one = createTrainAgent(1, timetable);
    const two = createTrainAgent(2, timetable);
    const nearEnd: TrainInput = { ...firstTick, self: { ...firstTick.self, pos: { track: 'A', offset: 5000 } } };
    one.decide({ ...nearEnd, inbox: [{ type: 'lockGrant', to: 1, resource: 'P1', follow: null }] });
    const other = two.decide({ ...nearEnd, self: { ...nearEnd.self, id: 2, pos: { track: 'B', offset: 5000 } } });
    expect(other.nextTrack).toBeNull();
    expect(one.decide(nearEnd).nextTrack).toBe('P1');
  });
});
