import type { PlatformId, TimetableEntry, TrainId } from '../shared/types';

/** mulberry32: a small seeded generator returning values in [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TimetableOptions {
  trains: number;
  /** Smallest gap in seconds between two trains entering. */
  minHeadway: number;
  /** Seconds each train waits in its platform. */
  dwell: number;
}

/**
 * A starting point to tune so the baseline visibly stalls and healthy running looks normal.
 * Trains enter at MAX_SPEED, so a healthy journey is about 400 s including the platform stop
 * and dwell. 16 trains at gaps of 45 to 90 s enter over roughly 1000 s, and runLengthFor adds
 * a 600 s margin so the last train can finish.
 */
export const DEFAULT_TIMETABLE: TimetableOptions = { trains: 16, minHeadway: 45, dwell: 30 };

/** How long a run must last for every train to finish: the last entry plus a settle margin. */
export function runLengthFor(timetable: TimetableEntry[], settle: number = 600): number {
  if (timetable.length < 1) throw new Error('timetable needs at least one train');
  return timetable[timetable.length - 1].enterAt + settle;
}

const PAIR: Record<'A' | 'B', [PlatformId, PlatformId]> = {
  A: ['P1', 'P2'],
  B: ['P3', 'P4'],
};

/**
 * Builds a timetable from a seed. Each gap is minHeadway + rng() * minHeadway, so the
 * timetable stays under full capacity. Default platforms alternate within each entry track.
 */
export function generateTimetable(seed: number, opts: TimetableOptions): TimetableEntry[] {
  if (opts.trains < 1) throw new Error('timetable needs at least one train');
  const rng = makeRng(seed);
  const lastOn: Record<'A' | 'B', TrainId | null> = { A: null, B: null };
  const countOn: Record<'A' | 'B', number> = { A: 0, B: 0 };
  const entries: TimetableEntry[] = [];
  let enterAt = 0;

  for (let id = 1; id <= opts.trains; id++) {
    if (id > 1) enterAt += opts.minHeadway + rng() * opts.minHeadway;
    const entry = rng() < 0.5 ? 'A' : 'B';
    const platform = PAIR[entry][countOn[entry] % 2];
    entries.push({
      id,
      entry,
      enterAt,
      platform,
      leader: lastOn[entry],
      dwell: opts.dwell,
    });
    lastOn[entry] = id;
    countOn[entry] += 1;
  }
  return entries;
}
