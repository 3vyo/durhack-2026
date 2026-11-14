import type { Switches } from '../engine/switches';

// Data only. When a scenario's failure starts and ends is worked out per seed in
// src/runner/failure.ts.

export type ScenarioId =
  | 'healthy'
  | 'centre-outage'
  | 'radio-off'
  | 'platform-keeper-fault'
  | 'local-fault'
  | 'sensors-off'
  | 'blackout-talking'
  | 'blackout-silent'
  | 'long-outage';

export interface Scenario {
  id: ScenarioId;
  title: string;
  /** How much we must build: must have, should have, could have. */
  tier: 'must' | 'should' | 'could';
  /** What changes when the failure starts and when it ends. Null means nothing fails. */
  failure: { set: Partial<Switches>; restore: Partial<Switches> } | null;
  /** How long the failure lasts, in seconds. Absent means FAILURE_LENGTH in src/runner/failure.ts. */
  length?: number;
}

const ALL_LOCAL_AND_CENTRE_OFF: Partial<Switches> = { centre: false, platformKeeper: false, junctionKeeper: false };
const ALL_LOCAL_AND_CENTRE_ON: Partial<Switches> = { centre: true, platformKeeper: true, junctionKeeper: true };

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
  'radio-off': {
    id: 'radio-off',
    title: 'Radio off',
    tier: 'should',
    failure: { set: { radioDrop: 1 }, restore: { radioDrop: 0 } },
  },
  'platform-keeper-fault': {
    id: 'platform-keeper-fault',
    title: 'Platform keeper fault',
    tier: 'should',
    failure: { set: { platformKeeper: false }, restore: { platformKeeper: true } },
  },
  'sensors-off': {
    id: 'sensors-off',
    title: 'Sensors off',
    tier: 'should',
    failure: { set: { sensors: false }, restore: { sensors: true } },
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
    failure: { set: { junctionKeeper: false }, restore: { junctionKeeper: true } },
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
  'long-outage': {
    id: 'long-outage',
    title: 'Long outage',
    tier: 'should',
    failure: { set: { centre: false }, restore: { centre: true } },
    // 30 minutes, long enough for radio working to start in the baseline.
    length: 1800,
  },
};
