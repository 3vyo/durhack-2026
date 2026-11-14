import type { TrainProgram } from '../engine/ports';
import { makeCentre } from './centre';
import { createBaselineAgent } from './train';

// The baseline: today's railway, where a control centre decides everything and a train
// with no permit stops. See "Today's rule, for comparison" in docs/design.md.

export { makeCentre } from './centre';
export type { CentreOptions } from './centre';
export { createBaselineAgent } from './train';

/**
 * The baseline as one program the engine can run. It has no local actors, because the
 * baseline holds no locks. Design: "Today's rule, for comparison".
 */
export const baselineProgram: TrainProgram = {
  name: 'baseline',
  agentFactory: createBaselineAgent,
  makeActors: () => [],
  makeCentre: (timetable) => makeCentre(timetable),
};
