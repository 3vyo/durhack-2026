/** The failure switches the demo can flip. All on, with no radio loss, is a healthy railway. */
export interface Switches {
  /** The control centre is switched on. */
  centre: boolean;
  /** The station actor is switched on. */
  station: boolean;
  /** The merge actor is switched on. */
  merge: boolean;
  /** The platform sensors are switched on. */
  sensors: boolean;
  /** Share of train-to-train messages the radio drops, from 0 to 1. */
  radioDrop: number;
}

export const ALL_ON: Switches = {
  centre: true,
  station: true,
  merge: true,
  sensors: true,
  radioDrop: 0,
};

/** A timed change to some switches. */
export interface Press {
  at: number;
  set: Partial<Switches>;
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
