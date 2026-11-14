import { Engine, type RunResult } from '../engine/engine';
import { timeToNormal, totalDelay } from '../engine/metrics';
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
  while (!engine.result().finished && engine.now < engine.result().runLength) engine.step();
  return engine.result();
}

export interface Stats {
  meanDelay: number;
  /** Standard deviation of the delay across seeds. */
  spreadDelay: number;
  /** Mean time to normal in seconds, or null if any seed never got back on time. */
  meanTimeToNormal: number | null;
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

function statsFor(runs: RunResult[], delays: number[], normals: Array<number | null>): Stats {
  const m = mean(delays);
  const variance = mean(delays.map((d) => (d - m) ** 2));
  const known = normals.filter((n): n is number => n !== null);
  return {
    meanDelay: m,
    spreadDelay: Math.sqrt(variance),
    meanTimeToNormal: known.length === normals.length ? mean(known) : null,
    collisions: runs.reduce((a, r) => a + r.collisions, 0),
    closeCalls: runs.reduce((a, r) => a + r.closeCalls, 0),
    overruns: runs.reduce((a, r) => a + r.overruns, 0),
  };
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

  for (const seed of seeds) {
    const reference = runScenario({ seed, scenario: SCENARIOS.healthy, program: programs.baseline, timetable: tt, settle });
    if (!reference.finished) {
      throw new Error(
        `healthy reference did not finish for seed ${seed}: raise the settle margin or lower the number of trains`,
      );
    }
    const failureEnd = scenario.failure ? failureWindow(generateTimetable(seed, tt), seed).end : null;
    for (const side of ['baseline', 'ours'] as const) {
      const run = runScenario({ seed, scenario, program: programs[side], timetable: tt, settle });
      runs[side].push(run);
      delays[side].push(totalDelay(run, reference));
      normals[side].push(timeToNormal(run, reference, failureEnd));
    }
  }

  return {
    scenario: scenario.id,
    seeds: seeds.length,
    baseline: statsFor(runs.baseline, delays.baseline, normals.baseline),
    ours: statsFor(runs.ours, delays.ours, normals.ours),
  };
}

/** True if any run collided, in either program. A baseline collision is a bug in the rig. */
export function hasCollisions(summaries: ScenarioSummary[]): boolean {
  return summaries.some((s) => s.baseline.collisions > 0 || s.ours.collisions > 0);
}
