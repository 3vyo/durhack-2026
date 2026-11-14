// These tests pin PENDING_NUMBERS, the stand-in used until #34 adds the map and timing
// numbers to src/shared/. Delete them in the commit that switches the agent to #34's
// constants. Do not edit them to pass.

import { describe, expect, it } from 'vitest';
import { TICK } from '../../src/shared/constants';
import { PENDING_NUMBERS } from '../../src/train/numbers';

describe('PENDING_NUMBERS (delete when #34 merges)', () => {
  it('gives half a tick of slack to every timer', () => {
    expect(PENDING_NUMBERS.slack).toBe(TICK / 2);
  });

  it('leaves every design number unset as NaN', () => {
    const { slack: _slack, pairs: _pairs, xOf: _xOf, ...numbers } = PENDING_NUMBERS;
    for (const value of Object.values(numbers)) expect(value).toBeNaN();
  });

  it('gives each entry track no platforms', () => {
    expect(PENDING_NUMBERS.pairs).toEqual({ A: [], B: [] });
  });

  it('gives no x for any position', () => {
    expect(PENDING_NUMBERS.xOf({ track: 'A', offset: 100 })).toBeNaN();
  });
});
