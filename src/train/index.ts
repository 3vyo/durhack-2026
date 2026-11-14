import type { TrainAgentFactory } from '../shared/types';
import { createAgent } from './agent';

/**
 * Builds the agent for one of our trains. The rules it must follow are in
 * docs/design.md under "Train rules". The agent itself is in agent.ts.
 *
 * Placeholder: every rule returns its safest value, so the agent holds its brakes on,
 * sets nextTrack to null, sends nothing and reports mode blind.
 */
export const createTrainAgent: TrainAgentFactory = createAgent;
