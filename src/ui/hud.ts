import type { ScenarioSummary } from '../runner/run';
import { batchRunsText } from './controls';

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
  /** Present on the safety line only: true for a side with a collision or close call, which the page shows in red. */
  alert?: Pair<boolean>;
}

export interface ScoreboardInput {
  through: Pair<number>;
  /** Null means not known yet: no restore pressed, or a late train has not left. */
  timeToNormalSeconds: Pair<number | null>;
  collisions: Pair<number>;
  closeCalls: Pair<number>;
  /** The many-run averages, once the background batch has finished. */
  avg: ScenarioSummary | null;
  /**
   * True for a side whose time to normal is shown at the run length because a late train never
   * got back on time before the run ended. The screen then says so.
   */
  timeToNormalCapped: Pair<boolean>;
  /** Trains still on the line when the run ended, or null while the run is going. */
  stillOnLine: Pair<number> | null;
}

function minutes(seconds: number): string {
  return (seconds / 60).toFixed(1);
}

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One side's safety cell: "none" while everything is zero, otherwise each count that is not.
 * The many-run collisions are counted too once the batch has finished.
 */
function safetyText(collisions: number, closeCalls: number, batch: { collisions: number; runs: number } | null): string {
  const parts: string[] = [];
  if (collisions > 0) parts.push(counted(collisions, 'collision', 'collisions'));
  if (closeCalls > 0) parts.push(counted(closeCalls, 'close call', 'close calls'));
  if (batch && batch.collisions > 0) parts.push(`${counted(batch.collisions, 'collision', 'collisions')} in the ${batch.runs} runs`);
  return parts.length === 0 ? 'none' : parts.join(', ');
}

/**
 * The safety line. Collisions and close calls must stay at zero, so they share one line that
 * reads "none" and only spells out a count when something has gone wrong.
 */
function safetyRow(i: ScoreboardInput): Row {
  const side = (s: 'baseline' | 'ours') =>
    safetyText(i.collisions[s], i.closeCalls[s], i.avg ? { collisions: i.avg[s].collisions, runs: i.avg.seeds } : null);
  const baseline = side('baseline');
  const ours = side('ours');
  return {
    label: i.avg ? `Collisions and close calls, this run and ${i.avg.seeds} more` : 'Collisions and close calls',
    baseline,
    ours,
    alert: { baseline: baseline !== 'none', ours: ours !== 'none' },
  };
}

function normalText(seconds: number | null, capped: boolean): string {
  if (seconds === null) return 'not yet';
  return capped ? `${minutes(seconds)} (run ended, counted at run length)` : minutes(seconds);
}

/**
 * The scoreboard's lines, as text. It formats what it is given and works nothing out, so the
 * scoreboard cannot disagree with the engine's metrics. The delay per train is not here: the
 * big numbers at the top of the page already show it.
 */
export function scoreboardRows(i: ScoreboardInput): Row[] {
  const rows: Row[] = [
    { label: 'Trains through', baseline: String(i.through.baseline), ours: String(i.through.ours) },
    {
      label: 'Time to normal (min)',
      baseline: normalText(i.timeToNormalSeconds.baseline, i.timeToNormalCapped.baseline),
      ours: normalText(i.timeToNormalSeconds.ours, i.timeToNormalCapped.ours),
    },
  ];
  if (i.stillOnLine && (i.stillOnLine.baseline > 0 || i.stillOnLine.ours > 0)) {
    rows.push({
      label: 'Not finished at run end (counted at run length)',
      baseline: String(i.stillOnLine.baseline),
      ours: String(i.stillOnLine.ours),
    });
  }
  if (i.avg) {
    const stuck = (n: number): string => (n > 0 ? ` (${n} never recovered)` : '');
    // The batch runs a scripted failure, so the labels say which one. Live presses do not reach it.
    const runs = batchRunsText(i.avg);
    rows.push(
      {
        label: `Average delay per train (min), ${runs}`,
        baseline: minutes(i.avg.baseline.meanDelay),
        ours: minutes(i.avg.ours.meanDelay),
      },
      {
        label: `Average time to normal (min), same ${i.avg.seeds} runs`,
        baseline: minutes(i.avg.baseline.meanTimeToNormal) + stuck(i.avg.baseline.neverRecovered),
        ours: minutes(i.avg.ours.meanTimeToNormal) + stuck(i.avg.ours.neverRecovered),
      },
    );
  }
  rows.push(safetyRow(i));
  return rows;
}

/** One big number at the top of the page. */
export interface Tile {
  label: string;
  value: string;
  sub: string;
  tone: 'baseline' | 'ours' | 'neutral';
}

function trainsText(n: number, what: string): string {
  return `${n} train${n === 1 ? '' : 's'} ${what}`;
}

/**
 * The three big numbers: each side's average delay per train so far, and the delay saved. The
 * saving is never negative; until there is one it reads 0.0 and says so. Under each delay, how
 * many trains are stopped on that side right now.
 */
export function heroTiles(i: { delaySeconds: Pair<number>; stopped: Pair<number> }): Tile[] {
  const saved = i.delaySeconds.baseline - i.delaySeconds.ours;
  const stoppedText = (n: number) => (n === 0 ? 'every train is moving' : trainsText(n, 'stopped on the line'));
  return [
    { label: "Today's system", value: minutes(i.delaySeconds.baseline), sub: stoppedText(i.stopped.baseline), tone: 'baseline' },
    { label: 'Our fallback', value: minutes(i.delaySeconds.ours), sub: stoppedText(i.stopped.ours), tone: 'ours' },
    {
      label: 'Delay saved',
      value: minutes(Math.max(0, saved)),
      sub: saved > 0 ? 'same timetable, same failure' : 'no saving yet',
      tone: 'neutral',
    },
  ];
}
