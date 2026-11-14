import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../src/scenarios/scenarios';

describe('SCENARIOS', () => {
  it('has no failure in the healthy control', () => {
    expect(SCENARIOS.healthy.failure).toBeNull();
  });

  it('cuts only the control centre in the centre outage', () => {
    expect(SCENARIOS['centre-outage'].failure).toEqual({
      set: { centre: false },
      restore: { centre: true },
    });
  });

  it('cuts the centre and both local actors in the talking blackout, leaving the radio', () => {
    const f = SCENARIOS['blackout-talking'].failure!;
    expect(f.set).toEqual({ centre: false, platformKeeper: false, junctionKeeper: false });
    expect(f.restore).toEqual({ centre: true, platformKeeper: true, junctionKeeper: true });
  });

  it('also silences the radio in the silent blackout and restores it', () => {
    const f = SCENARIOS['blackout-silent'].failure!;
    expect(f.set.radioDrop).toBe(1);
    expect(f.restore.radioDrop).toBe(0);
    expect(f.set.centre).toBe(false);
  });

  it('turns only the junction keeper off in the local fault', () => {
    expect(SCENARIOS['local-fault'].failure).toEqual({
      set: { junctionKeeper: false },
      restore: { junctionKeeper: true },
    });
  });

  it('tiers the scenarios must, should and could', () => {
    expect(SCENARIOS.healthy.tier).toBe('must');
    expect(SCENARIOS['centre-outage'].tier).toBe('must');
    expect(SCENARIOS['blackout-talking'].tier).toBe('should');
    expect(SCENARIOS['local-fault'].tier).toBe('should');
    expect(SCENARIOS['blackout-silent'].tier).toBe('could');
  });

  it('gives every scenario its own id as its key', () => {
    for (const [key, s] of Object.entries(SCENARIOS)) expect(s.id).toBe(key);
  });
});
