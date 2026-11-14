import type { LocalActor, TimetableEntry } from '../shared/types';
import { createJunctionKeeper } from './junction-keeper';
import { createPlatformKeeper } from './platform-keeper';

/**
 * Builds the platform keeper and the junction keeper for our program. This is
 * TrainProgram.makeActors in src/engine/ports.ts. Their rules are in docs/design.md under
 * "Entering the station", "Platform sensors switched off" and "Leaving the station".
 *
 * The platform sensors are not here. The engine builds them and passes their readings to
 * each actor's step.
 */
export function makeActors(timetable: TimetableEntry[]): LocalActor[] {
  return [createPlatformKeeper(timetable), createJunctionKeeper()];
}
