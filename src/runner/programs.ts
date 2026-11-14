import type { TrainProgram } from '../engine/ports';
import { baselineProgram, makeCentre } from '../baseline';
import { makeActors } from '../locks';
import { createTrainAgent } from '../train';

// The two real programs the engine runs. The stand-ins in stubs.ts are only for tests of
// the engine itself.

/**
 * Our program: our train agent, the station and merge actors, and the one control centre.
 * While the centre is on, our trains obey its permits like today's trains. When it fails
 * they carry on with their own rules and the local actors.
 */
export const ourProgram: TrainProgram = {
  name: 'ours',
  agentFactory: createTrainAgent,
  makeActors,
  makeCentre: (timetable) => makeCentre(timetable),
};

/** Today's rule: the same control centre decides everything, and trains obey their permits. */
export { baselineProgram };

export const PROGRAMS = { baseline: baselineProgram, ours: ourProgram };
