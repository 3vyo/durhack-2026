/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMETABLE } from '../../src/engine/timetable';
import { compareParams, engineFromParams, formatParamsReport, runParams, timetableFor } from '../../src/runner/params';
import { PROGRAMS } from '../../src/runner/programs';
import { stubBaseline, stubOurs } from '../../src/runner/stubs';
import { CROSS_LINES, LAYOUT, applyCrossLines, isPlatform } from '../../src/shared/map';
import { parseParams, resetParams } from '../../src/shared/params';
import type { PlatformId, TrainId } from '../../src/shared/types';
import { SHORT_TIMETABLE, newWatch, seedWithLineA, watched } from './cross-probe';

// A parameter file switches the cross links on with "crossLines": true. Design: "Cross links"
// and "The parameter file". The run has them on from start to end, the report says so, and the
// next run starts with them off. Most tests here use the stub programs, so they check the
// runner and not the real train rules.

const files = import.meta.glob('../../params/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

afterEach(() => resetParams());

const SEED = seedWithLineA();
const timetable = { seed: SEED, ...SHORT_TIMETABLE };
const crossed = parseParams({ name: 'crossed', crossLines: true, timetable, runLength: 900 });
const plain = parseParams({ name: 'plain', timetable, runLength: 900 });

describe('a run from a parameter file with the cross links on', () => {
  it('has them on from the first step to the last, as far as the engine, and off afterwards', () => {
    const watch = newWatch();
    const result = runParams(crossed, watched(stubOurs, watch, true));
    expect(watch.builds).toEqual([true]);
    expect([...watch.switches]).toEqual([true]);
    expect([...watch.links]).toEqual(['P3']);
    // The engine let line A trains onto P3, so it saw the switch on as well.
    expect(watch.crossed.size).toBeGreaterThan(0);
    expect(result.exits.size).toBe(SHORT_TIMETABLE.trains);
    expect(CROSS_LINES).toBe(false);
  });

  it('keeps them on in an engine built from the file, until resetParams', () => {
    const watch = newWatch();
    const engine = engineFromParams(crossed, watched(stubBaseline, watch));
    expect(CROSS_LINES).toBe(true);
    while (engine.now < 60) engine.step();
    expect([...watch.switches]).toEqual([true]);
    expect(CROSS_LINES).toBe(true);
    resetParams();
    expect(CROSS_LINES).toBe(false);
  });

  it('gives the same timetable as the same file with them off', () => {
    expect(timetableFor(crossed)).toEqual(timetableFor(plain));
    expect(CROSS_LINES).toBe(false);
  });

  it('runs the healthy reference and both programs with them on, and says so in the report', () => {
    const watch = newWatch();
    const report = compareParams(crossed, { baseline: watched(stubBaseline, watch), ours: watched(stubOurs, watch) });
    expect(watch.builds).toEqual([true, true, true]);
    expect([...watch.switches]).toEqual([true]);
    expect(CROSS_LINES).toBe(false);

    const lines = formatParamsReport(report).split('\n');
    expect(lines[0]).toBe('crossed');
    expect(lines[1]).toBe('  layout junction: 2 entry lines, 4 platforms');
    expect(lines[2]).toBe('  cross links on: A also leads to P3');
    expect(lines[3]).toContain(`${SHORT_TIMETABLE.trains} trains, seed ${SEED}`);
  });

  it('names the links of the layout the file picks', () => {
    const report = compareParams({ ...crossed, layout: 'hub' }, { baseline: stubBaseline, ours: stubOurs });
    expect(formatParamsReport(report)).toContain('  cross links on: A also leads to P3, B to P5, C to P7\n');
    expect(LAYOUT.id).toBe('junction');
  });

  it('does not let one file\'s switch leak into the next file', () => {
    runParams(crossed, stubBaseline);
    const watch = newWatch();
    runParams(plain, watched(stubOurs, watch, true));
    expect(watch.builds).toEqual([false]);
    expect([...watch.switches]).toEqual([false]);
    expect(watch.crossed.size).toBe(0);
  });
});

describe('a run from a parameter file that does not switch the cross links on', () => {
  it('has them off, and the report does not mention them', () => {
    const watch = newWatch();
    const report = compareParams(plain, { baseline: watched(stubBaseline, watch), ours: watched(stubOurs, watch) });
    expect(watch.builds).toEqual([false, false, false]);
    expect([...watch.switches]).toEqual([false]);
    expect([...watch.links]).toEqual(['']);
    const text = formatParamsReport(report);
    expect(text).not.toContain('cross');
    expect(text.split('\n')[2]).toContain(`${SHORT_TIMETABLE.trains} trains, seed ${SEED}`);
  });

  it('has them off even if they were on before the run, and off afterwards', () => {
    applyCrossLines(true);
    const watch = newWatch();
    runParams(plain, watched(stubOurs, watch, true));
    expect([...watch.switches]).toEqual([false]);
    expect(watch.crossed.size).toBe(0);
    expect(CROSS_LINES).toBe(false);
  });

  it('gives the same result as a file that says "crossLines": false', () => {
    const said = parseParams({ name: 'plain', crossLines: false, timetable, runLength: 900 });
    expect(said).toEqual(plain);
    expect(runParams(said, stubBaseline)).toEqual(runParams(plain, stubBaseline));
  });
});

// params/cross-lines-blocked-pair.json is the example for `npm run sim`: both of line A's
// platforms are blocked by broken-down trains while the centre stays on, which is when the
// centre has a reason to send a line A train across to P3.
describe('the example file cross-lines-blocked-pair', { timeout: 60_000 }, () => {
  const example = parseParams(files['../../params/cross-lines-blocked-pair.json']);
  /** When the file breaks down the train in P1, and the train in P2. */
  const P1 = { train: 5, at: 452 };
  const P2 = { train: 6, at: 545 };

  it('switches the cross links on, on the default layout with the standard timetable', () => {
    expect(example.crossLines).toBe(true);
    expect(example.layout).toBe('junction');
    expect(example.timetable).toEqual({ seed: 1, ...DEFAULT_TIMETABLE });
    expect(example.runLength).toBe(7200);
  });

  it('breaks down two trains and never switches off the centre or anything else', () => {
    expect(example.start).toEqual({ centre: true, platformKeeper: true, junctionKeeper: true, sensors: true, radioDrop: 0 });
    expect(example.failures).toEqual([
      { at: P1.at, breakDown: P1.train },
      { at: P2.at, breakDown: P2.train },
    ]);
  });

  // The real programs, stepped only as far as the second breakdown has settled.
  it.each(['baseline', 'ours'] as const)('breaks down the first train to stop in P1 and the first in P2 as they stand there, %s', (name) => {
    const engine = engineFromParams(example, PROGRAMS[name]);
    /** The first train seen standing still in each platform. */
    const firstToStop = new Map<PlatformId, TrainId>();
    /** Whether each of the two trains was standing in its platform at the step its breakdown came. */
    const standing = new Map<TrainId, boolean>();
    while (engine.now < P2.at + 15) {
      const before = engine.now;
      engine.step();
      for (const t of engine.snapshot().trains) {
        const track = t.pos.track;
        if (isPlatform(track) && t.speed === 0 && !firstToStop.has(track)) firstToStop.set(track, t.id);
        for (const { train, at } of [P1, P2]) {
          if (t.id === train && before < at && engine.now >= at) standing.set(train, isPlatform(track) && t.speed === 0);
        }
      }
    }
    expect(firstToStop.get('P1')).toBe(P1.train);
    expect(firstToStop.get('P2')).toBe(P2.train);
    expect(standing.get(P1.train)).toBe(true);
    expect(standing.get(P2.train)).toBe(true);

    const trains = engine.snapshot().trains;
    const inP1 = trains.find((t) => t.id === P1.train);
    const inP2 = trains.find((t) => t.id === P2.train);
    expect(inP1?.pos.track).toBe('P1');
    expect(inP1?.brokenDown).toBe(true);
    expect(inP1?.speed).toBe(0);
    expect(inP2?.pos.track).toBe('P2');
    expect(inP2?.brokenDown).toBe(true);
    expect(inP2?.speed).toBe(0);
    // Both stand short of offset 300, so neither is in the junction zone and the exit stays open.
    expect(inP1!.pos.offset).toBeLessThanOrEqual(300);
    expect(inP2!.pos.offset).toBeLessThanOrEqual(300);
    expect(engine.result().collisions).toBe(0);
  });
});
