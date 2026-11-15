import { afterEach, describe, expect, it } from 'vitest';
import {
  FRESH,
  JUNCTION_KEEPER_TIMEOUT,
  PERMIT_FRESH,
  POSITION_INTERVAL,
  REQUEST_REPEAT,
  SIGHT_SPEED,
  SLOT_LENGTH,
  SLOT_WINDOW,
  PLATFORM_KEEPER_TIMEOUT,
  TICK,
  resetConstants,
  setConstants,
} from '../../src/shared/constants';
import { ASK_POINT, PLATFORMS, PLATFORM_PAIRS, PLATFORM_STOP, RANGE, TRACK_LENGTH } from '../../src/shared/map';
import { createTrainAgent } from '../../src/train';
import { STILL, STOP_CLOSE, STOP_SHORT, isStill, trainNumbers } from '../../src/train/numbers';
import { startRun, ticks, timetable } from './sim';

describe('trainNumbers', () => {
  it('gives half a tick of slack to every timer', () => {
    expect(trainNumbers().slack).toBe(TICK / 2);
  });

  it('takes every timing number from src/shared/constants.ts', () => {
    const n = trainNumbers();
    expect(n.positionEvery).toBe(POSITION_INTERVAL);
    expect(n.requestRepeat).toBe(REQUEST_REPEAT);
    expect(n.fresh).toBe(FRESH);
    expect(n.permitFresh).toBe(PERMIT_FRESH);
    expect(n.platformKeeperTimeout).toBe(PLATFORM_KEEPER_TIMEOUT);
    expect(n.junctionKeeperTimeout).toBe(JUNCTION_KEEPER_TIMEOUT);
    expect(n.slotLength).toBe(SLOT_LENGTH);
    expect(n.slotWindow).toBe(SLOT_WINDOW);
  });

  it('has one clock slot for each platform of the layout, 4 on the default layout', () => {
    const n = trainNumbers();
    expect(n.slotCount).toBe(PLATFORMS.length);
    expect(n.slotCount).toBe(4);
    expect(n.slotOrder).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('gives a junction grant one REQUEST_REPEAT less than JUNCTION_KEEPER_TIMEOUT to be used', () => {
    expect(trainNumbers().grantLife).toBe(JUNCTION_KEEPER_TIMEOUT - REQUEST_REPEAT);
  });

  it('takes every map number from src/shared/map.ts', () => {
    const n = trainNumbers();
    expect(n.askPoint).toBe(ASK_POINT);
    expect(n.entryLength).toBe(TRACK_LENGTH.A);
    expect(n.entryLength).toBe(TRACK_LENGTH.B);
    expect(n.platformStop).toBe(PLATFORM_STOP);
    expect([n.hearSensorsFrom, n.hearSensorsTo]).toEqual([...RANGE.sensors]);
    expect(n.pairs).toBe(PLATFORM_PAIRS);
    expect(n.slotOrder).toBe(PLATFORMS);
    expect(n.xOf({ track: 'P1', offset: 100 })).toBe(6100);
    expect(n.xOf({ track: 'EXIT', offset: 100 })).toBe(6500);
  });

  it('keeps its own three small numbers local: the stop-short gap, the at-a-stop-point distance and the stopped speed', () => {
    expect(STOP_SHORT).toBeGreaterThan(0);
    expect(STOP_SHORT).toBeLessThan(0.1); // "a few centimetres short"
    expect(trainNumbers().stopClose).toBe(STOP_CLOSE);
    expect(STOP_CLOSE).toBeLessThanOrEqual(1);
    expect(isStill(0)).toBe(true);
    expect(isStill(STILL)).toBe(true);
    expect(isStill(0.01)).toBe(false);
  });
});

describe('a parameter file changes the constants before a run', () => {
  afterEach(() => resetConstants());

  it('reads the constants afresh on each call, never a copy made when the file loaded', () => {
    setConstants({ REQUEST_REPEAT: 3, JUNCTION_KEEPER_TIMEOUT: 20, TICK: 0.2 });
    const n = trainNumbers();
    expect(n.requestRepeat).toBe(3);
    expect(n.junctionKeeperTimeout).toBe(20);
    expect(n.grantLife).toBe(17);
    expect(n.slack).toBe(0.1);
    resetConstants();
    expect(trainNumbers().requestRepeat).toBe(REQUEST_REPEAT);
  });

  it('with SIGHT_SPEED set to 10, a blind train keeps to 10', () => {
    setConstants({ SIGHT_SPEED: 10 });
    expect(SIGHT_SPEED).toBe(10);
    // Train 2 never hears its leader. It enters at the new SIGHT_SPEED.
    const run = startRun(createTrainAgent(2, timetable), 2, { track: 'A', offset: 0 }, 10);
    ticks(run, 600);
    expect(run.out?.mode).toBe('blind');
    expect(run.topSpeed).toBeLessThanOrEqual(10 + 1e-9);
    expect(run.state.speed).toBeCloseTo(10, 6);
    expect(run.state.pos.offset).toBeCloseTo(600, 3);
  });

  it('an agent built before the change still uses the new value', () => {
    const run = startRun(createTrainAgent(2, timetable), 2, { track: 'A', offset: 0 }, 10);
    setConstants({ SIGHT_SPEED: 10 });
    ticks(run, 300);
    expect(run.topSpeed).toBeLessThanOrEqual(10 + 1e-9);
  });
});
