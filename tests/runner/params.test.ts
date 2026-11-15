/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest';
import type { TrainProgram } from '../../src/engine/ports';
import { baselineProgram } from '../../src/runner/programs';
import { stubBaseline, stubOurs } from '../../src/runner/stubs';
import { compareParams, engineFromParams, formatParamsReport, lastFailureAt, pressesFromParams, runParams, timetableFor } from '../../src/runner/params';
import { DEFAULT_CONSTANTS, MAX_SPEED, currentConstants } from '../../src/shared/constants';
import { LAYOUT, PLATFORMS, applyLayout, entryOf, isEntryTrack } from '../../src/shared/map';
import { parseParams, resetParams } from '../../src/shared/params';
import type { TimetableEntry } from '../../src/shared/types';

// Every example file in params/ must be a valid parameter file.
const files = import.meta.glob('../../params/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const file = (name: string) => parseParams(files[`../../params/${name}.json`]);

afterEach(() => resetParams());

describe('the example parameter files', () => {
  it('exist', () => {
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(5);
  });

  it.each(Object.keys(files))('%s is valid', (path) => {
    const params = parseParams(files[path]);
    expect(params.name.length).toBeGreaterThan(0);
    expect(params.runLength).toBeGreaterThan(0);
  });
});

describe('a run built from a parameter file', () => {
  it('uses the timetable the file asks for', () => {
    const tt = timetableFor(file('slow-heavy-trains'));
    expect(tt.length).toBe(8);
    expect(tt.every((e) => e.dwell === 45)).toBe(true);
    for (let i = 1; i < tt.length; i++) expect(tt[i]!.enterAt - tt[i - 1]!.enterAt).toBeGreaterThanOrEqual(90);
    expect(timetableFor(file('slow-heavy-trains'))).toEqual(tt);
  });

  it('turns the starting switches and the failures into presses in time order', () => {
    const params = parseParams({
      start: { junctionKeeper: false },
      failures: [
        { at: 200, breakDown: 3 },
        { at: 100, centre: false, radioDrop: 0.5 },
      ],
    });
    expect(pressesFromParams(params)).toEqual([
      { at: 0, set: { centre: true, platformKeeper: true, junctionKeeper: false, sensors: true, radioDrop: 0 } },
      { at: 100, set: { centre: false, radioDrop: 0.5 } },
      { at: 200, set: {}, breakDown: 3 },
    ]);
    expect(lastFailureAt(params)).toBe(200);
    expect(lastFailureAt(parseParams({}))).toBeNull();
  });

  it('starts with the switches the file sets', () => {
    const engine = engineFromParams(parseParams({ start: { sensors: false, radioDrop: 0.25 } }), baselineProgram);
    engine.step();
    expect(engine.snapshot().switches).toEqual({ centre: true, platformKeeper: true, junctionKeeper: true, sensors: false, radioDrop: 0.25 });
  });

  it('makes the engine use the physics in the file', () => {
    const params = file('slow-heavy-trains');
    const engine = engineFromParams(params, baselineProgram);
    expect(MAX_SPEED).toBe(30);
    let fastest = 0;
    while (engine.now < 600) {
      engine.step();
      for (const t of engine.snapshot().trains) fastest = Math.max(fastest, t.speed);
    }
    expect(fastest).toBeGreaterThan(20);
    expect(fastest).toBeLessThanOrEqual(30 + 1e-9);
  });

  it('puts the constants back after a whole run', () => {
    runParams(parseParams({ physics: { maxSpeed: 30 }, timetable: { trains: 2 }, runLength: 300 }), baselineProgram);
    expect(currentConstants()).toEqual(DEFAULT_CONSTANTS);
  });

  it('breaks down the train the file names', () => {
    const result = runParams(parseParams({ timetable: { trains: 4 }, failures: [{ at: 30, breakDown: 1 }], runLength: 1500 }), baselineProgram);
    expect(result.exits.has(1)).toBe(false);
    expect(result.collisions).toBe(0);
  });

  it('gets every baseline train through the slow, long-train file with no collision', () => {
    const params = file('slow-heavy-trains');
    const result = runParams({ ...params, failures: [] }, baselineProgram);
    expect(result.collisions).toBe(0);
    expect(result.overruns).toBe(0);
    expect(result.exits.size).toBe(params.timetable.trains);
  });
});

describe('comparing both programs from one file', () => {
  const params = parseParams({ timetable: { trains: 4 }, failures: [{ at: 120, centre: false }, { at: 240, centre: true }], runLength: 2400 });
  // The baseline stands in for both sides here. The real pair is tested in programs.test.ts.
  const report = compareParams(params, { baseline: baselineProgram, ours: baselineProgram });

  it('scores both against the baseline with nothing failed', () => {
    expect(report.reference.exits.size).toBe(4);
    expect(report.reference.collisions).toBe(0);
    expect(report.baseline.delay).toBeGreaterThan(0);
    expect(report.ours.delay).toBe(report.baseline.delay);
  });

  it('prints one row per program', () => {
    const text = formatParamsReport(report);
    expect(text).toContain('4 trains, seed 1, 2 failure event(s), run length 2400 s');
    expect(text).toMatch(/ours\s+4\/4/);
    expect(text).toMatch(/baseline\s+4\/4/);
  });

  it('warns when the reference run is too short to finish', () => {
    const short = compareParams({ ...params, runLength: 200 }, { baseline: baselineProgram, ours: baselineProgram });
    expect(formatParamsReport(short)).toContain('Raise runLength');
  });
});

// A parameter file can pick a layout: 'branch', 'junction' (the default), 'busy' or 'hub'.
// Design: "Layouts". These use the stub programs, so they check the runner and not the real
// train rules. The stubs have no locks, so nothing here counts collisions.
describe('a parameter file that picks a layout', () => {
  const stubs = { baseline: stubBaseline, ours: stubOurs };
  const busy = parseParams({ layout: 'busy', timetable: { seed: 1, trains: 16 }, failures: [{ at: 120, centre: false }, { at: 240, centre: true }], runLength: 3000 });

  /** A copy of a program that notes the layout in use and the timetable when its agents are built. */
  function recording(base: TrainProgram, seen: Array<{ layout: string; platforms: string[]; timetable: TimetableEntry[] }>): TrainProgram {
    return {
      ...base,
      agentFactory: (id, timetable) => {
        if (id === 1) seen.push({ layout: LAYOUT.id, platforms: [...PLATFORMS], timetable });
        return base.agentFactory(id, timetable);
      },
    };
  }

  it('has an example file for each layout that is not the default, each a 2 minute centre outage', () => {
    const outage = file('centre-outage');
    for (const layout of ['branch', 'busy', 'hub'] as const) {
      const params = file(`layout-${layout}`);
      expect(params.layout).toBe(layout);
      expect(params.failures).toEqual(outage.failures);
      expect(params.failures[1]!.at - params.failures[0]!.at).toBe(120);
      expect(params.timetable).toEqual(outage.timetable);
      expect(params.runLength).toBe(outage.runLength);
    }
  });

  it('leaves every other example file on the default layout', () => {
    for (const path of Object.keys(files)) {
      if (!path.includes('/layout-')) expect(parseParams(files[path]).layout).toBe('junction');
    }
  });

  it('runs a "busy" file on six platforms and three entry tracks, and is back on junction afterwards', () => {
    const seen: Array<{ layout: string; platforms: string[]; timetable: TimetableEntry[] }> = [];
    const result = runParams(busy, recording(stubBaseline, seen));
    expect(seen.length).toBe(1);
    expect(seen[0]!.layout).toBe('busy');
    expect(seen[0]!.platforms).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    expect([...new Set(seen[0]!.timetable.map((e) => e.entry))].sort()).toEqual(['A', 'B', 'C']);
    expect([...new Set(seen[0]!.timetable.map((e) => e.platform))].sort()).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    expect(result.exits.size).toBe(16);
    expect(LAYOUT.id).toBe('junction');
    expect(PLATFORMS).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('puts trains on entry track C of a "busy" file while the run is going', () => {
    const engine = engineFromParams(busy, stubBaseline);
    expect(LAYOUT.id).toBe('busy');
    const tracks = new Set<string>();
    while (engine.now < 900) {
      engine.step();
      for (const t of engine.snapshot().trains) if (isEntryTrack(t.pos.track)) tracks.add(t.pos.track);
    }
    expect([...tracks].sort()).toEqual(['A', 'B', 'C']);
    resetParams();
    expect(LAYOUT.id).toBe('junction');
  });

  it('is back on junction even when the run throws', () => {
    const broken: TrainProgram = {
      ...stubBaseline,
      agentFactory: () => {
        throw new Error('no agent');
      },
    };
    expect(() => runParams(busy, broken)).toThrow('no agent');
    expect(LAYOUT.id).toBe('junction');
    expect(currentConstants()).toEqual(DEFAULT_CONSTANTS);
  });

  it.each([
    ['branch', ['A'], 2],
    ['hub', ['A', 'B', 'C', 'D'], 8],
  ] as const)('runs a "%s" file on its own entry tracks and platforms', (layout, entries, platforms) => {
    const seen: Array<{ layout: string; platforms: string[]; timetable: TimetableEntry[] }> = [];
    const result = runParams({ ...busy, layout }, recording(stubBaseline, seen));
    expect(seen[0]!.layout).toBe(layout);
    expect(seen[0]!.platforms.length).toBe(platforms);
    expect([...new Set(seen[0]!.timetable.map((e) => e.entry))].sort()).toEqual([...entries]);
    expect(result.exits.size).toBe(16);
    expect(LAYOUT.id).toBe('junction');
  });

  it("works out the file's timetable on the file's own layout, whatever layout is in use", () => {
    const onDefault = timetableFor(busy);
    expect(onDefault.some((e) => e.entry === 'C')).toBe(true);
    for (const e of onDefault) expect(entryOf(e.platform)).toBe(e.entry);
    expect(LAYOUT.id).toBe('junction');

    applyLayout('hub');
    expect(timetableFor(busy)).toEqual(onDefault);
    expect(timetableFor(parseParams({ timetable: { trains: 12 } })).every((e) => e.entry === 'A' || e.entry === 'B')).toBe(true);
    expect(LAYOUT.id).toBe('hub');
  });

  it('compares both programs on the layout of the file and names it in the report', () => {
    const seen: Array<{ layout: string; platforms: string[]; timetable: TimetableEntry[] }> = [];
    const report = compareParams(busy, { baseline: recording(stubBaseline, seen), ours: recording(stubOurs, seen) });
    // The healthy reference, ours and the baseline all ran on the same layout and timetable.
    expect(seen.map((r) => r.layout)).toEqual(['busy', 'busy', 'busy']);
    expect(new Set(seen.map((r) => JSON.stringify(r.timetable))).size).toBe(1);
    expect(report.reference.exits.size).toBe(16);
    expect(report.baseline.delay).toBeGreaterThan(0);
    expect(LAYOUT.id).toBe('junction');

    const text = formatParamsReport(report);
    expect(text).toContain('layout busy: 3 entry lines, 6 platforms');
    expect(text).toMatch(/baseline\s+16\/16/);
  });

  it('names the default layout in the report of a file that picks none', () => {
    const plain = parseParams({ timetable: { trains: 2 }, runLength: 1200 });
    const report = compareParams(plain, stubs);
    expect(formatParamsReport(report)).toContain('layout junction: 2 entry lines, 4 platforms');
  });

  it('does not let one file\'s layout leak into the next file', () => {
    const hub = runParams({ ...busy, layout: 'hub' }, stubBaseline);
    const seen: Array<{ layout: string; platforms: string[]; timetable: TimetableEntry[] }> = [];
    runParams(parseParams({ timetable: { trains: 12 }, runLength: 3000 }), recording(stubBaseline, seen));
    expect(hub.exits.size).toBe(16);
    expect(seen[0]!.layout).toBe('junction');
    expect(seen[0]!.timetable.every((e) => e.entry === 'A' || e.entry === 'B')).toBe(true);
  });
});
