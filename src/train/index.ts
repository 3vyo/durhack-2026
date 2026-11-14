import { BRAKE } from '../shared/constants';
import type { TrainAgentFactory } from '../shared/types';

/**
 * Builds the agent for one of our trains. The rules it must follow are in
 * docs/design.md under "Train rules".
 *
 * Placeholder: the agent holds its brakes on and sends nothing.
 */
export const createTrainAgent: TrainAgentFactory = () => ({
  decide: () => ({ accel: -BRAKE, nextTrack: null, outbox: [], mode: 'blind' }),
});
