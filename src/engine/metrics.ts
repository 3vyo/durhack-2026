import type { TrainId } from '../shared/types';
import type { RunResult } from './engine';

/** A train is on time if it leaves EXIT no more than this many seconds after the reference run. */
export const ON_TIME_SLACK = 10;

/**
 * How many seconds late a train was against the reference. A train that never left is
 * counted at the run length, so a stuck train shows up as delay and is not dropped.
 * Arriving early adds nothing.
 */
function delayOf(run: RunResult, reference: RunResult, id: TrainId): number {
  const referenceExit = reference.exits.get(id);
  if (referenceExit === undefined) return 0;
  return Math.max(0, (run.exits.get(id) ?? run.runLength) - referenceExit);
}

/**
 * Average delay per train in seconds, over every train in the reference run. It is what a
 * passenger on a typical train would see, so it does not grow with the number of trains.
 */
export function averageDelay(run: RunResult, reference: RunResult): number {
  const ids = [...reference.exits.keys()];
  if (ids.length === 0) return 0;
  let total = 0;
  for (const id of ids) total += delayOf(run, reference, id);
  return total / ids.length;
}

/**
 * Average delay per train so far, for a live scoreboard. A train that has exited counts as in
 * averageDelay. A train that has not exited yet counts as overdue from its reference exit
 * time: max(0, now - refExit). Without this, trains stopped by an outage add nothing until
 * they finally leave, and the baseline would read as nearly on time at the moment it looks
 * worst.
 */
export function averageDelaySoFar(run: RunResult, reference: RunResult, now: number): number {
  if (reference.exits.size === 0) return 0;
  let total = 0;
  for (const [id, referenceExit] of reference.exits) {
    const exit = run.exits.get(id);
    total += Math.max(0, (exit ?? now) - referenceExit);
  }
  return total / reference.exits.size;
}

/**
 * Seconds from the end of the failure until trains are back on time: the exit time of the
 * last late train minus the failure end, clamped at 0. It is 0 if no train was late or there
 * was no failure. It is null if a late train never left, so the screen can show the run
 * length instead of a number that would be wrong.
 */
export function timeToNormal(
  run: RunResult,
  reference: RunResult,
  failureEnd: number | null,
): number | null {
  if (failureEnd === null) return 0;
  let lastLateExit = -Infinity;
  for (const id of reference.exits.keys()) {
    if (delayOf(run, reference, id) <= ON_TIME_SLACK) continue;
    const exit = run.exits.get(id);
    if (exit === undefined) return null;
    lastLateExit = Math.max(lastLateExit, exit);
  }
  return Math.max(0, lastLateExit - failureEnd);
}

/**
 * Time to normal for a live scoreboard, before the run is over. A train that has not exited
 * is late only if it is overdue by more than ON_TIME_SLACK at `now`. While any such train is
 * still on the line the answer is null ("not yet"). Once none is overdue, it is the exit of
 * the last late train that did leave minus the failure end, clamped at 0. Measuring a train
 * that simply has not been due yet as late would keep this at "not yet" until the run ended.
 */
export function timeToNormalSoFar(
  run: RunResult,
  reference: RunResult,
  failureEnd: number,
  now: number,
): number | null {
  let lastLateExit = -Infinity;
  for (const [id, referenceExit] of reference.exits) {
    const exit = run.exits.get(id);
    if (exit === undefined) {
      if (now - referenceExit > ON_TIME_SLACK) return null;
    } else if (exit - referenceExit > ON_TIME_SLACK) {
      lastLateExit = Math.max(lastLateExit, exit);
    }
  }
  return Math.max(0, lastLateExit - failureEnd);
}
