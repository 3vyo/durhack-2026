import { describe, expect, it } from 'vitest';
import type { TrainView } from '../../src/engine/engine';
import { SENSOR_RANGE } from '../../src/shared/constants';
import { sightBeam } from '../../src/ui/sight';

function view(over: Partial<TrainView> = {}): TrainView {
  return {
    id: 1,
    pos: { track: 'A', offset: 5000 },
    x: 5000,
    speed: 20,
    mode: 'full',
    leaderId: null,
    leaderAge: null,
    permitAge: null,
    lastGrants: { platform: null, junction: false },
    trackside: { platformKeeper: null, junctionKeeper: null, sensorsAge: null, askedPlatformKeeper: null, askedJunctionKeeper: null },
    nextTrack: null,
    sightAhead: null,
    ...over,
  };
}

describe('sightBeam', () => {
  it('reaches the full sensor range when nothing is in the way', () => {
    expect(sightBeam(view(), null)).toEqual({ route: { entry: 'A', platform: null }, fromX: 5000, toX: 5000 + SENSOR_RANGE, blocked: false });
  });

  it('stops at the obstacle the sensor reported, and says it is blocked', () => {
    const beam = sightBeam(view({ sightAhead: 120 }), null);
    expect(beam.toX).toBe(5120);
    expect(beam.blocked).toBe(true);
  });

  it('ends at the end of an entry line when the train has no platform set', () => {
    const beam = sightBeam(view({ pos: { track: 'A', offset: 5900 }, x: 5900 }), null);
    expect(beam.toX).toBe(6000);
    expect(beam.blocked).toBe(false);
  });

  it('runs on into the platform the train has set, bending with the points', () => {
    const beam = sightBeam(view({ pos: { track: 'B', offset: 5900 }, x: 5900, nextTrack: 'P4' }), null);
    expect(beam.toX).toBe(5900 + SENSOR_RANGE);
    expect(beam.route).toEqual({ entry: 'B', platform: 'P4' });
  });

  it('follows a train on EXIT out of the platform it came from', () => {
    const beam = sightBeam(view({ pos: { track: 'EXIT', offset: 10 }, x: 6410 }), 'P2');
    expect(beam.route).toEqual({ entry: 'A', platform: 'P2' });
  });
});
