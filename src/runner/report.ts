import { ALL_ENTRIES, LAYOUTS, pairOf, type LayoutId } from '../shared/map';
import { hasCollisions, type ScenarioSummary, type Stats } from './run';

/** One layout in words, for a printed report: "layout busy: 3 entry lines, 6 platforms". */
export function describeLayout(id: LayoutId): string {
  const { entries } = LAYOUTS[id];
  const platforms = entries.flatMap((e) => pairOf(e)).length;
  return `layout ${id}: ${entries.length} entry line${entries.length === 1 ? '' : 's'}, ${platforms} platforms`;
}

/**
 * The cross links of one layout in words, for a printed report of a run that had them on:
 * "cross links on: A also leads to P3, B to P5". Each entry line reaches the first platform
 * of the next line down, so the last line has none, and nor has a layout with one line. From
 * "Cross links" in docs/design.md. This reads the layout's own lines, not the switch in use,
 * so it can be printed after the run has put the switch back.
 */
export function describeCrossLines(id: LayoutId): string {
  const { entries } = LAYOUTS[id];
  const links: string[] = [];
  for (const entry of entries) {
    const next = ALL_ENTRIES[ALL_ENTRIES.indexOf(entry) + 1];
    if (next === undefined || !entries.includes(next)) continue;
    links.push(`${entry} ${links.length === 0 ? 'also leads to' : 'to'} ${pairOf(next)[0]}`);
  }
  if (links.length === 0) return 'cross links on: this layout has no line to cross to';
  return `cross links on: ${links.join(', ')}`;
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
 * ran on and the text starts by naming it. Say the batch ran with the cross links on and the
 * next line says so.
 */
export function formatSummaries(
  summaries: ScenarioSummary[],
  elapsedSeconds: number,
  layout?: LayoutId,
  crossLines = false,
): string {
  const lines: string[] = [];
  if (layout !== undefined) lines.push(describeLayout(layout));
  if (crossLines) lines.push(layout === undefined ? 'cross links on' : describeCrossLines(layout));
  for (const s of summaries) {
    lines.push(`${s.scenario} (${s.seeds} seeds)`);
    lines.push(line('baseline', s.baseline, s.seeds));
    lines.push(line('ours', s.ours, s.seeds));
  }
  lines.push(`elapsed ${elapsedSeconds.toFixed(1)} s`);
  lines.push(hasCollisions(summaries) ? 'FAIL: collisions found' : 'OK: zero collisions');
  return lines.join('\n');
}
