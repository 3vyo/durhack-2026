import { describe, expect, it } from 'vitest';
import type { RunResult } from '../../src/engine/engine';
import {
  ON_TIME_SLACK,
  averageDelay,
  averageDelaySoFar,
  timeToNormal,
  timeToNormalSoFar,
} from '../../src/engine/metrics';

function run(exits: Record<number, number>, runLength = 1000): RunResult {
  return {
    runLength,
    finished: Object.keys(exits).length === 3,
    exits: new Map(Object.entries(exits).map(([id, t]) => [Number(id), t])),
    collisions: 0,
    closeCalls: 0,
    overruns: 0,
  };
}

const reference = run({ 1: 100, 2: 200, 3: 300 });

describe('ON_TIME_SLACK', () => {
  it('is 10 seconds', () => {
    expect(ON_TIME_SLACK).toBe(10);
  });
});

describe('averageDelay', () => {
  it('averages how late each train left EXIT against the reference', () => {
    expect(averageDelay(run({ 1: 150, 2: 215, 3: 305 }), reference)).toBe((50 + 15 + 5) / 3);
  });

  it('counts a train that never left at the run length', () => {
    expect(averageDelay(run({ 1: 100, 2: 200 }, 1000), reference)).toBe(700 / 3);
  });

  it('adds nothing for a train that arrives earlier than the reference', () => {
    expect(averageDelay(run({ 1: 90, 2: 200, 3: 300 }), reference)).toBe(0);
  });

  it('is zero for a run identical to its reference', () => {
    expect(averageDelay(reference, reference)).toBe(0);
  });

  it('does not grow with the number of trains: two trains 60 s late average 60 s', () => {
    const two = run({ 1: 100, 2: 200 });
    expect(averageDelay(run({ 1: 160, 2: 260 }), two)).toBe(60);
  });

  it('is zero for a reference with no trains', () => {
    expect(averageDelay(run({}), run({}))).toBe(0);
  });
});

describe('averageDelaySoFar', () => {
  it('counts a train that has not exited as overdue from its reference exit time', () => {
    // Train 1 exited 50 s late. Train 2 is 50 s overdue at t = 250. Train 3 is not due yet.
    const soFar = run({ 1: 150 }, 1000);
    expect(averageDelaySoFar(soFar, reference, 250)).toBe((50 + 50 + 0) / 3);
  });

  it('keeps growing while trains are stuck, which a delay counted only at exit would miss', () => {
    const stuck = run({}, 1000);
    expect(averageDelaySoFar(stuck, reference, 250)).toBe((150 + 50) / 3);
    expect(averageDelaySoFar(stuck, reference, 400)).toBe((300 + 200 + 100) / 3);
  });

  it('agrees with averageDelay once every train has left', () => {
    const done = run({ 1: 150, 2: 215, 3: 305 });
    expect(averageDelaySoFar(done, reference, 500)).toBe(averageDelay(done, reference));
  });

  it('adds nothing for a train that exited early', () => {
    expect(averageDelaySoFar(run({ 1: 90, 2: 200, 3: 300 }), reference, 500)).toBe(0);
  });
});

describe('timeToNormal', () => {
  const late = run({ 1: 150, 2: 215, 3: 305 });

  it('is the exit of the last late train minus the failure end', () => {
    expect(timeToNormal(late, reference, 120)).toBe(215 - 120);
  });

  it('treats a train within the slack as on time', () => {
    expect(timeToNormal(run({ 1: 110, 2: 210, 3: 310 }), reference, 120)).toBe(0);
  });

  it('is 0 when no train was late', () => {
    expect(timeToNormal(reference, reference, 120)).toBe(0);
  });

  it('is 0 when there is no failure', () => {
    expect(timeToNormal(late, reference, null)).toBe(0);
  });

  it('is 0 when the last late train left before the failure ended', () => {
    expect(timeToNormal(late, reference, 400)).toBe(0);
  });

  it('is null when a late train never leaves', () => {
    expect(timeToNormal(run({ 1: 150, 2: 215 }), reference, 120)).toBeNull();
  });
});

describe('timeToNormalSoFar', () => {
  it('does not count a train that has not exited yet but is not overdue as late', () => {
    // Train 1 left late at 150. Train 2 is due at 200 and it is 205 now, within the slack.
    expect(timeToNormalSoFar(run({ 1: 150 }, 1000), reference, 120, 205)).toBe(150 - 120);
  });

  it('is null while a train is overdue and still has not exited', () => {
    expect(timeToNormalSoFar(run({ 1: 150 }, 1000), reference, 120, 250)).toBeNull();
  });

  it('is 0 right after the failure ends when nothing has been late, even before the run is over', () => {
    expect(timeToNormalSoFar(run({ 1: 100 }, 1000), reference, 120, 150)).toBe(0);
  });

  it('is 0 when the last late train left before the failure ended', () => {
    expect(timeToNormalSoFar(run({ 1: 150, 2: 200 }, 1000), reference, 400, 250)).toBe(0);
  });

  it('agrees with timeToNormal once every train has left', () => {
    const done = run({ 1: 150, 2: 215, 3: 305 });
    expect(timeToNormalSoFar(done, reference, 120, 500)).toBe(timeToNormal(done, reference, 120));
  });
});
