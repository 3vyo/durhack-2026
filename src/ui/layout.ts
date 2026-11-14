import type { Snapshot } from '../engine/engine';
import { TRAIN_LENGTH } from '../shared/constants';
import type { TrackId, TrainId, TrainOutput } from '../shared/types';

/**
 * A window onto the track. xMin and xMax are metres along the shared x axis, and width is
 * the number of scene units they are squashed into. Scene units are what three.js draws in.
 */
export interface Frame {
  xMin: number;
  xMax: number;
  width: number;
}

/** The station area, where everything that matters happens. */
export const STATION_FRAME: Frame = { xMin: 4000, xMax: 7000, width: 1500 };

/** Distance between lanes in scene units. Lanes run across the track, along z. */
export const LANE_SPACING = 40;

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

/** One colour per display mode, so a judge can read how each train is deciding. */
export function modeColor(mode: TrainOutput['mode']): number {
  switch (mode) {
    case 'central':
      return 0x4da3ff;
    case 'full':
      return 0x45c27a;
    case 'stale':
      return 0xe0b040;
    case 'blind':
      return 0xe05555;
  }
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
  if (mode === 'overhead') return { position: [cx, f.width * 0.9, cz], lookAt };
  return { position: [cx, f.width * 0.55, cz + f.width * 0.75], lookAt };
}
