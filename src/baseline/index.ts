import type { ControlCentre } from '../engine/ports';
import { BRAKE } from '../shared/constants';
import type { TimetableEntry, TrainAgentFactory } from '../shared/types';

/**
 * Builds the control centre. Its rules are in docs/design.md under "Today's rule,
 * for comparison".
 *
 * Placeholder: the centre sends no permits.
 */
export function makeCentre(_timetable: TimetableEntry[]): ControlCentre {
  return { step: () => [] };
}

/**
 * Builds the agent for a baseline train, which obeys its permits and holds no locks.
 *
 * Placeholder: the agent holds its brakes on, as a train with no permit does.
 */
export const createBaselineAgent: TrainAgentFactory = () => ({
  decide: () => ({ accel: -BRAKE, nextTrack: null, outbox: [], mode: 'blind' }),
});
