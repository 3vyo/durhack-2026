import type {
  Message,
  Outgoing,
  PlatformId,
  Position,
  TrackId,
  TrainId,
  TrainOutput,
  TrainState,
} from '../shared/types';

// Rules from docs/design.md, "Train rules" > "Following".
// Every function here is a placeholder that returns the safest value.

/**
 * Who the train follows. 'none' means the train knows there is no train ahead, as when
 * the timetable gives leader null. 'unknown' means it does not know, as after a clock slot
 * start on EXIT, so it stays at SIGHT_SPEED or below.
 */
export type Leader = TrainId | 'none' | 'unknown';

/** The last position a train heard from its leader. */
export interface LeaderReport {
  pos: Position; // the leader's front
  speed: number;
  sentAt: number;
}

/**
 * "Following". The position message to broadcast this tick, sent once every second over
 * long range, or null if none is due.
 *
 * Placeholder: sends nothing.
 */
export function positionMessage(
  _now: number,
  _self: TrainState,
  _lastSentAt: number | null,
): Outgoing | null {
  return null;
}

/**
 * "Following". The newest position report from this train's leader, given the report
 * it already had and this tick's inbox. Reports from other trains are ignored.
 *
 * Placeholder: knows nothing about the leader.
 */
export function latestLeaderReport(
  _prev: LeaderReport | null,
  _inbox: Message[],
  _leader: Leader,
): LeaderReport | null {
  return null;
}

/**
 * "Following". The speed limit from the leader's limit point: the leader's last reported
 * rear minus MARGIN, however old the report is. Floored at SIGHT_SPEED, capped at
 * MAX_SPEED. With an unknown leader, or a leader never heard, it is SIGHT_SPEED.
 *
 * Placeholder: 0, so the train stops.
 */
export function leaderLimit(
  _self: Position,
  _leader: Leader,
  _report: LeaderReport | null,
): number {
  return 0;
}

/**
 * "Following". The speed limit from the train's own sensor: safeSpeed(sightAhead - MARGIN),
 * with no floor. sightAhead is the distance from this train's front to the rear of the
 * nearest obstacle on its path. Null means nothing within SENSOR_RANGE, which adds no limit.
 *
 * Placeholder: 0, so the train stops.
 */
export function sightLimit(_sightAhead: number | null): number {
  return 0;
}

/**
 * "Following". The speed limit from the next stop point: the end of an entry track for a
 * train with no platform, or offset 300 in a platform. No floor. The train starts braking
 * one tick early so it stops at or before the point, never past it. nextTrack is this
 * tick's choice: once it is EXIT, the platform stop point no longer applies.
 *
 * Placeholder: 0, so the train stops.
 */
export function stopPointLimit(
  _self: TrainState,
  _platform: PlatformId | null,
  _nextTrack: TrackId | null,
): number {
  return 0;
}

/**
 * "Following", the mode table. Central while the train holds a permit under 5 seconds old,
 * then full, stale or blind from the age of the leader's report.
 *
 * Placeholder: blind.
 */
export function modeFor(
  _now: number,
  _leader: Leader,
  _report: LeaderReport | null,
  _permitFresh: boolean,
): TrainOutput['mode'] {
  return 'blind';
}
