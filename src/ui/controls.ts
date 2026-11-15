import type { Switches } from '../engine/switches';
import type { ScenarioSummary } from '../runner/run';
import { FAILURE_LENGTH } from '../runner/failure';
import { SCENARIOS } from '../scenarios/scenarios';
import type { TrainId } from '../shared/types';

/** The on/off failure switches the demo page shows, in the order it shows them. */
export type SwitchKey = 'centre' | 'platformKeeper' | 'junctionKeeper' | 'sensors';

export const SWITCH_KEYS: SwitchKey[] = ['centre', 'platformKeeper', 'junctionKeeper', 'sensors'];

const SWITCH_NAMES: Record<SwitchKey, string> = {
  centre: 'Control centre',
  platformKeeper: 'Platform keeper',
  junctionKeeper: 'Junction keeper',
  sensors: 'Platform sensors',
};

/** The text on a switch's button, such as "Platform keeper: ON". */
export function switchLabel(key: SwitchKey, on: boolean): string {
  return `${SWITCH_NAMES[key]}: ${on ? 'ON' : 'OFF'}`;
}

/** The text beside the radio slider, such as "Radio loss: 40%". */
export function radioLabel(drop: number): string {
  return `Radio loss: ${Math.round(drop * 100)}%`;
}

/** Every switch on one line for the banner, the radio loss second. */
export function switchesLine(sw: Switches): string {
  const [centre, ...local] = SWITCH_KEYS;
  return [switchLabel(centre, sw.centre), radioLabel(sw.radioDrop), ...local.map((k) => switchLabel(k, sw[k]))].join(
    '  |  ',
  );
}

/** The train IDs on either map, lowest first, each once. Both sides run the same timetable. */
export function trainChoices(...maps: Array<Array<{ id: TrainId }>>): TrainId[] {
  const ids = new Set<TrainId>();
  for (const trains of maps) for (const t of trains) ids.add(t.id);
  return [...ids].sort((a, b) => a - b);
}

/**
 * What the batch runs behind the averages were, for the scoreboard labels, such as
 * "50 runs with a scripted 2 min centre outage". Live presses never reach these runs.
 */
export function batchRunsText(avg: Pick<ScenarioSummary, 'scenario' | 'seeds'>): string {
  const scenario = SCENARIOS[avg.scenario];
  if (!scenario.failure) return `${avg.seeds} runs with nothing failing`;
  const minutes = Number((FAILURE_LENGTH / 60).toFixed(1));
  return `${avg.seeds} runs with a scripted ${minutes} min ${scenario.title.toLowerCase()}`;
}

const DOWN_NAMES: Record<SwitchKey, string> = {
  centre: 'control centre',
  platformKeeper: 'platform keeper',
  junctionKeeper: 'junction keeper',
  sensors: 'platform sensors',
};

function listed(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The page title: what is failing right now, read from the switches, such as "All systems
 * working", "Control centre down" or "Control centre and radio down". Partial radio loss is
 * given as a share.
 */
export function statusTitle(sw: Switches): string {
  const down = SWITCH_KEYS.filter((k) => !sw[k]).map((k) => DOWN_NAMES[k]);
  if (sw.radioDrop >= 1) down.push('radio');
  const partial = sw.radioDrop > 0 && sw.radioDrop < 1 ? `radio losing ${Math.round(sw.radioDrop * 100)}%` : '';
  if (down.length === 0 && !partial) return 'All systems working';
  const parts = [down.length > 0 ? `${listed(down)} down` : '', partial].filter(Boolean).join(', ');
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}
