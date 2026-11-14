import { describe, expect, it } from 'vitest';
import {
  BRAKE,
  FRESH,
  MARGIN,
  MAX_SPEED,
  SIGHT_SPEED,
  TICK,
  TRAIN_LENGTH,
  safeSpeed,
} from '../../src/shared/constants';
import type { Message, TrainState } from '../../src/shared/types';
import { createAgent, initialMemory } from '../../src/train/agent';
import {
  brakeLimit,
  hasLeft,
  isPastPlatformStop,
  leaderLimit,
  leaderReport,
  leavingMessage,
  modeFor,
  positionMessage,
  recordPositions,
  sightLimit,
  stopPointLimit,
  type PositionReport,
  type ReportLog,
} from '../../src/train/follow';
import { STOP_SHORT, trainNumbers } from '../../src/train/numbers';
import { sightTo, startRun, tick, ticks, timetable } from './sim';

const N = trainNumbers();

const self: TrainState = { id: 2, pos: { track: 'A', offset: 1000 }, speed: 30, brokenDown: false };
const report: PositionReport = { pos: { track: 'A', offset: 2000 }, speed: 30, sentAt: 9 };
const fromLeader: Message = { type: 'position', from: 1, pos: { track: 'A', offset: 2000 }, speed: 30, sentAt: 9 };

/** Half a tick of braking: how far under safeSpeed a train runs so its stepped stop does not overrun. */
const EARLY = (BRAKE * TICK) / 2;

function at(track: TrainState['pos']['track'], offset: number, speed = 0): TrainState {
  return { id: 2, pos: { track, offset }, speed, brokenDown: false };
}

describe('Following: position broadcast', () => {
  it('sends a position message over long range once every second', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 0 }, SIGHT_SPEED);
    ticks(run, 50);
    const sent = run.sent.filter((o) => o.msg.type === 'position');
    expect(sent).toHaveLength(5);
    expect(sent.every((o) => o.range === 'long')).toBe(true);
  });

  it('the position message carries its own id, front position, speed and sentAt equal to now', () => {
    expect(positionMessage(10, self, null, N)).toEqual({
      msg: { type: 'position', from: 2, pos: { track: 'A', offset: 1000 }, speed: 30, sentAt: 10 },
      range: 'long',
    });
  });

  it('sends its first position message on its first tick', () => {
    expect(positionMessage(0, self, null, N)).not.toBeNull();
  });

  it('does not send a second position message within the same second', () => {
    expect(positionMessage(10.5, self, 10, N)).toBeNull();
    expect(positionMessage(10.9, self, 10, N)).toBeNull();
  });

  it('sends on the tick a second has passed even when now - lastSentAt is a rounding error short (half a tick of slack)', () => {
    expect(positionMessage(10.999999999, self, 10, N)).not.toBeNull();
    expect(positionMessage(0.1 + 0.2 + 0.7, self, 0, N)).not.toBeNull();
  });

  it('keeps broadcasting while stopped, in a platform and on EXIT', () => {
    expect(positionMessage(11, at('A', 5999, 0), 10, N)).not.toBeNull();
    expect(positionMessage(11, at('P1', 299, 0), 10, N)).not.toBeNull();
    expect(positionMessage(11, at('EXIT', 500, 30), 10, N)).not.toBeNull();
  });
});

describe('Following: position reports', () => {
  it('on A or B, starts with the leader the timetable names', () => {
    expect(initialMemory(2, timetable).leader).toBe(1);
  });

  it('on A or B, a timetable leader of null means no train ahead (leader none)', () => {
    expect(initialMemory(1, timetable).leader).toBe('none');
  });

  it('keeps the newest position report from every train it hears, not only its leader', () => {
    const other: Message = { type: 'position', from: 7, pos: { track: 'EXIT', offset: 10 }, speed: 5, sentAt: 8 };
    const log = recordPositions({}, [fromLeader, other]);
    expect(log[1]).toEqual(report);
    expect(log[7]).toEqual({ pos: { track: 'EXIT', offset: 10 }, speed: 5, sentAt: 8 });
  });

  it('ignores a report with an older sentAt than the one it holds for that train', () => {
    const older: Message = { ...fromLeader, pos: { track: 'A', offset: 1500 }, sentAt: 8 };
    expect(recordPositions({ 1: report }, [older])[1]).toEqual(report);
  });

  it('keeps its reports when the inbox has nothing new', () => {
    const prev: ReportLog = { 1: report };
    expect(recordPositions(prev, [])).toBe(prev);
    expect(recordPositions(prev, [fromLeader])).toBe(prev);
  });

  it('looks up its leader in the report log', () => {
    expect(leaderReport({ 1: report }, 1)).toBe(report);
    expect(leaderReport({ 1: report }, 5)).toBeNull();
  });

  it('finds no report when the leader is none or unknown', () => {
    expect(leaderReport({ 1: report }, 'none')).toBeNull();
    expect(leaderReport({ 1: report }, 'unknown')).toBeNull();
  });

  it('uses the newest report it has heard from a new leader, from before the leader changed', () => {
    const log = recordPositions({}, [
      { type: 'position', from: 7, pos: { track: 'EXIT', offset: 100 }, speed: 5, sentAt: 3 },
      { type: 'position', from: 7, pos: { track: 'EXIT', offset: 400 }, speed: 9, sentAt: 4 },
    ]);
    expect(leaderReport(log, 7)).toEqual({ pos: { track: 'EXIT', offset: 400 }, speed: 9, sentAt: 4 });
  });
});

describe('Following: leader limit point', () => {
  const near: PositionReport = { pos: { track: 'A', offset: 1400 }, speed: 0, sentAt: 9 };

  it('the limit point is the leader rear (front minus TRAIN_LENGTH) minus MARGIN', () => {
    // Leader front at 1400, so the limit point is 1250, 250 m ahead of a train at 1000.
    expect(leaderLimit(self.pos, 1, near, N)).toBeCloseTo(brakeLimit(1400 - TRAIN_LENGTH - MARGIN - 1000), 9);
    // At the limit point itself only the floor is left.
    expect(leaderLimit({ track: 'A', offset: 1250 }, 1, near, N)).toBe(SIGHT_SPEED);
  });

  it('measures the distance to the limit point on the shared x axis when the leader is on another track', () => {
    const onExit: PositionReport = { pos: { track: 'EXIT', offset: 150 }, speed: 0, sentAt: 9 };
    // Leader front at x 6550, limit point at x 6400. The train is at x 6100 in P1.
    expect(leaderLimit({ track: 'P1', offset: 100 }, 1, onExit, N)).toBeCloseTo(brakeLimit(300), 9);
  });

  it('the leader limit is safeSpeed of the distance to the limit point, braked one tick early', () => {
    const distance = 300;
    const far: PositionReport = { pos: { track: 'A', offset: 1000 + distance + TRAIN_LENGTH + MARGIN }, speed: 0, sentAt: 9 };
    expect(leaderLimit(self.pos, 1, far, N)).toBeCloseTo(safeSpeed(distance - STOP_SHORT) - EARLY, 9);
  });

  it('the leader limit is capped at MAX_SPEED', () => {
    const far: PositionReport = { pos: { track: 'A', offset: 5900 }, speed: 0, sentAt: 9 };
    expect(leaderLimit(self.pos, 1, far, N)).toBe(MAX_SPEED);
  });

  it('the leader limit never falls below SIGHT_SPEED, even at or past the limit point', () => {
    expect(leaderLimit({ track: 'A', offset: 1240 }, 1, near, N)).toBe(SIGHT_SPEED);
    expect(leaderLimit({ track: 'A', offset: 1250 }, 1, near, N)).toBe(SIGHT_SPEED);
    expect(leaderLimit({ track: 'A', offset: 1390 }, 1, near, N)).toBe(SIGHT_SPEED);
  });

  it('a stale leader report still sets the limit point, however old it is', () => {
    const old: PositionReport = { ...near, sentAt: -1000 };
    const far: PositionReport = { pos: { track: 'A', offset: 1800 }, speed: 0, sentAt: -1000 };
    expect(leaderLimit(self.pos, 1, old, N)).toBe(leaderLimit(self.pos, 1, near, N));
    expect(leaderLimit(self.pos, 1, far, N)).toBeCloseTo(brakeLimit(650), 9);
  });

  it('with a report but no fresh one, the limit point stays where the old report put it', () => {
    const agent = createAgent(2, timetable);
    const run = startRun(agent, 2, { track: 'A', offset: 1000 }, SIGHT_SPEED);
    tick(run, [{ type: 'position', from: 1, pos: { track: 'A', offset: 2000 }, speed: 0, sentAt: 0 }]);
    // No more reports. The limit point stays at x 1850 and the train holds SIGHT_SPEED past it.
    ticks(run, 1500);
    expect(run.state.pos.offset).toBeGreaterThan(1850);
    expect(run.topSpeed).toBeLessThan(MAX_SPEED);
    expect(run.state.speed).toBeCloseTo(SIGHT_SPEED, 6);
    expect(run.out?.mode).toBe('stale');
  });

  it('the leader limit is SIGHT_SPEED when the train has never heard its leader', () => {
    expect(leaderLimit(self.pos, 1, null, N)).toBe(SIGHT_SPEED);
  });

  it('the leader limit is SIGHT_SPEED when the leader is unknown', () => {
    expect(leaderLimit(self.pos, 'unknown', null, N)).toBe(SIGHT_SPEED);
    expect(leaderLimit(self.pos, 'unknown', report, N)).toBe(SIGHT_SPEED);
  });

  it('with leader none there is no limit point, so only MAX_SPEED, sightAhead and stop points limit the train', () => {
    expect(leaderLimit(self.pos, 'none', null, N)).toBe(Infinity);
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 0 }, SIGHT_SPEED);
    ticks(run, 600);
    expect(run.state.speed).toBe(MAX_SPEED);
  });
});

describe('Following: sightAhead', () => {
  it('the sightAhead limit is safeSpeed(sightAhead - MARGIN), braked one tick early', () => {
    expect(sightLimit(250)).toBeCloseTo(safeSpeed(250 - MARGIN - STOP_SHORT) - EARLY, 9);
  });

  it('the sightAhead limit has no SIGHT_SPEED floor', () => {
    expect(sightLimit(MARGIN + 20)).toBeLessThan(SIGHT_SPEED);
    expect(sightLimit(MARGIN + 20)).toBeGreaterThan(0);
  });

  it('the sightAhead limit is 0 when sightAhead is MARGIN or less', () => {
    expect(sightLimit(MARGIN)).toBe(0);
    expect(sightLimit(MARGIN - 20)).toBe(0);
    expect(sightLimit(0)).toBe(0);
  });

  it('a null sightAhead adds no limit', () => {
    expect(sightLimit(null)).toBe(Infinity);
  });

  it('sightAhead lowers the limit below the SIGHT_SPEED floor of the leader limit', () => {
    // Train 2 has never heard its leader, so the leader limit is SIGHT_SPEED. An obstacle
    // 60 m ahead must still slow it right down.
    const agent = createAgent(2, timetable);
    const out = agent.decide({ now: 0, self: at('A', 1000, SIGHT_SPEED), inbox: [], sightAhead: 60 });
    expect(out.accel).toBe(-BRAKE);
  });

  it('an occupied junction zone seen through sightAhead slows the train like a train would', () => {
    // The engine reports an occupied zone as an obstacle at the zone's edge. The agent
    // cannot tell the two apart, so it stops MARGIN short of the edge.
    const run = startRun(createAgent(1, timetable), 1, { track: 'P1', offset: 0 }, 15);
    for (let i = 0; i < 600; i++) tick(run, [], sightTo(run, 6300));
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.offset).toBeLessThanOrEqual(300 - MARGIN);
    expect(run.state.pos.offset).toBeGreaterThan(300 - MARGIN - 1);
  });
});

describe('Following: stop points', () => {
  it('the end of an entry track is a stop point for a train with no platform', () => {
    expect(stopPointLimit(at('A', 5900), null, false, N)).toBeCloseTo(brakeLimit(100), 9);
    expect(stopPointLimit(at('B', 5900), null, false, N)).toBeCloseTo(brakeLimit(100), 9);
  });

  it('the end of an entry track is not a stop point once the train has a platform', () => {
    // The stop point is now offset 300 in the platform, 400 m ahead.
    expect(stopPointLimit(at('A', 5900), 'P1', false, N)).toBeCloseTo(brakeLimit(400), 9);
    expect(stopPointLimit(at('A', 6000), 'P1', false, N)).toBeGreaterThan(0);
  });

  it('offset 300 in a platform is a stop point', () => {
    expect(stopPointLimit(at('P1', 100), 'P1', false, N)).toBeCloseTo(brakeLimit(200), 9);
    expect(stopPointLimit(at('P4', 300), 'P4', false, N)).toBe(0);
  });

  it('the platform stop point no longer applies once the train is leaving, after a junction grant or a slot start', () => {
    expect(stopPointLimit(at('P1', 299), 'P1', true, N)).toBe(Infinity);
    expect(stopPointLimit(at('P1', 350), 'P1', true, N)).toBe(Infinity);
  });

  it('a train on EXIT has no stop point', () => {
    expect(stopPointLimit(at('EXIT', 10), 'P1', false, N)).toBe(Infinity);
    expect(stopPointLimit(at('EXIT', 5990), null, true, N)).toBe(Infinity);
  });

  it('the stop point limit is safeSpeed of the distance to the stop point, braked one tick early', () => {
    expect(stopPointLimit(at('A', 5500), null, false, N)).toBeCloseTo(safeSpeed(500 - STOP_SHORT) - EARLY, 9);
  });

  it('the stop point limit has no SIGHT_SPEED floor', () => {
    const limit = stopPointLimit(at('A', 5990), null, false, N);
    expect(limit).toBeLessThan(SIGHT_SPEED);
    expect(limit).toBeGreaterThan(0);
  });

  it('the stop point limit is 0 at or past the stop point', () => {
    expect(stopPointLimit(at('A', 6000), null, false, N)).toBe(0);
    expect(stopPointLimit(at('P1', 300), 'P1', false, N)).toBe(0);
    expect(stopPointLimit(at('P1', 320), 'P1', false, N)).toBe(0);
  });

  it('brakes one tick early: a train on the limit that then brakes fully stops at or before the point', () => {
    // The engine moves in steps, so a train exactly on safeSpeed would overrun by about
    // half a tick. From any distance, start on the limit and brake fully every tick.
    for (const distance of [0.02, 0.5, 3, 47.3, 250, 1125, 2000]) {
      let speed = brakeLimit(distance);
      let travelled = 0;
      while (speed > 0) {
        travelled += speed * TICK;
        speed = Math.max(0, speed - BRAKE * TICK);
      }
      expect(travelled).toBeLessThanOrEqual(distance);
      expect(brakeLimit(distance)).toBeLessThan(safeSpeed(distance));
    }
  });

  it('from MAX_SPEED it stops at or a few centimetres before the stop point', () => {
    const run = startRun(createAgent(1, timetable), 1, { track: 'A', offset: 3000 }, MAX_SPEED);
    for (let i = 0; i < 2000 && run.state.speed > 0; i++) tick(run);
    expect(run.state.speed).toBe(0);
    expect(run.state.pos.track).toBe('A');
    expect(run.state.pos.offset).toBeLessThan(6000);
    expect(run.state.pos.offset).toBeGreaterThan(6000 - 0.1);
    expect(run.overruns).toBe(0);
  });

  it('never passes a stop point, so it never enters the junction zone from a platform by rounding', () => {
    for (const [offset, speed] of [[0, 23], [120, 17.3], [250, 9], [299, 0], [299.9, 0.4]] as const) {
      const run = startRun(createAgent(1, timetable), 1, { track: 'P1', offset }, speed);
      for (let i = 0; i < 1500; i++) {
        tick(run);
        expect(run.state.pos.offset).toBeLessThan(300);
      }
      expect(run.state.speed).toBe(0);
      expect(run.state.pos.offset).toBeGreaterThan(300 - 0.1);
    }
  });
});

describe('Following: mode', () => {
  it('reports central while it holds a permit under 5 seconds old', () => {
    expect(modeFor(10, 1, report, true, N)).toBe('central');
  });

  it('central takes priority over full, stale and blind', () => {
    expect(modeFor(10, 1, report, true, N)).toBe('central');
    expect(modeFor(100, 1, report, true, N)).toBe('central');
    expect(modeFor(10, 1, null, true, N)).toBe('central');
    expect(modeFor(10, 'unknown', null, true, N)).toBe('central');
    expect(modeFor(10, 'none', null, true, N)).toBe('central');
  });

  it('reports full when the leader report is under FRESH seconds old', () => {
    expect(modeFor(9, 1, report, false, N)).toBe('full');
    expect(modeFor(9 + FRESH - 0.1, 1, report, false, N)).toBe('full');
  });

  it('reports stale when the leader report is FRESH seconds old or older', () => {
    expect(modeFor(9 + FRESH, 1, report, false, N)).toBe('stale');
    expect(modeFor(9 + FRESH + 100, 1, report, false, N)).toBe('stale');
  });

  it('judges FRESH with half a tick of slack', () => {
    expect(modeFor(9 + FRESH - 1e-9, 1, report, false, N)).toBe('stale');
    expect(modeFor(9 + FRESH - TICK + 1e-9, 1, report, false, N)).toBe('full');
  });

  it('reports blind when it has never heard its leader', () => {
    expect(modeFor(10, 1, null, false, N)).toBe('blind');
  });

  it('reports blind when its leader is unknown', () => {
    expect(modeFor(10, 'unknown', null, false, N)).toBe('blind');
  });

  it('reports full for a train with leader none, which knows the line ahead is clear', () => {
    expect(modeFor(10, 'none', null, false, N)).toBe('full');
  });
});

describe('Following: a leader that leaves the map', () => {
  const onExit = (offset: number, speed: number): TrainState => ({
    id: 1,
    pos: { track: 'EXIT', offset },
    speed,
    brokenDown: false,
  });

  it('sends one last position, with its front at the end of EXIT, on the tick it leaves', () => {
    const out = leavingMessage(50, onExit(N.exitLength - 3, 40), 0, N);
    expect(out?.range).toBe('long');
    expect(out?.msg).toMatchObject({ type: 'position', from: 1, pos: { track: 'EXIT', offset: N.exitLength }, sentAt: 50 });
  });

  it('sends nothing on a tick it stays on the map', () => {
    expect(leavingMessage(50, onExit(N.exitLength - 10, 40), 0, N)).toBeNull();
    // 40 m/s covers 4 m in a tick. Braking this tick it covers 3.991 m, so it stops short.
    expect(leavingMessage(50, onExit(N.exitLength - 3.995, 40), 0, N)).not.toBeNull();
    expect(leavingMessage(50, onExit(N.exitLength - 3.995, 40), -BRAKE, N)).toBeNull();
    expect(leavingMessage(50, { ...onExit(10, 40), pos: { track: 'P1', offset: 399 } }, 0, N)).toBeNull();
  });

  it('a broken-down train never says it has left', () => {
    expect(leavingMessage(50, { ...onExit(N.exitLength - 1, 40), brokenDown: true }, 0, N)).toBeNull();
  });

  it('a report with the front at the end of EXIT means the leader has gone, and leaves no limit point', () => {
    const gone: PositionReport = { pos: { track: 'EXIT', offset: N.exitLength }, speed: 40, sentAt: 0 };
    const near: PositionReport = { pos: { track: 'EXIT', offset: N.exitLength - 1 }, speed: 40, sentAt: 0 };
    expect(hasLeft(gone, N)).toBe(true);
    expect(hasLeft(near, N)).toBe(false);
    expect(leaderLimit({ track: 'EXIT', offset: N.exitLength - 300 }, 1, gone, N)).toBe(Infinity);
    expect(modeFor(100, 1, gone, false, N)).toBe('full');
  });

  it('the train behind keeps full speed to the end of the line once its leader has left', () => {
    const run = startRun(createAgent(2, timetable), 2, { track: 'EXIT', offset: 4000 }, MAX_SPEED);
    const goneMsg: Message = { type: 'position', from: 1, pos: { track: 'EXIT', offset: N.exitLength }, speed: 45, sentAt: 0 };
    // Train 2's leader on EXIT is train 1, from a junction grant.
    const memory = initialMemory(2, timetable);
    expect(memory.leader).toBe(1);
    tick(run, [goneMsg]);
    while (run.state.pos.offset < N.exitLength - 1) tick(run);
    expect(run.state.speed).toBe(MAX_SPEED);
  });

  it('counts a train past its platform stop as in the junction zone', () => {
    expect(isPastPlatformStop({ track: 'P2', offset: N.platformStop + 0.5 }, N)).toBe(true);
    expect(isPastPlatformStop({ track: 'P2', offset: N.platformStop }, N)).toBe(false);
    expect(isPastPlatformStop({ track: 'EXIT', offset: 350 }, N)).toBe(false);
    expect(isPastPlatformStop({ track: 'A', offset: 5999 }, N)).toBe(false);
  });
});
