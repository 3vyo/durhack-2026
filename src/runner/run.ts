import { Engine, type RunResult } from '../engine/engine';
import { averageDelay, timeToNormal } from '../engine/metrics';
import type { TrainProgram } from '../engine/ports';
import { generateTimetable, runLengthFor, type TimetableOptions } from '../engine/timetable';
import { SCENARIOS, type Scenario, type ScenarioId } from '../scenarios/scenarios';
import { failureWindow, pressesFor } from './failure';

export interface RunOptions {
  seed: number;
  scenario: Scenario;
  program: TrainProgram;
  timetable: TimetableOptions;
  /** Seconds added after the last entry to get the run length. Defaults to runLengthFor's margin. */
  settle?: number;
}

/**
 * One headless run: the timetable and the failure presses come from the seed, the run length
 * from the timetable, and the engine is stepped until every train has left or time runs out.
 */
export function runScenario(o: RunOptions): RunResult {
  const timetable = generateTimetable(o.seed, o.timetable);
  const engine = new Engine({
    timetable,
    program: o.program,
    seed: o.seed,
    runLength: runLengthFor(timetable, o.settle),
    presses: pressesFor(o.scenario, timetable, o.seed),
  });
  const runLength = runLengthFor(timetable, o.settle);
  while (!engine.finished && engine.now < runLength) engine.step();
  return engine.result();
}

export interface Stats {
  meanDelay: number;
  /** Standard deviation of the delay across seeds. */
  spreadDelay: number;
  /**
   * Mean time to normal in seconds. A seed that never got back on time before the run ended is
   * counted at the run length (run length minus failure end), so one stuck seed does not hide
   * the other results. `neverRecovered` says how many seeds that was.
   */
  meanTimeToNormal: number;
  neverRecovered: number;
  collisions: number;
  closeCalls: number;
  overruns: number;
}

export interface ScenarioSummary {
  scenario: ScenarioId;
  seeds: number;
  baseline: Stats;
  ours: Stats;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Averages one program's runs over the seeds. `normals` is each seed's time to normal, or null if
 * it never recovered, and `caps` is what to count a null at: that seed's run length minus its
 * failure end.
 */
export function statsFor(
  runs: RunResult[],
  delays: number[],
  normals: Array<number | null>,
  caps: number[],
): Stats {
  const m = mean(delays);
  const variance = mean(delays.map((d) => (d - m) ** 2));
  return {
    meanDelay: m,
    spreadDelay: Math.sqrt(variance),
    meanTimeToNormal: mean(normals.map((n, i) => n ?? caps[i])),
    neverRecovered: normals.filter((n) => n === null).length,
    collisions: runs.reduce((a, r) => a + r.collisions, 0),
    closeCalls: runs.reduce((a, r) => a + r.closeCalls, 0),
    overruns: runs.reduce((a, r) => a + r.overruns, 0),
  };
}

/**
 * The reference every program is scored against: the baseline's healthy run of this seed.
 * It must finish. If it does not, every delay measured against it would be too small, so this
 * throws instead of returning a short run. The live page uses it too, so its numbers and the
 * batch numbers rest on the same checked run.
 */
export function healthyReference(
  seed: number,
  baseline: TrainProgram,
  tt: TimetableOptions,
  settle?: number,
): RunResult {
  const reference = runScenario({ seed, scenario: SCENARIOS.healthy, program: baseline, timetable: tt, settle });
  if (!reference.finished) {
    throw new Error(
      `healthy reference did not finish for seed ${seed}: raise the settle margin or lower the number of trains`,
    );
  }
  return reference;
}

/**
 * Runs both programs on every seed and scores each against one reference: the baseline's
 * healthy run of the same seed. Scoring ours against its own healthy run would hide the cost
 * of our locks when nothing has failed.
 */
export function runBatch(
  scenario: Scenario,
  seeds: number[],
  programs: { baseline: TrainProgram; ours: TrainProgram },
  tt: TimetableOptions,
  settle?: number,
): ScenarioSummary {
  if (seeds.length < 1) throw new Error('runBatch needs at least one seed');
  if (new Set(seeds).size !== seeds.length) throw new Error('runBatch was given a duplicate seed');

  const runs = { baseline: [] as RunResult[], ours: [] as RunResult[] };
  const delays = { baseline: [] as number[], ours: [] as number[] };
  const normals = { baseline: [] as Array<number | null>, ours: [] as Array<number | null> };
  const caps: number[] = [];

  for (const seed of seeds) {
    const reference = healthyReference(seed, programs.baseline, tt, settle);
    const timetable = generateTimetable(seed, tt);
    const failureEnd = scenario.failure ? failureWindow(timetable, seed).end : null;
    caps.push(failureEnd === null ? 0 : Math.max(0, runLengthFor(timetable, settle) - failureEnd));
    for (const side of ['baseline', 'ours'] as const) {
      const run = runScenario({ seed, scenario, program: programs[side], timetable: tt, settle });
      runs[side].push(run);
      delays[side].push(averageDelay(run, reference));
      normals[side].push(timeToNormal(run, reference, failureEnd));
    }
  }

  return {
    scenario: scenario.id,
    seeds: seeds.length,
    baseline: statsFor(runs.baseline, delays.baseline, normals.baseline, caps),
    ours: statsFor(runs.ours, delays.ours, normals.ours, caps),
  };
}

/** True if any run collided, in either program. A baseline collision is a bug in the rig. */
export function hasCollisions(summaries: ScenarioSummary[]): boolean {
  return summaries.some((s) => s.baseline.collisions > 0 || s.ours.collisions > 0);
}
