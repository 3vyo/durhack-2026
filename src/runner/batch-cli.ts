import { DEFAULT_TIMETABLE } from '../engine/timetable';
import { SCENARIOS } from '../scenarios/scenarios';
import { BATCH_USAGE, parseBatchArgs, type BatchArgs } from './batch-args';
import { describeCrossLines, describeLayout, formatSummaries } from './report';
import { hasCollisions, onCrossLines, onLayout, runBatch } from './run';
import { baselineProgram, ourProgram } from './programs';

// Run with `npm run batch`. It runs every scenario over many seeds with no screen, prints
// one block per scenario, and exits non-zero if any run collided, in either program.
// Overruns are printed but do not fail the run. Design: "Scenarios and timings".
//
// `npm run batch -- 10` runs 10 seeds instead of 50, for a quicker check.
// `npm run batch -- --layout=hub` runs the hub layout instead of the default, junction.
// `npm run batch -- 10 --layout=all` runs every layout in turn, each under its own heading.
// `npm run batch -- 10 --cross` runs with the cross links on. They are off without it.
// With more than one layout the command fails if any of them collided or could not run.

declare const process: { argv: string[]; exitCode?: number };

function main(args: BatchArgs): boolean {
  let ok = true;
  const crossLines = args.crossLines ?? false;
  for (const layout of args.layouts) {
    const started = Date.now();
    try {
      // onLayout puts the earlier layout back when this one is done, so each layout starts clean.
      // onCrossLines does the same for the cross links switch.
      const summaries = onLayout(layout, () =>
        onCrossLines(crossLines, () =>
          Object.values(SCENARIOS).map((s) =>
            runBatch(s, args.seeds, { baseline: baselineProgram, ours: ourProgram }, DEFAULT_TIMETABLE),
          ),
        ),
      );
      console.log(`${formatSummaries(summaries, (Date.now() - started) / 1000, layout, crossLines)}\n`);
      if (hasCollisions(summaries)) ok = false;
    } catch (e) {
      const heading = crossLines ? `${describeLayout(layout)}\n${describeCrossLines(layout)}` : describeLayout(layout);
      console.log(`${heading}\nFAIL: the batch could not run: ${e instanceof Error ? e.message : String(e)}\n`);
      ok = false;
    }
  }
  if (args.layouts.length > 1) {
    console.log(ok ? `OK: zero collisions on all ${args.layouts.length} layouts` : 'FAIL: at least one layout collided or could not run');
  }
  return ok;
}

let args: BatchArgs | null = null;
try {
  args = parseBatchArgs(process.argv.slice(2));
} catch (e) {
  console.log(`${e instanceof Error ? e.message : String(e)}\n${BATCH_USAGE}`);
}
process.exitCode = args !== null && main(args) ? 0 : 1;
