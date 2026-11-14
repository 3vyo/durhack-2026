import { describe, expect, it } from 'vitest';
import { makeCentre } from '../../src/baseline/centre';
import { createBaselineAgent } from '../../src/baseline/train';
import { MARGIN, TRAIN_LENGTH } from '../../src/shared/constants';
import { JUNCTION_START_X, TRACK_LENGTH, TRACK_START, xOf } from '../../src/shared/map';
import type { TimetableEntry } from '../../src/shared/types';
import { makeSim, type Sim, type SimOptions } from './sim';

// The centre and several baseline trains run together in the tiny engine in ./sim.ts.
// Rules: "Today's rule, for comparison" in docs/design.md.

const threeOnA: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'A', enterAt: 30, platform: 'P2', leader: 1, dwell: 30 },
  { id: 3, entry: 'A', enterAt: 60, platform: 'P1', leader: 2, dwell: 30 },
];

const bothTracks: TimetableEntry[] = [
  ...threeOnA,
  { id: 4, entry: 'B', enterAt: 5, platform: 'P3', leader: null, dwell: 30 },
];

const ENTRY_END_X = TRACK_START.A + TRACK_LENGTH.A;

function run(timetable: TimetableEntry[], options: SimOptions = {}, restartGap?: number): Sim {
  return makeSim(timetable, makeCentre(timetable, { serves: 'baseline', restartGap }), createBaselineAgent, options);
}

function expectSafe(sim: Sim): void {
  expect(sim.overlaps).toBe(0);
  expect(sim.junctionClashes).toBe(0);
  expect(sim.overruns).toBe(0);
  expect(sim.pastPermit).toBe(0);
}

function allStopped(sim: Sim): boolean {
  return sim.trains.every((t) => t.state.speed === 0);
}

/** The smallest gap between a train's front and the rear of the next train ahead on A. */
function smallestGapOnA(sim: Sim): number {
  const xs = sim.trains.filter((t) => t.state.pos.track === 'A').map((t) => xOf(t.state.pos)).sort((a, b) => a - b);
  let smallest = Infinity;
  for (let i = 1; i < xs.length; i++) smallest = Math.min(smallest, xs[i] - TRAIN_LENGTH - xs[i - 1]);
  return smallest;
}

describe('healthy running', () => {
  it('runs three trains on track A through platforms and out, with no overlap and never two in the junction zone', () => {
    const sim = run(threeOnA);
    sim.runUntil(700);
    expect(sim.left).toEqual([1, 2, 3]);
    expectSafe(sim);
  });

  it('runs trains from both entry tracks through the one junction', () => {
    const sim = run(bothTracks);
    sim.runUntil(700);
    expect([...sim.left].sort()).toEqual([1, 2, 3, 4]);
    expectSafe(sim);
  });

  it('stops each train in a platform for its dwell before it leaves', () => {
    const sim = run(threeOnA);
    let stoppedTicks = 0;
    while (sim.left.length === 0 && sim.now < 700) {
      sim.tick();
      const first = sim.train(1);
      if (first && first.pos.track === 'P1' && first.speed === 0) stoppedTicks += 1;
    }
    expect(stoppedTicks / 10).toBeGreaterThanOrEqual(threeOnA[0].dwell);
  });
});

describe('the centre goes silent', () => {
  it('stops every train without overlap, and they move again when it returns', () => {
    const sim = run(bothTracks, { centreOn: (now) => now < 100 || now >= 400 });
    sim.runUntil(399);
    expect(sim.trains).toHaveLength(4);
    expect(allStopped(sim)).toBe(true);
    expect(sim.left).toEqual([]);
    expect(smallestGapOnA(sim)).toBeGreaterThanOrEqual(MARGIN);
    expectSafe(sim);
    sim.runUntil(410);
    expect(sim.trains.some((t) => t.state.speed > 0)).toBe(true);
    sim.runUntil(1200);
    expect([...sim.left].sort()).toEqual([1, 2, 3, 4]);
    expectSafe(sim);
  });

  it('stays safe whenever the outage starts and however long it lasts', () => {
    for (let start = 0; start < 420; start += 23) {
      for (const length of [3, 20, 90]) {
        const sim = run(bothTracks, { centreOn: (now) => now < start || now >= start + length });
        sim.runUntil(start + length - 1);
        if (length >= 90) expect(allStopped(sim)).toBe(true);
        sim.runUntil(1000);
        expect([...sim.left].sort()).toEqual([1, 2, 3, 4]);
        expectSafe(sim);
      }
    }
  }, 30000);

  it('with restartGap, releases the stopped trains one at a time after the outage', () => {
    const sim = run(bothTracks, { centreOn: (now) => now < 100 || now >= 400 }, 60);
    sim.runUntil(399);
    expect(allStopped(sim)).toBe(true);
    const stoppedAt = new Map(sim.trains.map((t) => [t.state.id, xOf(t.state.pos)]));
    const movedBy = (time: number) => {
      sim.runUntil(time);
      return sim.trains.filter((t) => xOf(t.state.pos) > stoppedAt.get(t.state.id)!).map((t) => t.state.id).sort();
    };
    // The train furthest along goes first, then one more every 60 seconds.
    expect(movedBy(430)).toEqual([1]);
    expect(movedBy(490)).toEqual([1, 4]);
    expect(movedBy(550)).toEqual([1, 2, 4]);
    expect(movedBy(610)).toEqual([1, 2, 3, 4]);
    sim.runUntil(2000);
    expect([...sim.left].sort()).toEqual([1, 2, 3, 4]);
    expectSafe(sim);
  });
});

describe('local faults', () => {
  it('with the station actor dead, permits no train past the end of its entry track', () => {
    const sim = run(bothTracks, { alive: (now) => ({ station: now < 100 || now >= 500, merge: true }) });
    sim.runUntil(499);
    expect(allStopped(sim)).toBe(true);
    expect(sim.trains.every((t) => xOf(t.state.pos) <= ENTRY_END_X)).toBe(true);
    sim.runUntil(1300);
    expect([...sim.left].sort()).toEqual([1, 2, 3, 4]);
    expectSafe(sim);
  });

  it('with every platform sensor dead, permits no train into any platform', () => {
    const sim = run(bothTracks, { sensorsOn: (now) => now < 100 || now >= 500 });
    sim.runUntil(499);
    expect(allStopped(sim)).toBe(true);
    expect(sim.trains.every((t) => xOf(t.state.pos) <= ENTRY_END_X)).toBe(true);
    sim.runUntil(1300);
    expect([...sim.left].sort()).toEqual([1, 2, 3, 4]);
    expectSafe(sim);
  });

  it('with the merge actor dead, permits no train into the junction zone', () => {
    const sim = run(bothTracks, { alive: (now) => ({ station: true, merge: now < 100 || now >= 500 }) });
    sim.runUntil(499);
    expect(allStopped(sim)).toBe(true);
    expect(sim.left).toEqual([]);
    expect(sim.trains.every((t) => xOf(t.state.pos) <= JUNCTION_START_X)).toBe(true);
    sim.runUntil(1300);
    expect([...sim.left].sort()).toEqual([1, 2, 3, 4]);
    expectSafe(sim);
  });

  it('lets a train run clear when the actor dies after the train was permitted through', () => {
    // At 140 train 1 is too close to stop before x 6000. At 216 it has just been let into the junction.
    const station = run(bothTracks, { alive: (now) => ({ station: now < 140, merge: true }) });
    station.runUntil(600);
    expect(station.left).toContain(1);
    expectSafe(station);
    const merge = run(bothTracks, { alive: (now) => ({ station: true, merge: now < 216 }) });
    merge.runUntil(600);
    expect(merge.left).toEqual([1]);
    expectSafe(merge);
  });

  it('holds a broken-down train where it is and keeps its followers behind it', () => {
    const sim = run(bothTracks);
    sim.runUntil(50);
    sim.breakDown(1);
    const brokenAt = xOf(sim.train(1)!.pos);
    sim.runUntil(900);
    expect(xOf(sim.train(1)!.pos)).toBe(brokenAt);
    expect(sim.left).toEqual([4]);
    expect(allStopped(sim)).toBe(true);
    expect(smallestGapOnA(sim)).toBeGreaterThanOrEqual(MARGIN);
    expectSafe(sim);
  });

  it('sends later trains to the other platform when a train breaks down in its platform', () => {
    const sim = run(bothTracks);
    sim.runUntil(165);
    expect(sim.train(1)!.pos.track).toBe('P1');
    sim.breakDown(1);
    sim.runUntil(1200);
    expect([...sim.left].sort()).toEqual([2, 3, 4]);
    expectSafe(sim);
  });
});
