import type { Message, Outgoing, PlatformId, TrainId } from '../shared/types';

// Rules from docs/design.md, "Train rules" > "Leaving the station" and "Merge switched off".
// Every function here is a placeholder that returns the safest value.

/** A junction grant from the merge actor to this train. */
export interface MergeGrant {
  follow: TrainId | null; // the train to treat as leader on EXIT
}

export interface JunctionRequestInput {
  now: number;
  id: TrainId;
  dwellDone: boolean;
  holdsJunction: boolean;
  lastSentAt: number | null;
}

/**
 * "Leaving the station". True once the train has waited its dwell time since it stopped.
 *
 * Placeholder: never done, so the train stays in the platform.
 */
export function dwellDone(_dwellStartedAt: number | null, _dwell: number, _now: number): boolean {
  return false;
}

/**
 * "Leaving the station". The lockRequest for JUNCTION to send this tick over short range:
 * after the dwell, then every 2 seconds. Null if none is due.
 *
 * Placeholder: asks for nothing.
 */
export function junctionRequest(_input: JunctionRequestInput): Outgoing | null {
  return null;
}

/**
 * "Leaving the station". The merge actor's junction grant to this train in this tick's
 * inbox, or null. Grants to other trains and platform grants are ignored.
 *
 * Placeholder: hears nothing.
 */
export function mergeGrant(_inbox: Message[], _id: TrainId): MergeGrant | null {
  return null;
}

/**
 * "Merge switched off". True after 10 seconds of asking for the junction with no reply.
 *
 * Placeholder: false, so the train keeps waiting.
 */
export function useClockSlots(
  _firstAskedAt: number | null,
  _heardReply: boolean,
  _now: number,
): boolean {
  return false;
}

/**
 * "Merge switched off". True during the first 15 seconds of slot k - 1 for platform Pk,
 * where slot = floor(now / 60) mod 4.
 *
 * Placeholder: the slot is never open.
 */
export function slotOpen(_platform: PlatformId, _now: number): boolean {
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
): boolean {
  return false;
}
