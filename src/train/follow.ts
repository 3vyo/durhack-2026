import { BRAKE, MARGIN, MAX_SPEED, SIGHT_SPEED, TICK, TRAIN_LENGTH, safeSpeed } from '../shared/constants';
import type {
  Message,
  Outgoing,
  PlatformId,
  Position,
  TrainId,
  TrainOutput,
  TrainState,
} from '../shared/types';
import { STOP_SHORT, type TrainNumbers } from './numbers';

// Rules from docs/design.md, "Train rules" > "Following".

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

/** True once `span` seconds have passed, allowing `slack` for rounding in the clock. */
export function elapsed(since: number, now: number, span: number, slack: number): boolean {
  return now - since >= span - slack;
}

/**
 * The speed a train may have after this tick and still stop within distance d. This is
 * safeSpeed(d) braked one tick early: the engine moves in steps of TICK, so a train that
 * followed safeSpeed exactly would run about half a tick past the point. Taking half a
 * tick of braking off the speed makes the stepped stop land at or before the point, and
 * STOP_SHORT keeps rounding from carrying it over. A train on this curve stays on it under
 * full braking. No floor.
 */
export function brakeLimit(d: number): number {
  return Math.max(0, safeSpeed(d - STOP_SHORT) - (BRAKE * TICK) / 2);
}

/**
 * "Following". The position message to broadcast this tick, sent every positionEvery
 * seconds over long range, or null if none is due. Allows `slack` on the timer.
 */
export function positionMessage(
  now: number,
  self: TrainState,
  lastSentAt: number | null,
  numbers: Pick<TrainNumbers, 'positionEvery' | 'slack'>,
): Outgoing | null {
  if (lastSentAt !== null && !elapsed(lastSentAt, now, numbers.positionEvery, numbers.slack)) return null;
  const msg: Message = { type: 'position', from: self.id, pos: { ...self.pos }, speed: self.speed, sentAt: now };
  return { msg, range: 'long' };
}

/**
 * "Following". The last position message of a train that leaves the map on this tick: its
 * front at the end of EXIT, sent whatever the broadcast timer says, so the train behind
 * knows its leader has gone and does not slow down for the last report it heard. Null if
 * the train does not leave this tick. It works the move out the way the engine does: the
 * speed first, then the distance. A broken-down train never leaves.
 */
export function leavingMessage(
  now: number,
  self: TrainState,
  accel: number,
  numbers: Pick<TrainNumbers, 'exitLength'>,
): Outgoing | null {
  if (self.pos.track !== 'EXIT' || self.brokenDown) return null;
  const speed = Math.min(MAX_SPEED, Math.max(0, self.speed + accel * TICK));
  if (self.pos.offset + speed * TICK < numbers.exitLength) return null;
  const pos: Position = { track: 'EXIT', offset: numbers.exitLength };
  const msg: Message = { type: 'position', from: self.id, pos, speed, sentAt: now };
  return { msg, range: 'long' };
}

/**
 * "Following". True if the report puts the train's front at the end of EXIT. Only a train
 * leaving the map sends that, so the train has gone.
 */
export function hasLeft(report: PositionReport, numbers: Pick<TrainNumbers, 'exitLength'>): boolean {
  return report.pos.track === 'EXIT' && report.pos.offset >= numbers.exitLength;
}

/**
 * "Following". The report log updated with this tick's position messages, keeping the
 * newest report from every train, not only the leader. Then a train that gets a new
 * leader already has its last report.
 */
export function recordPositions(prev: ReportLog, inbox: Message[]): ReportLog {
  let log = prev;
  for (const msg of inbox) {
    if (msg.type !== 'position') continue;
    const held = log[msg.from];
    if (held && held.sentAt >= msg.sentAt) continue;
    if (log === prev) log = { ...prev };
    log[msg.from] = { pos: msg.pos, speed: msg.speed, sentAt: msg.sentAt };
  }
  return log;
}

/**
 * "Following". The leader's newest report from the log, or null if the leader is 'none',
 * 'unknown' or never heard.
 */
export function leaderReport(log: ReportLog, leader: Leader): PositionReport | null {
  if (leader === 'none' || leader === 'unknown') return null;
  return log[leader] ?? null;
}

/**
 * "Following". The speed limit from the leader's limit point: the leader's last reported
 * rear minus MARGIN, however old the report is. Floored at SIGHT_SPEED, capped at
 * MAX_SPEED. With an unknown leader, or a leader never heard, it is SIGHT_SPEED. With no
 * leader at all the line ahead is clear, so there is no limit point and no limit. A leader
 * that has left the map leaves no limit point either.
 */
export function leaderLimit(
  self: Position,
  leader: Leader,
  report: PositionReport | null,
  numbers: Pick<TrainNumbers, 'xOf' | 'exitLength'>,
): number {
  if (leader === 'none') return Infinity;
  if (leader === 'unknown' || report === null) return SIGHT_SPEED;
  if (hasLeft(report, numbers)) return Infinity;
  const limitPoint = numbers.xOf(report.pos) - TRAIN_LENGTH - MARGIN;
  const distance = limitPoint - numbers.xOf(self);
  return Math.min(MAX_SPEED, Math.max(brakeLimit(distance), SIGHT_SPEED));
}

/**
 * "Following". The speed limit from the train's own sensor: safeSpeed(sightAhead - MARGIN),
 * braked one tick early, with no floor. sightAhead is the distance from this train's front
 * to the rear of the nearest obstacle on its path. Null means nothing within SENSOR_RANGE,
 * which adds no limit.
 */
export function sightLimit(sightAhead: number | null): number {
  if (sightAhead === null) return Infinity;
  return brakeLimit(sightAhead - MARGIN);
}

/**
 * The distance to the train's next stop point, or Infinity if it has none: the end of an
 * entry track for a train with no platform, or offset platformStop in a platform. A train
 * with a platform, still on its entry track, measures through to the stop in the platform.
 * `leaving` is true once the train holds the junction lock, has started in its clock slot,
 * or was let through by the centre before it failed. Then the platform stop point no longer
 * applies.
 */
export function stopPointDistance(
  pos: Position,
  platform: PlatformId | null,
  leaving: boolean,
  numbers: Pick<TrainNumbers, 'entryLength' | 'platformStop'>,
): number {
  if (pos.track === 'EXIT') return Infinity;
  if (pos.track === 'A' || pos.track === 'B') {
    const toEnd = numbers.entryLength - pos.offset;
    return platform === null ? toEnd : toEnd + numbers.platformStop;
  }
  return leaving ? Infinity : numbers.platformStop - pos.offset;
}

/**
 * "The centre comes first". True if the train's front is past its platform's stop point,
 * so it is in the junction zone. Our rules never take a train past it without leave to go,
 * so a train found there was let through by the centre before the centre failed.
 */
export function isPastPlatformStop(pos: Position, numbers: Pick<TrainNumbers, 'platformStop'>): boolean {
  const inPlatform = pos.track !== 'A' && pos.track !== 'B' && pos.track !== 'EXIT';
  return inPlatform && pos.offset > numbers.platformStop;
}

/**
 * "Following". The speed limit from the next stop point. No floor. The train brakes one
 * tick early so it stops at or before the point, never past it.
 */
export function stopPointLimit(
  self: TrainState,
  platform: PlatformId | null,
  leaving: boolean,
  numbers: Pick<TrainNumbers, 'entryLength' | 'platformStop'>,
): number {
  const distance = stopPointDistance(self.pos, platform, leaving, numbers);
  return distance === Infinity ? Infinity : brakeLimit(distance);
}

/**
 * "Following", the mode table. Central while the train holds a fresh permit. Otherwise
 * full, stale or blind from the age of the leader's report against `fresh`, allowing
 * `slack`. A train with no leader at all reports full: it knows the line ahead is clear.
 */
export function modeFor(
  now: number,
  leader: Leader,
  report: PositionReport | null,
  permitFresh: boolean,
  numbers: Pick<TrainNumbers, 'fresh' | 'slack' | 'exitLength'>,
): TrainOutput['mode'] {
  if (permitFresh) return 'central';
  if (leader === 'none') return 'full';
  if (leader === 'unknown' || report === null) return 'blind';
  if (hasLeft(report, numbers)) return 'full';
  return elapsed(report.sentAt, now, numbers.fresh, numbers.slack) ? 'stale' : 'full';
}
