import { describe, expect, it } from 'vitest';
import {
  JUNCTION_KEEPER_TIMEOUT,
  PERMIT_FRESH,
  PERMIT_INTERVAL,
  POSITION_INTERVAL,
  REQUEST_REPEAT,
  RESUME_SETTLE,
  SLOT_COUNT,
  SLOT_LENGTH,
  SLOT_WINDOW,
  PLATFORM_KEEPER_TIMEOUT,
  TICK,
} from '../../src/shared/constants';

// Each value is checked against the line in docs/design.md that states it.

describe('timers', () => {
  it('keeps a permit fresh for 5 seconds ("A permit is fresh for 5 seconds")', () => {
    expect(PERMIT_FRESH).toBe(5);
  });

  it('sends permits every second ("it sends each train a permit every second")', () => {
    expect(PERMIT_INTERVAL).toBe(1);
  });

  it('broadcasts positions every second ("a position message every second")', () => {
    expect(POSITION_INTERVAL).toBe(1);
  });

  it('repeats a lock request every 2 seconds ("repeats it every 2 seconds")', () => {
    expect(REQUEST_REPEAT).toBe(2);
  });

  it('waits 10 seconds for the junction keeper ("After 10 seconds without a reply")', () => {
    expect(JUNCTION_KEEPER_TIMEOUT).toBe(10);
  });

  it('uses 60 second slots, 4 of them, with a 15 second start window', () => {
    expect(SLOT_LENGTH).toBe(60);
    expect(SLOT_COUNT).toBe(4);
    expect(SLOT_WINDOW).toBe(15);
  });

  it('waits as long for the platform keeper as for the junction keeper before falling back', () => {
    expect(PLATFORM_KEEPER_TIMEOUT).toBe(10);
    expect(PLATFORM_KEEPER_TIMEOUT).toBe(JUNCTION_KEEPER_TIMEOUT);
  });

  it('settles for at least one request repeat plus two ticks after an actor comes back', () => {
    expect(RESUME_SETTLE).toBe(5);
    expect(RESUME_SETTLE).toBeGreaterThanOrEqual(REQUEST_REPEAT + 2 * TICK);
  });
});
