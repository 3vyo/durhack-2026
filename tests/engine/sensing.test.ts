import { afterEach, describe, expect, it } from 'vitest';
import type { Body } from '../../src/engine/footprint';
import { readSensors, sightAhead } from '../../src/engine/sensing';
import { ALL_ON } from '../../src/engine/switches';
import { ALL_PLATFORMS, LAYOUT_IDS, PLATFORMS, applyLayout, resetLayout } from '../../src/shared/map';
import type { TrackId } from '../../src/shared/types';

afterEach(() => resetLayout());

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

describe('sightAhead on the entry tracks and platforms of the bigger layouts', () => {
  it('sees a train ahead on C or D, and not a train at the same place on another entry track', () => {
    expect(sightAhead(body(1, 'C', 1000), null, [body(2, 'C', 1300)])).toBe(200);
    expect(sightAhead(body(1, 'D', 1000), null, [body(2, 'D', 1300)])).toBe(200);
    expect(sightAhead(body(1, 'C', 1000), null, [body(2, 'D', 1300)])).toBeNull();
    expect(sightAhead(body(1, 'D', 1000), null, [body(2, 'A', 1300)])).toBeNull();
  });

  it('follows nextTrack from D into P7, and does not see a train in P8', () => {
    expect(sightAhead(body(1, 'D', 5900), 'P7', [body(2, 'P7', 150, 'D')])).toBe(150);
    expect(sightAhead(body(1, 'D', 5900), 'P7', [body(2, 'P8', 150, 'D')])).toBeNull();
    expect(sightAhead(body(1, 'C', 5900), 'P6', [body(2, 'P6', 150, 'C')])).toBe(150);
    expect(sightAhead(body(1, 'C', 5900), 'P6', [body(2, 'P5', 150, 'C')])).toBeNull();
  });

  it('sees the rear of a train that has just left D, whatever its own nextTrack is', () => {
    const spanning = body(2, 'P7', 50, 'D');
    expect(sightAhead(body(1, 'D', 5700), 'P8', [spanning])).toBe(250);
    expect(sightAhead(body(1, 'D', 5700), null, [spanning])).toBe(250);
  });

  it('reports the edge of an occupied junction zone to a train in P7', () => {
    const inZone = body(2, 'EXIT', 50, 'P2');
    expect(sightAhead(body(1, 'P7', 100, 'D'), 'EXIT', [inZone])).toBe(200);
    expect(sightAhead(body(1, 'P7', 300, 'D'), 'EXIT', [inZone])).toBe(0);
    expect(sightAhead(body(1, 'P7', 299.99, 'D'), 'EXIT', [inZone])).toBeCloseTo(0.01, 6);
  });

  it('reports the zone edge to a train in P5 while a train from P8 is in the zone', () => {
    const inZone = body(2, 'P8', 350, 'D');
    expect(sightAhead(body(1, 'P5', 150, 'C'), 'EXIT', [inZone])).toBe(150);
  });

  it('reports nothing to a train in P7 while the junction zone is empty', () => {
    const waiting = body(2, 'P2', 299.99, 'A');
    expect(sightAhead(body(1, 'P7', 100, 'D'), 'EXIT', [waiting])).toBeNull();
  });

  it('measures the zone edge from D and C through the platform, like from A', () => {
    // From the very end of an entry track the edge is exactly SENSOR_RANGE away.
    const inZone = body(2, 'P7', 350, 'D');
    expect(sightAhead(body(1, 'D', 6000), 'P8', [inZone])).toBe(300);
    expect(sightAhead(body(1, 'C', 6000), 'P5', [inZone])).toBe(300);
    expect(sightAhead(body(1, 'A', 6000), 'P1', [inZone])).toBe(300);
    expect(sightAhead(body(1, 'D', 5990), 'P8', [inZone])).toBeNull();
  });

  it('takes the nearer of a train rear in P7 and the zone edge', () => {
    const onPlatform = body(2, 'P7', 350, 'D');
    expect(sightAhead(body(1, 'D', 5980), 'P7', [onPlatform])).toBe(20 + 250);
  });

  it('does not treat a train far along C or D as being in the junction zone', () => {
    // An entry track is never part of the zone, however large the offset.
    const onD = body(2, 'D', 5000);
    expect(sightAhead(body(1, 'P1', 100, 'A'), 'EXIT', [onD])).toBeNull();
    expect(sightAhead(body(1, 'P5', 100, 'C'), 'EXIT', [body(2, 'C', 5000)])).toBeNull();
  });
});

describe('readSensors on each layout', () => {
  it('reads the platforms of the layout empty and every other platform occupied', () => {
    for (const layout of LAYOUT_IDS) {
      applyLayout(layout);
      const r = readSensors([], ALL_ON);
      expect(Object.keys(r.platformOccupied).sort()).toEqual([...ALL_PLATFORMS]);
      for (const p of ALL_PLATFORMS) expect(r.platformOccupied[p], `${layout} ${p}`).toBe(!PLATFORMS.includes(p));
    }
  });

  it('reads only P1 and P2 empty on the branch layout', () => {
    applyLayout('branch');
    expect(readSensors([], ALL_ON).platformOccupied).toEqual({
      P1: false, P2: false, P3: true, P4: true, P5: true, P6: true, P7: true, P8: true,
    });
  });

  it('reads P1 to P6 empty on the busy layout', () => {
    applyLayout('busy');
    expect(readSensors([], ALL_ON).platformOccupied).toEqual({
      P1: false, P2: false, P3: false, P4: false, P5: false, P6: false, P7: true, P8: true,
    });
  });

  it('reads every platform empty on the hub layout, and P7 occupied while a train is on it', () => {
    applyLayout('hub');
    expect(readSensors([], ALL_ON).platformOccupied).toEqual({
      P1: false, P2: false, P3: false, P4: false, P5: false, P6: false, P7: false, P8: false,
    });
    expect(readSensors([body(1, 'P7', 200, 'D')], ALL_ON).platformOccupied).toEqual({
      P1: false, P2: false, P3: false, P4: false, P5: false, P6: false, P7: true, P8: false,
    });
  });

  it('keeps P6 and P8 occupied while only the rear of a train is on them', () => {
    applyLayout('hub');
    const r = readSensors([body(1, 'EXIT', 50, 'P6'), body(2, 'EXIT', 400, 'P8')], ALL_ON);
    expect(r.platformOccupied.P6).toBe(true);
    expect(r.platformOccupied.P5).toBe(false);
    expect(r.platformOccupied.P8).toBe(false);
  });

  it('reads all eight platforms occupied on every layout when the sensors are switched off', () => {
    for (const layout of LAYOUT_IDS) {
      applyLayout(layout);
      const r = readSensors([], { ...ALL_ON, sensors: false });
      expect(r.platformOccupied, layout).toEqual({
        P1: true, P2: true, P3: true, P4: true, P5: true, P6: true, P7: true, P8: true,
      });
    }
  });

  it('reads the junction and the start of EXIT for a train from P7 or P8', () => {
    applyLayout('hub');
    expect(readSensors([body(1, 'P7', 350, 'D')], ALL_ON).junctionOccupied).toBe(true);
    expect(readSensors([body(1, 'P7', 299.99, 'D')], ALL_ON).junctionOccupied).toBe(false);
    expect(readSensors([body(1, 'EXIT', 250, 'P8')], ALL_ON).junctionOccupied).toBe(true);
    expect(readSensors([body(1, 'EXIT', 250, 'P8')], ALL_ON).exitStartClear).toBe(false);
    expect(readSensors([body(1, 'EXIT', 450, 'P8')], ALL_ON).exitStartClear).toBe(true);
  });

  it('does not read the junction occupied for trains running on C and D', () => {
    applyLayout('hub');
    const r = readSensors([body(1, 'C', 5000), body(2, 'D', 6000)], ALL_ON);
    expect(r.junctionOccupied).toBe(false);
    expect(r.exitStartClear).toBe(true);
  });
});

describe('readSensors', () => {
  it('reads a platform occupied while a train is on it', () => {
    const r = readSensors([body(1, 'P2', 200, 'A')], ALL_ON);
    // P5 to P8 are not in the default layout, so they read occupied.
    expect(r.platformOccupied).toEqual({
      P1: false, P2: true, P3: false, P4: false, P5: true, P6: true, P7: true, P8: true,
    });
  });

  it('keeps a platform occupied while only the rear of a train is on it', () => {
    const r = readSensors([body(1, 'EXIT', 50, 'P1')], ALL_ON);
    expect(r.platformOccupied.P1).toBe(true);
    expect(r.platformOccupied.P2).toBe(false);
  });

  it('reads every platform occupied when the sensors are switched off', () => {
    const r = readSensors([], { ...ALL_ON, sensors: false });
    expect(r.platformOccupied).toEqual({
      P1: true, P2: true, P3: true, P4: true, P5: true, P6: true, P7: true, P8: true,
    });
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
