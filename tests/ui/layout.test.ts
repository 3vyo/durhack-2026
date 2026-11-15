import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/engine/engine';
import { ALL_ON } from '../../src/engine/switches';
import {
  ANGLED_FOCUS,
  EXIT_MERGE,
  POINTS_LENGTH,
  pathAt,
  routeOf,
  CAMERA_FOV,
  DEFAULT_CAMERA,
  DEVICE_SITES,
  LANE_SPACING,
  deviceLook,
  junctionBusy,
  labelAnchors,
  ndcToCss,
  offDeviceVisible,
  STATION_FRAME,
  UNITS_PER_METRE,
  cameraPreset,
  isStopped,
  laneOf,
  markersFor,
  modeColor,
  toScreenX,
  type Frame,
} from '../../src/ui/layout';
import { TRAIN_LENGTH } from '../../src/shared/constants';
import type { TrackId } from '../../src/shared/types';

const frame: Frame = { xMin: 4000, xMax: 7000, width: 1500 };

function snapshotWith(x: number): Snapshot {
  return {
    now: 0,
    switches: ALL_ON,
    trains: [
      {
        id: 1,
        pos: { track: 'A', offset: x },
        x,
        speed: 45,
        mode: 'blind',
        leaderAge: null,
        permitAge: null,
        lastGrants: { platform: null, junction: false },
      },
    ],
  };
}

describe('toScreenX', () => {
  it('maps the middle of the frame to half the width', () => {
    expect(toScreenX(5500, frame)).toBe(750);
  });

  it('maps the frame edges to 0 and the width', () => {
    expect(toScreenX(4000, frame)).toBe(0);
    expect(toScreenX(7000, frame)).toBe(1500);
  });
});

describe('laneOf', () => {
  it('gives every track its own lane', () => {
    const tracks: TrackId[] = ['A', 'B', 'P1', 'P2', 'P3', 'P4', 'EXIT'];
    const lanes = tracks.map(laneOf);
    expect(new Set(lanes).size).toBe(tracks.length);
  });
});

describe('markersFor', () => {
  it('hides a train that is outside the frame', () => {
    expect(markersFor(snapshotWith(100), frame)[0].visible).toBe(false);
  });

  it('shows a train inside the frame at its screen position', () => {
    const marker = markersFor(snapshotWith(5500), frame)[0];
    expect(marker.visible).toBe(true);
    expect(marker.px).toBe(750);
  });

  it('scales the train length by the metres-to-pixels ratio', () => {
    const marker = markersFor(snapshotWith(5500), frame)[0];
    expect(marker.lengthPx).toBe(TRAIN_LENGTH * (frame.width / (frame.xMax - frame.xMin)));
  });

  it('puts the train in the lane of its track', () => {
    expect(markersFor(snapshotWith(5500), frame)[0].lane).toBe(laneOf('A'));
  });
});

describe('cameraPreset', () => {
  const tanHalf = Math.tan((CAMERA_FOV / 2) * (Math.PI / 180));

  it('looks straight down from above in overhead mode', () => {
    const { position, lookAt } = cameraPreset('overhead', STATION_FRAME);
    expect(position[0]).toBe(lookAt[0]);
    expect(position[2]).toBe(lookAt[2]);
    expect(position[1]).toBeGreaterThan(0);
  });

  it('sits in front of and above its target in angled mode', () => {
    const { position, lookAt } = cameraPreset('angled', STATION_FRAME);
    expect(position[2]).toBeGreaterThan(lookAt[2]);
    expect(position[1]).toBeGreaterThan(0);
  });

  it('fits the whole frame width on a wide canvas, with little to spare', () => {
    for (const aspect of [1.4, 1.6, 2]) {
      const { position, lookAt } = cameraPreset('overhead', STATION_FRAME, aspect);
      const visibleWidth = 2 * (position[1] - lookAt[1]) * tanHalf * aspect;
      expect(visibleWidth).toBeGreaterThanOrEqual(STATION_FRAME.width);
      expect(visibleWidth).toBeLessThan(STATION_FRAME.width * 1.1);
    }
  });

  it('backs off on a tall canvas so the depth still fits', () => {
    const tall = cameraPreset('overhead', STATION_FRAME, 0.5).position[1];
    const wide = cameraPreset('overhead', STATION_FRAME, 1.6).position[1];
    expect(tall).toBeGreaterThan(wide);
  });

  it('opens in the angled view', () => {
    expect(DEFAULT_CAMERA).toBe('angled');
  });

  it('puts the angled camera lower and closer than the overhead one', () => {
    const angled = cameraPreset('angled', STATION_FRAME);
    const overhead = cameraPreset('overhead', STATION_FRAME);
    const distance = (p: ReturnType<typeof cameraPreset>) =>
      Math.hypot(...p.position.map((v, i) => v - p.lookAt[i]));
    expect(angled.position[1]).toBeLessThan(overhead.position[1]);
    expect(distance(angled)).toBeLessThan(distance(overhead));
  });

  it('points the angled camera at the focus stretch, the platforms and the junction', () => {
    const x = cameraPreset('angled', STATION_FRAME).lookAt[0];
    expect(x).toBeGreaterThanOrEqual(toScreenX(ANGLED_FOCUS.xMin, STATION_FRAME));
    expect(x).toBeLessThanOrEqual(toScreenX(ANGLED_FOCUS.xMax, STATION_FRAME));
  });
});

describe('ndcToCss', () => {
  it('maps the centre and the corners', () => {
    expect(ndcToCss({ x: 0, y: 0 }, 800, 400)).toEqual({ left: 400, top: 200 });
    expect(ndcToCss({ x: -1, y: 1 }, 800, 400)).toEqual({ left: 0, top: 0 });
    expect(ndcToCss({ x: 1, y: -1 }, 800, 400)).toEqual({ left: 800, top: 400 });
  });
});

describe('labelAnchors', () => {
  it('puts every device and the A, B and EXIT labels inside the angled view focus', () => {
    const anchors = labelAnchors(STATION_FRAME).filter((a) => a.kind === 'device' || ['A', 'B', 'EXIT'].includes(a.text));
    for (const a of anchors) {
      expect(a.x).toBeGreaterThanOrEqual(ANGLED_FOCUS.xMin);
      expect(a.x).toBeLessThanOrEqual(ANGLED_FOCUS.xMax);
    }
  });

  it('labels the seven tracks and the four devices, all inside the frame', () => {
    const anchors = labelAnchors(STATION_FRAME);
    expect(anchors.filter((a) => a.kind === 'track').map((a) => a.text)).toEqual(['A', 'B', 'P1', 'P2', 'P3', 'P4', 'EXIT']);
    expect(anchors.filter((a) => a.kind === 'device')).toHaveLength(4);
    for (const a of anchors) {
      expect(a.x).toBeGreaterThanOrEqual(STATION_FRAME.xMin);
      expect(a.x).toBeLessThanOrEqual(STATION_FRAME.xMax);
    }
  });
});

describe('modeColor', () => {
  it('gives each of the five modes its own colour, from the palette', () => {
    const colours = (['central', 'radio', 'full', 'stale', 'blind'] as const).map(modeColor);
    expect(new Set(colours).size).toBe(5);
    expect(modeColor('central')).toBe(0x3987e5);
  });
});

describe('native units and the station frame', () => {
  it('uses the kit units, 0.08 per metre, across the frame', () => {
    expect(STATION_FRAME.width / (STATION_FRAME.xMax - STATION_FRAME.xMin)).toBeCloseTo(UNITS_PER_METRE, 9);
    expect(STATION_FRAME).toMatchObject({ xMin: 5000, xMax: 6800 });
  });

  it('puts x 5900 in the middle of the frame', () => {
    expect(toScreenX(5900, STATION_FRAME)).toBeCloseTo(72, 9);
  });

  it('draws a 100 m train 8 units long, its true length', () => {
    expect(markersFor(snapshotWith(5900), STATION_FRAME)[0].lengthPx).toBeCloseTo(8, 9);
  });

  it('puts the lanes 4 units apart', () => {
    expect(LANE_SPACING).toBe(4);
  });
});

describe('isStopped', () => {
  it('is true below 0.1 m/s and false above', () => {
    expect(isStopped(0.05)).toBe(true);
    expect(isStopped(0)).toBe(true);
    expect(isStopped(3)).toBe(false);
  });
});

describe('devices', () => {
  const keys = ['centre', 'platformKeeper', 'junctionKeeper', 'sensors'] as const;

  it('puts the four devices in four different places', () => {
    expect(new Set(keys.map((k) => `${DEVICE_SITES[k].x},${DEVICE_SITES[k].z}`)).size).toBe(4);
  });

  it('lights the lamp when on and puts it out when off, and changes the body', () => {
    for (const k of keys) {
      expect(deviceLook(k, true).light).not.toBeNull();
      expect(deviceLook(k, false).light).toBeNull();
      expect(deviceLook(k, true).body).not.toBe(deviceLook(k, false).body);
    }
  });

  it('keeps a switched-off device visible against the background', () => {
    for (const k of keys) expect(offDeviceVisible(k)).toBe(true);
  });
});

describe('junctionBusy', () => {
  const at = (track: TrackId, x: number): Snapshot => {
    const s = snapshotWith(x);
    return { ...s, trains: s.trains.map((t) => ({ ...t, pos: { ...t.pos, track } })) };
  };

  it('is true with a train in the last 100 m of a platform or the first 200 m of EXIT', () => {
    expect(junctionBusy(at('P2', 6350))).toBe(true);
    expect(junctionBusy(at('EXIT', 6650))).toBe(true);
  });

  it('is false with a train before the zone, past it, or on an entry line', () => {
    expect(junctionBusy(at('P2', 6290))).toBe(false);
    expect(junctionBusy(at('EXIT', 6750))).toBe(false);
    expect(junctionBusy(at('A', 5990))).toBe(false);
  });
});

describe('pathAt and routeOf', () => {
  const lane = (t: TrackId) => laneOf(t) * LANE_SPACING;

  it('runs straight along an entry line up to its end', () => {
    expect(pathAt(5990, routeOf('A', null))).toEqual({ z: lane('A'), slope: 0 });
  });

  it('bends from the entry lane into the platform over the points, then runs straight', () => {
    const route = routeOf('P1', null);
    expect(pathAt(6000, route).z).toBeCloseTo(lane('A'), 9);
    expect(pathAt(6000 + POINTS_LENGTH / 2, route).z).toBeCloseTo((lane('A') + lane('P1')) / 2, 9);
    expect(pathAt(6000 + POINTS_LENGTH / 2, route).slope).toBeCloseTo((lane('P1') - lane('A')) / POINTS_LENGTH, 9);
    expect(pathAt(6300, route)).toEqual({ z: lane('P1'), slope: 0 });
  });

  it('joins its platform pair first, then the pair joins EXIT, then runs straight', () => {
    const route = routeOf('EXIT', 'P4');
    expect(route.entry).toBe('B');
    expect(pathAt(6400, route).z).toBeCloseTo(lane('P4'), 9);
    expect(pathAt(6400 + EXIT_MERGE.pairs, route).z).toBeCloseTo(lane('B'), 9);
    expect(pathAt(6400 + EXIT_MERGE.pairs + EXIT_MERGE.join, route)).toEqual({ z: lane('EXIT'), slope: 0 });
    // Its partner platform joins the same pair lane.
    expect(pathAt(6400 + EXIT_MERGE.pairs, routeOf('EXIT', 'P3')).z).toBeCloseTo(lane('B'), 9);
  });

  it('keeps the rear cars on the entry line while the front is already in the platform', () => {
    const route = routeOf('P3', null);
    expect(pathAt(5950, route)).toEqual({ z: lane('B'), slope: 0 });
  });

  it('keeps a stopped train straight: the bends are clear of the platform stop', () => {
    for (const p of ['P1', 'P2', 'P3', 'P4'] as const) {
      expect(pathAt(6200, routeOf(p, null)).slope).toBe(0);
      expect(pathAt(6300, routeOf(p, null)).slope).toBe(0);
    }
  });
});
