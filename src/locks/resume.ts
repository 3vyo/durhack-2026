// Helpers both actors use when they are switched back on. The engine calls step only
// while an actor is on, and the actor keeps its memory while it is off.
//
// The settle time is an input here, not a number in this file. It waits on a
// RESUME_SETTLE constant in src/shared/constants.ts, which pull request #34 adds. It must
// be at least one request repeat plus two ticks. For the station it must also cover a
// train getting from its stop at the end of A or B to the platform sensor.

/**
 * Switched back on: the actor was off if `now` jumped by more than one TICK since its
 * last step.
 *
 * Placeholder: always says it was off, so the actor keeps restarting its settle window
 * and grants nothing.
 */
export function wasSwitchedOff(_lastStepAt: number | null, _now: number): boolean {
  return true;
}

/**
 * Switched back on: true until `resumedAt + settle`. While it is true the actor grants
 * nothing. With `resumedAt` null the actor has never been switched off.
 *
 * Placeholder: always settling, so the actor grants nothing.
 */
export function stillSettling(_resumedAt: number | null, _now: number, _settle: number): boolean {
  return true;
}
