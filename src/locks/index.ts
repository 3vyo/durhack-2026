import type { LocalActor, TimetableEntry } from '../shared/types';
import { createMergeActor } from './merge';
import { createStationActor } from './station';

/**
 * Builds the station actor and the merge actor for our program. This is
 * TrainProgram.makeActors in src/engine/ports.ts. Their rules are in docs/design.md under
 * "Entering the station", "Platform sensors switched off" and "Leaving the station".
 *
 * The platform sensors are not here. The engine builds them and passes their readings to
 * each actor's step.
 */
export function makeActors(timetable: TimetableEntry[]): LocalActor[] {
  return [createStationActor(timetable), createMergeActor()];
}
