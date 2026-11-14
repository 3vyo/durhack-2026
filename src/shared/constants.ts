// Units: metres, seconds, metres per second. Values from docs/design.md.

export const MAX_SPEED = 45; // about 100 mph
export const ACCEL = 0.5;
export const BRAKE = 0.9;
export const TRAIN_LENGTH = 100;
export const MARGIN = 50; // extra gap kept beyond braking distance
export const SENSOR_RANGE = 300; // how far a train's own sensor sees along its path
export const SIGHT_SPEED = 21; // fastest speed that can stop within SENSOR_RANGE - MARGIN
export const FRESH = 5; // a position message older than this is stale
export const TICK = 0.1; // simulation step

/** The speed that can stop within distance d: sqrt(2 * BRAKE * d). Never negative. */
export function safeSpeed(d: number): number {
  return Math.sqrt(2 * BRAKE * Math.max(0, d));
}

// Timers, in seconds. Values from docs/design.md.

/**
 * A permit is fresh for this long. A train shows mode 'central' only while its permit is
 * younger than this. The baseline train brakes to a stop after this long with no permit.
 */
export const PERMIT_FRESH = 5;
export const PERMIT_INTERVAL = 1; // the control centre sends each train a permit this often
export const POSITION_INTERVAL = 1; // each train broadcasts its position this often
export const REQUEST_REPEAT = 2; // a train repeats a lockRequest this often
export const MERGE_TIMEOUT = 10; // with no reply from the merge actor for this long, a train uses clock slots
export const STATION_TIMEOUT = 10; // with no reply from the station actor for this long, a train stopped at the end of its entry track uses the fixed split
export const RESUME_SETTLE = 5; // a local actor that is switched back on grants nothing for this long

// Clock slots, used while the merge actor is switched off.
// slot = floor(now / SLOT_LENGTH) mod SLOT_COUNT. Platform Pk may start during the
// first SLOT_WINDOW seconds of slot k - 1.
export const SLOT_LENGTH = 60;
export const SLOT_WINDOW = 15;
export const SLOT_COUNT = 4;
