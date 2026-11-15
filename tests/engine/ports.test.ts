import { describe, expect, it } from 'vitest';
import type { ControlCentre, TrainProgram } from '../../src/engine/ports';
import { platformReadings } from '../../src/shared/map';
import type { TimetableEntry, TrackId, TrainAgentFactory } from '../../src/shared/types';

// A message sent on tick t is in the recipient's inbox on tick t + 1, for trains,
// actors and the control centre alike. See the comment on ControlCentre in ports.ts.

const idleAgent: TrainAgentFactory = () => ({
  decide: () => ({ accel: 0, nextTrack: null, outbox: [], mode: 'blind' }),
});

describe('ports', () => {
  it("lets a control centre see each train's set route", () => {
    const seen: Array<Map<number, TrackId | null>> = [];
    const centre: ControlCentre = {
      step: (_now, _trains, _sensors, routes) => {
        seen.push(routes);
        return [];
      },
    };
    centre.step(
      0,
      [],
      {
        platformOccupied: platformReadings(),
        junctionOccupied: false,
        exitStartClear: true,
      },
      new Map([[1, 'P1']]),
    );
    expect(seen).toEqual([new Map([[1, 'P1']])]);
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
