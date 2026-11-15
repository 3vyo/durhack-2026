import { afterEach, describe, expect, it } from 'vitest';
import * as map from '../../src/shared/map';
import {
  ALL_ENTRIES,
  ALL_PLATFORMS,
  ASK_POINT,
  CROSS_LINES,
  LAYOUT_IDS,
  PLATFORMS,
  TRACK_LENGTH,
  applyCrossLines,
  applyLayout,
  crossPlatforms,
  entryOf,
  pairOf,
  platformReadings,
  resetLayout,
  successors,
} from '../../src/shared/map';
import type { LayoutId } from '../../src/shared/map';
import { DEFAULT_PARAMS, ParamsError, applyParams, parseParams, resetParams } from '../../src/shared/params';
import type { EntryId, PlatformId } from '../../src/shared/types';

// The cross links switch, from "Cross links" and "The parameter file" in docs/design.md. With
// it on, the end of an entry line also leads to the first platform of the next line down, if
// that line is in the layout. With it off, the map is what it was before the switch existed.

afterEach(() => resetParams());

function problemsOf(input: unknown): string[] {
  try {
    parseParams(input);
  } catch (e) {
    if (e instanceof ParamsError) return e.problems;
    throw e;
  }
  return [];
}

/** What each line's link reaches on each layout with the switch on. */
const LINKS: Record<LayoutId, Record<EntryId, PlatformId[]>> = {
  branch: { A: [], B: [], C: [], D: [] },
  junction: { A: ['P3'], B: [], C: [], D: [] },
  busy: { A: ['P3'], B: ['P5'], C: [], D: [] },
  hub: { A: ['P3'], B: ['P5'], C: ['P7'], D: [] },
};

describe('the cross links switch', () => {
  it('is off until something turns it on', () => {
    expect(CROSS_LINES).toBe(false);
    expect(map.CROSS_LINES).toBe(false);
  });

  it('shows its new value to a file that already imported it', () => {
    applyCrossLines(true);
    expect(CROSS_LINES).toBe(true);
    expect(map.CROSS_LINES).toBe(true);
    applyCrossLines(false);
    expect(CROSS_LINES).toBe(false);
  });

  it('is turned off by resetLayout', () => {
    applyLayout('hub');
    applyCrossLines(true);
    resetLayout();
    expect(CROSS_LINES).toBe(false);
    expect(map.LAYOUT.id).toBe('junction');
    expect(crossPlatforms('A')).toEqual([]);
    expect(successors('A')).toEqual(['P1', 'P2']);
  });

  it('is left alone by applyLayout, on or off', () => {
    applyCrossLines(true);
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      expect(CROSS_LINES).toBe(true);
    }
    applyCrossLines(false);
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      expect(CROSS_LINES).toBe(false);
    }
  });
});

describe('crossPlatforms', () => {
  it.each(LAYOUT_IDS)('is empty for every line on %s with the switch off', (id) => {
    applyLayout(id);
    for (const e of ALL_ENTRIES) expect(crossPlatforms(e)).toEqual([]);
  });

  it.each(LAYOUT_IDS)('is the first platform of the next line down on %s with the switch on', (id) => {
    applyLayout(id);
    applyCrossLines(true);
    for (const e of ALL_ENTRIES) expect(crossPlatforms(e)).toEqual(LINKS[id][e]);
  });

  it('sends A to P3, B to P5 and C to P7 when every line is in the layout', () => {
    applyLayout('hub');
    applyCrossLines(true);
    expect(crossPlatforms('A')).toEqual(['P3']);
    expect(crossPlatforms('B')).toEqual(['P5']);
    expect(crossPlatforms('C')).toEqual(['P7']);
  });

  it('gives the last line of a layout no link, because there is no line below it', () => {
    applyCrossLines(true);
    applyLayout('branch');
    expect(crossPlatforms('A')).toEqual([]);
    applyLayout('junction');
    expect(crossPlatforms('B')).toEqual([]);
    applyLayout('busy');
    expect(crossPlatforms('C')).toEqual([]);
    applyLayout('hub');
    expect(crossPlatforms('D')).toEqual([]);
  });

  it.each(LAYOUT_IDS)('only ever reaches a platform that is in the layout on %s', (id) => {
    applyLayout(id);
    applyCrossLines(true);
    for (const e of ALL_ENTRIES) {
      for (const p of crossPlatforms(e)) expect(PLATFORMS).toContain(p);
    }
  });

  it('is built in one direction only: no line reaches its own pair or the pair above it', () => {
    applyLayout('hub');
    applyCrossLines(true);
    for (const e of ALL_ENTRIES) {
      for (const p of crossPlatforms(e)) {
        expect(pairOf(e)).not.toContain(p);
        expect(ALL_ENTRIES.indexOf(entryOf(p))).toBe(ALL_ENTRIES.indexOf(e) + 1);
        expect(p).toBe(pairOf(entryOf(p))[0]);
      }
    }
  });

  it('follows the layout in use, read when it is called', () => {
    applyCrossLines(true);
    expect(crossPlatforms('B')).toEqual([]);
    applyLayout('busy');
    expect(crossPlatforms('B')).toEqual(['P5']);
    applyLayout('junction');
    expect(crossPlatforms('B')).toEqual([]);
  });

  it('returns a new array, so a caller cannot change the map', () => {
    applyCrossLines(true);
    crossPlatforms('A').push('P4');
    expect(crossPlatforms('A')).toEqual(['P3']);
  });
});

describe('successors with cross links', () => {
  it.each(LAYOUT_IDS)('is the own pair alone for every line on %s with the switch off', (id) => {
    applyLayout(id);
    for (const e of ALL_ENTRIES) expect(successors(e)).toEqual([...pairOf(e)]);
  });

  it.each(LAYOUT_IDS)('is the own pair followed by the cross platforms on %s with the switch on', (id) => {
    applyLayout(id);
    applyCrossLines(true);
    for (const e of ALL_ENTRIES) expect(successors(e)).toEqual([...pairOf(e), ...LINKS[id][e]]);
  });

  it('sends A to P1, P2 and then P3 on the default layout', () => {
    applyCrossLines(true);
    expect(successors('A')).toEqual(['P1', 'P2', 'P3']);
    expect(successors('B')).toEqual(['P3', 'P4']);
  });

  it('still sends every platform to EXIT and EXIT nowhere', () => {
    applyLayout('hub');
    applyCrossLines(true);
    for (const p of ALL_PLATFORMS) expect(successors(p)).toEqual(['EXIT']);
    expect(successors('EXIT')).toEqual([]);
  });

  it('returns a new array with the switch on too', () => {
    applyCrossLines(true);
    successors('A').push('P4');
    expect(successors('A')).toEqual(['P1', 'P2', 'P3']);
    expect(map.PLATFORM_PAIRS.A).toEqual(['P1', 'P2']);
  });
});

describe('what the switch leaves alone', () => {
  it('does not change who owns a platform, the platforms in use or the sensor readings', () => {
    const before = { platforms: [...PLATFORMS], readings: platformReadings(), pairs: ALL_ENTRIES.map((e) => [...pairOf(e)]) };
    applyCrossLines(true);
    expect([...PLATFORMS]).toEqual(before.platforms);
    expect(platformReadings()).toEqual(before.readings);
    expect(ALL_ENTRIES.map((e) => [...pairOf(e)])).toEqual(before.pairs);
    expect(entryOf('P3')).toBe('B');
    expect(entryOf('P5')).toBe('C');
    expect(entryOf('P7')).toBe('D');
  });
});

describe('crossLines in a parameter file', () => {
  it('is off when the file does not say', () => {
    expect(DEFAULT_PARAMS.crossLines).toBe(false);
    expect(parseParams({}).crossLines).toBe(false);
    expect(parseParams({ layout: 'hub' }).crossLines).toBe(false);
  });

  it('reads true and false', () => {
    expect(parseParams({ crossLines: true }).crossLines).toBe(true);
    expect(parseParams({ crossLines: false }).crossLines).toBe(false);
  });

  it('is a known key at the top of the file', () => {
    expect(problemsOf({ crossLines: true })).toEqual([]);
    expect(problemsOf({ crosslines: true })[0]).toContain('crosslines is not a known section');
    expect(problemsOf({ crosslines: true })[0]).toContain('crossLines');
  });

  it('must be a boolean', () => {
    for (const bad of ['yes', 1, null, {}, []]) {
      const problems = problemsOf({ crossLines: bad });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('crossLines must be a boolean');
    }
  });

  it('keeps the default when the value is wrong, and lists the other problems too', () => {
    const problems = problemsOf({ crossLines: 'on', timetable: { trains: 0 } });
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('crossLines must be a boolean, but is "on"');
    expect(problems.join('\n')).toContain('timetable.trains');
  });

  it('does not change the defaults', () => {
    parseParams({ crossLines: true });
    expect(DEFAULT_PARAMS.crossLines).toBe(false);
  });

  it('is accepted on a layout with one entry line, where it changes nothing', () => {
    const p = parseParams({ layout: 'branch', crossLines: true });
    expect(p.crossLines).toBe(true);
    applyParams(p);
    expect(CROSS_LINES).toBe(true);
    expect(crossPlatforms('A')).toEqual([]);
    expect(successors('A')).toEqual(['P1', 'P2']);
  });
});

describe('applying crossLines', () => {
  it('applyParams turns the switch on, after the layout', () => {
    applyParams(parseParams({ layout: 'busy', crossLines: true }));
    expect(CROSS_LINES).toBe(true);
    expect(map.LAYOUT.id).toBe('busy');
    expect(successors('A')).toEqual(['P1', 'P2', 'P3']);
    expect(successors('B')).toEqual(['P3', 'P4', 'P5']);
    expect(successors('C')).toEqual(['P5', 'P6']);
  });

  it('applyParams turns the switch off again for a file that leaves it out', () => {
    applyParams(parseParams({ crossLines: true }));
    applyParams(parseParams({ layout: 'hub' }));
    expect(CROSS_LINES).toBe(false);
    for (const e of ALL_ENTRIES) expect(successors(e)).toEqual([...pairOf(e)]);
  });

  it('resetParams turns the switch off and puts the default layout back', () => {
    applyParams(parseParams({ layout: 'hub', crossLines: true }));
    resetParams();
    expect(CROSS_LINES).toBe(false);
    expect(map.LAYOUT.id).toBe('junction');
    expect(successors('A')).toEqual(['P1', 'P2']);
  });

  it('leaves the default parameters with the map exactly as it starts', () => {
    applyParams(DEFAULT_PARAMS);
    expect(CROSS_LINES).toBe(false);
    for (const e of ALL_ENTRIES) expect(crossPlatforms(e)).toEqual([]);
  });
});

describe('the braking check with crossLines on', () => {
  // A train that can no longer stop before the end of its line must be past the ask point
  // already. So braking from top speed must fit between the ask point and the end of the line.
  const room = TRACK_LENGTH.A - ASK_POINT;

  it('has 1200 m between the ask point and the end of every entry line', () => {
    expect(room).toBe(1200);
    for (const e of ALL_ENTRIES) expect(TRACK_LENGTH[e] - ASK_POINT).toBe(room);
  });

  it('passes the design values: 45 m/s at 0.9 m/s2 stops in 1125 m', () => {
    const { maxSpeed, brake } = DEFAULT_PARAMS.physics;
    expect((maxSpeed * maxSpeed) / (2 * brake)).toBeLessThanOrEqual(room);
    expect(problemsOf({ crossLines: true })).toEqual([]);
  });

  it('lists a problem when the top speed is too high to stop in that room', () => {
    // 50 m/s at the default 0.9 m/s2 needs 1389 m.
    const problems = problemsOf({ crossLines: true, physics: { maxSpeed: 50 } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('crossLines');
    expect(problems[0]).toContain('physics.maxSpeed (50)');
    expect(problems[0]).toContain('1200 m');
    expect(problems[0]).toContain('1389 m');
  });

  it('lists a problem when the brake is too weak, using the default top speed', () => {
    // 45 m/s at 0.8 m/s2 needs 1266 m. sightSpeed is given so it is not the problem.
    const problems = problemsOf({ crossLines: true, physics: { brake: 0.8, sightSpeed: 15 } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('physics.brake (0.8)');
    expect(problems[0]).toContain('1266 m');
  });

  it('uses the values in the file together', () => {
    // 60 m/s at 1.5 m/s2 needs exactly 1200 m, which fits. At 1.4 m/s2 it needs 1286 m.
    expect(problemsOf({ crossLines: true, physics: { maxSpeed: 60, brake: 1.5, sightSpeed: 21 } })).toEqual([]);
    expect(problemsOf({ crossLines: true, physics: { maxSpeed: 60, brake: 1.4, sightSpeed: 21 } })).toHaveLength(1);
  });

  it('does not check a file with crossLines off or left out', () => {
    expect(problemsOf({ physics: { maxSpeed: 50 } })).toEqual([]);
    expect(problemsOf({ crossLines: false, physics: { maxSpeed: 50 } })).toEqual([]);
    expect(problemsOf({ crossLines: false, physics: { brake: 0.8, sightSpeed: 15 } })).toEqual([]);
  });

  it('checks every layout the same way, because every entry line is the same length', () => {
    for (const layout of LAYOUT_IDS) {
      expect(problemsOf({ layout, crossLines: true })).toEqual([]);
      expect(problemsOf({ layout, crossLines: true, physics: { maxSpeed: 50 } })).toHaveLength(1);
    }
  });

  it('adds no second problem when the brake is not a usable number', () => {
    const problems = problemsOf({ crossLines: true, physics: { brake: 0 } });
    expect(problems.some((p) => p.includes('physics.brake must be more than 0'))).toBe(true);
    expect(problems.some((p) => p.includes('crossLines'))).toBe(false);
  });
});
