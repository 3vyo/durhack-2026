import { describe, expect, it } from 'vitest';
import { makeActors } from '../../src/locks';
import type { SensorReadings, TimetableEntry } from '../../src/shared/types';

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
];

const allClear: SensorReadings = {
  platformOccupied: { P1: false, P2: false, P3: false, P4: false },
  junctionOccupied: false,
  exitStartClear: true,
};

describe('makeActors', () => {
  it('returns the platform keeper and the junction keeper', () => {
    expect(makeActors(timetable).map((a) => a.id)).toEqual(['platformKeeper', 'junctionKeeper']);
  });

  it('builds fresh actors on each call, so two runs do not share memory', () => {
    const first = makeActors(timetable);
    const second = makeActors(timetable);
    expect(first[0]).not.toBe(second[0]);
    expect(first[1]).not.toBe(second[1]);
  });

  it('gives a platform keeper that answers platform requests and a junction keeper that answers junction requests', () => {
    const [platformKeeper, junctionKeeper] = makeActors(timetable);
    const inbox = [
      { type: 'lockRequest' as const, from: 1, resource: 'P1' as const },
      { type: 'lockRequest' as const, from: 2, resource: 'JUNCTION' as const },
    ];
    expect(platformKeeper.step(0, inbox, allClear)).toEqual([
      { msg: { type: 'lockGrant', to: 1, resource: 'P1', follow: null }, range: 'short' },
    ]);
    expect(junctionKeeper.step(0, inbox, allClear)).toEqual([
      { msg: { type: 'lockGrant', to: 2, resource: 'JUNCTION', follow: null }, range: 'short' },
    ]);
  });

  it('gives two runs their own locks', () => {
    const request = [{ type: 'lockRequest' as const, from: 1, resource: 'P1' as const }];
    const [first] = makeActors(timetable);
    const [second] = makeActors(timetable);
    first.step(0, request, allClear);
    expect(second.step(0, request, allClear)[0].msg.type).toBe('lockGrant');
  });
});
