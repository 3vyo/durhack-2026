import { SIGHT_SPEED } from '../shared/constants';
import { isEntryTrack, isPlatform } from '../shared/map';
import type { EntryId, Message, Outgoing, PlatformId, Position, TrackId, TrainId, TrainState } from '../shared/types';
import { elapsed } from './follow';
import { isStill, type TrainNumbers } from './numbers';

// Rules from docs/design.md, "Train rules" > "Entering the station",
// "Platform keeper switched off" and "Platform sensors switched off".

/** A reply from the platform keeper to this train about a platform. */
export type PlatformKeeperReply =
  | { kind: 'grant'; platform: PlatformId }
  | { kind: 'refuse'; platform: PlatformId; alternative: PlatformId | null };

/** The last station reply the train heard, with the time it arrived. */
export type HeardPlatformKeeperReply = PlatformKeeperReply & { at: number };

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
  asking: PlatformId | null; // the platform to ask for, or the platform already chosen
  lastSentAt: number | null;
}

export interface FallbackInput {
  self: TrainState;
  now: number;
  firstAskedAt: number | null; // when the train sent its first platform request
  lastReplyAt: number | null; // when the station last gave a reply that counts
  usingFallback: boolean; // whether the train was using the fallback last tick
}

export interface CreepInput {
  entry: EntryId;
  probing: TrackId | null; // the nextTrack the train returned last tick
  sightAhead: number | null; // looks along last tick's nextTrack
}

export interface RefusalInput {
  lastReply: HeardPlatformKeeperReply | null; // the last station reply, however old
  statuses: PlatformStatusLog;
  entry: EntryId;
  pos: Position;
  now: number;
}

/**
 * "Entering the station". The platform keeper's reply to this train in this tick's inbox,
 * or null. Replies to other trains and junction replies are ignored. A grant wins over a
 * refusal in the same inbox.
 */
export function platformKeeperReply(inbox: Message[], id: TrainId): PlatformKeeperReply | null {
  let reply: PlatformKeeperReply | null = null;
  for (const msg of inbox) {
    if (msg.type !== 'lockGrant' && msg.type !== 'lockRefuse') continue;
    if (msg.to !== id || msg.resource === 'JUNCTION') continue;
    if (msg.type === 'lockGrant') return { kind: 'grant', platform: msg.resource };
    reply = { kind: 'refuse', platform: msg.resource, alternative: msg.alternative };
  }
  return reply;
}

/**
 * "Entering the station". Keeps a reply to the train's own pair. The entry track only
 * leads to its own two platforms, so a grant for any other platform is dropped, and an
 * alternative outside the pair is read as no alternative.
 */
export function ownPairOnly(reply: PlatformKeeperReply | null, pair: readonly PlatformId[]): PlatformKeeperReply | null {
  if (reply === null || !pair.includes(reply.platform)) return null;
  if (reply.kind === 'grant' || reply.alternative === null) return reply;
  return pair.includes(reply.alternative) ? reply : { ...reply, alternative: null };
}

/**
 * "Entering the station". Which platform to ask for: the last refusal's alternative if
 * there is one, else the default platform.
 */
export function platformToAsk(defaultPlatform: PlatformId, lastReply: HeardPlatformKeeperReply | null): PlatformId {
  if (lastReply?.kind === 'refuse' && lastReply.alternative !== null) return lastReply.alternative;
  return defaultPlatform;
}

/**
 * "Entering the station". The lockRequest to send this tick over short range: first at the
 * ask point, then every requestRepeat seconds, allowing `slack`. The train keeps repeating
 * after the grant until its front is in the platform, so the station keeps the lock while
 * it is on its way in. Null if none is due.
 */
export function platformRequest(
  input: PlatformRequestInput,
  numbers: Pick<TrainNumbers, 'askPoint' | 'requestRepeat' | 'slack'>,
): Outgoing | null {
  const { now, pos, asking, lastSentAt } = input;
  if (asking === null || !isEntryTrack(pos.track) || pos.offset < numbers.askPoint) return null;
  if (lastSentAt !== null && !elapsed(lastSentAt, now, numbers.requestRepeat, numbers.slack)) return null;
  return { msg: { type: 'lockRequest', from: input.id, resource: asking }, range: 'short' };
}

/**
 * "Entering the station". When the dwell timer started: the moment the train stops in its
 * platform. Once started it does not change.
 */
export function dwellStart(prev: number | null, self: TrainState, now: number): number | null {
  if (prev !== null) return prev;
  return isPlatform(self.pos.track) && isStill(self.speed) ? now : null;
}

/**
 * "Platform keeper switched off". True when the train is stopped at the end of its entry track,
 * within stopClose of it, and the station has given no reply that counts for platformKeeperTimeout
 * seconds, allowing `slack`.
 * The count runs from the later of the first request and the last reply. A refusal that
 * counts as silence is not a reply: the agent leaves it out of lastReplyAt.
 *
 * The agent stores the result and passes it back as usingFallback. Once true it stays true
 * while the silence lasts and while the train is in a platform, so the train keeps to
 * SIGHT_SPEED on its way in. It ends on EXIT.
 */
export function shouldUseFallback(
  input: FallbackInput,
  numbers: Pick<TrainNumbers, 'entryLength' | 'stopClose' | 'platformKeeperTimeout' | 'slack'>,
): boolean {
  const { self, now, firstAskedAt, lastReplyAt, usingFallback } = input;
  if (self.pos.track === 'EXIT') return false;
  if (!isEntryTrack(self.pos.track)) return usingFallback;
  if (firstAskedAt === null) return false;
  const since = Math.max(firstAskedAt, lastReplyAt ?? -Infinity);
  if (!elapsed(since, now, numbers.platformKeeperTimeout, numbers.slack)) return false;
  if (usingFallback) return true;
  return isStill(self.speed) && self.pos.offset >= numbers.entryLength - numbers.stopClose;
}

/**
 * "Platform keeper switched off". The fixed split: the first platform of the train's own pair
 * whose sensor says empty, from a fresh status, or null to wait.
 */
export function fixedSplitPlatform(
  entry: EntryId,
  statuses: PlatformStatusLog,
  now: number,
  numbers: Pick<TrainNumbers, 'pairs' | 'fresh' | 'slack'>,
): PlatformId | null {
  for (const platform of numbers.pairs[entry]) {
    if (hasFreshStatus(statuses, platform, now, numbers) && statuses[platform]?.occupied === false) {
      return platform;
    }
  }
  return null;
}

/**
 * "Platform keeper switched off". With the sensors off too, look into the first platform of the
 * pair, then the other, and take the first that sightAhead shows has no train. Wait if
 * both do, and keep looking at each in turn.
 *
 * sightAhead follows the nextTrack returned last tick, which is `probing`. So it only
 * judges a platform on the tick after the train pointed at it.
 */
export function creepStep(input: CreepInput, numbers: Pick<TrainNumbers, 'pairs'>): CreepStep {
  const pair = numbers.pairs[input.entry];
  const looking = pair.find((p) => p === input.probing) ?? null;
  if (looking === null) return { probe: pair[0] ?? null, take: null };
  if (input.sightAhead === null) return { probe: looking, take: looking };
  const other = pair.find((p) => p !== looking) ?? null;
  return { probe: other, take: null };
}

/**
 * "Platform keeper switched off". The speed limit while entering a platform under the fallback:
 * SIGHT_SPEED or below. No limit when the train is not using the fallback.
 */
export function fallbackLimit(usingFallback: boolean): number {
  return usingFallback ? SIGHT_SPEED : Infinity;
}

/**
 * "Platform keeper switched off". True when this tick's nextTrack differs from last tick's. The
 * train must not accelerate on that tick, because sightAhead still reports the old path.
 */
export function pathJustChanged(prev: TrackId | null, next: TrackId | null): boolean {
  return prev !== next;
}

/**
 * "Platform sensors switched off". The status log updated with this tick's platformStatus
 * messages, keeping the newest per platform.
 */
export function recordPlatformStatus(prev: PlatformStatusLog, inbox: Message[]): PlatformStatusLog {
  let log = prev;
  for (const msg of inbox) {
    if (msg.type !== 'platformStatus') continue;
    const held = log[msg.platform];
    if (held && held.sentAt >= msg.sentAt) continue;
    if (log === prev) log = { ...prev };
    log[msg.platform] = { occupied: msg.occupied, sentAt: msg.sentAt };
  }
  return log;
}

/**
 * "Platform sensors switched off". True if the platform has a status under `fresh` seconds
 * old, allowing `slack`.
 */
export function hasFreshStatus(
  statuses: PlatformStatusLog,
  platform: PlatformId,
  now: number,
  numbers: Pick<TrainNumbers, 'fresh' | 'slack'>,
): boolean {
  const status = statuses[platform];
  return status !== undefined && !elapsed(status.sentAt, now, numbers.fresh, numbers.slack);
}

/**
 * "Platform sensors switched off". True if the train has no fresh status from any platform
 * of its pair. Where it should hear the sensors, that means they are switched off.
 */
export function sensorsSilent(
  entry: EntryId,
  statuses: PlatformStatusLog,
  now: number,
  numbers: Pick<TrainNumbers, 'pairs' | 'fresh' | 'slack'>,
): boolean {
  return numbers.pairs[entry].every((p) => !hasFreshStatus(statuses, p, now, numbers));
}

/**
 * "Platform sensors switched off". True when the last station reply is a refusal with no
 * alternative and it should count as silence: the train is where it should hear the
 * sensors (hearSensorsFrom to hearSensorsTo) and has no fresh platformStatus from either
 * platform of its pair. Reads the stored reply, so it holds on the ticks after the refusal.
 */
export function refusalMeansSilence(
  input: RefusalInput,
  numbers: Pick<TrainNumbers, 'hearSensorsFrom' | 'hearSensorsTo' | 'pairs' | 'xOf' | 'fresh' | 'slack'>,
): boolean {
  const { lastReply, statuses, entry, pos, now } = input;
  if (lastReply?.kind !== 'refuse' || lastReply.alternative !== null) return false;
  const x = numbers.xOf(pos);
  if (x < numbers.hearSensorsFrom || x > numbers.hearSensorsTo) return false;
  return sensorsSilent(entry, statuses, now, numbers);
}
