import { describe, expect, it } from 'vitest';
import type { ControlCentre, TrainProgram } from '../../src/engine/ports';
import type { TimetableEntry, TrainAgentFactory } from '../../src/shared/types';

// A message sent on tick t is in the recipient's inbox on tick t + 1, for trains,
// actors and the control centre alike. See the comment on ControlCentre in ports.ts.

const idleAgent: TrainAgentFactory = () => ({
  decide: () => ({ accel: 0, nextTrack: null, outbox: [], mode: 'blind' }),
});

describe('ports', () => {
  it('lets a control centre see whether the station and merge actors are alive', () => {
    const seen: Array<{ station: boolean; merge: boolean }> = [];
    const centre: ControlCentre = {
      step: (_now, _trains, _sensors, alive) => {
        seen.push(alive);
        return [];
      },
    };
    centre.step(
      0,
      [],
      {
        platformOccupied: { P1: false, P2: false, P3: false, P4: false },
        junctionOccupied: false,
        exitStartClear: true,
      },
      { station: true, merge: false },
    );
    expect(seen).toEqual([{ station: true, merge: false }]);
  });

  it('describes a program as an agent factory plus actors plus an optional centre', () => {
    const program: TrainProgram = {
      name: 'ours',
      agentFactory: idleAgent,
      makeActors: (_tt: TimetableEntry[]) => [],
      makeCentre: (_tt: TimetableEntry[]) => null,
    };
    expect(program.makeCentre([])).toBeNull();
    expect(program.makeActors([])).toEqual([]);
  });
});
