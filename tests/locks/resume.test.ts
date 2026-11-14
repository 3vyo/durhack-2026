// Placeholder tests: each test named "placeholder ..." checks a placeholder's safe value.
// Delete it in the commit that fills its rule. Do not edit it to pass. Turn each it.todo
// into a real test when you write its rule.

import { describe, expect, it } from 'vitest';
import { stillSettling, wasSwitchedOff } from '../../src/locks/resume';

// A test value for the input that waits on RESUME_SETTLE from pull request #34.
const settle = 1;

describe('resume frame', () => {
  it('placeholder wasSwitchedOff always says the actor was off', () => {
    expect(wasSwitchedOff(10, 10.1)).toBe(true);
  });

  it('placeholder stillSettling always says the actor is settling', () => {
    expect(stillSettling(null, 100, settle)).toBe(true);
  });
});

describe('Switched back on: noticing the gap (rule from the review on #31)', () => {
  it.todo('wasSwitchedOff says no on the first step, when lastStepAt is null');
  it.todo('wasSwitchedOff says no when now is one TICK after lastStepAt');
  it.todo('wasSwitchedOff says yes when now is more than one TICK after lastStepAt');
});

describe('Switched back on: the settle window (rule from the review on #31)', () => {
  it.todo('stillSettling says no when resumedAt is null');
  it.todo('stillSettling says yes from resumedAt until resumedAt + settle');
  it.todo('stillSettling says no from resumedAt + settle on');
});
