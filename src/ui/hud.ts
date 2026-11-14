import type { ScenarioSummary } from '../runner/run';

/** The same measurement for the baseline and for ours. */
export interface Pair<T> {
  baseline: T;
  ours: T;
}

/** One line of the scoreboard, as text for each side. */
export interface Row {
  label: string;
  baseline: string;
  ours: string;
}

export interface ScoreboardInput {
  through: Pair<number>;
  delaySeconds: Pair<number>;
  /** Null means not known yet: no restore pressed, or a late train has not left. */
  timeToNormalSeconds: Pair<number | null>;
  collisions: Pair<number>;
  closeCalls: Pair<number>;
  /** The many-run averages, once the background batch has finished. */
  avg: ScenarioSummary | null;
}

function minutes(seconds: number): string {
  return (seconds / 60).toFixed(1);
}

/**
 * The numbers under the two scenes, as text. It formats what it is given and works nothing
 * out, so the scoreboard cannot disagree with the engine's metrics.
 */
export function scoreboardRows(i: ScoreboardInput): Row[] {
  const rows: Row[] = [
    { label: 'Trains through', baseline: String(i.through.baseline), ours: String(i.through.ours) },
    {
      label: 'Delay (min)',
      baseline: minutes(i.delaySeconds.baseline),
      ours: minutes(i.delaySeconds.ours),
    },
    {
      label: 'Time to normal (min)',
      baseline: i.timeToNormalSeconds.baseline === null ? 'not yet' : minutes(i.timeToNormalSeconds.baseline),
      ours: i.timeToNormalSeconds.ours === null ? 'not yet' : minutes(i.timeToNormalSeconds.ours),
    },
    { label: 'Collisions', baseline: String(i.collisions.baseline), ours: String(i.collisions.ours) },
    { label: 'Close calls', baseline: String(i.closeCalls.baseline), ours: String(i.closeCalls.ours) },
  ];
  if (i.avg) {
    rows.push({
      label: `Average delay over ${i.avg.seeds} runs (min)`,
      baseline: minutes(i.avg.baseline.meanDelay),
      ours: minutes(i.avg.ours.meanDelay),
    });
  }
  return rows;
}
