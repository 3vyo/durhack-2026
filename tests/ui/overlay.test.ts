import { describe, expect, it } from 'vitest';
import type { TrainView } from '../../src/engine/engine';
import { describeTrain } from '../../src/ui/overlay';

function view(over: Partial<TrainView> = {}): TrainView {
  return {
    id: 4,
    pos: { track: 'A', offset: 100 },
    x: 100,
    speed: 20,
    mode: 'central',
    leaderAge: null,
    permitAge: null,
    lastGrants: { platform: null, junction: false },
    ...over,
  };
}

describe('describeTrain', () => {
  it('starts with the mode', () => {
    expect(describeTrain(view())[0]).toBe('mode: central');
  });

  it('shows how old the leader report is, to one decimal place', () => {
    expect(describeTrain(view({ leaderAge: 8 }))).toContain('leader report 8.0 s old');
  });

  it('says no leader known when none has been heard', () => {
    expect(describeTrain(view({ leaderAge: null }))).toContain('no leader known');
  });

  it('shows how old the permit is, or that there is none', () => {
    expect(describeTrain(view({ permitAge: 2 }))).toContain('permit 2.0 s old');
    expect(describeTrain(view({ permitAge: null }))).toContain('no permit');
  });

  it('lists the last grants the train heard, platform first', () => {
    const v = view({ lastGrants: { platform: 'P2', junction: true } });
    expect(describeTrain(v)).toContain('last grant: P2, junction');
  });

  it('lists a platform grant on its own', () => {
    expect(describeTrain(view({ lastGrants: { platform: 'P3', junction: false } }))).toContain('last grant: P3');
  });

  it('says no grant heard, and never no lock, for a train that holds nothing it has heard of', () => {
    const lines = describeTrain(view());
    expect(lines).toContain('no grant heard');
    expect(lines.join(' ')).not.toContain('no lock');
  });

  it('ends with the reason when there is one', () => {
    const lines = describeTrain(view({ reason: 'braking: leader report 8 s old' }));
    expect(lines[lines.length - 1]).toBe('braking: leader report 8 s old');
  });

  it('adds no extra line when there is no reason, so the mode is not repeated', () => {
    const lines = describeTrain(view());
    expect(lines.filter((l) => l.startsWith('mode:'))).toHaveLength(1);
    expect(lines).toHaveLength(4);
  });
});
