import type { Switches } from '../engine/switches';
import type { ScenarioSummary } from '../runner/run';
import { FAILURE_LENGTH } from '../runner/failure';
import { SCENARIOS } from '../scenarios/scenarios';
import { DEFAULT_LAYOUT, ENTRIES, LAYOUT, isLayoutId, type LayoutId } from '../shared/map';
import type { EntryId, TrainId } from '../shared/types';

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

/** A line a spawned train can start on. */
export type EntryLine = EntryId;

/** The lines a spawned train can start on: the entry lines of the layout in use, in order. */
export function entryLines(): EntryLine[] {
  return [...ENTRIES];
}

/**
 * The line a spawned train starts on: one of the layout's entry lines, each as likely as the
 * others. `random` returns a number from 0 up to but not including 1, like Math.random. Both
 * sides get the train on the same line, so they stay comparable.
 */
export function randomLine(random: () => number = Math.random): EntryLine {
  const lines = entryLines();
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))];
}

/**
 * The layout the page address asks for with `?layout=<id>`, or the default layout if it names
 * none or one that does not exist.
 */
export function parseLayout(search: string): LayoutId {
  const value = new URLSearchParams(search).get('layout');
  return isLayoutId(value) ? value : DEFAULT_LAYOUT;
}

/**
 * The page address that opens another layout: the same address with `layout` set, and every
 * other parameter kept, such as `quality=low`. The layout is chosen before anything is built,
 * so the page changes it by loading this address.
 */
export function layoutUrl(href: string, id: LayoutId): string {
  const url = new URL(href);
  url.searchParams.set('layout', id);
  return url.href;
}

/** The parts of the Layout list that `keepLayoutShown` uses. */
export interface LayoutList {
  value: string;
  autocomplete: string;
}

/** The part of the window that `keepLayoutShown` uses. */
export interface ShownPage {
  addEventListener(type: 'pageshow', listener: () => void): void;
}

/**
 * Makes the Layout list show the layout in use, and keeps it that way. Choosing another layout
 * leaves this page with the new choice selected. The browser's Back button can then bring the
 * page back as it was left, or load it again and put the old choice back, so the list would
 * name a layout the page is not running, and choosing that layout would do nothing. The
 * browser is told not to restore the list, and the list is set again each time the page is
 * shown. Call it after the list has its options.
 */
export function keepLayoutShown(list: LayoutList, page: ShownPage): void {
  const show = (): void => {
    list.value = LAYOUT.id;
  };
  list.autocomplete = 'off';
  show();
  page.addEventListener('pageshow', show);
}

/** The note beside the spawn button after a train is added, such as "Train 17 joins line A". */
export function spawnNote(id: TrainId, line: EntryLine): string {
  return `Train ${id} joins line ${line}`;
}

/** The train IDs on either map, lowest first, each once. Both sides run the same timetable. */
export function trainChoices(...maps: Array<Array<{ id: TrainId }>>): TrainId[] {
  const ids = new Set<TrainId>();
  for (const trains of maps) for (const t of trains) ids.add(t.id);
  return [...ids].sort((a, b) => a - b);
}

/**
 * What the batch runs behind the averages were, for the score panel, such as
 * "50 runs, 2 min centre outage". Live presses never reach these runs.
 */
export function batchRunsText(avg: Pick<ScenarioSummary, 'scenario' | 'seeds'>): string {
  const scenario = SCENARIOS[avg.scenario];
  if (!scenario.failure) return `${avg.seeds} runs, nothing failing`;
  const minutes = Number((FAILURE_LENGTH / 60).toFixed(1));
  return `${avg.seeds} runs, ${minutes} min ${scenario.title.toLowerCase()}`;
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
