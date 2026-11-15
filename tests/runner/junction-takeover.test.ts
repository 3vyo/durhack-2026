import { afterEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';
import type { TrainProgram } from '../../src/engine/ports';
import { generateTimetable } from '../../src/engine/timetable';
import { baselineProgram, ourProgram } from '../../src/runner/programs';
import { applyLayout, resetLayout, type LayoutId } from '../../src/shared/map';

// Design: "The centre comes first". The centre comes back while a train of ours is setting
// off on a junction keeper grant, its front still short of the junction zone. The centre must
// take that train over as the junction holder. Before it did, it let a second train into the
// zone (a collision on `busy`) or was left with a holder that could never go (a line that
// stood for good on `hub`). Both runs are dense: a train enters every 20 to 40 seconds.

const DENSE = { trains: 16, minHeadway: 20, dwell: 30 };
const OFF = { centre: false, platformKeeper: false, sensors: false };
const ON = { centre: true, platformKeeper: true, sensors: true };

function run(layout: LayoutId, program: TrainProgram, offAt: number, runLength: number) {
  applyLayout(layout);
  const timetable = generateTimetable(1, DENSE);
  const engine = new Engine({
    timetable,
    program,
    seed: 1,
    runLength,
    presses: [
      { at: offAt, set: OFF },
      { at: offAt + 20, set: ON },
    ],
  });
  while (!engine.finished && engine.now < runLength) engine.step();
  const result = engine.result();
  return { left: timetable.length - result.exits.size, result };
}

describe('the centre comes back while a train is setting off into the junction zone', () => {
  afterEach(() => resetLayout());

  it('lets no second train into the zone (busy, centre back at 485 s)', { timeout: 60_000 }, () => {
    const { left, result } = run('busy', ourProgram, 465, 3000);
    expect(result.collisions).toBe(0);
    expect(result.overruns).toBe(0);
    expect(left).toBe(0);
  });

  it('leaves no line standing for good (hub, centre back at 615 s)', { timeout: 60_000 }, () => {
    const { left, result } = run('hub', ourProgram, 595, 3000);
    expect(result.collisions).toBe(0);
    expect(result.overruns).toBe(0);
    expect(left).toBe(0);
  });

  it('gets every baseline train out in the same runs', { timeout: 60_000 }, () => {
    for (const [layout, offAt] of [['busy', 465], ['hub', 595]] as const) {
      const { left, result } = run(layout, baselineProgram, offAt, 3000);
      expect(result.collisions).toBe(0);
      expect(left).toBe(0);
    }
  });
});
