import type { TrainProgram } from '../engine/ports';
import { ACCEL } from '../shared/constants';
import type { PlatformId, TrackId } from '../shared/types';

/** Where a stub train heads at the end of its current track. */
function nextFor(track: TrackId, platform: PlatformId): TrackId | null {
  if (track === 'A' || track === 'B') return platform;
  if (track === 'EXIT') return null;
  return 'EXIT';
}

/**
 * A stand-in for our program until the real train, locks and centre land. Its trains
 * always accelerate and drive straight through to EXIT, with no actors and no centre.
 * It exists to exercise the rig, not to be a good railway.
 */
export const stubOurs: TrainProgram = {
  name: 'ours',
  agentFactory: (id, timetable) => {
    const entry = timetable.find((e) => e.id === id);
    if (!entry) throw new Error(`no timetable entry for train ${id}`);
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
