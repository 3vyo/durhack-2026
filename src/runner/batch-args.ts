import { DEFAULT_LAYOUT, LAYOUT_IDS, isLayoutId, type LayoutId } from '../shared/map';

// The arguments of `npm run batch`, kept apart from batch-cli.ts so they can be tested
// without starting a batch.

/** How many seeds the batch runs unless it is told otherwise. */
export const DEFAULT_SEED_COUNT = 50;

export const BATCH_USAGE =
  `Usage: npm run batch -- [number of seeds] [--layout=<${LAYOUT_IDS.join('|')}|all>] [--cross]\n` +
  `With no arguments it runs ${DEFAULT_SEED_COUNT} seeds on the ${DEFAULT_LAYOUT} layout, with the cross links off.`;

export interface BatchArgs {
  /** The seeds to run: 1 up to the number asked for. */
  seeds: number[];
  /** The layouts to run, in order. `--layout=all` gives every layout, simplest first. */
  layouts: LayoutId[];
  /** True if `--cross` was given: run with the cross links on. Absent means off. */
  crossLines?: boolean;
}

/**
 * Reads the batch command's arguments. A whole number is the number of seeds, and
 * `--layout=<id>` or `--layout=all` picks the layouts. `--cross` switches the cross links on.
 * Anything else throws, so a mistyped layout stops the command instead of quietly running the
 * default one.
 */
export function parseBatchArgs(args: string[]): BatchArgs {
  let count = DEFAULT_SEED_COUNT;
  let layouts: LayoutId[] = [DEFAULT_LAYOUT];
  let crossLines = false;
  for (const arg of args) {
    if (arg === '--cross') {
      crossLines = true;
    } else if (arg.startsWith('--layout=')) {
      const value = arg.slice('--layout='.length);
      if (value === 'all') layouts = [...LAYOUT_IDS];
      else if (isLayoutId(value)) layouts = [value];
      else throw new Error(`unknown layout "${value}": it must be one of ${LAYOUT_IDS.join(', ')}, or all`);
    } else if (/^[0-9]+$/.test(arg) && Number(arg) > 0) {
      count = Number(arg);
    } else {
      throw new Error(`cannot read the argument "${arg}"`);
    }
  }
  return { seeds: Array.from({ length: count }, (_, i) => i + 1), layouts, ...(crossLines ? { crossLines } : {}) };
}
