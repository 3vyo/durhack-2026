import type { ControlCentre, TrainProgram } from '../engine/ports';
import { ACCEL, BRAKE, FRESH } from '../shared/constants';
import type { PlatformId, TimetableEntry, TrackId } from '../shared/types';

/** Where a stub train heads at the end of its current track. */
function nextFor(track: TrackId, platform: PlatformId): TrackId | null {
  if (track === 'A' || track === 'B') return platform;
  if (track === 'EXIT') return null;
  return 'EXIT';
}

function entryFor(id: number, timetable: TimetableEntry[]): TimetableEntry {
  const entry = timetable.find((e) => e.id === id);
  if (!entry) throw new Error(`no timetable entry for train ${id}`);
  return entry;
}

/**
 * A stand-in for our program until the real train, locks and centre land. Its trains
 * always accelerate and drive straight through to EXIT, with no actors and no centre.
 * It exists to exercise the rig, not to be a good railway.
 */
export const stubOurs: TrainProgram = {
  name: 'ours',
  agentFactory: (id, timetable) => {
    const entry = entryFor(id, timetable);
    return {
      decide: ({ self }) => ({
        accel: ACCEL,
        nextTrack: nextFor(self.pos.track, entry.platform),
        outbox: [],
        mode: 'blind',
      }),
    };
  },
  makeActors: () => [],
  makeCentre: () => null,
};

/** A stand-in centre that permits every train to the end of the line, every second. */
const permitEverything: ControlCentre = {
  step: (now, trains) =>
    trains.map((t) => ({ type: 'permit', to: t.id, untilX: 12400, nextTrack: null, sentAt: now })),
};

/**
 * A stand-in for the baseline: today's rule in miniature. A train runs while a permit under
 * FRESH seconds old is held and brakes to a stop when it is not. It resumes as soon as a
 * permit arrives. The real baseline lives in src/baseline/.
 */
export const stubBaseline: TrainProgram = {
  name: 'baseline',
  agentFactory: (id, timetable) => {
    const entry = entryFor(id, timetable);
    let firstSeen: number | null = null;
    let lastPermit: number | null = null;
    return {
      decide: ({ now, self, inbox }) => {
        if (firstSeen === null) firstSeen = now;
        for (const m of inbox) if (m.type === 'permit') lastPermit = now;
        const stale = now - (lastPermit ?? firstSeen) > FRESH;
        return {
          accel: stale ? -BRAKE : ACCEL,
          nextTrack: nextFor(self.pos.track, entry.platform),
          outbox: [],
          mode: stale ? 'blind' : 'central',
        };
      },
    };
  },
  makeActors: () => [],
  makeCentre: () => permitEverything,
};
