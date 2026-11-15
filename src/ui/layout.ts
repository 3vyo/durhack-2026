import type { Snapshot } from '../engine/engine';
import { TRAIN_LENGTH } from '../shared/constants';
import { JUNCTION_END_X, JUNCTION_START_X, TRACK_START, entryOf } from '../shared/map';
import type { PlatformId, TrackId, TrainId, TrainOutput } from '../shared/types';
import { MODE_STYLE, SURFACE, contrastRatio } from './palette';

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

/** The view the page opens with: a close 3D view of the station. The button switches to the overhead overview. */
export const DEFAULT_CAMERA: CameraMode = 'angled';

/** The camera's vertical field of view, in degrees. */
export const CAMERA_FOV = 45;

/**
 * The stretch the angled view looks at, in metres: the approach, the platforms and the
 * junction. 1,000 m, so a train is about a tenth of the width and reads as a model. The
 * overhead view still shows the whole frame, and the minimap the whole line.
 */
export const ANGLED_FOCUS = { xMin: 5650, xMax: 6650 } as const;

/** Across the line, the scene runs from the control centre (z -10) to the far platform (z 21). */
const CONTENT_Z = { from: -10, to: 21 };
/** How far the angled view looks down, in degrees above the horizon. */
const ANGLED_ELEVATION = 30;
/** How far the angled view swings to the left of straight-on, in degrees, to look a little along the line. */
const ANGLED_SWING = 4;
/**
 * The angled camera sits this share of the distance that would fit the focus at its middle.
 * Perspective makes the near tracks wider than the middle, so less than 1 still shows the focus.
 */
const ANGLED_CLOSENESS = 0.82;
/** A little room around the frame, so nothing sits on the very edge. */
const FIT_MARGIN = 1.03;

/**
 * Where to put the camera. In scene space x runs along the track, y is up and z runs across
 * the lanes, at this canvas aspect (width / height).
 * - Overhead looks straight down at the middle of the frame, just far enough away to show the
 *   whole frame's width and the whole depth from the control centre to the far platform.
 * - Angled is a close 3D view of ANGLED_FOCUS: low over the line, a little to one side.
 */
export function cameraPreset(
  mode: CameraMode,
  f: Frame,
  aspect = 1.6,
): { position: [number, number, number]; lookAt: [number, number, number] } {
  const tanHalf = Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);
  const cz = (CONTENT_Z.from + CONTENT_Z.to) / 2;
  if (mode === 'overhead') {
    const cx = f.width / 2;
    const forWidth = ((f.width / 2) * FIT_MARGIN) / (tanHalf * aspect);
    const forDepth = (((CONTENT_Z.to - CONTENT_Z.from) / 2) * FIT_MARGIN) / tanHalf;
    return { position: [cx, Math.max(forWidth, forDepth), cz], lookAt: [cx, 0, cz] };
  }
  const scale = f.width / (f.xMax - f.xMin);
  const focusWidth = (ANGLED_FOCUS.xMax - ANGLED_FOCUS.xMin) * scale;
  const fx = toScreenX((ANGLED_FOCUS.xMin + ANGLED_FOCUS.xMax) / 2, f);
  // Look a little nearer than the middle of the lanes: perspective already makes the far side small.
  const fz = cz + 1;
  const distance = (((focusWidth / 2) * FIT_MARGIN) / (tanHalf * aspect)) * ANGLED_CLOSENESS;
  const e = (ANGLED_ELEVATION * Math.PI) / 180;
  const a = (ANGLED_SWING * Math.PI) / 180;
  return {
    position: [fx - distance * Math.cos(e) * Math.sin(a), distance * Math.sin(e), fz + distance * Math.cos(e) * Math.cos(a)],
    lookAt: [fx, 0, fz],
  };
}

/** Converts a point in normalised device coordinates (-1 to 1, y up) to CSS pixels on a canvas. */
export function ndcToCss(ndc: { x: number; y: number }, width: number, height: number): { left: number; top: number } {
  return { left: ((ndc.x + 1) / 2) * width, top: ((1 - ndc.y) / 2) * height };
}

/**
 * Where the HTML labels sit, x in metres and z in scene units. A, B and EXIT are labelled just
 * inside the angled view's focus, so both camera views show them, and EXIT near the right
 * edge, each platform near its entrance (trains stop further in, so the label never hides
 * one), and each device just behind its building.
 */
export function labelAnchors(f: Frame): Array<{ text: string; x: number; z: number; kind: 'track' | 'device' }> {
  const lane = (t: TrackId) => laneOf(t) * LANE_SPACING;
  const track = (text: string, x: number, t: TrackId) => ({ text, x, z: lane(t), kind: 'track' as const });
  const platformEntrance = TRACK_START.P1 + POINTS_LENGTH + 40;
  const device = (text: string, key: DeviceKey) => ({ text, x: DEVICE_SITES[key].x, z: DEVICE_SITES[key].z - 1.4, kind: 'device' as const });
  return [
    track('A', Math.max(f.xMin + 150, ANGLED_FOCUS.xMin + 220), 'A'),
    track('B', Math.max(f.xMin + 150, ANGLED_FOCUS.xMin + 220), 'B'),
    track('P1', platformEntrance, 'P1'),
    track('P2', platformEntrance, 'P2'),
    track('P3', platformEntrance, 'P3'),
    track('P4', platformEntrance, 'P4'),
    track('EXIT', Math.min(f.xMax - 150, ANGLED_FOCUS.xMax - 110), 'EXIT'),
    device('Control centre', 'centre'),
    device('Platform keeper', 'platformKeeper'),
    device('Sensors', 'sensors'),
    device('Junction keeper', 'junctionKeeper'),
  ];
}

/** The four pieces of trackside equipment the scene draws, keyed like the engine's switches. */
export type DeviceKey = 'centre' | 'platformKeeper' | 'junctionKeeper' | 'sensors';

/**
 * Where each device stands: x in metres along the line, z in scene units across it. The
 * control centre stands back from the line, the others beside platform P1's track.
 */
export const DEVICE_SITES: Record<DeviceKey, { x: number; z: number }> = {
  centre: { x: 5850, z: -9 },
  platformKeeper: { x: 5740, z: -4 },
  sensors: { x: 5980, z: -4 },
  junctionKeeper: { x: 6320, z: -4 },
};

export interface DeviceLook {
  body: number;
  roof: number;
  /** The lamp's colour when the device is on, or null: a switched-off device's lamp is out. */
  light: number | null;
}

const DEVICE_BODY: Record<DeviceKey, number> = {
  centre: 0xd9dee6,
  platformKeeper: 0x3f8a5f,
  junctionKeeper: 0x3f8a5f,
  sensors: 0x8794a6,
};

/**
 * How a device looks. On: its own colour and a green lamp. Off: a dull red body and no lamp,
 * still clear of the background so a judge can see what went dark.
 */
export function deviceLook(key: DeviceKey, on: boolean): DeviceLook {
  if (on) return { body: DEVICE_BODY[key], roof: 0x4a5a70, light: 0x7be07b };
  return { body: 0x7a2f2f, roof: 0x3a2a2e, light: null };
}

/** True if a switched-off device still stands out from the scene background, at least 1.5 to 1. */
export function offDeviceVisible(key: DeviceKey): boolean {
  return contrastRatio(deviceLook(key, false).body, SURFACE.scene) >= 1.5;
}

/**
 * True if any part of a train is in the junction zone: the last 100 m of a platform or the
 * first 200 m of EXIT. The scene lights the zone up then. It reads the snapshot only.
 */
export function junctionBusy(s: Snapshot): boolean {
  return s.trains.some((t) => {
    if (t.pos.track === 'A' || t.pos.track === 'B') return false;
    const rear = t.x - TRAIN_LENGTH;
    return t.x > JUNCTION_START_X && rear < JUNCTION_END_X;
  });
}

/**
 * Length of the points, in metres. Each entry line splits where it ends, and each branch
 * bends across into its platform over the platform's first POINTS_LENGTH metres. Each
 * platform bends into EXIT over EXIT's first POINTS_LENGTH metres. Trains stop well clear
 * of both bends, so a stopped train always stands straight.
 */
export const POINTS_LENGTH = 120;

/** The route a train is on, as far as the picture needs it. */
export interface Route {
  entry: 'A' | 'B' | null;
  platform: PlatformId | null;
}

/**
 * The route of a train, from the track its front is on. A train on EXIT has left its
 * platform behind, so the caller passes the platform it was last seen in, if any.
 */
export function routeOf(track: TrackId, lastPlatform: PlatformId | null): Route {
  if (track === 'A' || track === 'B') return { entry: track, platform: null };
  if (track === 'EXIT') return { entry: lastPlatform ? entryOf(lastPlatform) : null, platform: lastPlatform };
  return { entry: entryOf(track), platform: track };
}

/**
 * Where the track is across the line at x metres along a route: z in scene units, and how
 * fast z changes per metre (0 on straight track). Through the points it runs straight from
 * one lane to the next, the way the drawn track does, so each car follows the rails.
 */
export function pathAt(x: number, route: Route): { z: number; slope: number } {
  const lane = (t: TrackId) => laneOf(t) * LANE_SPACING;
  const entry = route.entry ?? (route.platform ? entryOf(route.platform) : null);
  const start = entry ? lane(entry) : lane('EXIT');
  const platform = route.platform ? lane(route.platform) : start;
  const exit = lane('EXIT');
  const bend = (from: number, to: number, x0: number) => {
    const t = (x - x0) / POINTS_LENGTH;
    return { z: from + (to - from) * t, slope: (to - from) / POINTS_LENGTH };
  };
  const intoPlatforms = TRACK_START.P1;
  const intoExit = TRACK_START.EXIT;
  if (x < intoPlatforms) return { z: start, slope: 0 };
  if (x < intoPlatforms + POINTS_LENGTH) return route.platform ? bend(start, platform, intoPlatforms) : { z: start, slope: 0 };
  if (x < intoExit) return { z: platform, slope: 0 };
  if (x < intoExit + POINTS_LENGTH) return route.platform ? bend(platform, exit, intoExit) : { z: exit, slope: 0 };
  return { z: exit, slope: 0 };
}
