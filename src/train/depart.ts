import type { Message, Outgoing, PlatformId, TrainId } from '../shared/types';
import { ACCEL, BRAKE, TICK } from '../shared/constants';
import { brakeLimit, elapsed } from './follow';
import type { TrainNumbers } from './numbers';

// Rules from docs/design.md, "Train rules" > "Leaving the station" and "Merge switched off".

/**
 * A reply from the merge actor to this train about the junction. The actor refuses a
 * queued train so it knows the actor is alive and does not fall back to clock slots.
 */
export type MergeReply =
  | { kind: 'grant'; follow: TrainId | null } // follow: the train to treat as leader on EXIT
  | { kind: 'refuse' };

export interface JunctionRequestInput {
  now: number;
  id: TrainId;
  dwellDone: boolean;
  holdsJunction: boolean; // true once the train holds the lock, or has left on a clock slot
  lastSentAt: number | null;
}

/**
 * "Leaving the station". True once the train has waited its dwell time since it stopped,
 * allowing `slack`.
 */
export function dwellDone(
  dwellStartedAt: number | null,
  dwell: number,
  now: number,
  numbers: Pick<TrainNumbers, 'slack'>,
): boolean {
  return dwellStartedAt !== null && elapsed(dwellStartedAt, now, dwell, numbers.slack);
}

/**
 * "Leaving the station". The lockRequest for JUNCTION to send this tick over short range:
 * after the dwell, then every requestRepeat seconds, allowing `slack`. Null if none is due.
 */
export function junctionRequest(
  input: JunctionRequestInput,
  numbers: Pick<TrainNumbers, 'requestRepeat' | 'slack'>,
): Outgoing | null {
  if (!input.dwellDone || input.holdsJunction) return null;
  const { lastSentAt, now } = input;
  if (lastSentAt !== null && !elapsed(lastSentAt, now, numbers.requestRepeat, numbers.slack)) return null;
  return { msg: { type: 'lockRequest', from: input.id, resource: 'JUNCTION' }, range: 'short' };
}

/**
 * "Leaving the station". The merge actor's reply to this train about JUNCTION in this
 * tick's inbox, grant or refusal, or null. Replies to other trains and platform replies
 * are ignored. A grant wins over a refusal in the same inbox.
 */
export function mergeReply(inbox: Message[], id: TrainId): MergeReply | null {
  let reply: MergeReply | null = null;
  for (const msg of inbox) {
    if (msg.type === 'lockGrant' && msg.to === id && msg.resource === 'JUNCTION') {
      return { kind: 'grant', follow: msg.follow };
    }
    if (msg.type === 'lockRefuse' && msg.to === id && msg.resource === 'JUNCTION') {
      reply = { kind: 'refuse' };
    }
  }
  return reply;
}

export interface GrantCheck {
  now: number;
  grantedAt: number; // when the train first heard this grant
  distance: number; // metres from the front to the junction zone, 0 or less once inside
  speed: number;
}

/**
 * "Leaving the station". True when the train must drop its junction grant. The merge actor
 * releases a grant if the zone has not filled within mergeTimeout, so the train must be in
 * the zone within grantLife of the grant or not enter on it at all. This looks ahead: it is
 * true as soon as the train could no longer reach the zone in time at full acceleration.
 * It is never true inside the zone, or when the train is too close and too fast to stop
 * short of it. Such a train is under three seconds from the zone and keeps going.
 */
export function grantExpired(input: GrantCheck, numbers: Pick<TrainNumbers, 'grantLife' | 'slack'>): boolean {
  const { now, grantedAt, distance, speed } = input;
  if (distance <= 0) return false;
  const timeToZone = (Math.sqrt(speed * speed + 2 * ACCEL * distance) - speed) / ACCEL;
  if (now + timeToZone < grantedAt + numbers.grantLife - numbers.slack) return false;
  return speed - BRAKE * TICK <= brakeLimit(distance);
}

/**
 * "Merge switched off". True after mergeTimeout seconds with no reply from the merge
 * actor, counted from the later of the first junction request and the last reply,
 * allowing `slack`.
 */
export function useClockSlots(
  firstAskedAt: number | null,
  lastReplyAt: number | null,
  now: number,
  numbers: Pick<TrainNumbers, 'mergeTimeout' | 'slack'>,
): boolean {
  if (firstAskedAt === null) return false;
  const since = Math.max(firstAskedAt, lastReplyAt ?? -Infinity);
  return elapsed(since, now, numbers.mergeTimeout, numbers.slack);
}

/**
 * "Merge switched off". True during the first slotWindow seconds of slot k - 1 for
 * platform Pk, where slot = floor(now / slotLength) mod slotCount. Allows `slack` at the
 * slot edges: a now a rounding error short of an edge counts as on it.
 */
export function slotOpen(
  platform: PlatformId,
  now: number,
  numbers: Pick<TrainNumbers, 'slotLength' | 'slotWindow' | 'slotCount' | 'slotOrder' | 'slack'>,
): boolean {
  const t = now + numbers.slack;
  const started = Math.floor(t / numbers.slotLength);
  const slot = started % numbers.slotCount;
  const into = t - started * numbers.slotLength;
  return slot === numbers.slotOrder.indexOf(platform) && into < numbers.slotWindow;
}

/**
 * "Merge switched off". True if the slot is open and sightAhead shows the junction zone
 * empty. From the platform stop point the whole zone is within SENSOR_RANGE, and the engine
 * reports an occupied zone as an obstacle, so empty means sightAhead is null. The caller
 * must have had nextTrack EXIT on the tick before, so sightAhead looks along EXIT.
 */
export function mayStartInSlot(
  platform: PlatformId,
  now: number,
  sightAhead: number | null,
  numbers: Pick<TrainNumbers, 'slotLength' | 'slotWindow' | 'slotCount' | 'slotOrder' | 'slack'>,
): boolean {
  return sightAhead === null && slotOpen(platform, now, numbers);
}
