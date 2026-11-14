import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMETABLE, generateTimetable } from '../../src/engine/timetable';
import {
  FAILURE_AFTER_TRAIN,
  FAILURE_JITTER,
  FAILURE_LENGTH,
  failureWindow,
  pressesFor,
} from '../../src/runner/failure';
import { SCENARIOS } from '../../src/scenarios/scenarios';

const tt = generateTimetable(1, DEFAULT_TIMETABLE);

describe('failureWindow', () => {
  it('is the same for the same seed', () => {
    expect(failureWindow(SCENARIOS['centre-outage'], tt, 5)).toEqual(failureWindow(SCENARIOS['centre-outage'], tt, 5));
  });

  it('starts once train 8 has entered, within the jitter', () => {
    const anchor = tt[FAILURE_AFTER_TRAIN - 1].enterAt;
    for (let seed = 1; seed <= 30; seed++) {
      const { start } = failureWindow(SCENARIOS['centre-outage'], tt, seed);
      expect(start).toBeGreaterThanOrEqual(anchor);
      expect(start).toBeLessThan(anchor + FAILURE_JITTER);
    }
  });

  it('lasts FAILURE_LENGTH seconds', () => {
    const { start, end } = failureWindow(SCENARIOS['centre-outage'], tt, 3);
    expect(end - start).toBe(FAILURE_LENGTH);
  });

  it("lasts the scenario's own length when it gives one, as the long outage does", () => {
    const { start, end } = failureWindow(SCENARIOS['long-outage'], tt, 3);
    expect(end - start).toBe(1800);
  });

  it('starts at different moments for different seeds', () => {
    const starts = new Set(Array.from({ length: 10 }, (_, i) => failureWindow(SCENARIOS['centre-outage'], tt, i + 1).start));
    expect(starts.size).toBeGreaterThan(1);
  });

  it('uses the last train when the timetable is shorter than 8', () => {
    const short = generateTimetable(1, { ...DEFAULT_TIMETABLE, trains: 3 });
    expect(failureWindow(SCENARIOS['centre-outage'], short, 1).start).toBeGreaterThanOrEqual(short[2].enterAt);
  });

  it('throws for an empty timetable', () => {
    expect(() => failureWindow(SCENARIOS['centre-outage'], [], 1)).toThrow('at least one train');
  });
});

describe('pressesFor', () => {
  it('gives no presses for the healthy control', () => {
    expect(pressesFor(SCENARIOS.healthy, tt, 1)).toEqual([]);
  });

  it('cuts then restores the centre in the centre outage', () => {
    const { start, end } = failureWindow(SCENARIOS['centre-outage'], tt, 7);
    expect(pressesFor(SCENARIOS['centre-outage'], tt, 7)).toEqual([
      { at: start, set: { centre: false } },
      { at: end, set: { centre: true } },
    ]);
  });
});
