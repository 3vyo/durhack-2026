// Units: metres, seconds, metres per second. Default values from docs/design.md.
//
// These are the values every part of the build reads. A parameter file can change them
// for one run: see params.ts. They are declared with `let` so that setConstants can
// replace them, and every file that imports one sees the new value. Because of that,
// read a constant where you use it, inside a function. A copy made when a file loads,
// such as `const HALF_TICK = TICK / 2` at the top of a file, keeps the old value.

export let MAX_SPEED = 45; // about 100 mph
export let ACCEL = 0.5;
export let BRAKE = 0.9;
export let TRAIN_LENGTH = 100;
export let MARGIN = 50; // extra gap kept beyond braking distance
export let SENSOR_RANGE = 300; // how far a train's own sensor sees along its path
export let SIGHT_SPEED = 21; // fastest speed that can stop within SENSOR_RANGE - MARGIN
export let FRESH = 5; // a position message older than this is stale
export let TICK = 0.1; // simulation step

/** The speed that can stop within distance d: sqrt(2 * BRAKE * d). Never negative. */
export function safeSpeed(d: number): number {
  return Math.sqrt(2 * BRAKE * Math.max(0, d));
}

// Timers, in seconds. Default values from docs/design.md.

/**
 * A permit is fresh for this long. A train shows mode 'central' only while its permit is
 * younger than this. The baseline train brakes to a stop after this long with no permit.
 */
export let PERMIT_FRESH = 5;
export let PERMIT_INTERVAL = 1; // the control centre sends each train a permit this often
export let POSITION_INTERVAL = 1; // each train broadcasts its position this often
export let REQUEST_REPEAT = 2; // a train repeats a lockRequest this often
export let JUNCTION_KEEPER_TIMEOUT = 10; // with no reply from the junction keeper for this long, a train uses clock slots
export let PLATFORM_KEEPER_TIMEOUT = 10; // with no reply from the platform keeper for this long, a train stopped at the end of its entry track uses the fixed split
export let RESUME_SETTLE = 5; // a local actor that is switched back on grants nothing for this long

// Radio working: today's fallback when the control centre is down. Staff move stopped
// trains by radio, one at a time and at caution speed. RADIO_WORKING_DELAY is from the
// Modern Railways article in issue #24. RADIO_RELEASE_GAP is our own assumption.
export let RADIO_WORKING_DELAY = 1200; // the centre is down this long before staff move the first train
export let RADIO_RELEASE_GAP = 60; // staff release one stopped train this often

// Slow restart: when the centre comes back, staff release the stopped trains one at a time
// instead of all at once. Our assumption, off by default (0). See "Slow restart" in docs/design.md.
export let RESTART_GAP = 0; // seconds between releases. 0 releases every train at once

// Clock slots, used while the junction keeper is switched off.
// slot = floor(now / SLOT_LENGTH) mod SLOT_COUNT. Platform Pk may start during the
// first SLOT_WINDOW seconds of slot k - 1.
export let SLOT_LENGTH = 60;
export let SLOT_WINDOW = 15;
export let SLOT_COUNT = 4;

/** Every constant above, by name. currentConstants is the one list of them. */
export type ConstantValues = ReturnType<typeof currentConstants>;

/** The values in docs/design.md. resetConstants puts these back. */
export const DEFAULT_CONSTANTS: Readonly<ConstantValues> = Object.freeze(currentConstants());

/** The values in use right now. */
export function currentConstants() {
  return {
    MAX_SPEED,
    ACCEL,
    BRAKE,
    TRAIN_LENGTH,
    MARGIN,
    SENSOR_RANGE,
    SIGHT_SPEED,
    FRESH,
    TICK,
    PERMIT_FRESH,
    PERMIT_INTERVAL,
    POSITION_INTERVAL,
    REQUEST_REPEAT,
    JUNCTION_KEEPER_TIMEOUT,
    PLATFORM_KEEPER_TIMEOUT,
    RESUME_SETTLE,
    RADIO_WORKING_DELAY,
    RADIO_RELEASE_GAP,
    RESTART_GAP,
    SLOT_LENGTH,
    SLOT_WINDOW,
    SLOT_COUNT,
  };
}

/**
 * Replace some or all of the constants for the next run. Call it before a run starts,
 * never in the middle of one. It does not check the values. applyParams in params.ts
 * checks them first, so prefer that.
 */
export function setConstants(values: Partial<ConstantValues>): void {
  const v = { ...currentConstants(), ...values };
  MAX_SPEED = v.MAX_SPEED;
  ACCEL = v.ACCEL;
  BRAKE = v.BRAKE;
  TRAIN_LENGTH = v.TRAIN_LENGTH;
  MARGIN = v.MARGIN;
  SENSOR_RANGE = v.SENSOR_RANGE;
  SIGHT_SPEED = v.SIGHT_SPEED;
  FRESH = v.FRESH;
  TICK = v.TICK;
  PERMIT_FRESH = v.PERMIT_FRESH;
  PERMIT_INTERVAL = v.PERMIT_INTERVAL;
  POSITION_INTERVAL = v.POSITION_INTERVAL;
  REQUEST_REPEAT = v.REQUEST_REPEAT;
  JUNCTION_KEEPER_TIMEOUT = v.JUNCTION_KEEPER_TIMEOUT;
  PLATFORM_KEEPER_TIMEOUT = v.PLATFORM_KEEPER_TIMEOUT;
  RESUME_SETTLE = v.RESUME_SETTLE;
  RADIO_WORKING_DELAY = v.RADIO_WORKING_DELAY;
  RADIO_RELEASE_GAP = v.RADIO_RELEASE_GAP;
  RESTART_GAP = v.RESTART_GAP;
  SLOT_LENGTH = v.SLOT_LENGTH;
  SLOT_WINDOW = v.SLOT_WINDOW;
  SLOT_COUNT = v.SLOT_COUNT;
}

/** Put every constant back to its value in docs/design.md. */
export function resetConstants(): void {
  setConstants(DEFAULT_CONSTANTS);
}
