import { describe, expect, it } from 'vitest';
import { longerThan, stillSettling, wasSwitchedOff } from '../../src/locks/resume';
import { RESUME_SETTLE, TICK } from '../../src/shared/constants';

/** The time after this many ticks, built by adding TICK as the engine builds it. */
function after(ticks: number, from = 0): number {
  let now = from;
  for (let i = 0; i < ticks; i++) now += TICK;
  return now;
}

describe('Switched back on: noticing the gap (rule from the review on #31)', () => {
  // Reworded. The frame said "wasSwitchedOff says no on the first step, when lastStepAt
  // is null". The team decided a first step later than time 0 is a resume: the actor was
  // switched off at the start of the run and has only now been turned on.
  it('wasSwitchedOff says no on the first step, when lastStepAt is null and the run has just started', () => {
    expect(wasSwitchedOff(null, 0)).toBe(false);
    expect(wasSwitchedOff(null, TICK)).toBe(false);
  });

  it('wasSwitchedOff says yes on the first step when now is already two or more TICKs into the run', () => {
    expect(wasSwitchedOff(null, 2 * TICK)).toBe(true);
    expect(wasSwitchedOff(null, 30)).toBe(true);
  });

  it('wasSwitchedOff says no when now is one TICK after lastStepAt, even with floating-point rounding', () => {
    for (let ticks = 0; ticks < 5000; ticks++) {
      const last = after(ticks);
      if (wasSwitchedOff(last, last + TICK)) throw new Error(`off at tick ${ticks}`);
    }
    expect(wasSwitchedOff(10, 10.1)).toBe(false);
    expect(wasSwitchedOff(0.1 + 0.2, 0.4)).toBe(false);
  });

  it('wasSwitchedOff says yes when now is two or more TICKs after lastStepAt', () => {
    expect(wasSwitchedOff(10, 10 + 2 * TICK)).toBe(true);
    expect(wasSwitchedOff(after(100), after(102))).toBe(true);
    expect(wasSwitchedOff(10, 70)).toBe(true);
  });
});

describe('Switched back on: the settle window (rule from the review on #31)', () => {
  it('stillSettling says no when resumedAt is null', () => {
    expect(stillSettling(null, 0, RESUME_SETTLE)).toBe(false);
    expect(stillSettling(null, 100, RESUME_SETTLE)).toBe(false);
  });

  it('stillSettling says yes from resumedAt until resumedAt + settle', () => {
    expect(stillSettling(50, 50, RESUME_SETTLE)).toBe(true);
    expect(stillSettling(50, 50 + RESUME_SETTLE / 2, RESUME_SETTLE)).toBe(true);
    expect(stillSettling(50, 50 + RESUME_SETTLE - TICK, RESUME_SETTLE)).toBe(true);
  });

  it('stillSettling says no from resumedAt + settle on', () => {
    expect(stillSettling(50, 50 + RESUME_SETTLE, RESUME_SETTLE)).toBe(false);
    expect(stillSettling(50, 50 + RESUME_SETTLE + TICK, RESUME_SETTLE)).toBe(false);
    expect(stillSettling(50, 1000, RESUME_SETTLE)).toBe(false);
  });

  it('stillSettling ends on the same tick whichever way the float rounds', () => {
    const ticks = Math.round(RESUME_SETTLE / TICK);
    for (const start of [0, 3, 17.3, 123.4]) {
      const resumedAt = after(7, start);
      expect(stillSettling(resumedAt, after(ticks - 1, resumedAt), RESUME_SETTLE)).toBe(true);
      expect(stillSettling(resumedAt, after(ticks, resumedAt), RESUME_SETTLE)).toBe(false);
    }
  });
});

describe('Timers with float time', () => {
  it('longerThan says no at the limit and yes one tick past it, whichever way the float rounds', () => {
    for (const start of [0, 3, 17.3, 123.4]) {
      expect(longerThan(after(22, start) - start, 2.2)).toBe(false);
      expect(longerThan(after(23, start) - start, 2.2)).toBe(true);
    }
  });
});
