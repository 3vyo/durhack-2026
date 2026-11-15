import { LAYOUTS, pairOf, type LayoutId } from '../shared/map';
import { hasCollisions, type ScenarioSummary, type Stats } from './run';

/** One layout in words, for a printed report: "layout busy: 3 entry lines, 6 platforms". */
export function describeLayout(id: LayoutId): string {
  const { entries } = LAYOUTS[id];
  const platforms = entries.flatMap((e) => pairOf(e)).length;
  return `layout ${id}: ${entries.length} entry line${entries.length === 1 ? '' : 's'}, ${platforms} platforms`;
}

function minutes(seconds: number): string {
  return (seconds / 60).toFixed(1);
}

function line(name: string, s: Stats, seeds: number): string {
  const stuck = s.neverRecovered > 0 ? ` (${s.neverRecovered} of ${seeds} never recovered)` : '';
  const normal = `${minutes(s.meanTimeToNormal)} min${stuck}`;
  return (
    `  ${name.padEnd(9)}` +
    `avg delay per train ${minutes(s.meanDelay)} min (spread ${minutes(s.spreadDelay)})  ` +
    `time to normal ${normal}  ` +
    `collisions ${s.collisions}  close calls ${s.closeCalls}  overruns ${s.overruns}`
  );
}

/**
 * The text the batch command prints for one layout: one block per scenario, the elapsed time,
 * and a last line that says whether the zero-collision gate held. Give the layout the batch
 * ran on and the text starts by naming it.
 */
export function formatSummaries(summaries: ScenarioSummary[], elapsedSeconds: number, layout?: LayoutId): string {
  const lines: string[] = [];
  if (layout !== undefined) lines.push(describeLayout(layout));
  for (const s of summaries) {
    lines.push(`${s.scenario} (${s.seeds} seeds)`);
    lines.push(line('baseline', s.baseline, s.seeds));
    lines.push(line('ours', s.ours, s.seeds));
  }
  lines.push(`elapsed ${elapsedSeconds.toFixed(1)} s`);
  lines.push(hasCollisions(summaries) ? 'FAIL: collisions found' : 'OK: zero collisions');
  return lines.join('\n');
}
