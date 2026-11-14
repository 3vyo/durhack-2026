import { TICK } from '../shared/constants';

// Helpers both actors use when they are switched back on. The engine calls step only
// while an actor is on, and the actor keeps its memory while it is off.
//
// The settle time is an input here. The actors pass RESUME_SETTLE from
// src/shared/constants.ts.

/**
 * Time is a float built by adding TICK, so two times that should be equal can differ by a
 * hair. Every timer comparison in this folder allows half a tick. Local to src/locks/.
 */
export function slack(): number {
  return TICK / 2;
}

/** How far `now` may be past the last step before the actor counts as having been off. */
function offGap(): number {
  return 1.5 * TICK;
}

/**
 * True if `elapsed` is clearly longer than `limit`. A time that lands on the limit, give
 * or take rounding, is not longer. So a timer built on this fires one tick late, never
 * one tick early.
 */
export function longerThan(elapsed: number, limit: number): boolean {
  return elapsed > limit + slack();
}

/**
 * Switched back on: the actor was off if `now` jumped by more than about 1.5 TICKs since
 * its last step. Not "more than one TICK": with floating-point time a normal step can
 * come out a hair over one TICK, and the actor would then restart its window every step.
 *
 * The first step counts from time 0. An actor first stepped later than that was switched
 * off at the start of the run and has only now been turned on, so it resumes too.
 */
export function wasSwitchedOff(lastStepAt: number | null, now: number): boolean {
  return now - (lastStepAt ?? 0) > offGap();
}

/**
 * Switched back on: true until `resumedAt + settle`. While it is true the actor grants
 * nothing. With `resumedAt` null the actor has never been switched off.
 */
export function stillSettling(resumedAt: number | null, now: number, settle: number): boolean {
  if (resumedAt === null) return false;
  return now < resumedAt + settle - slack();
}
