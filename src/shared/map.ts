import type { EntryId, PlatformId, Position, TrackId } from './types';

// The map, in metres on one shared x axis. Values from "The map", "Layouts", "The radio" and
// the `exitStartClear` comment in "Shared types" in docs/design.md. The names, and the choice
// of which edges count as inside, follow "Task 3: Map geometry" in issue #26, so the
// engine can import them from here.
//
// Every layout has the same shape: one to four entry tracks, two platforms for each, one
// junction zone and one EXIT. The geometry below covers every track any layout can have, and
// never changes. What a layout chooses is which entry tracks, and so which platforms, exist.
// ENTRIES and PLATFORMS hold that choice. They are declared with `let`, like the constants, so
// every file that imports one sees the layout in use. Read them where you use them, inside a
// function. A copy made when a file loads keeps the default layout.

/** Every entry track a layout can have, in order. */
export const ALL_ENTRIES: readonly EntryId[] = ['A', 'B', 'C', 'D'];

/** Every platform a layout can have, lowest number first. */
export const ALL_PLATFORMS: readonly PlatformId[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

/** The two platforms each entry track owns. From "Platform keeper switched off" in docs/design.md. */
export const PLATFORM_PAIRS: Readonly<Record<EntryId, readonly [PlatformId, PlatformId]>> = {
  A: ['P1', 'P2'],
  B: ['P3', 'P4'],
  C: ['P5', 'P6'],
  D: ['P7', 'P8'],
};

export type LayoutId = 'branch' | 'junction' | 'busy' | 'hub';

export interface Layout {
  id: LayoutId;
  title: string;
  /** The entry tracks this layout has. Each brings its own pair of platforms. */
  entries: readonly EntryId[];
}

/** The layouts, simplest first. Each adds one entry track, and so one more line to merge. */
export const LAYOUTS: Readonly<Record<LayoutId, Layout>> = {
  branch: { id: 'branch', title: 'Branch: 1 line, 2 platforms', entries: ['A'] },
  junction: { id: 'junction', title: 'Junction: 2 lines, 4 platforms', entries: ['A', 'B'] },
  busy: { id: 'busy', title: 'Busy: 3 lines, 6 platforms', entries: ['A', 'B', 'C'] },
  hub: { id: 'hub', title: 'Hub: 4 lines, 8 platforms', entries: ['A', 'B', 'C', 'D'] },
};

export const LAYOUT_IDS: readonly LayoutId[] = ['branch', 'junction', 'busy', 'hub'];

/** The layout docs/design.md draws, and the one every run uses unless it picks another. */
export const DEFAULT_LAYOUT: LayoutId = 'junction';

/** True if `value` names a layout. */
export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === 'string' && (LAYOUT_IDS as readonly string[]).includes(value);
}

/** The layout in use. */
export let LAYOUT: Layout = LAYOUTS[DEFAULT_LAYOUT];

/** The entry tracks of the layout in use, in order. */
export let ENTRIES: readonly EntryId[] = LAYOUT.entries;

/**
 * The platforms of the layout in use, lowest number first. Its length is also the number of
 * clock slots, so every platform has one slot.
 */
export let PLATFORMS: readonly PlatformId[] = LAYOUT.entries.flatMap((e) => PLATFORM_PAIRS[e]);

/**
 * Make this the layout every part of the build reads. Call it before a run starts, never in
 * the middle of one: agents, keepers and the centre built on another layout would disagree
 * about which tracks exist.
 */
export function applyLayout(id: LayoutId): void {
  LAYOUT = LAYOUTS[id];
  ENTRIES = LAYOUT.entries;
  PLATFORMS = LAYOUT.entries.flatMap((e) => PLATFORM_PAIRS[e]);
}

/** Go back to the default layout. */
export function resetLayout(): void {
  applyLayout(DEFAULT_LAYOUT);
}

/** Where every entry track ends and every platform starts on the x axis. */
const ENTRY_LENGTH = 6000;
const PLATFORM_LENGTH = 400;
const EXIT_LENGTH = 6000;

/** Where each track starts on the x axis. Every layout shares these. */
export const TRACK_START: Readonly<Record<TrackId, number>> = {
  A: 0,
  B: 0,
  C: 0,
  D: 0,
  P1: ENTRY_LENGTH,
  P2: ENTRY_LENGTH,
  P3: ENTRY_LENGTH,
  P4: ENTRY_LENGTH,
  P5: ENTRY_LENGTH,
  P6: ENTRY_LENGTH,
  P7: ENTRY_LENGTH,
  P8: ENTRY_LENGTH,
  EXIT: ENTRY_LENGTH + PLATFORM_LENGTH,
};

/** How long each track is. Every layout shares these. */
export const TRACK_LENGTH: Readonly<Record<TrackId, number>> = {
  A: ENTRY_LENGTH,
  B: ENTRY_LENGTH,
  C: ENTRY_LENGTH,
  D: ENTRY_LENGTH,
  P1: PLATFORM_LENGTH,
  P2: PLATFORM_LENGTH,
  P3: PLATFORM_LENGTH,
  P4: PLATFORM_LENGTH,
  P5: PLATFORM_LENGTH,
  P6: PLATFORM_LENGTH,
  P7: PLATFORM_LENGTH,
  P8: PLATFORM_LENGTH,
  EXIT: EXIT_LENGTH,
};

/**
 * The offset on an entry track where a train sends its first lockRequest for a platform. It is the
 * last place a train at full speed can still brake before the station.
 */
export const ASK_POINT = 4800;

/** A train stops in a platform with its front at this offset. */
export const PLATFORM_STOP = 300;

/** The junction zone covers the last this-many metres of every platform... */
export const JUNCTION_PLATFORM_LENGTH = 100;
/** ...and the first this-many metres of EXIT. */
export const JUNCTION_EXIT_LENGTH = 200;

/** The junction zone on the x axis, from 6300 up to but not including 6600. */
export const JUNCTION_START_X = TRACK_START.EXIT - JUNCTION_PLATFORM_LENGTH;
export const JUNCTION_END_X = TRACK_START.EXIT + JUNCTION_EXIT_LENGTH;

/** `SensorReadings.exitStartClear` is true when no train is in this many metres at the start of EXIT. */
export const EXIT_CLEAR_LENGTH = 300;

/**
 * Where a train can hear each short-range actor, as [from x, to x]. Use with `inRange`.
 * platformKeeper: the platform keeper. junctionKeeper: the junction keeper. sensors: the platform sensors.
 */
export const RANGE = {
  platformKeeper: [4300, 6400],
  junctionKeeper: [6000, 6600],
  sensors: [5500, 6400],
} as const;

/** True if x is inside the range. Both ends count as inside, as the plan in #26 says. */
export function inRange(x: number, range: readonly [number, number]): boolean {
  return x >= range[0] && x <= range[1];
}

/** A position's x on the shared axis: its track's start plus its offset. */
export function xOf(pos: Position): number {
  return TRACK_START[pos.track] + pos.offset;
}

/** True for an entry track of any layout: A to D. */
export function isEntryTrack(track: TrackId): track is EntryId {
  return (ALL_ENTRIES as readonly TrackId[]).includes(track);
}

/** True for a platform of any layout: P1 to P8. */
export function isPlatform(track: TrackId): track is PlatformId {
  return (ALL_PLATFORMS as readonly TrackId[]).includes(track);
}

/**
 * True if the position is in the junction zone: platform offset 300 up to the platform's
 * end, or EXIT offset 0 up to but not including 200. Offset 300 in a platform is in the zone.
 * These edges follow the plan in #26.
 *
 * This tests one point. The plan in #26 counts a train as in the zone if any part of it is.
 * For that, check its front and its rear, which is `TRAIN_LENGTH` behind the front and may
 * be on the track before.
 */
export function inJunctionZone(pos: Position): boolean {
  if (isPlatform(pos.track)) {
    return pos.offset >= TRACK_LENGTH[pos.track] - JUNCTION_PLATFORM_LENGTH;
  }
  if (pos.track === 'EXIT') {
    return pos.offset < JUNCTION_EXIT_LENGTH;
  }
  return false;
}

/** The tracks a train can move onto from the end of this one. EXIT leads off the map. */
export function successors(track: TrackId): TrackId[] {
  if (isEntryTrack(track)) return [...PLATFORM_PAIRS[track]];
  return track === 'EXIT' ? [] : ['EXIT'];
}

/** The two platforms an entry track owns, lowest number first. */
export function pairOf(entry: EntryId): readonly [PlatformId, PlatformId] {
  return PLATFORM_PAIRS[entry];
}

/** The entry track that owns a platform: A for P1 and P2, B for P3 and P4, and so on. */
export function entryOf(platform: PlatformId): EntryId {
  return ALL_ENTRIES.find((e) => PLATFORM_PAIRS[e].includes(platform))!;
}

/**
 * A full set of platform sensor readings. Every platform of the layout in use reads empty
 * unless `occupied` says otherwise, and every platform outside the layout reads occupied, as a
 * dead sensor does, so nothing is ever sent to a platform that does not exist.
 */
export function platformReadings(occupied: Partial<Record<PlatformId, boolean>> = {}): Record<PlatformId, boolean> {
  const out = {} as Record<PlatformId, boolean>;
  for (const p of ALL_PLATFORMS) out[p] = occupied[p] ?? !PLATFORMS.includes(p);
  return out;
}
