import { makeRng } from '../engine/timetable';
import type { Press } from '../engine/switches';
import type { Scenario } from '../scenarios/scenarios';
import type { TimetableEntry } from '../shared/types';

/** The failure starts once the station is busy: after this many trains have entered. */
export const FAILURE_AFTER_TRAIN = 8;
/** Up to this many seconds are added to the start, drawn from the seed. */
export const FAILURE_JITTER = 60;
/** How long the failure lasts, in seconds. */
export const FAILURE_LENGTH = 120;

/**
 * When the failure starts and ends for this timetable and seed. The seed moves the start
 * by up to FAILURE_JITTER seconds, so a batch sees failures arrive at different phases.
 * The jitter comes from its own stream, so it does not depend on the timetable's draws.
 */
export function failureWindow(
  timetable: TimetableEntry[],
  seed: number,
): { start: number; end: number } {
  if (timetable.length < 1) throw new Error('timetable needs at least one train');
  const anchor = timetable[Math.min(FAILURE_AFTER_TRAIN, timetable.length) - 1];
  const start = anchor.enterAt + makeRng(seed + 1)() * FAILURE_JITTER;
  return { start, end: start + FAILURE_LENGTH };
}

/** The timed presses that make a scenario happen for this timetable and seed. */
export function pressesFor(scenario: Scenario, timetable: TimetableEntry[], seed: number): Press[] {
  if (!scenario.failure) return [];
  const { start, end } = failureWindow(timetable, seed);
  return [
    { at: start, set: scenario.failure.set },
    { at: end, set: scenario.failure.restore },
  ];
}
