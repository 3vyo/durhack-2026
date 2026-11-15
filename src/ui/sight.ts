import type { TrainView } from '../engine/engine';
import { SENSOR_RANGE } from '../shared/constants';
import { TRACK_LENGTH, TRACK_START, isEntryTrack, isPlatform } from '../shared/map';
import type { PlatformId } from '../shared/types';
import { routeOf, type Route } from './layout';

// The beam the scene draws ahead of each train for its own front sensor (sightAhead in the
// design). Both programs' trains brake for it. It follows the same path the engine's sensor
// looks along: the rest of the current track, then the track the train has set to take next.

export const SIGHT_STYLE = {
  clear: '#7fd6ff',
  blocked: '#ff5a5a',
  label: 'Sensor ahead',
  meaning: `What the train's own sensor sees, up to ${SENSOR_RANGE} m. Red when something is in the way`,
} as const;

export interface SightBeam {
  /** The route the beam follows across the lanes. */
  route: Route;
  /** Metres along the x axis: the train's front, and where the beam stops. */
  fromX: number;
  toX: number;
  /** True if the sensor sees a train or a busy junction zone at toX. */
  blocked: boolean;
}

/**
 * The beam for one train. It reaches SENSOR_RANGE ahead, or to the end of the train's path if
 * that is nearer (an entry line with no platform set ends at its last metre), or to the
 * obstacle the sensor reported. `lastPlatform` is the platform a train on EXIT came from.
 */
export function sightBeam(v: TrainView, lastPlatform: PlatformId | null): SightBeam {
  const track = v.pos.track;
  const end = v.nextTrack ?? track;
  const pathEnd = TRACK_START[end] + TRACK_LENGTH[end];
  const toX = Math.min(v.x + (v.sightAhead ?? SENSOR_RANGE), pathEnd);
  const route =
    isEntryTrack(track) ? { entry: track, platform: v.nextTrack !== null && isPlatform(v.nextTrack) ? v.nextTrack : null } : routeOf(track, lastPlatform);
  return { route, fromX: v.x, toX: Math.max(v.x, toX), blocked: v.sightAhead !== null };
}
