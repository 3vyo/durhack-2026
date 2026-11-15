import type { TrainProgram } from '../../src/engine/ports';
import { generateTimetable, type TimetableOptions } from '../../src/engine/timetable';
import { CROSS_LINES, crossPlatforms } from '../../src/shared/map';
import type { TrainId } from '../../src/shared/types';

// Shared by the cross links tests of the runner. The control centre decides who crosses, and
// that is tested with the centre. These helpers only show whether the switch a run asked for
// is the one the engine and the agents see while the run is going.

/** What the trains of a watched program saw while they ran. */
export interface Watch {
  /** The switch each time the program built train 1's agent, so one value for each run. */
  builds: boolean[];
  /** Every value of the switch an agent saw in `decide`. */
  switches: Set<boolean>;
  /** Every value of `crossPlatforms('A')` an agent saw in `decide`, joined into text. */
  links: Set<string>;
  /** The line A trains whose front was seen in P3. */
  crossed: Set<TrainId>;
}

export function newWatch(): Watch {
  return { builds: [], switches: new Set(), links: new Set(), crossed: new Set() };
}

/**
 * A copy of a stub program that notes what its trains see of the cross links switch.
 *
 * With `redirect`, its line A trains also ask for P3 at the end of A, the platform A's cross
 * link reaches. The engine moves a train onto a track only if the map says the track leads
 * there, so a line A train is seen in P3 only if the engine itself saw the switch on. With the
 * switch off, the engine stops those trains at the end of A instead.
 */
export function watched(base: TrainProgram, watch: Watch, redirect = false): TrainProgram {
  return {
    ...base,
    agentFactory: (id, timetable) => {
      if (id === 1) watch.builds.push(CROSS_LINES);
      const onLineA = timetable.find((e) => e.id === id)?.entry === 'A';
      const agent = base.agentFactory(id, timetable);
      return {
        decide: (input) => {
          watch.switches.add(CROSS_LINES);
          watch.links.add(crossPlatforms('A').join());
          const track = input.self.pos.track;
          if (onLineA && track === 'P3') watch.crossed.add(id);
          const out = agent.decide(input);
          return redirect && onLineA && track === 'A' ? { ...out, nextTrack: 'P3' } : out;
        },
      };
    },
  };
}

/** A short timetable for these tests: six trains, so each run is quick. */
export const SHORT_TIMETABLE: TimetableOptions = { trains: 6, minHeadway: 45, dwell: 30 };

/**
 * A seed whose short timetable, on the default layout, has a line A train among its first
 * three trains. Call it with the default layout in use.
 */
export function seedWithLineA(): number {
  for (let seed = 1; seed <= 50; seed++) {
    if (generateTimetable(seed, SHORT_TIMETABLE).slice(0, 3).some((e) => e.entry === 'A')) return seed;
  }
  throw new Error('no seed up to 50 puts an early train on line A');
}
