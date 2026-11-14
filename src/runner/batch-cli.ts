import { DEFAULT_TIMETABLE } from '../engine/timetable';
import { SCENARIOS } from '../scenarios/scenarios';
import { formatSummaries } from './report';
import { hasCollisions, runBatch } from './run';
import { baselineProgram, ourProgram } from './programs';

// Run with `npm run batch`. It runs every scenario over many seeds with no screen, prints
// one block per scenario, and exits non-zero if any run collided, in either program.
// Overruns are printed but do not fail the run. Design: "Scenarios and timings".
//
// `npm run batch -- 10` runs 10 seeds instead of 50, for a quicker check.

declare const process: { argv: string[]; exitCode?: number };

const asked = Number(process.argv[2]);
const SEEDS = Array.from({ length: Number.isInteger(asked) && asked > 0 ? asked : 50 }, (_, i) => i + 1);

const started = Date.now();
const summaries = Object.values(SCENARIOS).map((s) =>
  runBatch(s, SEEDS, { baseline: baselineProgram, ours: ourProgram }, DEFAULT_TIMETABLE),
);
const elapsed = (Date.now() - started) / 1000;

console.log(formatSummaries(summaries, elapsed));
process.exitCode = hasCollisions(summaries) ? 1 : 0;
