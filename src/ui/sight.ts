import type { TrainView } from '../engine/engine';
import { SENSOR_RANGE } from '../shared/constants';
import { isEntryTrack, isPlatform } from '../shared/map';
import type { PlatformId } from '../shared/types';
import { routeOf, type Route } from './layout';

// The cone the scene draws ahead of each train for its own front sensor (sightAhead in the
// design). Both programs' trains brake for it. The cone shows how far the sensor reaches; a bar
// marks the obstacle it found, on the path the sensor looks along: the rest of the current
// track, then the track the train has set to take next.

export const SIGHT_STYLE = {
  clear: '#7fd6ff',
  blocked: '#ff5a5a',
  label: 'Sensor',
  meaning: `What the train's own sensor covers, ${SENSOR_RANGE} m ahead. Red when it sees something, with a bar where it is`,
} as const;

/** Half the cone's opening angle, in radians. Wide enough to read as a cone, not a line. */
export const SIGHT_HALF_ANGLE = (16 * Math.PI) / 180;

export interface SightCone {
  /** The route the train's path follows across the lanes, for the heading and the obstacle. */
  route: Route;
  /** Metres along the x axis of the train's front, where the cone starts. */
  frontX: number;
  /** Metres along the x axis of what the sensor sees, or null if nothing is in range. */
  obstacleX: number | null;
}

/** The cone for one train. `lastPlatform` is the platform a train on EXIT came from. */
export function sightCone(v: TrainView, lastPlatform: PlatformId | null): SightCone {
  const track = v.pos.track;
  const route = isEntryTrack(track)
    ? { entry: track, platform: v.nextTrack !== null && isPlatform(v.nextTrack) ? v.nextTrack : null }
    : routeOf(track, lastPlatform);
  return { route, frontX: v.x, obstacleX: v.sightAhead === null ? null : v.x + v.sightAhead };
}
