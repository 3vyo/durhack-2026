import type { Message, Outgoing, PlatformId, Position, TrackId, TrainId, TrainState } from '../shared/types';
import type { TrainNumbers } from './numbers';

// Rules from docs/design.md, "Train rules" > "Entering the station",
// "Station switched off" and "Platform sensors switched off".
// Every function here is a placeholder that returns the safest value.

/** A reply from the station actor to this train about a platform. */
export type StationReply =
  | { kind: 'grant'; platform: PlatformId }
  | { kind: 'refuse'; platform: PlatformId; alternative: PlatformId | null };

/** The last station reply the train heard, with the time it arrived. */
export type HeardStationReply = StationReply & { at: number };

/** The newest platformStatus heard from each platform. */
export type PlatformStatusLog = Partial<Record<PlatformId, { occupied: boolean; sentAt: number }>>;

/** One tick of the creep rule, used when the station and the platform sensors are off. */
export interface CreepStep {
  probe: PlatformId | null; // platform to set as nextTrack so sightAhead looks into it
  take: PlatformId | null; // platform the train has chosen to enter
}

export interface PlatformRequestInput {
  now: number;
  id: TrainId;
  pos: Position;
  asking: PlatformId | null; // the platform to ask for, or the platform already granted
  lastSentAt: number | null;
}

export interface FallbackInput {
  self: TrainState;
  now: number;
  lastReply: HeardStationReply | null; // the last station reply, however old
  refusalIsSilence: boolean; // from refusalMeansSilence, this tick
  usingFallback: boolean; // whether the train was using the fallback last tick
}

export interface CreepInput {
  entry: 'A' | 'B';
  probing: PlatformId | null; // the nextTrack the train returned last tick
  sightAhead: number | null; // looks along last tick's nextTrack
}

export interface RefusalInput {
  lastReply: HeardStationReply | null; // the last station reply, however old
  statuses: PlatformStatusLog;
  entry: 'A' | 'B';
  pos: Position;
  now: number;
}

/**
 * "Entering the station". The station actor's reply to this train in this tick's inbox,
 * or null. Replies to other trains and junction replies are ignored.
 *
 * Placeholder: hears nothing, and silence means no.
 */
export function stationReply(_inbox: Message[], _id: TrainId): StationReply | null {
  return null;
}

/**
 * "Entering the station". Which platform to ask for: the last refusal's alternative if
 * there is one, else the permit's suggestion, else the default platform.
 *
 * Placeholder: the default platform. Asking does not move the train.
 */
export function platformToAsk(
  defaultPlatform: PlatformId,
  _suggestion: PlatformId | null,
  _lastReply: HeardStationReply | null,
): PlatformId {
  return defaultPlatform;
}

/**
 * "Entering the station". The lockRequest to send this tick over short range: first at the
 * ask point, then every requestRepeat seconds, allowing `slack`. The train keeps repeating
 * after the grant until its front is in the platform, so the station keeps the lock while
 * it is on its way in. Null if none is due.
 *
 * Placeholder: asks for nothing.
 */
export function platformRequest(
  _input: PlatformRequestInput,
  _numbers: Pick<TrainNumbers, 'askPoint' | 'requestRepeat' | 'slack'>,
): Outgoing | null {
  return null;
}

/**
 * "Entering the station". When the dwell timer started: the moment the train stops in its
 * platform. Once started it does not change.
 *
 * Placeholder: never starts, so the train never departs.
 */
export function dwellStart(_prev: number | null, _self: TrainState, _now: number): number | null {
  return null;
}

/**
 * "Station switched off". True when the train is stopped at the end of its entry track and
 * has had no reply, or has had a refusal that counts as silence. The agent stores the
 * result and passes it back as usingFallback, so the train can keep the fallback while it
 * moves into the platform.
 *
 * Placeholder: false, so the train keeps waiting.
 */
export function shouldUseFallback(
  _input: FallbackInput,
  _numbers: Pick<TrainNumbers, 'entryLength'>,
): boolean {
  return false;
}

/**
 * "Station switched off". The fixed split: the first platform of the train's own pair
 * whose sensor says empty, from a fresh status, or null to wait.
 *
 * Placeholder: waits.
 */
export function fixedSplitPlatform(
  _entry: 'A' | 'B',
  _statuses: PlatformStatusLog,
  _now: number,
  _numbers: Pick<TrainNumbers, 'pairs' | 'slack'>,
): PlatformId | null {
  return null;
}

/**
 * "Station switched off". With the sensors off too, look into the first platform of the
 * pair, then the other, and take the first that sightAhead shows has no train. Wait if
 * both do.
 *
 * Placeholder: looks at nothing and takes nothing.
 */
export function creepStep(_input: CreepInput, _numbers: Pick<TrainNumbers, 'pairs'>): CreepStep {
  return { probe: null, take: null };
}

/**
 * "Station switched off". The speed limit while entering a platform under the fallback:
 * SIGHT_SPEED or below. No limit when the train is not using the fallback.
 *
 * Placeholder: 0, so the train stops.
 */
export function fallbackLimit(_usingFallback: boolean): number {
  return 0;
}

/**
 * "Station switched off". True when this tick's nextTrack differs from last tick's. The
 * train must not accelerate on that tick, because sightAhead still reports the old path.
 *
 * Placeholder: true, so the train never accelerates.
 */
export function pathJustChanged(_prev: TrackId | null, _next: TrackId | null): boolean {
  return true;
}

/**
 * "Platform sensors switched off". The status log updated with this tick's platformStatus
 * messages, keeping the newest per platform.
 *
 * Placeholder: learns nothing new.
 */
export function recordPlatformStatus(prev: PlatformStatusLog, _inbox: Message[]): PlatformStatusLog {
  return prev;
}

/**
 * "Platform sensors switched off". True if the platform has a status under FRESH seconds
 * old, allowing `slack`.
 *
 * Placeholder: false, so the train trusts no sensor.
 */
export function hasFreshStatus(
  _statuses: PlatformStatusLog,
  _platform: PlatformId,
  _now: number,
  _numbers: Pick<TrainNumbers, 'slack'>,
): boolean {
  return false;
}

/**
 * "Platform sensors switched off". True when the last station reply is a refusal with no
 * alternative and it should count as silence: the train is where it should hear the
 * sensors (hearSensorsFrom to hearSensorsTo) and has no fresh platformStatus from either
 * platform of its pair. Reads the stored reply, so it holds on the ticks after the refusal.
 *
 * Placeholder: false, so the train keeps waiting.
 */
export function refusalMeansSilence(
  _input: RefusalInput,
  _numbers: Pick<TrainNumbers, 'hearSensorsFrom' | 'hearSensorsTo' | 'pairs' | 'xOf' | 'slack'>,
): boolean {
  return false;
}
