import type { TrainId } from '../shared/types';

/** The failure switches the demo can flip. All on, with no radio loss, is a healthy railway. */
export interface Switches {
  /** The control centre is switched on. */
  centre: boolean;
  /** The platform keeper is switched on. */
  platformKeeper: boolean;
  /** The junction keeper is switched on. */
  junctionKeeper: boolean;
  /** The platform sensors are switched on. */
  sensors: boolean;
  /** Share of train-to-train messages the radio drops, from 0 to 1. */
  radioDrop: number;
}

export const ALL_ON: Switches = {
  centre: true,
  platformKeeper: true,
  junctionKeeper: true,
  sensors: true,
  radioDrop: 0,
};

/** A timed change to some switches. */
export interface Press {
  at: number;
  set: Partial<Switches>;
  /** A train that breaks down at this time. It stops where it is and stays there. */
  breakDown?: TrainId;
}

/** The switches at a given time: presses up to and including `now`, applied in time order. */
export function switchesAt(presses: Press[], now: number): Switches {
  const result: Switches = { ...ALL_ON };
  const ordered = [...presses].sort((a, b) => a.at - b.at);
  for (const p of ordered) {
    if (p.at <= now) Object.assign(result, p.set);
  }
  return result;
}
