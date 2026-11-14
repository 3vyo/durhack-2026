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
import type { TrainNumbers } from './numbers';

// Rules from docs/design.md, "Train rules" > "Following".
// Every function here is a placeholder that returns the safest value.

/**
 * Who the train follows. 'none' means the train knows there is no train ahead, as when
 * the timetable gives leader null. 'unknown' means it does not know, as after a clock slot
 * start on EXIT, so it stays at SIGHT_SPEED or below.
 */
export type Leader = TrainId | 'none' | 'unknown';

/** The last position a train heard from another train. */
export interface PositionReport {
  pos: Position; // the other train's front
  speed: number;
  sentAt: number;
}

/** The newest position report heard from each train, by train ID. */
export type ReportLog = Record<TrainId, PositionReport>;

/**
 * "Following". The position message to broadcast this tick, sent every positionEvery
 * seconds over long range, or null if none is due. Allows `slack` on the timer.
 *
 * Placeholder: sends nothing.
 */
export function positionMessage(
  _now: number,
  _self: TrainState,
  _lastSentAt: number | null,
  _numbers: Pick<TrainNumbers, 'positionEvery' | 'slack'>,
): Outgoing | null {
  return null;
}

/**
 * "Following". The report log updated with this tick's position messages, keeping the
 * newest report from every train, not only the leader. Then a train that gets a new
 * leader already has its last report.
 *
 * Placeholder: learns nothing new.
 */
export function recordPositions(prev: ReportLog, _inbox: Message[]): ReportLog {
  return prev;
}

/**
 * "Following". The leader's newest report from the log, or null if the leader is 'none',
 * 'unknown' or never heard.
 *
 * Placeholder: no report.
 */
export function leaderReport(_log: ReportLog, _leader: Leader): PositionReport | null {
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
  _report: PositionReport | null,
  _numbers: Pick<TrainNumbers, 'xOf'>,
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
 * train with no platform, or offset platformStop in a platform. No floor. The train starts
 * braking one tick early so it stops at or before the point, never past it. nextTrack is
 * this tick's choice: once it is EXIT, the platform stop point no longer applies.
 *
 * Placeholder: 0, so the train stops.
 */
export function stopPointLimit(
  _self: TrainState,
  _platform: PlatformId | null,
  _nextTrack: TrackId | null,
  _numbers: Pick<TrainNumbers, 'entryLength' | 'platformStop'>,
): number {
  return 0;
}

/**
 * "Following", the mode table. Central while the train holds a fresh permit, then full,
 * stale or blind from the age of the leader's report against FRESH, allowing `slack`.
 *
 * Placeholder: blind.
 */
export function modeFor(
  _now: number,
  _leader: Leader,
  _report: PositionReport | null,
  _permitFresh: boolean,
  _numbers: Pick<TrainNumbers, 'slack'>,
): TrainOutput['mode'] {
  return 'blind';
}
