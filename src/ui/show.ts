import type { LinkKind } from './links';

// Which of the explanatory drawings the scene shows. Each can be turned on and off from the
// Show menu, and L turns them all on or off together. They are drawings only: turning one off
// changes nothing in the run.

export type ShowKey = 'permits' | 'leader' | 'keepers' | 'sensorRadio' | 'cables' | 'cones' | 'tint' | 'zone';

export type Show = Record<ShowKey, boolean>;

export interface ShowItem {
  key: ShowKey;
  label: string;
  /** The line kinds this item covers. The cones, the track tint and the zone are not lines. */
  kinds: readonly LinkKind[];
}

/** The menu, in the order it lists them. */
export const SHOW_ITEMS: readonly ShowItem[] = [
  { key: 'permits', label: 'Control centre permits', kinds: ['permit', 'staff'] },
  { key: 'leader', label: 'Train ahead', kinds: ['leader'] },
  { key: 'keepers', label: 'Keeper requests and replies', kinds: ['grant', 'refuse', 'asking'] },
  { key: 'sensorRadio', label: 'Sensor radio', kinds: ['sensors'] },
  { key: 'cables', label: 'Sensor cables', kinds: ['wired'] },
  { key: 'cones', label: 'Train sensor cones', kinds: [] },
  { key: 'tint', label: 'Platform track readings', kinds: [] },
  { key: 'zone', label: 'Junction zone', kinds: [] },
];

export const SHOW_ALL: Show = {
  permits: true,
  leader: true,
  keepers: true,
  sensorRadio: true,
  cables: true,
  cones: true,
  tint: true,
  zone: true,
};

/** True if a line of this kind is on show. */
export function kindShown(kind: LinkKind, show: Show): boolean {
  return SHOW_ITEMS.some((item) => show[item.key] && item.kinds.includes(kind));
}

/** What L does: if anything is on show, hide everything; if nothing is, show everything. */
export function toggleAll(show: Show): Show {
  const on = !Object.values(show).some(Boolean);
  return Object.fromEntries(SHOW_ITEMS.map((item) => [item.key, on])) as Show;
}

/**
 * Reads a saved choice. Anything missing or not a boolean falls back to on, so a choice saved
 * before an item existed still works.
 */
export function parseShow(saved: string | null): Show {
  let raw: unknown = null;
  try {
    raw = saved === null ? null : JSON.parse(saved);
  } catch {
    raw = null;
  }
  const out = { ...SHOW_ALL };
  if (raw && typeof raw === 'object') {
    for (const item of SHOW_ITEMS) {
      const value = (raw as Record<string, unknown>)[item.key];
      if (typeof value === 'boolean') out[item.key] = value;
    }
  }
  return out;
}
