import type { Switches } from '../engine/switches';

// Data only. When a scenario's failure starts and ends is worked out per seed in
// src/runner/failure.ts.

export type ScenarioId =
  | 'healthy'
  | 'centre-outage'
  | 'blackout-talking'
  | 'local-fault'
  | 'blackout-silent';

export interface Scenario {
  id: ScenarioId;
  title: string;
  /** How much we must build: must have, should have, could have. */
  tier: 'must' | 'should' | 'could';
  /** What changes when the failure starts and when it ends. Null means nothing fails. */
  failure: { set: Partial<Switches>; restore: Partial<Switches> } | null;
}

const ALL_LOCAL_AND_CENTRE_OFF: Partial<Switches> = { centre: false, station: false, merge: false };
const ALL_LOCAL_AND_CENTRE_ON: Partial<Switches> = { centre: true, station: true, merge: true };

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  healthy: {
    id: 'healthy',
    title: 'Healthy control',
    tier: 'must',
    failure: null,
  },
  'centre-outage': {
    id: 'centre-outage',
    title: 'Centre outage',
    tier: 'must',
    failure: { set: { centre: false }, restore: { centre: true } },
  },
  'blackout-talking': {
    id: 'blackout-talking',
    title: 'Blackout, trains talking',
    tier: 'should',
    failure: { set: ALL_LOCAL_AND_CENTRE_OFF, restore: ALL_LOCAL_AND_CENTRE_ON },
  },
  'local-fault': {
    id: 'local-fault',
    title: 'Local fault',
    tier: 'should',
    failure: { set: { merge: false }, restore: { merge: true } },
  },
  'blackout-silent': {
    id: 'blackout-silent',
    title: 'Blackout, trains silent',
    tier: 'could',
    failure: {
      set: { ...ALL_LOCAL_AND_CENTRE_OFF, radioDrop: 1 },
      restore: { ...ALL_LOCAL_AND_CENTRE_ON, radioDrop: 0 },
    },
  },
};
