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
