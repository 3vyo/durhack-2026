import type { Message, Outgoing, PlatformId, TrainId } from '../shared/types';
import type { TrainNumbers } from './numbers';

// Rules from docs/design.md, "Train rules" > "Leaving the station" and "Merge switched off".
// Every function here is a placeholder that returns the safest value.

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
  holdsJunction: boolean;
  lastSentAt: number | null;
}

/**
 * "Leaving the station". True once the train has waited its dwell time since it stopped,
 * allowing `slack`.
 *
 * Placeholder: never done, so the train stays in the platform.
 */
export function dwellDone(
  _dwellStartedAt: number | null,
  _dwell: number,
  _now: number,
  _numbers: Pick<TrainNumbers, 'slack'>,
): boolean {
  return false;
}

/**
 * "Leaving the station". The lockRequest for JUNCTION to send this tick over short range:
 * after the dwell, then every requestRepeat seconds, allowing `slack`. Null if none is due.
 *
 * Placeholder: asks for nothing.
 */
export function junctionRequest(
  _input: JunctionRequestInput,
  _numbers: Pick<TrainNumbers, 'requestRepeat' | 'slack'>,
): Outgoing | null {
  return null;
}

/**
 * "Leaving the station". The merge actor's reply to this train about JUNCTION in this
 * tick's inbox, grant or refusal, or null. Replies to other trains and platform replies
 * are ignored.
 *
 * Placeholder: hears nothing.
 */
export function mergeReply(_inbox: Message[], _id: TrainId): MergeReply | null {
  return null;
}

/**
 * "Merge switched off". True after mergeTimeout seconds with no reply from the merge
 * actor, counted from the later of the first junction request and the last reply,
 * allowing `slack`.
 *
 * Placeholder: false, so the train keeps waiting.
 */
export function useClockSlots(
  _firstAskedAt: number | null,
  _lastReplyAt: number | null,
  _now: number,
  _numbers: Pick<TrainNumbers, 'mergeTimeout' | 'slack'>,
): boolean {
  return false;
}

/**
 * "Merge switched off". True during the first slotWindow seconds of slot k - 1 for
 * platform Pk, where slot = floor(now / slotLength) mod slotCount. Allows `slack` at the
 * slot edges.
 *
 * Placeholder: the slot is never open.
 */
export function slotOpen(
  _platform: PlatformId,
  _now: number,
  _numbers: Pick<TrainNumbers, 'slotLength' | 'slotWindow' | 'slotCount' | 'slack'>,
): boolean {
  return false;
}

/**
 * "Merge switched off". True if the slot is open and sightAhead shows the junction zone
 * empty.
 *
 * Placeholder: false, so the train stays in the platform.
 */
export function mayStartInSlot(
  _platform: PlatformId,
  _now: number,
  _sightAhead: number | null,
  _numbers: Pick<TrainNumbers, 'slotLength' | 'slotWindow' | 'slotCount' | 'slack'>,
): boolean {
  return false;
}
