import type { ScenarioSummary } from '../runner/run';
import { batchRunsText } from './controls';

/** The same measurement for the baseline and for ours. */
export interface Pair<T> {
  baseline: T;
  ours: T;
}

/** One measurement drawn as two bars, today's system above ours. */
export interface BarRow {
  label: string;
  /** The bar lengths. The longer bar fills the track. Null draws no bar. */
  values: Pair<number | null>;
  /** The text at the end of each bar. */
  text: Pair<string>;
}

/** Everything on the score panel. */
export interface Board {
  /** Average delay per train so far, the biggest thing on the panel. */
  delay: BarRow;
  /** Minutes of delay saved per train, as text, or null while there is no saving. */
  saved: string | null;
  /** This run's other measurements. */
  rows: BarRow[];
  /** The many-run averages, once the background batch has finished. */
  runs: { title: string; rows: BarRow[] } | null;
}

export interface BoardInput {
  /** Average delay per train so far, in seconds. */
  delaySeconds: Pair<number>;
  through: Pair<number>;
  /** Null means not known yet: no restore pressed, or a late train has not left. */
  timeToNormalSeconds: Pair<number | null>;
  /**
   * True for a side whose time to normal is shown at the run length because a late train never
   * got back on time before the run ended. The panel then says "never".
   */
  timeToNormalCapped: Pair<boolean>;
  /** Trains still on the line when the run ended, or null while the run is going. */
  stillOnLine: Pair<number> | null;
  /** The many-run averages, once the background batch has finished. */
  avg: ScenarioSummary | null;
}

function minutes(seconds: number): string {
  return (seconds / 60).toFixed(1);
}

function both<T>(f: (side: 'baseline' | 'ours') => T): Pair<T> {
  return { baseline: f('baseline'), ours: f('ours') };
}

function minuteRow(label: string, seconds: Pair<number>, note: Pair<string> = { baseline: '', ours: '' }): BarRow {
  return { label, values: seconds, text: both((s) => `${minutes(seconds[s])} min${note[s]}`) };
}

function countRow(label: string, n: Pair<number>): BarRow {
  return { label, values: n, text: both((s) => String(n[s])) };
}

function timeToNormalRow(i: BoardInput): BarRow {
  return {
    label: 'Time to normal',
    values: i.timeToNormalSeconds,
    text: both((s) => {
      const seconds = i.timeToNormalSeconds[s];
      if (seconds === null) return 'not yet';
      return i.timeToNormalCapped[s] ? 'never' : `${minutes(seconds)} min`;
    }),
  };
}

/**
 * The score panel, as numbers and text. It formats what it is given and works nothing out, so
 * the panel cannot disagree with the engine's metrics. The saving is never negative. Collisions
 * are not shown: `npm run batch` fails if either program has one.
 */
export function scoreBoard(i: BoardInput): Board {
  const savedSeconds = i.delaySeconds.baseline - i.delaySeconds.ours;
  const rows = [countRow('Trains out', i.through), timeToNormalRow(i)];
  if (i.stillOnLine && (i.stillOnLine.baseline > 0 || i.stillOnLine.ours > 0)) {
    rows.push(countRow('Never left', i.stillOnLine));
  }
  let runs: Board['runs'] = null;
  if (i.avg) {
    const avg = i.avg;
    const stuck = both((s) => (avg[s].neverRecovered > 0 ? ` (${avg[s].neverRecovered} never)` : ''));
    runs = {
      // The batch runs a scripted failure, so the title says which one. Live presses do not reach it.
      title: batchRunsText(avg),
      rows: [
        minuteRow('Delay per train', both((s) => avg[s].meanDelay)),
        minuteRow('Time to normal', both((s) => avg[s].meanTimeToNormal), stuck),
      ],
    };
  }
  return {
    delay: minuteRow('Delay per train', i.delaySeconds),
    saved: savedSeconds > 0 ? minutes(savedSeconds) : null,
    rows,
    runs,
  };
}

/** How far along the track each bar reaches, from 0 to 1. The longer bar fills the track. */
export function barShares(values: Pair<number | null>): Pair<number> {
  const top = Math.max(values.baseline ?? 0, values.ours ?? 0);
  return both((s) => (top > 0 ? Math.max(0, values[s] ?? 0) / top : 0));
}
