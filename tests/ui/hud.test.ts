import { describe, expect, it } from 'vitest';
import type { ScenarioSummary, Stats } from '../../src/runner/run';
import { barShares, scoreBoard, type BoardInput, type Pair } from '../../src/ui/hud';

const pair = <T>(baseline: T, ours: T): Pair<T> => ({ baseline, ours });

const stats = (meanDelay: number): Stats => ({
  meanDelay,
  spreadDelay: 0,
  meanTimeToNormal: 0,
  neverRecovered: 0,
  collisions: 0,
  closeCalls: 0,
  overruns: 0,
});

const avg: ScenarioSummary = {
  scenario: 'centre-outage',
  seeds: 50,
  baseline: { ...stats(624), meanTimeToNormal: 300, neverRecovered: 2, collisions: 4 },
  ours: { ...stats(6), meanTimeToNormal: 0, collisions: 0 },
};

function board(over: Partial<BoardInput> = {}) {
  return scoreBoard({
    delaySeconds: pair(90, 0),
    through: pair(7, 9),
    timeToNormalSeconds: pair(null, 0),
    timeToNormalCapped: pair(false, false),
    stillOnLine: null,
    avg: null,
    ...over,
  });
}

const row = (b: ReturnType<typeof board>, label: string) => b.rows.find((x) => x.label === label);

describe('scoreBoard', () => {
  it('draws the delay per train for each side, in minutes, and the saving', () => {
    const b = board({ delaySeconds: pair(1308, 234) });
    expect(b.delay.values).toEqual(pair(1308, 234));
    expect(b.delay.text).toEqual(pair('21.8 min', '3.9 min'));
    expect(b.saved).toBe('17.9');
  });

  it('has no saving instead of a negative one', () => {
    expect(board({ delaySeconds: pair(30, 60) }).saved).toBeNull();
    expect(board({ delaySeconds: pair(0, 0) }).saved).toBeNull();
  });

  it('counts the trains out for each side', () => {
    expect(row(board(), 'Trains out')).toEqual({ label: 'Trains out', values: pair(7, 9), text: pair('7', '9') });
  });

  it('shows time to normal, with no bar and not yet while it is unknown', () => {
    const r = row(board({ timeToNormalSeconds: pair(null, 150) }), 'Time to normal')!;
    expect(r.values).toEqual(pair(null, 150));
    expect(r.text).toEqual(pair('not yet', '2.5 min'));
  });

  it('says never when a late train did not get back on time before the run ended', () => {
    const r = row(board({ timeToNormalSeconds: pair(300, 0), timeToNormalCapped: pair(true, false) }), 'Time to normal')!;
    expect(r.text).toEqual(pair('never', '0.0 min'));
    expect(r.values.baseline).toBe(300);
  });

  it('counts the trains that never left, only once the run has ended with some on the line', () => {
    expect(row(board({ stillOnLine: pair(2, 0) }), 'Never left')!.text).toEqual(pair('2', '0'));
    expect(row(board(), 'Never left')).toBeUndefined();
    expect(row(board({ stillOnLine: pair(0, 0) }), 'Never left')).toBeUndefined();
  });

  it('has no many-run section until the averages arrive', () => {
    expect(board().runs).toBeNull();
  });

  it('names the runs and their failure, and shows the average delay and time to normal', () => {
    const runs = board({ avg }).runs!;
    expect(runs.title).toBe('50 runs, 2 min centre outage');
    expect(runs.rows.map((r) => r.label)).toEqual(['Delay per train', 'Time to normal']);
    expect(runs.rows[0].text).toEqual(pair('10.4 min', '0.1 min'));
    expect(runs.rows[1].text).toEqual(pair('5.0 min (2 never)', '0.0 min'));
  });

  it('has no collision line', () => {
    expect(JSON.stringify(board({ avg }))).not.toMatch(/collision|close call/i);
  });
});

describe('barShares', () => {
  it('fills the track with the longer bar and scales the other to it', () => {
    expect(barShares(pair(90, 30))).toEqual(pair(1, 1 / 3));
  });

  it('draws nothing for a missing value or when both are zero', () => {
    expect(barShares(pair(null, 60))).toEqual(pair(0, 1));
    expect(barShares(pair(0, 0))).toEqual(pair(0, 0));
    expect(barShares(pair(null, null))).toEqual(pair(0, 0));
  });
});
