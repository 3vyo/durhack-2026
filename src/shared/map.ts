import type { PlatformId, Position, TimetableEntry, TrackId } from './types';

// The map, in metres on one shared x axis. Values from "The map", "The radio" and the
// `exitStartClear` comment in "Shared types" in docs/design.md. The names, and the choice
// of which edges count as inside, follow "Task 3: Map geometry" in issue #26, so the
// engine can import them from here.

type EntryTrack = TimetableEntry['entry'];

/** The two platforms each entry track owns. From "Station switched off" in docs/design.md. */
export const PLATFORM_PAIRS: Record<'A' | 'B', readonly [PlatformId, PlatformId]> = {
  A: ['P1', 'P2'],
  B: ['P3', 'P4'],
};

/** The four platforms, lowest number first. */
export const PLATFORMS: readonly PlatformId[] = ['P1', 'P2', 'P3', 'P4'];

/** Where each track starts on the x axis. */
export const TRACK_START: Readonly<Record<TrackId, number>> = {
  A: 0,
  B: 0,
  P1: 6000,
  P2: 6000,
  P3: 6000,
  P4: 6000,
  EXIT: 6400,
};

/** How long each track is. */
export const TRACK_LENGTH: Readonly<Record<TrackId, number>> = {
  A: 6000,
  B: 6000,
  P1: 400,
  P2: 400,
  P3: 400,
  P4: 400,
  EXIT: 6000,
};

/**
 * The offset on A and B where a train sends its first lockRequest for a platform. It is the
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
 * station: the station actor. merge: the merge actor. sensors: the platform sensors.
 */
export const RANGE = {
  station: [4300, 6400],
  merge: [6000, 6600],
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

function isPlatform(track: TrackId): track is PlatformId {
  return track === 'P1' || track === 'P2' || track === 'P3' || track === 'P4';
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
  switch (track) {
    case 'A':
    case 'B':
      return [...PLATFORM_PAIRS[track]];
    case 'EXIT':
      return [];
    default:
      return ['EXIT'];
  }
}

/** The two platforms an entry track owns, lowest number first. */
export function pairOf(entry: EntryTrack): readonly [PlatformId, PlatformId] {
  return PLATFORM_PAIRS[entry];
}

/** The entry track that owns a platform: A for P1 and P2, B for P3 and P4. */
export function entryOf(platform: PlatformId): EntryTrack {
  return PLATFORM_PAIRS.A.includes(platform) ? 'A' : 'B';
}
