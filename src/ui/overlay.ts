import type { TrainView } from '../engine/engine';

function seconds(value: number): string {
  return value.toFixed(1);
}

/**
 * The lines of the card a judge sees when they click a train: how it is deciding and what it
 * last heard. It shows facts the engine recorded, never a guess about which lock an actor
 * thinks the train holds. A train with no known leader says so, and a train that has heard no
 * grant says that, which is the normal state on the fixed split or a clock slot.
 */
export function describeTrain(v: TrainView): string[] {
  const grants: string[] = [];
  if (v.lastGrants.platform !== null) grants.push(v.lastGrants.platform);
  if (v.lastGrants.junction) grants.push('junction');

  const lines = [
    `mode: ${v.mode}`,
    v.leaderAge === null ? 'no leader known' : `leader report ${seconds(v.leaderAge)} s old`,
    v.permitAge === null ? 'no permit' : `permit ${seconds(v.permitAge)} s old`,
    grants.length === 0 ? 'no grant heard' : `last grant: ${grants.join(', ')}`,
  ];
  if (v.reason) lines.push(v.reason);
  return lines;
}
