import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/engine/engine';
import { ALL_ON } from '../../src/engine/switches';
import {
  DEVICE_SITES,
  LANE_SPACING,
  deviceLook,
  junctionBusy,
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
  it('looks straight down from above in overhead mode', () => {
    const { position, lookAt } = cameraPreset('overhead', frame);
    expect(position[0]).toBe(lookAt[0]);
    expect(position[2]).toBe(lookAt[2]);
    expect(position[1]).toBeGreaterThan(0);
  });

  it('sits off to one side of its target in angled mode', () => {
    const { position, lookAt } = cameraPreset('angled', frame);
    expect(position[2]).not.toBe(lookAt[2]);
    expect(position[1]).toBeGreaterThan(0);
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
