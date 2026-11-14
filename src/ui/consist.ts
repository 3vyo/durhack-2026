// How the cars of one train sit end to end, how a click finds its train, and freeing what a
// train used. Pure, so the tests never load three.js.

/**
 * Lays cars end to end along the direction of travel. `lengths` are in model units, the nose
 * first, and the nose goes at the front (largest x). `scale` makes the whole train, gaps
 * included, exactly `targetLength` long. `centres` are each car's centre in scene units,
 * relative to the train's centre, nose first. `gap` is in model units.
 */
export function consistLayout(
  lengths: number[],
  targetLength: number,
  gap = 0,
): { scale: number; centres: number[] } {
  if (lengths.length === 0) throw new Error('a train needs at least one car');
  const total = lengths.reduce((sum, l) => sum + l, 0) + gap * (lengths.length - 1);
  const scale = targetLength / total;
  const centres: number[] = [];
  let front = total / 2;
  for (const length of lengths) {
    centres.push((front - length / 2) * scale);
    front -= length + gap;
  }
  return { scale, centres };
}

export type Pickable = { userData: { trainId?: number }; parent: Pickable | null };

/** The train an object belongs to: the first trainId found on it or its parents, or null. */
export function trainIdOf(o: Pickable | null): number | null {
  for (let p = o; p; p = p.parent) if (typeof p.userData.trainId === 'number') return p.userData.trainId;
  return null;
}

/** Calls dispose on each item once and says how many there were. */
export function disposeAll(items: Array<{ dispose(): void }>): number {
  for (const item of new Set(items)) item.dispose();
  return new Set(items).size;
}
