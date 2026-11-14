import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/engine/engine';
import { cameraPreset, laneOf, markersFor, toScreenX, type Frame } from '../../src/ui/layout';
import { TRAIN_LENGTH } from '../../src/shared/constants';
import type { TrackId } from '../../src/shared/types';

const frame: Frame = { xMin: 4000, xMax: 7000, width: 1500 };

function snapshotWith(x: number): Snapshot {
  return {
    now: 0,
    trains: [{ id: 1, pos: { track: 'A', offset: x }, x, speed: 45, mode: 'blind' }],
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
