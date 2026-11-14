import { MARGIN } from '../shared/constants';
import { footprint, touchesZone, type Body, type Segment } from './footprint';

/** The shortest gap in metres between two trains on a track they both cover, or null if none. */
function closestGap(a: Segment[], b: Segment[]): { overlap: boolean; gap: number } | null {
  let result: { overlap: boolean; gap: number } | null = null;
  for (const sa of a) {
    for (const sb of b) {
      if (sa.track !== sb.track) continue;
      const gap = Math.max(sa.from, sb.from) - Math.min(sa.to, sb.to);
      const overlap = gap < 0;
      if (result === null || gap < result.gap) result = { overlap, gap };
    }
  }
  return result;
}

/**
 * Counts new collisions and close calls among the trains this tick.
 *
 * Two trains collide if their bodies overlap on a track, or if both have any part in the
 * junction zone. A close call is a gap under MARGIN between two trains on one track.
 * Bodies come from footprints, so a rear still on the previous track counts.
 *
 * Each pair's ongoing state is kept in `active`. Only a new episode is counted: a pair that
 * stays overlapped for many ticks is one collision, and a pair that separates and meets
 * again is a second.
 */
export function checkSafety(
  bodies: Body[],
  active: Set<string>,
): { collisions: number; closeCalls: number } {
  const now = new Set<string>();
  const feet = bodies.map((b) => footprint(b));
  const ids = bodies.map((b) => b.state.id);

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const pair = ids[i] < ids[j] ? `${ids[i]}-${ids[j]}` : `${ids[j]}-${ids[i]}`;
      const close = closestGap(feet[i], feet[j]);
      const collided = (close?.overlap ?? false) || (touchesZone(feet[i]) && touchesZone(feet[j]));
      if (collided) now.add(`c:${pair}`);
      else if (close && close.gap < MARGIN) now.add(`cc:${pair}`);
    }
  }

  let collisions = 0;
  let closeCalls = 0;
  for (const key of now) {
    if (active.has(key)) continue;
    if (key.startsWith('c:')) collisions += 1;
    else closeCalls += 1;
  }
  active.clear();
  for (const key of now) active.add(key);
  return { collisions, closeCalls };
}
