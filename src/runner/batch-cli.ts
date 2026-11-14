import { DEFAULT_TIMETABLE } from '../engine/timetable';
import { SCENARIOS } from '../scenarios/scenarios';
import { formatSummaries } from './report';
import { hasCollisions, runBatch } from './run';
import { baselineProgram, ourProgram } from './programs';

// Run with `npm run batch`. It runs the must-have scenarios over many seeds with no screen,
// prints one block per scenario, and exits non-zero if any run collided, in either program.
// Overruns are printed but do not fail the run.

declare const process: { exitCode?: number };

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

const started = Date.now();
const summaries = Object.values(SCENARIOS)
  .filter((s) => s.tier === 'must')
  .map((s) =>
    runBatch(s, SEEDS, { baseline: baselineProgram, ours: ourProgram }, DEFAULT_TIMETABLE),
  );
const elapsed = (Date.now() - started) / 1000;

console.log(formatSummaries(summaries, elapsed));
process.exitCode = hasCollisions(summaries) ? 1 : 0;
