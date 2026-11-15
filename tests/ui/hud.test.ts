import { describe, expect, it } from 'vitest';
import type { ScenarioSummary, Stats } from '../../src/runner/run';
import { heroTiles, scoreboardRows, type Pair } from '../../src/ui/hud';

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

function rows(over: Partial<Parameters<typeof scoreboardRows>[number]> = {}) {
  return scoreboardRows({
    through: pair(7, 9),
    timeToNormalSeconds: pair(null, 0),
    collisions: pair(0, 0),
    closeCalls: pair(0, 0),
    avg: null,
    timeToNormalCapped: pair(false, false),
    stillOnLine: null,
    ...over,
  });
}

const byLabel = (r: ReturnType<typeof rows>, label: string) => r.find((x) => x.label === label);

describe('scoreboardRows', () => {
  it('shows trains through for each side', () => {
    expect(byLabel(rows(), 'Trains through')).toEqual({ label: 'Trains through', baseline: '7', ours: '9' });
  });

  it('leaves the delay per train to the big numbers at the top of the page', () => {
    expect(rows().some((x) => x.label.startsWith('Delay per train'))).toBe(false);
  });

  it('shows time to normal, and not yet while it is unknown', () => {
    const r = byLabel(rows({ timeToNormalSeconds: pair(null, 150) }), 'Time to normal (min)')!;
    expect(r.baseline).toBe('not yet');
    expect(r.ours).toBe('2.5');
  });

  it('puts collisions and close calls on one safety line that reads none while both are zero', () => {
    const r = rows();
    expect(r.filter((x) => /collision|close call/i.test(x.label))).toHaveLength(1);
    expect(byLabel(r, 'Collisions and close calls')).toEqual({
      label: 'Collisions and close calls',
      baseline: 'none',
      ours: 'none',
      alert: { baseline: false, ours: false },
    });
  });

  it('spells out each count that is not zero on the safety line, and marks that side', () => {
    const r = byLabel(rows({ collisions: pair(2, 0), closeCalls: pair(1, 3) }), 'Collisions and close calls')!;
    expect(r.baseline).toBe('2 collisions, 1 close call');
    expect(r.ours).toBe('3 close calls');
    expect(r.alert).toEqual({ baseline: true, ours: true });
    const one = byLabel(rows({ collisions: pair(1, 0) }), 'Collisions and close calls')!;
    expect(one.baseline).toBe('1 collision');
    expect(one.ours).toBe('none');
    expect(one.alert).toEqual({ baseline: true, ours: false });
  });

  it('keeps the safety line last, under the averages', () => {
    const r = rows({ avg });
    expect(r[r.length - 1].label).toMatch(/^Collisions and close calls/);
  });

  it('has no average row until the averages arrive', () => {
    expect(rows().some((x) => x.label.startsWith('Average'))).toBe(false);
  });

  it('adds an average row naming the runs and their scripted failure once the averages arrive', () => {
    const r = rows({ avg });
    const row = r.find((x) => x.label.startsWith('Average'))!;
    expect(row.label).toBe('Average delay per train (min), 50 runs with a scripted 2 min centre outage');
    expect(row.baseline).toBe('10.4');
    expect(row.ours).toBe('0.1');
  });

  it('adds the average time to normal, counting stuck seeds, and counts the many-run collisions on the safety line', () => {
    const r = rows({ avg });
    const ttn = r.find((x) => x.label === 'Average time to normal (min), same 50 runs')!;
    expect(ttn.baseline).toBe('5.0 (2 never recovered)');
    expect(ttn.ours).toBe('0.0');
    expect(r.some((x) => x.label === 'Collisions, same 50 runs')).toBe(false);
    const safety = r.find((x) => x.label === 'Collisions and close calls, this run and 50 more')!;
    expect(safety.baseline).toBe('4 collisions in the 50 runs');
    expect(safety.ours).toBe('none');
    expect(safety.alert).toEqual({ baseline: true, ours: false });
  });

  it('says the run ended and the time is counted at the run length when a train never got back on time', () => {
    const r = rows({
      timeToNormalSeconds: pair(300, 0),
      timeToNormalCapped: pair(true, false),
    });
    const row = byLabel(r, 'Time to normal (min)')!;
    expect(row.baseline).toBe('5.0 (run ended, counted at run length)');
    expect(row.ours).toBe('0.0');
  });

  it('lists the trains still on the line at the end, which were counted at the run length', () => {
    const r = rows({ stillOnLine: pair(2, 0) });
    const row = r.find((x) => x.label === 'Not finished at run end (counted at run length)')!;
    expect(row).toMatchObject({ baseline: '2', ours: '0' });
  });

  it('has no unfinished row when the run is still going or every train finished', () => {
    const label = 'Not finished at run end (counted at run length)';
    expect(rows().some((x) => x.label === label)).toBe(false);
    expect(rows({ stillOnLine: pair(0, 0) }).some((x) => x.label === label)).toBe(false);
  });
});

describe('heroTiles', () => {
  const tiles = (b: number, o: number, stopped = { baseline: 0, ours: 0 }) =>
    heroTiles({ delaySeconds: { baseline: b, ours: o }, stopped });

  it('shows each side in minutes and the saving', () => {
    const t = tiles(1308, 234);
    expect(t.map((x) => x.value)).toEqual(['21.8', '3.9', '17.9']);
    expect(t.map((x) => x.tone)).toEqual(['baseline', 'ours', 'neutral']);
  });

  it('says there is no saving yet instead of showing a negative one', () => {
    const t = tiles(30, 60);
    expect(t[2].value).toBe('0.0');
    expect(t[2].sub).toBe('no saving yet');
    expect(tiles(0, 0)[2].sub).toBe('no saving yet');
  });

  it('says how many trains are stopped on each side', () => {
    const t = tiles(600, 0, { baseline: 9, ours: 0 });
    expect(t[0].sub).toBe('9 trains stopped on the line');
    expect(t[1].sub).toBe('every train is moving');
    expect(tiles(0, 0, { baseline: 1, ours: 0 })[0].sub).toBe('1 train stopped on the line');
  });
});
