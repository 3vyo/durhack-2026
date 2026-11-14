import { describe, expect, it } from 'vitest';
import type { Message, TrainState } from '../../src/shared/types';
import {
  latestLeaderReport,
  leaderLimit,
  modeFor,
  positionMessage,
  sightLimit,
  stopPointLimit,
  type LeaderReport,
} from '../../src/train/follow';

const self: TrainState = { id: 2, pos: { track: 'A', offset: 1000 }, speed: 30, brokenDown: false };
const report: LeaderReport = { pos: { track: 'A', offset: 2000 }, speed: 30, sentAt: 9 };
const fromLeader: Message = { type: 'position', from: 1, pos: { track: 'A', offset: 2000 }, speed: 30, sentAt: 9 };

describe('follow.ts placeholders', () => {
  it('positionMessage sends nothing', () => {
    expect(positionMessage(10, self, null)).toBeNull();
  });

  it('latestLeaderReport knows nothing about the leader', () => {
    expect(latestLeaderReport(null, [fromLeader], 1)).toBeNull();
    expect(latestLeaderReport(report, [fromLeader], 1)).toBeNull();
  });

  it('leaderLimit is 0 with or without a report', () => {
    expect(leaderLimit(self.pos, report)).toBe(0);
    expect(leaderLimit(self.pos, null)).toBe(0);
  });

  it('sightLimit is 0 with or without an obstacle', () => {
    expect(sightLimit(200)).toBe(0);
    expect(sightLimit(null)).toBe(0);
  });

  it('stopPointLimit is 0 with or without a platform', () => {
    expect(stopPointLimit(self.pos, null)).toBe(0);
    expect(stopPointLimit({ track: 'P1', offset: 100 }, 'P1')).toBe(0);
  });

  it('modeFor reports blind', () => {
    expect(modeFor(10, report, true)).toBe('blind');
    expect(modeFor(10, null, false)).toBe('blind');
  });
});

describe('Following: position broadcast', () => {
  it.todo('sends a position message over long range once every second');
  it.todo('the position message carries its own id, front position, speed and sentAt equal to now');
  it.todo('sends its first position message on its first tick');
  it.todo('does not send a second position message within the same second');
  it.todo('keeps broadcasting while stopped, in a platform and on EXIT');
});

describe('Following: leader reports', () => {
  it.todo('on A or B, starts with the leader the timetable names');
  it.todo('keeps the newest position report from its leader');
  it.todo('ignores position reports from trains other than its leader');
  it.todo('ignores a report with an older sentAt than the one it holds');
  it.todo('keeps its last report when the inbox has nothing from the leader');
  it.todo('holds no report when the leader is unknown');
});

describe('Following: leader limit point', () => {
  it.todo('the limit point is the leader rear (front minus TRAIN_LENGTH) minus MARGIN');
  it.todo('measures the distance to the limit point on the shared x axis when the leader is on another track');
  it.todo('the leader limit is safeSpeed of the distance to the limit point');
  it.todo('the leader limit is capped at MAX_SPEED');
  it.todo('the leader limit never falls below SIGHT_SPEED, even at or past the limit point');
  it.todo('a stale leader report still sets the limit point, however old it is');
  it.todo('with a report but no fresh one, the limit point stays where the old report put it');
  it.todo('the leader limit is SIGHT_SPEED when the train has never heard its leader');
  it.todo('the leader limit is SIGHT_SPEED when the leader is unknown');
});

describe('Following: sightAhead', () => {
  it.todo('the sightAhead limit is safeSpeed(sightAhead - MARGIN)');
  it.todo('the sightAhead limit has no SIGHT_SPEED floor');
  it.todo('the sightAhead limit is 0 when sightAhead is MARGIN or less');
  it.todo('a null sightAhead adds no limit');
  it.todo('sightAhead lowers the limit below the SIGHT_SPEED floor of the leader limit');
  it.todo('an occupied junction zone seen through sightAhead slows the train like a train would');
});

describe('Following: stop points', () => {
  it.todo('the end of an entry track is a stop point for a train with no platform');
  it.todo('the end of an entry track is not a stop point once the train has a platform');
  it.todo('offset 300 in a platform is a stop point');
  it.todo('a train on EXIT has no stop point');
  it.todo('the stop point limit is safeSpeed of the distance to the stop point');
  it.todo('the stop point limit has no SIGHT_SPEED floor');
  it.todo('the stop point limit is 0 at or past the stop point');
  it.todo('brakes one tick early, so from MAX_SPEED it stops at or a few centimetres before the stop point');
  it.todo('never passes a stop point, so it never enters the junction zone from a platform by rounding');
});

describe('Following: mode', () => {
  it.todo('reports central while it holds a permit under 5 seconds old');
  it.todo('central takes priority over full, stale and blind');
  it.todo('reports full when the leader report is under FRESH seconds old');
  it.todo('reports stale when the leader report is FRESH seconds old or older');
  it.todo('reports blind when it has never heard its leader');
  it.todo('reports blind when its leader is unknown');
});
