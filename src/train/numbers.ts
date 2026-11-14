import {
  FRESH,
  JUNCTION_KEEPER_TIMEOUT,
  PERMIT_FRESH,
  POSITION_INTERVAL,
  REQUEST_REPEAT,
  SLOT_COUNT,
  SLOT_LENGTH,
  SLOT_WINDOW,
  PLATFORM_KEEPER_TIMEOUT,
  TICK,
} from '../shared/constants';
import { ASK_POINT, PLATFORMS, PLATFORM_PAIRS, PLATFORM_STOP, RANGE, TRACK_LENGTH, xOf } from '../shared/map';
import type { PlatformId, Position } from '../shared/types';

// The map and timing numbers the train rules need, taken from src/shared/. No number the
// design names is written in src/train/. Each rule function takes the numbers it needs as
// an input, picked from this type, so a test can pass its own.
//
// A parameter file can replace the shared constants before a run (setConstants). So
// nothing here copies one when the file loads: trainNumbers() reads them on every call,
// and the agent calls it on every decide.

export interface TrainNumbers {
  // Timing, in seconds.
  slack: number; // half a tick, so a timer built by adding TICK does not fire a tick late
  positionEvery: number; // position broadcast interval ("every second")
  requestRepeat: number; // repeat interval for lock requests
  fresh: number; // a position report or platformStatus under this age is fresh
  permitFresh: number; // a permit under this age is fresh
  platformKeeperTimeout: number; // silence from the platform keeper before the fixed split
  junctionKeeperTimeout: number; // silence from the junction keeper before clock slots
  grantLife: number; // a junction grant must be used within this long, or the train drops it
  slotLength: number;
  slotWindow: number; // a platform may start during the first slotWindow seconds of its slot
  slotCount: number;
  slotOrder: readonly PlatformId[]; // the platform at index k may start in slot k

  // Map, in metres.
  askPoint: number; // offset on A and B where the train first asks for a platform
  entryLength: number; // length of A and B
  exitLength: number; // length of EXIT. A train whose front reaches its end leaves the map
  platformStop: number; // offset in a platform where the train stops
  stopClose: number; // a train stopped within this distance of a stop point is "at" it
  hearSensorsFrom: number; // x range where a train should hear the platform sensors
  hearSensorsTo: number;
  pairs: Record<'A' | 'B', readonly PlatformId[]>; // the platforms each entry track owns
  xOf: (pos: Position) => number; // a position on the shared x axis
}

/**
 * Local to the train agent, not in src/shared/. A train aims this far short of every point
 * it brakes for, so floating point rounding can never carry it past the point. One
 * centimetre. The design says rounding leaves a train "a few centimetres short".
 */
export const STOP_SHORT = 0.01;

/**
 * Local to the train agent, not in src/shared/. A speed at or below this counts as stopped.
 * The engine clamps speed at 0, so this only absorbs floating point noise.
 */
export const STILL = 1e-6;

/**
 * Local to the train agent, not in src/shared/. A train stopped within this distance of a
 * stop point counts as at it. A train only sets off without a lock (fixed split, creep or
 * clock slot) from there, so the platform or junction sensor shows it within a second or
 * two. One metre.
 */
export const STOP_CLOSE = 1;

/** True if the speed counts as stopped. */
export function isStill(speed: number): boolean {
  return speed <= STILL;
}

/**
 * The numbers the agent uses, read from src/shared/constants.ts and src/shared/map.ts at
 * the moment of the call. Call it again for every decide. Do not keep the result.
 */
export function trainNumbers(): TrainNumbers {
  return {
    slack: TICK / 2,
    positionEvery: POSITION_INTERVAL,
    requestRepeat: REQUEST_REPEAT,
    fresh: FRESH,
    permitFresh: PERMIT_FRESH,
    platformKeeperTimeout: PLATFORM_KEEPER_TIMEOUT,
    junctionKeeperTimeout: JUNCTION_KEEPER_TIMEOUT,
    // The junction keeper releases a grant the zone has not filled within JUNCTION_KEEPER_TIMEOUT. The
    // train gives up one REQUEST_REPEAT sooner, so the two never disagree.
    grantLife: JUNCTION_KEEPER_TIMEOUT - REQUEST_REPEAT,
    slotLength: SLOT_LENGTH,
    slotWindow: SLOT_WINDOW,
    slotCount: SLOT_COUNT,
    slotOrder: PLATFORMS,
    askPoint: ASK_POINT,
    entryLength: TRACK_LENGTH.A,
    exitLength: TRACK_LENGTH.EXIT,
    platformStop: PLATFORM_STOP,
    stopClose: STOP_CLOSE,
    hearSensorsFrom: RANGE.sensors[0],
    hearSensorsTo: RANGE.sensors[1],
    pairs: PLATFORM_PAIRS,
    xOf,
  };
}
