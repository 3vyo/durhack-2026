/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest';
import { baselineProgram } from '../../src/runner/programs';
import { compareParams, engineFromParams, formatParamsReport, lastFailureAt, pressesFromParams, runParams, timetableFor } from '../../src/runner/params';
import { DEFAULT_CONSTANTS, MAX_SPEED, currentConstants } from '../../src/shared/constants';
import { parseParams, resetParams } from '../../src/shared/params';

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
