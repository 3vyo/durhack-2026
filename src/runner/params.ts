import { Engine, type RunResult } from '../engine/engine';
import { timeToNormal, totalDelay } from '../engine/metrics';
import type { TrainProgram } from '../engine/ports';
import type { Press } from '../engine/switches';
import { generateTimetable } from '../engine/timetable';
import { applyParams, resetParams, type SimParams } from '../shared/params';
import type { TimetableEntry } from '../shared/types';

// Runs built from a parameter file (src/shared/params.ts). The file sets the physics and
// timer values, the timetable, the starting switches, the failures and the run length.

/** The timetable a parameter file asks for. The same seed always gives the same one. */
export function timetableFor(params: SimParams): TimetableEntry[] {
  const { seed, trains, headway, dwell } = params.timetable;
  return generateTimetable(seed, { trains, minHeadway: headway, dwell });
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
 * An engine set up from a parameter file. This makes the file's physics and timer values
 * the ones every part of the build reads, until resetParams() or the next applyParams().
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

/** One whole run from a parameter file, with no screen. Leaves the constants at their defaults. */
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
  /** Total seconds late against the reference. A train that never left counts at the run length. */
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
    start: { centre: true, station: true, merge: true, sensors: true, radioDrop: 0 },
    failures: [],
  };
  const reference = runParams(healthy, programs.baseline);
  const failureEnd = lastFailureAt(params);
  const report = (program: TrainProgram): ProgramReport => {
    const result = runParams(params, program);
    return {
      result,
      trains: params.timetable.trains,
      delay: totalDelay(result, reference),
      timeToNormal: timeToNormal(result, reference, failureEnd),
    };
  };
  return { params, reference, ours: report(programs.ours), baseline: report(programs.baseline) };
}

/** A plain-text table for one report. */
export function formatParamsReport(r: ParamsReport): string {
  const head = ['program', 'through', 'total delay', 'back to normal', 'collisions', 'overruns', 'close calls'];
  const widths = [9, 7, 12, 14, 10, 8, 11];
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
    `  ${t.trains} trains, seed ${t.seed}, ${r.params.failures.length} failure event(s), run length ${r.params.runLength} s`,
    line(head),
    row('ours', r.ours),
    row('baseline', r.baseline),
    ...notes,
  ].join('\n');
}
