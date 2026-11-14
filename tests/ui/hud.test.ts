import { describe, expect, it } from 'vitest';
import type { ScenarioSummary, Stats } from '../../src/runner/run';
import { scoreboardRows, type Pair } from '../../src/ui/hud';

const pair = <T>(baseline: T, ours: T): Pair<T> => ({ baseline, ours });

const stats = (meanDelay: number): Stats => ({
  meanDelay,
  spreadDelay: 0,
  meanTimeToNormal: 0,
  collisions: 0,
  closeCalls: 0,
  overruns: 0,
});

const avg: ScenarioSummary = {
  scenario: 'centre-outage',
  seeds: 50,
  baseline: stats(624),
  ours: stats(6),
};

function rows(over: Partial<Parameters<typeof scoreboardRows>[number]> = {}) {
  return scoreboardRows({
    through: pair(7, 9),
    delaySeconds: pair(90, 0),
    timeToNormalSeconds: pair(null, 0),
    collisions: pair(0, 0),
    closeCalls: pair(1, 2),
    avg: null,
    ...over,
  });
}

const byLabel = (r: ReturnType<typeof rows>, label: string) => r.find((x) => x.label === label);

describe('scoreboardRows', () => {
  it('shows trains through for each side', () => {
    expect(byLabel(rows(), 'Trains through')).toEqual({ label: 'Trains through', baseline: '7', ours: '9' });
  });

  it('shows delay in minutes to one decimal place', () => {
    const delay = byLabel(rows(), 'Delay (min)')!;
    expect(delay.baseline).toBe('1.5');
    expect(delay.ours).toBe('0.0');
  });

  it('shows time to normal, and not yet while it is unknown', () => {
    const r = byLabel(rows({ timeToNormalSeconds: pair(null, 150) }), 'Time to normal (min)')!;
    expect(r.baseline).toBe('not yet');
    expect(r.ours).toBe('2.5');
  });

  it('shows collisions and close calls exactly as given', () => {
    const r = rows({ collisions: pair(2, 0), closeCalls: pair(5, 3) });
    expect(byLabel(r, 'Collisions')).toMatchObject({ baseline: '2', ours: '0' });
    expect(byLabel(r, 'Close calls')).toMatchObject({ baseline: '5', ours: '3' });
  });

  it('has no average row until the averages arrive', () => {
    expect(rows().some((x) => x.label.startsWith('Average'))).toBe(false);
  });

  it('adds an average row naming the number of runs once the averages arrive', () => {
    const r = rows({ avg });
    const row = r.find((x) => x.label.startsWith('Average'))!;
    expect(row.label).toBe('Average delay over 50 runs (min)');
    expect(row.baseline).toBe('10.4');
    expect(row.ours).toBe('0.1');
  });
});
