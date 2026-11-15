import { Engine, type RunResult } from '../engine/engine';
import { averageDelay, timeToNormal } from '../engine/metrics';
import type { TrainProgram } from '../engine/ports';
import type { Press } from '../engine/switches';
import { generateTimetable } from '../engine/timetable';
import { applyParams, resetParams, type SimParams } from '../shared/params';
import type { TimetableEntry } from '../shared/types';
import { describeCrossLines, describeLayout } from './report';
import { onLayout } from './run';

// Runs built from a parameter file (src/shared/params.ts). The file sets the layout, the cross
// links switch, the physics and timer values, the timetable, the starting switches, the
// failures and the run length.

/**
 * The timetable a parameter file asks for. The same seed and layout always give the same one.
 * The trains are spread over the entry tracks of the file's own layout, whatever layout is in
 * use when this is called, and the layout in use is left as it was. The cross links change
 * no timetable: every train still enters on its own line and is booked into its own pair.
 */
export function timetableFor(params: SimParams): TimetableEntry[] {
  const { seed, trains, minHeadway, dwell } = params.timetable;
  return onLayout(params.layout, () => generateTimetable(seed, { trains, minHeadway, dwell }));
}

/** The file's starting switches and failures as engine presses, in time order. */
export function pressesFromParams(params: SimParams): Press[] {
  const start: Press = { at: 0, set: { ...params.start } };
  const failures = params.failures.map(({ at, breakDown, ...set }): Press => ({
    at,
    set,
    ...(breakDown === undefined ? {} : { breakDown }),
  }));
  return [start, ...failures];
}

/** When the last scripted change happens, or null if nothing ever fails. */
export function lastFailureAt(params: SimParams): number | null {
  return params.failures.length === 0 ? null : Math.max(...params.failures.map((f) => f.at));
}

/**
 * An engine set up from a parameter file. This makes the file's layout, its cross links switch
 * and its physics and timer values the ones every part of the build reads, until resetParams()
 * or the next applyParams(). Call resetParams() when the engine is done with, or the file's
 * layout, switch and values stay in use for whatever runs next.
 */
export function engineFromParams(params: SimParams, program: TrainProgram): Engine {
  applyParams(params);
  return new Engine({
    timetable: timetableFor(params),
    program,
    seed: params.timetable.seed,
    runLength: params.runLength,
    presses: pressesFromParams(params),
  });
}

/**
 * One whole run from a parameter file, with no screen. Afterwards the constants and the
 * layout are back at their defaults and the cross links are off, even if the run throws, so
 * one file's layout or switch cannot leak into the next run.
 */
export function runParams(params: SimParams, program: TrainProgram): RunResult {
  try {
    const engine = engineFromParams(params, program);
    while (engine.now < params.runLength) {
      engine.step();
      if (engine.finished) break;
    }
    return engine.result();
  } finally {
    resetParams();
  }
}

export interface ProgramReport {
  result: RunResult;
  trains: number;
  /** Average seconds late per train against the reference. A train that never left counts at the run length. */
  delay: number;
  /** Seconds from the last scripted change until every later train was on time, or null if never. */
  timeToNormal: number | null;
}

export interface ParamsReport {
  params: SimParams;
  /** The baseline on the same timetable and physics with nothing failed. Both programs are scored against it. */
  reference: RunResult;
  ours: ProgramReport;
  baseline: ProgramReport;
}

/**
 * Run both programs from one parameter file and score each against the same reference:
 * the baseline with everything switched on and no failures.
 */
export function compareParams(params: SimParams, programs: { baseline: TrainProgram; ours: TrainProgram }): ParamsReport {
  const healthy: SimParams = {
    ...params,
    start: { centre: true, platformKeeper: true, junctionKeeper: true, sensors: true, radioDrop: 0 },
    failures: [],
  };
  const reference = runParams(healthy, programs.baseline);
  const failureEnd = lastFailureAt(params);
  const report = (program: TrainProgram): ProgramReport => {
    const result = runParams(params, program);
    return {
      result,
      trains: params.timetable.trains,
      delay: averageDelay(result, reference),
      timeToNormal: timeToNormal(result, reference, failureEnd),
    };
  };
  return { params, reference, ours: report(programs.ours), baseline: report(programs.baseline) };
}

/** A plain-text table for one report. */
export function formatParamsReport(r: ParamsReport): string {
  const head = ['program', 'through', 'avg delay per train', 'back to normal', 'collisions', 'overruns', 'close calls'];
  const widths = [9, 7, 19, 14, 10, 8, 11];
  const line = (cells: string[]) => `  ${cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')}`;
  const row = (label: string, p: ProgramReport) =>
    line([
      label,
      `${p.result.exits.size}/${p.trains}`,
      `${(p.delay / 60).toFixed(1)} min`,
      p.timeToNormal === null ? 'never' : `${p.timeToNormal.toFixed(0)} s`,
      String(p.result.collisions),
      String(p.result.overruns),
      String(p.result.closeCalls),
    ]);
  const t = r.params.timetable;
  const notes: string[] = [];
  if (r.reference.exits.size < t.trains) {
    notes.push(`  note: the healthy reference only got ${r.reference.exits.size} of ${t.trains} trains through in ${r.params.runLength} s, so delays are understated. Raise runLength.`);
  }
  return [
    `${r.params.name}`,
    `  ${describeLayout(r.params.layout)}`,
    ...(r.params.crossLines ? [`  ${describeCrossLines(r.params.layout)}`] : []),
    `  ${t.trains} trains, seed ${t.seed}, ${r.params.failures.length} failure event(s), run length ${r.params.runLength} s`,
    line(head),
    row('ours', r.ours),
    row('baseline', r.baseline),
    ...notes,
  ].join('\n');
}
