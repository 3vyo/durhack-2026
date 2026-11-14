import type { TrainProgram } from '../../src/engine/ports';
import { baselineProgram, makeCentre } from '../../src/baseline';
import { makeActors } from '../../src/locks';
import { createTrainAgent } from '../../src/train';

/**
 * Our program: our train agent, the station and merge actors, and the one control centre
 * serving permits as hints. The demo's runner will build the same thing from the same
 * exports.
 */
export const ourProgram: TrainProgram = {
  name: 'ours',
  agentFactory: createTrainAgent,
  makeActors,
  makeCentre: (timetable) => makeCentre(timetable, { serves: 'ours' }),
};

export { baselineProgram };
