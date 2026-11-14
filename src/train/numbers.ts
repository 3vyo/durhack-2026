import { TICK } from '../shared/constants';
import type { PlatformId, Position } from '../shared/types';

// The map and timing numbers the train rules need. Pull request #34 adds them to
// src/shared/. Until it merges, no number the design names is written in src/train/.
// Each rule function takes the numbers it needs as an input, picked from this type.

export interface TrainNumbers {
  // Timing, in seconds.
  slack: number; // half a tick, so a timer built by adding TICK does not fire a tick late
  positionEvery: number; // position broadcast interval ("every second")
  requestRepeat: number; // repeat interval for lock requests
  permitFresh: number; // a permit under this age is fresh
  mergeTimeout: number; // silence from the merge actor before clock slots
  slotLength: number;
  slotWindow: number; // a platform may start during the first slotWindow seconds of its slot
  slotCount: number;

  // Map, in metres.
  askPoint: number; // offset on A and B where the train first asks for a platform
  entryLength: number; // length of A and B
  platformStop: number; // offset in a platform where the train stops
  hearSensorsFrom: number; // x range where a train should hear the platform sensors
  hearSensorsTo: number;
  pairs: Record<'A' | 'B', readonly PlatformId[]>; // the platforms each entry track owns
  xOf: (pos: Position) => number; // a position on the shared x axis
}

/**
 * The numbers the agent uses until #34 merges. Every design number is NaN, the pairs are
 * empty and xOf gives NaN. A speed limit built from NaN is NaN, and lowestLimit reads that
 * as 0, so a rule written before then keeps the train stopped. Other results are not
 * guarded: a negated comparison such as !(x < askPoint) is true, so a request could go out
 * early. Replace each value with its constant from src/shared/ once #34 merges.
 */
export const PENDING_NUMBERS: TrainNumbers = {
  slack: TICK / 2,
  positionEvery: NaN,
  requestRepeat: NaN,
  permitFresh: NaN,
  mergeTimeout: NaN,
  slotLength: NaN,
  slotWindow: NaN,
  slotCount: NaN,
  askPoint: NaN,
  entryLength: NaN,
  platformStop: NaN,
  hearSensorsFrom: NaN,
  hearSensorsTo: NaN,
  pairs: { A: [], B: [] },
  xOf: () => NaN,
};
