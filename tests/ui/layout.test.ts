import { afterEach, describe, expect, it } from 'vitest';
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
  acrossLine,
  exitJoinLength,
  exitJoinedX,
  stageGrowth,
  stationFrame,
  sensorSite,
  type Frame,
} from '../../src/ui/layout';
import { TRAIN_LENGTH } from '../../src/shared/constants';
import {
  ENTRIES,
  JUNCTION_END_X,
  LAYOUT_IDS,
  LAYOUTS,
  PLATFORMS,
  PLATFORM_STOP,
  TRACK_START,
  applyLayout,
  entryOf,
  pairOf,
  resetLayout,
} from '../../src/shared/map';
import type { TrackId } from '../../src/shared/types';

// Some tests below change the layout in use. Every test starts from the default again.
afterEach(() => resetLayout());

const frame: Frame = { xMin: 4000, xMax: 7000, width: 1500 };

function snapshotWith(x: number): Snapshot {
  return {
    now: 0,
    switches: ALL_ON,
    sensors: {
      platformOccupied: { P1: false, P2: false, P3: false, P4: false, P5: true, P6: true, P7: true, P8: true },
      junctionOccupied: false,
      exitStartClear: true,
    },
    trains: [
      {
        id: 1,
        pos: { track: 'A', offset: x },
        x,
        speed: 45,
        mode: 'blind',
        leaderId: null,
        leaderAge: null,
        permitAge: null,
        lastGrants: { platform: null, junction: false },
        nextTrack: null,
        sightAhead: null,
        trackside: { platformKeeper: null, junctionKeeper: null, sensorsAge: null, askedPlatformKeeper: null, askedJunctionKeeper: null },
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

describe('lanes in every layout', () => {
  const tracksInUse = (): TrackId[] => [...ENTRIES, ...PLATFORMS];

  it('keeps the default layout in the lanes it has always had', () => {
    expect((['P1', 'A', 'P2', 'EXIT', 'P3', 'B', 'P4'] as const).map(laneOf)).toEqual([0, 1, 2, 2.5, 3, 4, 5]);
  });

  it('gives every entry line and platform its own lane', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      const lanes = tracksInUse().map(laneOf);
      expect(new Set(lanes).size).toBe(lanes.length);
    }
  });

  it('puts each entry line in the lane between its two platforms', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      for (const entry of ENTRIES) {
        const [first, second] = pairOf(entry);
        expect(laneOf(first)).toBe(laneOf(entry) - 1);
        expect(laneOf(second)).toBe(laneOf(entry) + 1);
      }
    }
  });

  it('lays the four-line layout out as P1 A P2, P3 B P4, P5 C P6, P7 D P8', () => {
    applyLayout('hub');
    const inOrder = tracksInUse().sort((a, b) => laneOf(a) - laneOf(b));
    expect(inOrder).toEqual(['P1', 'A', 'P2', 'P3', 'B', 'P4', 'P5', 'C', 'P6', 'P7', 'D', 'P8']);
    expect(inOrder.map(laneOf)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('puts EXIT in the middle of the lanes the layout has', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      const lanes = tracksInUse().map(laneOf);
      expect(laneOf('EXIT')).toBe((Math.min(...lanes) + Math.max(...lanes)) / 2);
      // As many lanes on one side of EXIT as on the other.
      expect(lanes.filter((l) => l < laneOf('EXIT')).length).toBe(lanes.filter((l) => l > laneOf('EXIT')).length);
    }
  });

  it('never puts EXIT in a platform lane, and with an even number of lines it has a lane to itself', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      expect(PLATFORMS.map(laneOf)).not.toContain(laneOf('EXIT'));
      const shared = ENTRIES.filter((e) => laneOf(e) === laneOf('EXIT'));
      // With one or three lines the middle line runs straight on into EXIT.
      expect(shared).toEqual(ENTRIES.length % 2 === 1 ? [ENTRIES[(ENTRIES.length - 1) / 2]] : []);
    }
  });

  it('does not move a track when the layout changes, only EXIT', () => {
    const before = (['A', 'B', 'P1', 'P2', 'P3', 'P4'] as const).map(laneOf);
    applyLayout('hub');
    expect((['A', 'B', 'P1', 'P2', 'P3', 'P4'] as const).map(laneOf)).toEqual(before);
    expect(laneOf('EXIT')).toBe(5.5);
    applyLayout('busy');
    expect(laneOf('EXIT')).toBe(4);
    applyLayout('branch');
    expect(laneOf('EXIT')).toBe(1);
  });
});

describe('pathAt in every layout', () => {
  const lane = (t: TrackId) => laneOf(t) * LANE_SPACING;
  const intoExit = TRACK_START.EXIT;

  it('takes a train through P5 from line C, beside the platform, and out into EXIT', () => {
    applyLayout('hub');
    const route = routeOf('P5', null);
    expect(route).toEqual({ entry: 'C', platform: 'P5' });
    expect(pathAt(5900, route)).toEqual({ z: lane('C'), slope: 0 });
    expect(pathAt(TRACK_START.P5 + PLATFORM_STOP, route)).toEqual({ z: lane('P5'), slope: 0 });
    expect(pathAt(intoExit + EXIT_MERGE.pairs, route).z).toBeCloseTo(lane('C'), 9);
    expect(pathAt(exitJoinedX(), route)).toEqual({ z: lane('EXIT'), slope: 0 });
    expect(pathAt(7400, routeOf('EXIT', 'P5'))).toEqual({ z: lane('EXIT'), slope: 0 });
  });

  it('takes a train through P8 from line D, beside the platform, and out into EXIT', () => {
    applyLayout('hub');
    const route = routeOf('P8', null);
    expect(route).toEqual({ entry: 'D', platform: 'P8' });
    expect(pathAt(5900, route)).toEqual({ z: lane('D'), slope: 0 });
    expect(pathAt(TRACK_START.P8 + PLATFORM_STOP, route)).toEqual({ z: lane('P8'), slope: 0 });
    expect(pathAt(intoExit + EXIT_MERGE.pairs, route).z).toBeCloseTo(lane('D'), 9);
    // Line D is the furthest from EXIT, so its pair is the last to join.
    expect(pathAt(exitJoinedX() - 1, route).z).not.toBeCloseTo(lane('EXIT'), 3);
    expect(pathAt(exitJoinedX(), route)).toEqual({ z: lane('EXIT'), slope: 0 });
    expect(pathAt(7400, routeOf('EXIT', 'P8'))).toEqual({ z: lane('EXIT'), slope: 0 });
  });

  it('works out the route of every entry line and platform', () => {
    applyLayout('hub');
    for (const entry of ENTRIES) expect(routeOf(entry, null)).toEqual({ entry, platform: null });
    for (const p of PLATFORMS) {
      expect(routeOf(p, null)).toEqual({ entry: entryOf(p), platform: p });
      expect(routeOf('EXIT', p)).toEqual({ entry: entryOf(p), platform: p });
    }
    expect(routeOf('EXIT', null)).toEqual({ entry: null, platform: null });
  });

  it('has no jumps along x for any platform of any layout', () => {
    // The sharpest bend is the pairs' merge: one lane over EXIT_MERGE.pairs metres.
    const steepest = LANE_SPACING / EXIT_MERGE.pairs;
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      for (const p of PLATFORMS) {
        // The same train: on its platform, then on EXIT having left that platform.
        for (const route of [routeOf(p, null), routeOf('EXIT', p)]) {
          let last = pathAt(5800, route).z;
          for (let x = 5800.5; x <= 7200; x += 0.5) {
            const { z, slope } = pathAt(x, route);
            expect(Math.abs(z - last)).toBeLessThanOrEqual(steepest * 0.5 + 1e-9);
            expect(Math.abs(slope)).toBeLessThanOrEqual(steepest + 1e-12);
            last = z;
          }
        }
      }
    }
  });

  it('runs in the entry lane before the station, the platform lane beside it and the EXIT lane after it', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      for (const p of PLATFORMS) {
        const route = routeOf(p, null);
        expect(pathAt(TRACK_START[p] - 1, route)).toEqual({ z: lane(entryOf(p)), slope: 0 });
        for (const x of [TRACK_START[p] + POINTS_LENGTH, TRACK_START[p] + PLATFORM_STOP, intoExit - 1]) {
          expect(pathAt(x, route)).toEqual({ z: lane(p), slope: 0 });
        }
        expect(pathAt(exitJoinedX(), route)).toEqual({ z: lane('EXIT'), slope: 0 });
        expect(pathAt(stationFrame().xMax, route)).toEqual({ z: lane('EXIT'), slope: 0 });
      }
    }
  });

  it('joins both platforms of a pair into the entry line\'s lane first', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      for (const entry of ENTRIES) {
        for (const p of pairOf(entry)) {
          expect(pathAt(intoExit + EXIT_MERGE.pairs, routeOf('EXIT', p)).z).toBeCloseTo(lane(entry), 9);
        }
      }
    }
  });

  it('never bends the way into EXIT more sharply than about 30 degrees', () => {
    const degrees = (slope: number) => (Math.atan2(Math.abs(slope), UNITS_PER_METRE) * 180) / Math.PI;
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      for (const entry of ENTRIES) {
        const join = exitJoinLength(entry);
        if (join === 0) continue;
        const { slope } = pathAt(intoExit + EXIT_MERGE.pairs + join / 2, routeOf('EXIT', pairOf(entry)[0]));
        expect(degrees(slope)).toBeGreaterThan(0);
        expect(degrees(slope)).toBeLessThanOrEqual(33);
      }
    }
  });

  it('keeps a stopped train straight in every platform of every layout', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      for (const p of PLATFORMS) {
        // The whole train, from its front at the stop back to its rear.
        expect(pathAt(TRACK_START[p] + PLATFORM_STOP, routeOf(p, null)).slope).toBe(0);
        expect(pathAt(TRACK_START[p] + PLATFORM_STOP - TRAIN_LENGTH, routeOf(p, null)).slope).toBe(0);
      }
    }
  });
});

describe('the way into EXIT', () => {
  it('takes the default layout the 120 m it always has', () => {
    expect(exitJoinLength('A')).toBe(EXIT_MERGE.join);
    expect(exitJoinLength('B')).toBe(EXIT_MERGE.join);
    expect(exitJoinedX()).toBe(TRACK_START.EXIT + EXIT_MERGE.pairs + EXIT_MERGE.join);
  });

  it('takes longer the further a line is from EXIT', () => {
    applyLayout('hub');
    expect(exitJoinLength('B')).toBe(EXIT_MERGE.join);
    expect(exitJoinLength('C')).toBe(EXIT_MERGE.join);
    expect(exitJoinLength('A')).toBe(3 * EXIT_MERGE.join);
    expect(exitJoinLength('D')).toBe(3 * EXIT_MERGE.join);
    expect(exitJoinedX()).toBe(TRACK_START.EXIT + EXIT_MERGE.pairs + 3 * EXIT_MERGE.join);
  });

  it('is nothing for a line already in line with EXIT', () => {
    applyLayout('branch');
    expect(exitJoinLength('A')).toBe(0);
    expect(exitJoinedX()).toBe(TRACK_START.EXIT + EXIT_MERGE.pairs);
    applyLayout('busy');
    expect(exitJoinLength('B')).toBe(0);
    expect(exitJoinLength('A')).toBe(2 * EXIT_MERGE.join);
    expect(exitJoinLength('C')).toBe(2 * EXIT_MERGE.join);
  });
});

describe('stationFrame', () => {
  it('is the default frame in the default layout and in the one-line layout', () => {
    expect(stationFrame()).toEqual(STATION_FRAME);
    applyLayout('branch');
    expect(stationFrame()).toEqual(STATION_FRAME);
  });

  it('shows the whole way into EXIT and some straight track after it, at true scale', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      const f = stationFrame();
      expect(f.xMin).toBe(STATION_FRAME.xMin);
      expect(f.xMax).toBeGreaterThanOrEqual(exitJoinedX() + 2 * TRAIN_LENGTH);
      expect(f.xMax).toBeGreaterThan(JUNCTION_END_X);
      expect(f.width / (f.xMax - f.xMin)).toBeCloseTo(UNITS_PER_METRE, 9);
    }
  });

  it('is longer for the four-line layout, whose outer lines join EXIT last', () => {
    applyLayout('hub');
    expect(stationFrame().xMax).toBeGreaterThan(STATION_FRAME.xMax);
  });
});

describe('cameras in every layout', () => {
  const tanHalf = Math.tan((CAMERA_FOV / 2) * (Math.PI / 180));
  const distance = (p: ReturnType<typeof cameraPreset>) => Math.hypot(...p.position.map((v, i) => v - p.lookAt[i]));

  it('keeps the default layout where it has always been', () => {
    const overhead = cameraPreset('overhead', STATION_FRAME, 1.6);
    expect(overhead.lookAt).toEqual([72, 0, 5.5]);
    expect(overhead.position[1]).toBeCloseTo((72 * 1.03) / (tanHalf * 1.6), 9);
    const angled = cameraPreset('angled', STATION_FRAME, 1.6);
    expect(angled.lookAt[0]).toBeCloseTo(toScreenX(6150, STATION_FRAME), 9);
    expect(angled.lookAt[2]).toBe(6.5);
    expect(distance(angled)).toBeCloseTo(((40 * 1.03) / (tanHalf * 1.6)) * 0.82, 9);
  });

  it('runs across the line from the control centre to just past the last platform', () => {
    expect(acrossLine()).toEqual({ from: -10, to: 21 });
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      const lanes = PLATFORMS.map((p) => laneOf(p) * LANE_SPACING);
      expect(acrossLine().from).toBeLessThan(Math.min(...Object.values(DEVICE_SITES).map((s) => s.z)));
      expect(acrossLine().to).toBe(Math.max(...lanes) + 1);
    }
  });

  it('centres the overhead view on the lanes the layout has, and fits them', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      const f = stationFrame();
      const across = acrossLine();
      for (const aspect of [1, 1.6, 2.2]) {
        const { position, lookAt } = cameraPreset('overhead', f, aspect);
        expect(lookAt[0]).toBe(f.width / 2);
        expect(lookAt[2]).toBe((across.from + across.to) / 2);
        const height = position[1] - lookAt[1];
        expect(2 * height * tanHalf * aspect).toBeGreaterThanOrEqual(f.width);
        expect(2 * height * tanHalf).toBeGreaterThanOrEqual(across.to - across.from);
      }
    }
  });

  it('looks at the one-line layout from as close as the default, a little off the middle of its own lanes', () => {
    const usual = cameraPreset('angled', STATION_FRAME);
    applyLayout('branch');
    const branch = cameraPreset('angled', stationFrame());
    expect(distance(branch)).toBeCloseTo(distance(usual), 9);
    const across = acrossLine();
    expect(branch.lookAt[2]).toBeGreaterThan((across.from + across.to) / 2);
    expect(branch.lookAt[2]).toBeLessThan(laneOf('P2') * LANE_SPACING);
    expect(branch.lookAt[2]).toBeLessThan(usual.lookAt[2]);
  });

  it('backs the angled camera off for a deeper layout, in step with its depth', () => {
    const usual = cameraPreset('angled', STATION_FRAME);
    const usualDepth = acrossLine().to - acrossLine().from;
    for (const id of ['busy', 'hub'] as const) {
      applyLayout(id);
      const across = acrossLine();
      const p = cameraPreset('angled', stationFrame());
      expect(distance(p)).toBeCloseTo((distance(usual) * (across.to - across.from)) / usualDepth, 9);
      // Still aimed a little nearer than the middle of the lanes, as the default is.
      expect(p.lookAt[2]).toBeGreaterThan((across.from + across.to) / 2);
      expect(p.lookAt[2]).toBeLessThan(across.to);
      expect(p.position[2]).toBeGreaterThan(p.lookAt[2]);
    }
  });

  it('needs no more ground or shadow than the default until the layout is bigger', () => {
    expect(stageGrowth(stationFrame())).toBe(1);
    applyLayout('branch');
    expect(stageGrowth(stationFrame())).toBe(1);
    applyLayout('busy');
    const busy = stageGrowth(stationFrame());
    applyLayout('hub');
    const hub = stageGrowth(stationFrame());
    expect(busy).toBeGreaterThan(1);
    expect(hub).toBeGreaterThan(busy);
    // Enough for the deeper stage and for the longer frame.
    expect(hub).toBeGreaterThanOrEqual((acrossLine().to - acrossLine().from) / 31);
    expect(hub).toBeGreaterThanOrEqual(stationFrame().width / STATION_FRAME.width);
  });
});

describe('labels and the junction zone in every layout', () => {
  it('labels the entry lines, the platforms and EXIT of the layout in use, inside its frame', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      const f = stationFrame();
      const anchors = labelAnchors(f);
      const tracks = anchors.filter((a) => a.kind === 'track');
      expect(tracks.map((a) => a.text)).toEqual([...LAYOUTS[id].entries, ...PLATFORMS, 'EXIT']);
      for (const a of tracks) {
        expect(a.z).toBe(laneOf(a.text as TrackId) * LANE_SPACING);
        expect(a.x).toBeGreaterThanOrEqual(f.xMin);
        expect(a.x).toBeLessThanOrEqual(f.xMax);
      }
      expect(anchors.filter((a) => a.kind === 'device')).toHaveLength(4);
    }
  });

  it('labels the lines of the four-line layout', () => {
    applyLayout('hub');
    const texts = labelAnchors(stationFrame()).map((a) => a.text);
    for (const t of ['C', 'D', 'P5', 'P6', 'P7', 'P8']) expect(texts).toContain(t);
  });

  it('does not label a track the layout does not have', () => {
    applyLayout('branch');
    const texts = labelAnchors(stationFrame()).map((a) => a.text);
    for (const t of ['B', 'P3', 'P4']) expect(texts).not.toContain(t);
  });

  it('keeps the devices clear of every lane', () => {
    applyLayout('hub');
    for (const key of ['centre', 'platformKeeper', 'junctionKeeper'] as const) {
      expect(DEVICE_SITES[key].z).toBeLessThan(laneOf('P1') * LANE_SPACING);
    }
  });

  it('puts each platform sensor box on its island, beside its own track and clear of both lanes', () => {
    applyLayout('hub');
    for (const p of PLATFORMS) {
      const box = sensorSite(p);
      const own = laneOf(p) * LANE_SPACING;
      const island = laneOf(entryOf(p)) * LANE_SPACING;
      expect(Math.abs(box.z - own)).toBeLessThan(Math.abs(island - own));
      expect(Math.abs(box.z - island)).toBeLessThan(2.1);
      expect(Math.abs(box.z - own)).toBeGreaterThan(1.5);
      expect(box.x).toBeGreaterThan(TRACK_START[p]);
      expect(box.x).toBeLessThan(TRACK_START.EXIT);
    }
    expect(new Set(PLATFORMS.map((p) => sensorSite(p).z)).size).toBe(PLATFORMS.length);
    expect(sensorSite('P1')).toEqual(DEVICE_SITES.sensors);
  });

  it('lights the junction zone for a train at the end of P7, and not for one on line C or D', () => {
    applyLayout('hub');
    const at = (track: TrackId, x: number): Snapshot => {
      const s = snapshotWith(x);
      return { ...s, trains: s.trains.map((t) => ({ ...t, pos: { ...t.pos, track } })) };
    };
    expect(junctionBusy(at('P7', 6350))).toBe(true);
    expect(junctionBusy(at('P6', 6290))).toBe(false);
    expect(junctionBusy(at('C', 5990))).toBe(false);
    expect(junctionBusy(at('D', 5990))).toBe(false);
  });

  it('puts a train on line D in line D\'s lane', () => {
    applyLayout('hub');
    const s = snapshotWith(5500);
    const onD: Snapshot = { ...s, trains: s.trains.map((t) => ({ ...t, pos: { ...t.pos, track: 'D' as const } })) };
    expect(markersFor(onD, stationFrame())[0].lane).toBe(laneOf('D'));
  });
});
