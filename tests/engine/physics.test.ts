import { describe, expect, it } from 'vitest';
import { advanceTrain } from '../../src/engine/physics';
import { ACCEL, BRAKE, MAX_SPEED, TICK } from '../../src/shared/constants';
import type { TrainState } from '../../src/shared/types';

function train(track: TrainState['pos']['track'], offset: number, speed: number): TrainState {
  return { id: 1, pos: { track, offset }, speed, brokenDown: false };
}

describe('advanceTrain', () => {
  it('clamps acceleration to ACCEL', () => {
    const { state } = advanceTrain(train('A', 0, 0), 5, null);
    expect(state.speed).toBeCloseTo(ACCEL * TICK, 10);
  });

  it('clamps braking to BRAKE and never goes below zero speed', () => {
    const { state } = advanceTrain(train('A', 100, 0.01), -5, null);
    expect(state.speed).toBe(0);
    const slowing = advanceTrain(train('A', 100, 10), -5, null).state;
    expect(slowing.speed).toBeCloseTo(10 - BRAKE * TICK, 10);
  });

  it('never exceeds MAX_SPEED', () => {
    const { state } = advanceTrain(train('A', 100, MAX_SPEED), ACCEL, null);
    expect(state.speed).toBe(MAX_SPEED);
  });

  it('moves onto nextTrack with the overflow as the new offset', () => {
    const { state, exited } = advanceTrain(train('A', 5999.9, MAX_SPEED), 0, 'P1');
    expect(state.pos.track).toBe('P1');
    expect(state.pos.offset).toBeCloseTo(4.4, 3);
    expect(exited).toBe(false);
  });

  it('stops at the end of a track when nextTrack is null', () => {
    const { state, exited } = advanceTrain(train('A', 5999.9, MAX_SPEED), 0, null);
    expect(state.pos).toEqual({ track: 'A', offset: 6000 });
    expect(state.speed).toBe(0);
    expect(exited).toBe(false);
  });

  it('stops at the end of a track when nextTrack is not a successor', () => {
    const { state } = advanceTrain(train('A', 5999.9, MAX_SPEED), 0, 'P3');
    expect(state.pos).toEqual({ track: 'A', offset: 6000 });
    expect(state.speed).toBe(0);
  });

  it('reports exited when a train crosses the end of EXIT', () => {
    const { state, exited } = advanceTrain(train('EXIT', 5999.9, MAX_SPEED), 0, null);
    expect(exited).toBe(true);
    expect(state.pos.offset).toBe(6000);
  });

  it('flags an overrun when a moving train reaches a track end with no valid next track', () => {
    expect(advanceTrain(train('A', 5999.9, MAX_SPEED), 0, null).overrun).toBe(true);
    expect(advanceTrain(train('A', 5999.9, MAX_SPEED), 0, 'P3').overrun).toBe(true);
  });

  it('does not flag an overrun for a normal move, a valid crossing, an exit, or a stopped train', () => {
    expect(advanceTrain(train('A', 100, 10), 0, null).overrun).toBe(false);
    expect(advanceTrain(train('A', 5999.9, MAX_SPEED), 0, 'P1').overrun).toBe(false);
    expect(advanceTrain(train('EXIT', 5999.9, MAX_SPEED), 0, null).overrun).toBe(false);
    expect(advanceTrain(train('A', 6000, 0), 0, null).overrun).toBe(false);
  });

  it('carries brokenDown through unchanged', () => {
    const broken: TrainState = { ...train('A', 100, 0), brokenDown: true };
    expect(advanceTrain(broken, ACCEL, null).state.brokenDown).toBe(true);
  });
});
