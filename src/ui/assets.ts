// Where the Kenney Train Kit files live (public/models/kenney-train-kit/, CC0, see its
// License.txt). Only the files the screen uses are in the repo. Pure, so tests can load it.

export const KIT_DIR = 'models/kenney-train-kit/';

/** The cars of one unit, the nose first. Car a faces +z in the model. */
export const TRAIN_UNIT: readonly [string, string, string] = [
  'train-electric-subway-a',
  'train-electric-subway-b',
  'train-electric-subway-c',
];

/** A straight piece of track with sleepers, 1 wide and 4 long, running along z from its start. */
export const RAIL_PIECE = 'railroad-straight';

/**
 * The URL of one model. `base` is where the site is served from, which is Vite's
 * import.meta.env.BASE_URL in the page, so the built copy finds the files too.
 */
export function assetUrl(name: string, base = '/'): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}${KIT_DIR}${name}.glb`;
}
