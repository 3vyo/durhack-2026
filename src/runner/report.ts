import { hasCollisions, type ScenarioSummary, type Stats } from './run';

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
 * The text the batch command prints: one block per scenario, the elapsed time, and a last
 * line that says whether the zero-collision gate held.
 */
export function formatSummaries(summaries: ScenarioSummary[], elapsedSeconds: number): string {
  const lines: string[] = [];
  for (const s of summaries) {
    lines.push(`${s.scenario} (${s.seeds} seeds)`);
    lines.push(line('baseline', s.baseline, s.seeds));
    lines.push(line('ours', s.ours, s.seeds));
  }
  lines.push(`elapsed ${elapsedSeconds.toFixed(1)} s`);
  lines.push(hasCollisions(summaries) ? 'FAIL: collisions found' : 'OK: zero collisions');
  return lines.join('\n');
}
