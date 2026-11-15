import { afterEach, describe, expect, it } from 'vitest';
import { makeActors } from '../../src/locks';
import { applyLayout, platformReadings, resetLayout } from '../../src/shared/map';
import type { SensorReadings, TimetableEntry } from '../../src/shared/types';

const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
];

/** Every platform of the layout in use reads empty. Built when called, so it follows the layout. */
function clearReadings(): SensorReadings {
  return { platformOccupied: platformReadings(), junctionOccupied: false, exitStartClear: true };
}

const allClear = clearReadings();

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

describe('makeActors on other layouts', () => {
  afterEach(() => resetLayout());

  const hubTimetable: TimetableEntry[] = [
    { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
    { id: 2, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
    { id: 3, entry: 'C', enterAt: 0, platform: 'P5', leader: null, dwell: 30 },
    { id: 4, entry: 'D', enterAt: 0, platform: 'P7', leader: null, dwell: 30 },
  ];

  it('on hub, the platform keeper grants each of the four entry tracks its own platform', () => {
    applyLayout('hub');
    const [platformKeeper] = makeActors(hubTimetable);
    const inbox = hubTimetable.map((e) => ({ type: 'lockRequest' as const, from: e.id, resource: e.platform }));
    expect(platformKeeper.step(0, inbox, clearReadings()).map((o) => o.msg)).toEqual([
      { type: 'lockGrant', to: 1, resource: 'P1', follow: null },
      { type: 'lockGrant', to: 2, resource: 'P3', follow: null },
      { type: 'lockGrant', to: 3, resource: 'P5', follow: null },
      { type: 'lockGrant', to: 4, resource: 'P7', follow: null },
    ]);
  });

  it('on branch, the platform keeper serves A and refuses a request for P3', () => {
    applyLayout('branch');
    const [platformKeeper] = makeActors(hubTimetable.slice(0, 1));
    const inbox = [{ type: 'lockRequest' as const, from: 1, resource: 'P3' as const }];
    expect(platformKeeper.step(0, inbox, clearReadings()).map((o) => o.msg)).toEqual([
      { type: 'lockRefuse', to: 1, resource: 'P3', alternative: 'P1' },
    ]);
  });
});
