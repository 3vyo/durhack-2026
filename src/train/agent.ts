import { ACCEL, BRAKE, MAX_SPEED } from '../shared/constants';
import type {
  Outgoing,
  PlatformId,
  Position,
  ResourceId,
  TimetableEntry,
  TrackId,
  TrainAgent,
  TrainId,
  TrainInput,
  TrainOutput,
} from '../shared/types';
import { dwellDone, junctionRequest, mergeReply, type MergeReply } from './depart';
import {
  leaderLimit,
  leaderReport,
  modeFor,
  positionMessage,
  recordPositions,
  sightLimit,
  stopPointLimit,
  type Leader,
  type ReportLog,
} from './follow';
import { PENDING_NUMBERS, type TrainNumbers } from './numbers';
import { isPermitFresh, latestPermit, permitLimit, suggestedPlatform, type HeldPermit } from './permits';
import {
  dwellStart,
  fallbackLimit,
  pathJustChanged,
  platformRequest,
  platformToAsk,
  recordPlatformStatus,
  refusalMeansSilence,
  shouldUseFallback,
  stationReply,
  type HeardStationReply,
  type PlatformStatusLog,
  type StationReply,
} from './station';

// The agent for one of our trains. It keeps the train's memory, calls the rule files each
// tick, takes the lowest speed limit and builds the TrainOutput. The rules themselves live
// in follow.ts, permits.ts, station.ts and depart.ts. See "Train rules" in docs/design.md.

/** Everything one train remembers between ticks. */
export interface TrainMemory {
  id: TrainId;
  entry: TimetableEntry | null; // this train's own timetable entry, null if the timetable lacks it
  leader: Leader; // from the timetable on A and B, from the junction grant on EXIT
  reports: ReportLog; // the newest position report from every train, the leader's included
  permit: HeldPermit | null; // the last permit from the control centre
  locks: ResourceId[]; // locks the station and merge actors have granted this train
  platform: PlatformId | null; // the platform this train has chosen
  dwellStartedAt: number | null; // when the train stopped in its platform

  // Timers and fallback state.
  lastPositionSentAt: number | null;
  asking: PlatformId | null; // the platform the train is asking the station for
  lastPlatformRequestAt: number | null;
  lastStationReply: HeardStationReply | null; // what the station last said, and when
  usingFallback: boolean; // using the station-off rule, from shouldUseFallback
  firstJunctionRequestAt: number | null;
  lastJunctionRequestAt: number | null;
  lastMergeReplyAt: number | null; // when the merge actor last granted or refused
  platformStatus: PlatformStatusLog;
  lastNextTrack: TrackId | null; // the nextTrack returned last tick, which sightAhead follows now
}

/** The output of a train that holds its brakes on and does nothing else. */
export function hold(): TrainOutput {
  return { accel: -BRAKE, nextTrack: null, outbox: [], mode: 'blind' };
}

/** The memory a train starts with, built from its own ID and the timetable only. */
export function initialMemory(id: TrainId, timetable: TimetableEntry[]): TrainMemory {
  const entry = timetable.find((e) => e.id === id) ?? null;
  return {
    id,
    entry,
    leader: entry ? (entry.leader ?? 'none') : 'unknown',
    reports: {},
    permit: null,
    locks: [],
    platform: null,
    dwellStartedAt: null,
    lastPositionSentAt: null,
    asking: null,
    lastPlatformRequestAt: null,
    lastStationReply: null,
    usingFallback: false,
    firstJunctionRequestAt: null,
    lastJunctionRequestAt: null,
    lastMergeReplyAt: null,
    platformStatus: {},
    lastNextTrack: null,
  };
}

/** The lowest of the limits, capped at MAX_SPEED and never below 0. NaN counts as 0. */
export function lowestLimit(limits: number[]): number {
  const lowest = Math.min(MAX_SPEED, ...limits);
  return Number.isNaN(lowest) ? 0 : Math.max(0, lowest);
}

/** Keeps an acceleration between -BRAKE and ACCEL. NaN becomes -BRAKE. */
export function clampAccel(accel: number): number {
  if (Number.isNaN(accel)) return -BRAKE;
  return Math.min(ACCEL, Math.max(-BRAKE, accel));
}

/**
 * "Following". The acceleration that brings the train's speed to the limit without passing
 * it by the next tick.
 *
 * Placeholder: full brakes.
 */
export function accelFor(_speed: number, _limit: number): number {
  return -BRAKE;
}

/** What chooseRoute decided this tick. The agent stores it in memory. */
export interface RouteChoice {
  nextTrack: TrackId | null; // the track to take at the end of the current one
  platform: PlatformId | null; // the chosen platform, from a grant or the fallback
  slotStart: boolean; // true on the tick the train starts in its clock slot
}

/**
 * "Entering the station", "Station switched off", "Leaving the station" and "Merge switched
 * off". The route for this tick. On A or B, nextTrack is the chosen platform, or the one
 * creepStep is probing. In a platform it is EXIT once the train holds the junction lock or
 * mayStartInSlot says go. Null otherwise. Under the fallback, platform comes from
 * fixedSplitPlatform or creepStep. On a slot start the agent sets the leader to 'unknown'.
 * nextTrack must not change once the front has crossed the end of the current track.
 *
 * Placeholder: nextTrack null, the platform unchanged, no slot start.
 */
export function chooseRoute(
  memory: TrainMemory,
  _input: TrainInput,
  _numbers: TrainNumbers,
): RouteChoice {
  return { nextTrack: null, platform: memory.platform, slotStart: false };
}

/**
 * The leader on EXIT named by a junction grant. This is the one place that reads
 * follow null. It reads it as "no train ahead", which holds while the merge actor stays
 * up. Review of #31 notes it is wrong after the actor has been off, because trains joined
 * EXIT on clock slots. Change this line when the team settles it.
 */
export function exitLeader(follow: TrainId | null): Leader {
  return follow ?? 'none';
}

/**
 * Stores what this tick's replies say: the station's last reply and its time, a granted
 * lock, the granted platform, the merge actor's last reply time, and the new leader from
 * a junction grant. A platform grant is ignored once the front has left the entry track,
 * so a late grant cannot move a train that is already in a platform. Bookkeeping only.
 * The decisions live in the rule files.
 */
export function remember(
  memory: TrainMemory,
  now: number,
  pos: Position,
  station: StationReply | null,
  merge: MergeReply | null,
): void {
  if (station) memory.lastStationReply = { ...station, at: now };
  const onEntryTrack = pos.track === 'A' || pos.track === 'B';
  if (station?.kind === 'grant' && onEntryTrack) {
    memory.platform = station.platform;
    addLock(memory, station.platform);
  }

  if (merge) memory.lastMergeReplyAt = now;
  if (merge?.kind === 'grant') {
    addLock(memory, 'JUNCTION');
    memory.leader = exitLeader(merge.follow);
  }
}

/** Records when each request and position message went out, for the repeat timers. */
export function noteSent(memory: TrainMemory, outbox: Outgoing[], now: number): void {
  for (const { msg } of outbox) {
    if (msg.type === 'position') memory.lastPositionSentAt = now;
    if (msg.type === 'lockRequest' && msg.resource === 'JUNCTION') {
      memory.firstJunctionRequestAt ??= now;
      memory.lastJunctionRequestAt = now;
    } else if (msg.type === 'lockRequest') {
      memory.lastPlatformRequestAt = now;
    }
  }
}

function addLock(memory: TrainMemory, resource: ResourceId): void {
  if (!memory.locks.includes(resource)) memory.locks.push(resource);
}

/**
 * Builds the agent for train `id`. Uses only its ID, the timetable, the map and timing
 * numbers, and each decide input. `numbers` defaults to PENDING_NUMBERS until #34 merges.
 */
export function createAgent(
  id: TrainId,
  timetable: TimetableEntry[],
  numbers: TrainNumbers = PENDING_NUMBERS,
): TrainAgent {
  const memory = initialMemory(id, timetable);

  return {
    decide(input: TrainInput): TrainOutput {
      const entry = memory.entry;
      if (!entry) return hold();
      const { now, self, inbox, sightAhead } = input;

      // Read this tick's inbox. A message sent on tick t arrives here on tick t + 1.
      remember(memory, now, self.pos, stationReply(inbox, id), mergeReply(inbox, id));
      memory.reports = recordPositions(memory.reports, inbox);
      memory.permit = latestPermit(memory.permit, inbox, id);
      memory.platformStatus = recordPlatformStatus(memory.platformStatus, inbox);
      memory.dwellStartedAt = dwellStart(memory.dwellStartedAt, self, now);
      memory.asking = platformToAsk(
        entry.platform,
        suggestedPlatform(memory.permit, now, entry.entry, numbers),
        memory.lastStationReply,
      );

      const refusalIsSilence = refusalMeansSilence(
        {
          lastReply: memory.lastStationReply,
          statuses: memory.platformStatus,
          entry: entry.entry,
          pos: self.pos,
          now,
        },
        numbers,
      );
      memory.usingFallback = shouldUseFallback(
        {
          self,
          now,
          lastReply: memory.lastStationReply,
          refusalIsSilence,
          usingFallback: memory.usingFallback,
        },
        numbers,
      );

      const route = chooseRoute(memory, input, numbers);
      memory.platform = route.platform;
      if (route.slotStart) memory.leader = 'unknown';
      const nextTrack = route.nextTrack;
      const report = leaderReport(memory.reports, memory.leader);

      const limit = lowestLimit([
        leaderLimit(self.pos, memory.leader, report, numbers),
        sightLimit(sightAhead),
        stopPointLimit(self, memory.platform, nextTrack, numbers),
        permitLimit(self, memory.permit, now, numbers),
        fallbackLimit(memory.usingFallback),
      ]);

      let accel = accelFor(self.speed, limit);
      if (pathJustChanged(memory.lastNextTrack, nextTrack)) accel = Math.min(accel, 0);
      accel = clampAccel(accel);

      const outbox = [
        positionMessage(now, self, memory.lastPositionSentAt, numbers),
        platformRequest(
          {
            now,
            id,
            pos: self.pos,
            asking: memory.platform ?? memory.asking,
            lastSentAt: memory.lastPlatformRequestAt,
          },
          numbers,
        ),
        junctionRequest(
          {
            now,
            id,
            dwellDone: dwellDone(memory.dwellStartedAt, entry.dwell, now, numbers),
            holdsJunction: memory.locks.includes('JUNCTION'),
            lastSentAt: memory.lastJunctionRequestAt,
          },
          numbers,
        ),
      ].filter((o): o is Outgoing => o !== null);
      noteSent(memory, outbox, now);

      memory.lastNextTrack = nextTrack;
      return {
        accel,
        nextTrack,
        outbox,
        mode: modeFor(now, memory.leader, report, isPermitFresh(memory.permit, now, numbers), numbers),
      };
    },
  };
}
