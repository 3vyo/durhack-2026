import { ENTRIES, PLATFORM_PAIRS } from '../shared/map';
import type { EntryId, TimetableEntry, TrainId } from '../shared/types';

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
 * The one timetable the demo, the batch and the example parameter files use. Design:
 * "Scenarios and timings". Trains enter at SIGHT_SPEED, and a healthy journey takes about
 * 600 s including the platform stop. 16 trains at gaps of 45 to 90 s enter over roughly
 * 1000 s.
 */
export const DEFAULT_TIMETABLE: TimetableOptions = { trains: 16, minHeadway: 45, dwell: 30 };

/**
 * Every run lasts up to this many seconds, and stops early once every train has left. A
 * train that never leaves counts as leaving now, so every delay is measured against the same
 * end. Design: "Scenarios and timings".
 */
export const RUN_LENGTH = 7200;

/** True if timetable order puts `a` before `b`: earlier `enterAt` first, lowest ID on a tie. */
export function entersBefore(a: TimetableEntry, b: TimetableEntry): boolean {
  return a.enterAt < b.enterAt || (a.enterAt === b.enterAt && a.id < b.id);
}

/**
 * The entry for a train added to a running timetable on `track`, due at `now`. It takes the
 * next free ID. Its leader is the last train on the same track that comes before it in
 * timetable order, which may be one still waiting to enter. Its default platform is the other
 * one of the pair from that leader's, so defaults still alternate. This only builds the entry:
 * Engine.addTrain puts it in the timetable. The track must be an entry track of the layout in use.
 */
export function spawnEntry(timetable: TimetableEntry[], track: EntryId, now: number, dwell: number): TimetableEntry {
  if (!ENTRIES.includes(track)) throw new Error(`entry track ${track} is not in this layout`);
  const pair = PLATFORM_PAIRS[track];
  const id = timetable.reduce((max, e) => Math.max(max, e.id), 0) + 1;
  const entry: TimetableEntry = { id, entry: track, enterAt: now, platform: pair[0], leader: null, dwell };
  let leader: TimetableEntry | null = null;
  for (const e of timetable) {
    if (e.entry !== track || !entersBefore(e, entry)) continue;
    if (leader === null || entersBefore(leader, e)) leader = e;
  }
  if (leader !== null) {
    entry.leader = leader.id;
    entry.platform = leader.platform === pair[0] ? pair[1] : pair[0];
  }
  return entry;
}

/**
 * Builds a timetable from a seed. Each gap is minHeadway + rng() * minHeadway, so the
 * timetable stays under full capacity. Each train picks one of the layout's entry tracks at
 * random from the seed, with one draw, so the default layout gives the timetables it always
 * gave. Default platforms alternate within each entry track's own pair.
 */
export function generateTimetable(seed: number, opts: TimetableOptions): TimetableEntry[] {
  if (opts.trains < 1) throw new Error('timetable needs at least one train');
  const rng = makeRng(seed);
  const tracks = ENTRIES;
  const lastOn = new Map<EntryId, TrainId>();
  const countOn = new Map<EntryId, number>();
  const entries: TimetableEntry[] = [];
  let enterAt = 0;

  for (let id = 1; id <= opts.trains; id++) {
    if (id > 1) enterAt += opts.minHeadway + rng() * opts.minHeadway;
    const entry = tracks[Math.floor(rng() * tracks.length)];
    const count = countOn.get(entry) ?? 0;
    const pair = PLATFORM_PAIRS[entry];
    entries.push({
      id,
      entry,
      enterAt,
      platform: pair[count % pair.length],
      leader: lastOn.get(entry) ?? null,
      dwell: opts.dwell,
    });
    lastOn.set(entry, id);
    countOn.set(entry, count + 1);
  }
  return entries;
}
