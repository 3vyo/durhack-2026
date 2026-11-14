import { describe, expect, it } from 'vitest';
import type { Body } from '../../src/engine/footprint';
import { readSensors, sightAhead } from '../../src/engine/sensing';
import { ALL_ON } from '../../src/engine/switches';
import type { TrackId } from '../../src/shared/types';

function body(id: number, track: TrackId, offset: number, prev: TrackId | null = null): Body {
  return { state: { id, pos: { track, offset }, speed: 10, brokenDown: false }, prev };
}

describe('sightAhead', () => {
  it('is the distance from the front of self to the rear of a train ahead on the same track', () => {
    expect(sightAhead(body(1, 'A', 1000), null, [body(2, 'A', 1300)])).toBe(200);
  });

  it('is null beyond SENSOR_RANGE', () => {
    expect(sightAhead(body(1, 'A', 1000), null, [body(2, 'A', 1500)])).toBeNull();
  });

  it('ignores a train behind', () => {
    expect(sightAhead(body(1, 'A', 1000), null, [body(2, 'A', 900)])).toBeNull();
  });

  it('follows nextTrack across a boundary', () => {
    const other = body(2, 'P1', 150, 'A');
    expect(sightAhead(body(1, 'A', 5900), 'P1', [other])).toBe(150);
  });

  it('does not see a train on the other platform', () => {
    const other = body(2, 'P2', 150, 'A');
    expect(sightAhead(body(1, 'A', 5900), 'P1', [other])).toBeNull();
  });

  it('sees a train that spans two tracks, whatever its own nextTrack is', () => {
    const spanning = body(2, 'P1', 50, 'A');
    expect(sightAhead(body(1, 'A', 5700), 'P2', [spanning])).toBe(250);
    expect(sightAhead(body(1, 'A', 5700), null, [spanning])).toBe(250);
  });

  it('reports the edge of an occupied junction zone as an obstacle', () => {
    const inZone = body(2, 'EXIT', 50, 'P2');
    expect(sightAhead(body(1, 'P1', 100, 'A'), 'EXIT', [inZone])).toBe(200);
  });

  it('does not see the zone edge from an entry track, because it is beyond SENSOR_RANGE', () => {
    const inZone = body(2, 'EXIT', 50, 'P2');
    expect(sightAhead(body(1, 'A', 5990), 'P1', [inZone])).toBeNull();
  });

  it('takes the nearer of a train rear on the path and the zone edge', () => {
    const onPlatform = body(2, 'P1', 350, 'A');
    expect(sightAhead(body(1, 'A', 5980), 'P1', [onPlatform])).toBe(20 + 250);
  });

  it('reports the zone edge as 0 for a train standing exactly at it, so it does not slip in unwarned', () => {
    const inZone = body(2, 'EXIT', 50, 'P2');
    expect(sightAhead(body(1, 'P1', 300, 'A'), 'EXIT', [inZone])).toBe(0);
  });

  it('warns a train a centimetre short of the edge', () => {
    const inZone = body(2, 'EXIT', 50, 'P2');
    expect(sightAhead(body(1, 'P1', 299.99, 'A'), 'EXIT', [inZone])).toBeCloseTo(0.01, 6);
  });

  it('takes the nearest obstacle when there are several', () => {
    const near = body(2, 'A', 1250);
    const far = body(3, 'A', 1400);
    expect(sightAhead(body(1, 'A', 1000), null, [far, near])).toBe(150);
  });

  it('never counts itself as an obstacle', () => {
    const self = body(1, 'A', 1000);
    expect(sightAhead(self, null, [self])).toBeNull();
  });
});

describe('readSensors', () => {
  it('reads a platform occupied while a train is on it', () => {
    const r = readSensors([body(1, 'P2', 200, 'A')], ALL_ON);
    expect(r.platformOccupied).toEqual({ P1: false, P2: true, P3: false, P4: false });
  });

  it('keeps a platform occupied while only the rear of a train is on it', () => {
    const r = readSensors([body(1, 'EXIT', 50, 'P1')], ALL_ON);
    expect(r.platformOccupied.P1).toBe(true);
    expect(r.platformOccupied.P2).toBe(false);
  });

  it('reads every platform occupied when the sensors are switched off', () => {
    const r = readSensors([], { ...ALL_ON, sensors: false });
    expect(r.platformOccupied).toEqual({ P1: true, P2: true, P3: true, P4: true });
  });

  it('reads the junction occupied while any part of a train is in the zone', () => {
    expect(readSensors([body(1, 'P1', 350, 'A')], ALL_ON).junctionOccupied).toBe(true);
    expect(readSensors([body(1, 'EXIT', 250, 'P1')], ALL_ON).junctionOccupied).toBe(true);
    expect(readSensors([body(1, 'EXIT', 350, 'P1')], ALL_ON).junctionOccupied).toBe(false);
    expect(readSensors([], ALL_ON).junctionOccupied).toBe(false);
  });

  it('keeps reading the junction when the platform sensors are off', () => {
    const r = readSensors([body(1, 'P1', 350, 'A')], { ...ALL_ON, sensors: false });
    expect(r.junctionOccupied).toBe(true);
  });

  it('reads the start of EXIT clear only when no part of a train is in its first 300 m', () => {
    expect(readSensors([], ALL_ON).exitStartClear).toBe(true);
    expect(readSensors([body(1, 'EXIT', 250, 'P1')], ALL_ON).exitStartClear).toBe(false);
    expect(readSensors([body(1, 'EXIT', 450, 'P1')], ALL_ON).exitStartClear).toBe(true);
    expect(readSensors([body(1, 'EXIT', 350, 'P1')], ALL_ON).exitStartClear).toBe(false);
  });
});
