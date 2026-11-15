// Laying the kit's track pieces along a track. Pure, so the tests never load three.js.

/**
 * The centres of the pieces along a track, measured from its start, in the same unit as the
 * lengths. It uses ceil(trackLength / pieceLength) pieces, so the last one may overhang.
 */
export function railOffsets(trackLength: number, pieceLength: number): number[] {
  if (!(pieceLength > 0)) throw new Error('a track piece must have a length');
  const count = Math.ceil(trackLength / pieceLength);
  return Array.from({ length: Math.max(0, count) }, (_, i) => (i + 0.5) * pieceLength);
}
