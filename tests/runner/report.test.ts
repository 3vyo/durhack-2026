import { describe, expect, it } from 'vitest';
import type { ScenarioSummary, Stats } from '../../src/runner/run';
import { describeLayout, formatSummaries } from '../../src/runner/report';

const base: Stats = {
  meanDelay: 600,
  spreadDelay: 60,
  meanTimeToNormal: 480,
  neverRecovered: 0,
  collisions: 0,
  closeCalls: 2,
  overruns: 0,
};
const ours: Stats = { ...base, meanDelay: 0, spreadDelay: 0, meanTimeToNormal: 0, closeCalls: 0 };
const summary: ScenarioSummary = { scenario: 'centre-outage', seeds: 50, baseline: base, ours };

describe('formatSummaries', () => {
  it('shows the scenario, the seed count and both programs in minutes', () => {
    const text = formatSummaries([summary], 12.3);
    expect(text).toContain('centre-outage');
    expect(text).toContain('50 seeds');
    expect(text).toMatch(/baseline\s+avg delay per train 10\.0 min/);
    expect(text).toMatch(/ours\s+avg delay per train 0\.0 min/);
    expect(text).toContain('time to normal 8.0 min');
  });

  it('shows collisions, close calls and overruns', () => {
    const text = formatSummaries([summary], 1);
    expect(text).toContain('close calls 2');
    expect(text).toContain('collisions 0');
    expect(text).toContain('overruns 0');
  });

  it('says how many seeds never recovered, and still shows the average of the rest', () => {
    const text = formatSummaries(
      [{ ...summary, baseline: { ...base, meanTimeToNormal: 480, neverRecovered: 3 } }],
      1,
    );
    expect(text).toContain('time to normal 8.0 min (3 of 50 never recovered)');
  });

  it('reports the elapsed time', () => {
    expect(formatSummaries([summary], 12.34)).toContain('elapsed 12.3 s');
  });

  it('ends with OK when nothing collided', () => {
    expect(formatSummaries([summary], 1)).toContain('OK: zero collisions');
  });

  it('ends with FAIL when anything collided', () => {
    const bad = { ...summary, ours: { ...ours, collisions: 3 } };
    const text = formatSummaries([bad], 1);
    expect(text).toContain('FAIL: collisions found');
    expect(text).not.toContain('OK: zero collisions');
  });
});

describe('the layout in a report', () => {
  it('describes each layout by its entry lines and platforms', () => {
    expect(describeLayout('branch')).toBe('layout branch: 1 entry line, 2 platforms');
    expect(describeLayout('junction')).toBe('layout junction: 2 entry lines, 4 platforms');
    expect(describeLayout('busy')).toBe('layout busy: 3 entry lines, 6 platforms');
    expect(describeLayout('hub')).toBe('layout hub: 4 entry lines, 8 platforms');
  });

  it('starts the batch text with the layout it ran on', () => {
    const text = formatSummaries([summary], 1, 'hub');
    expect(text.split('\n')[0]).toBe('layout hub: 4 entry lines, 8 platforms');
    expect(text).toContain('centre-outage (50 seeds)');
  });

  it('names no layout when it is not told one', () => {
    expect(formatSummaries([summary], 1)).not.toContain('layout');
  });
});
