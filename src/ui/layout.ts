import type { Snapshot } from '../engine/engine';
import { TRAIN_LENGTH } from '../shared/constants';
import type { TrackId, TrainId, TrainOutput } from '../shared/types';
import { MODE_STYLE } from './palette';

/**
 * A window onto the track. xMin and xMax are metres along the shared x axis, and width is
 * the number of scene units they are squashed into. Scene units are what three.js draws in.
 */
export interface Frame {
  xMin: number;
  xMax: number;
  width: number;
}

/**
 * Scene units per metre. These are the Kenney Train Kit's own units, so a 100 m train is
 * 8 units long and the models need almost no scaling. Never scale a train up to make it easier
 * to see: collisions are judged on true lengths, and a bigger train would look as if it
 * overlapped one it does not.
 */
export const UNITS_PER_METRE = 0.08;

/**
 * The stretch of line each scene shows: the braking approach, the platforms, the junction and
 * the start of EXIT. 1,800 m, so a train is about 5.5 percent of the width. The minimap shows
 * the whole line.
 */
export const STATION_FRAME: Frame = { xMin: 5000, xMax: 6800, width: 1800 * UNITS_PER_METRE };

/** Distance between lanes in scene units. Lanes run across the track, along z. */
export const LANE_SPACING = 4;

export function toScreenX(x: number, f: Frame): number {
  return ((x - f.xMin) / (f.xMax - f.xMin)) * f.width;
}

const LANES: Record<TrackId, number> = {
  P1: 0,
  A: 1,
  P2: 2,
  EXIT: 2.5,
  P3: 3,
  B: 4,
  P4: 5,
};

/** Each track has its own lane: entry lines sit between the two platforms they feed. */
export function laneOf(track: TrackId): number {
  return LANES[track];
}

export interface Marker {
  id: TrainId;
  mode: TrainOutput['mode'];
  speed: number;
  /** Scene x of the train's front. */
  px: number;
  lane: number;
  lengthPx: number;
  /** True if any part of the train is inside the frame. */
  visible: boolean;
}

export function markersFor(s: Snapshot, f: Frame): Marker[] {
  const scale = f.width / (f.xMax - f.xMin);
  return s.trains.map((t) => ({
    id: t.id,
    mode: t.mode,
    speed: t.speed,
    px: toScreenX(t.x, f),
    lane: laneOf(t.pos.track),
    lengthPx: TRAIN_LENGTH * scale,
    visible: t.x >= f.xMin && t.x - TRAIN_LENGTH <= f.xMax,
  }));
}

/** One colour per display mode, from the palette. Each mode also has its own marker shape. */
export function modeColor(mode: TrainOutput['mode']): number {
  return MODE_STYLE[mode].hex;
}

/** A train this slow reads as stopped. The picture dims it so stopped against moving shows at a glance. */
export function isStopped(speed: number): boolean {
  return speed < 0.1;
}

export type CameraMode = 'angled' | 'overhead';

/**
 * Where to put the camera. In scene space x runs along the track, y is up and z runs
 * across the lanes. Both presets look at the middle of the frame and the middle lane.
 */
export function cameraPreset(
  mode: CameraMode,
  f: Frame,
): { position: [number, number, number]; lookAt: [number, number, number] } {
  const cx = f.width / 2;
  const cz = 2.5 * LANE_SPACING;
  const lookAt: [number, number, number] = [cx, 0, cz];
  if (mode === 'overhead') return { position: [cx, f.width * 0.8, cz], lookAt };
  return { position: [cx, f.width * 0.42, cz + f.width * 0.55], lookAt };
}
