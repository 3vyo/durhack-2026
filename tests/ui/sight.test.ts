import { describe, expect, it } from 'vitest';
import type { TrainView } from '../../src/engine/engine';
import { sightCone } from '../../src/ui/sight';

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

describe('sightCone', () => {
  it('starts at the front of the train and finds nothing when the sensor sees nothing', () => {
    expect(sightCone(view(), null)).toEqual({ route: { entry: 'A', platform: null }, frontX: 5000, obstacleX: null });
  });

  it('marks the obstacle the sensor reported, that far ahead of the front', () => {
    expect(sightCone(view({ sightAhead: 120 }), null).obstacleX).toBe(5120);
  });

  it('heads into the platform the train has set, so it turns with the points', () => {
    expect(sightCone(view({ pos: { track: 'B', offset: 5900 }, x: 5900, nextTrack: 'P4' }), null).route).toEqual({ entry: 'B', platform: 'P4' });
  });

  it('follows a train on EXIT out of the platform it came from', () => {
    expect(sightCone(view({ pos: { track: 'EXIT', offset: 10 }, x: 6410 }), 'P2').route).toEqual({ entry: 'A', platform: 'P2' });
  });
});
