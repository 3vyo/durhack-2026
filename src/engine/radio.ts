import type { Outgoing, TrainId } from '../shared/types';
import { RANGE, inRange } from '../shared/map';
import type { Switches } from './switches';

/** Who sent a message. The engine fills this in, since a message does not carry its sender's kind. */
export type Sender =
  | { kind: 'train'; id: TrainId }
  | { kind: 'actor'; id: 'platformKeeper' | 'junctionKeeper' }
  | { kind: 'sensors' }
  | { kind: 'centre' }
  | { kind: 'radio' }; // staff moving trains by radio while the centre is down

export type Recipient =
  | { kind: 'train'; id: TrainId }
  | { kind: 'actor'; id: 'platformKeeper' | 'junctionKeeper' };

/** True if the slider drops this one delivery. Draws from rng only for partial rates. */
function dropped(sw: Switches, rng: () => number): boolean {
  if (sw.radioDrop >= 1) return true;
  if (sw.radioDrop <= 0) return false;
  return rng() < sw.radioDrop;
}

/**
 * Every message goes through this one function. It says who receives `out`.
 *
 * - Long range reaches every other train, and the slider drops each delivery on its own
 *   draw. A permit from the control centre goes to its train only, and the slider does not
 *   touch it: the centre is either on or off. A radio working permit also goes to its train
 *   only, but the slider drops it, because it travels by radio.
 * - Short range depends on where the train is. A train reaches the platform keeper from x 4300
 *   to 6400 and the junction keeper from x 6000 to 6600, and hears the platform sensors from x
 *   5500 to 6400. A local actor is either on or off, so there is no random loss here.
 */
export function route(
  out: Outgoing,
  from: Sender,
  trains: ReadonlyArray<{ id: TrainId; x: number }>,
  sw: Switches,
  rng: () => number,
): Recipient[] {
  const msg = out.msg;

  if (out.range === 'long') {
    if (msg.type === 'permit') {
      if (from.kind === 'radio') {
        if (dropped(sw, rng)) return [];
      } else if (!sw.centre) {
        return [];
      }
      return trains.some((t) => t.id === msg.to) ? [{ kind: 'train', id: msg.to }] : [];
    }
    return trains
      .filter((t) => !(from.kind === 'train' && t.id === from.id))
      .filter(() => !dropped(sw, rng))
      .map((t) => ({ kind: 'train', id: t.id }));
  }

  switch (msg.type) {
    case 'lockRequest': {
      const sender = trains.find((t) => t.id === msg.from);
      if (!sender) return [];
      if (msg.resource === 'JUNCTION') {
        return sw.junctionKeeper && inRange(sender.x, RANGE.junctionKeeper) ? [{ kind: 'actor', id: 'junctionKeeper' }] : [];
      }
      return sw.platformKeeper && inRange(sender.x, RANGE.platformKeeper) ? [{ kind: 'actor', id: 'platformKeeper' }] : [];
    }
    case 'lockGrant':
    case 'lockRefuse': {
      if (from.kind !== 'actor') return [];
      const range = from.id === 'platformKeeper' ? RANGE.platformKeeper : RANGE.junctionKeeper;
      const target = trains.find((t) => t.id === msg.to);
      return target && inRange(target.x, range) ? [{ kind: 'train', id: msg.to }] : [];
    }
    case 'platformStatus': {
      if (!sw.sensors) return [];
      return trains
        .filter((t) => inRange(t.x, RANGE.sensors))
        .map((t) => ({ kind: 'train', id: t.id }));
    }
    default:
      return [];
  }
}
