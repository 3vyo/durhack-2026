import { SENSOR_RANGE } from '../shared/constants';
import type { PlatformId, SensorReadings, TrackId } from '../shared/types';
import { footprint, touchesZone, type Body } from './footprint';
import { PLATFORM_STOP, TRACK_LENGTH } from '../shared/map';
import type { Switches } from './switches';

const PLATFORMS: PlatformId[] = ['P1', 'P2', 'P3', 'P4'];

/**
 * Metres from the front of `self` to the rear of the nearest obstacle on its path, or null
 * if nothing is within SENSOR_RANGE. The path is the rest of its current track and then
 * `nextTrack`, the one it returned on the previous tick. An obstacle is any part of another
 * train, including a rear that is still on the previous track, and the edge of the junction
 * zone while a train is inside it.
 */
export function sightAhead(self: Body, nextTrack: TrackId | null, others: Body[]): number | null {
  const { track, offset } = self.state.pos;
  const toEnd = TRACK_LENGTH[track] - offset;
  let nearest = Infinity;
  let zoneOccupied = false;

  for (const other of others) {
    if (other.state.id === self.state.id) continue;
    const segments = footprint(other);
    if (touchesZone(segments)) zoneOccupied = true;
    for (const seg of segments) {
      if (seg.track === track && seg.to > offset) {
        nearest = Math.min(nearest, Math.max(0, seg.from - offset));
      } else if (nextTrack !== null && seg.track === nextTrack) {
        nearest = Math.min(nearest, toEnd + seg.from);
      }
    }
  }

  if (zoneOccupied) {
    const edge = zoneEdgeDistance(track, offset, nextTrack);
    if (edge !== null) nearest = Math.min(nearest, edge);
  }
  return nearest <= SENSOR_RANGE ? nearest : null;
}

/**
 * Distance along the path to where the junction zone starts, or null if self is already past it.
 * A train exactly at the edge gets 0, so it stops there and does not slip in unwarned.
 */
function zoneEdgeDistance(track: TrackId, offset: number, nextTrack: TrackId | null): number | null {
  if (track === 'A' || track === 'B') {
    const toPlatform = nextTrack !== null && nextTrack !== 'EXIT' ? nextTrack : null;
    return toPlatform ? TRACK_LENGTH[track] - offset + PLATFORM_STOP : null;
  }
  if (track === 'EXIT') return null;
  return offset <= PLATFORM_STOP ? PLATFORM_STOP - offset : null;
}

/**
 * What the wired and platform sensors report. A platform reads occupied while any part of a
 * train is on it. A dead platform sensor reads occupied, never empty. The junction and the
 * start of EXIT are wired to the merge actor, so they do not depend on the platform sensors.
 */
export function readSensors(bodies: Body[], sw: Switches): SensorReadings {
  const segments = bodies.flatMap((b) => footprint(b));
  const platformOccupied = {} as Record<PlatformId, boolean>;
  for (const p of PLATFORMS) {
    platformOccupied[p] = !sw.sensors || segments.some((s) => s.track === p);
  }
  return {
    platformOccupied,
    junctionOccupied: bodies.some((b) => touchesZone(footprint(b))),
    exitStartClear: !segments.some((s) => s.track === 'EXIT' && s.from < 300),
  };
}
