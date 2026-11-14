import type { TrainAgentFactory } from '../shared/types';
import { createAgent } from './agent';

/**
 * Builds the agent for one of our trains. The rules it must follow are in
 * docs/design.md under "Train rules". The agent itself is in agent.ts.
 */
export const createTrainAgent: TrainAgentFactory = (id, timetable) => createAgent(id, timetable);
