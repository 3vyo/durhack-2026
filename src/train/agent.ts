import { ACCEL, BRAKE, MAX_SPEED } from '../shared/constants';
import type {
  Outgoing,
  PlatformId,
  ResourceId,
  TimetableEntry,
  TrackId,
  TrainAgent,
  TrainId,
  TrainInput,
  TrainOutput,
} from '../shared/types';
import { dwellDone, junctionRequest, mergeGrant, type MergeGrant } from './depart';
import {
  latestLeaderReport,
  leaderLimit,
  modeFor,
  positionMessage,
  sightLimit,
  stopPointLimit,
  type Leader,
  type LeaderReport,
} from './follow';
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
  leaderReport: LeaderReport | null; // the leader's last position report
  permit: HeldPermit | null; // the last permit from the control centre
  locks: ResourceId[]; // locks the station and merge actors have granted this train
  platform: PlatformId | null; // the platform this train has chosen
  dwellStartedAt: number | null; // when the train stopped in its platform

  // Timers and fallback state.
  lastPositionSentAt: number | null;
  asking: PlatformId | null; // the platform the train is asking the station for
  alternative: PlatformId | null; // the alternative from the last refusal
  lastPlatformRequestAt: number | null;
  lastStationReplyAt: number | null;
  usingFallback: boolean; // using the station-off rule, from shouldUseFallback
  firstJunctionRequestAt: number | null;
  lastJunctionRequestAt: number | null;
  heardMergeReply: boolean;
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
    leaderReport: null,
    permit: null,
    locks: [],
    platform: null,
    dwellStartedAt: null,
    lastPositionSentAt: null,
    asking: null,
    alternative: null,
    lastPlatformRequestAt: null,
    lastStationReplyAt: null,
    usingFallback: false,
    firstJunctionRequestAt: null,
    lastJunctionRequestAt: null,
    heardMergeReply: false,
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
 *
 * Placeholder: nextTrack null, the platform unchanged, no slot start.
 */
export function chooseRoute(memory: TrainMemory, _input: TrainInput): RouteChoice {
  return { nextTrack: null, platform: memory.platform, slotStart: false };
}

/**
 * Stores what this tick's replies say: a granted lock, the granted platform, a refusal's
 * alternative, and the new leader from a junction grant. A new leader drops the old
 * leader's report. Bookkeeping only. The decisions live in the rule files.
 *
 * A grant with follow null is read as "no train ahead on EXIT". The design does not say
 * whether it could also mean "unknown".
 */
export function remember(
  memory: TrainMemory,
  now: number,
  station: StationReply | null,
  merge: MergeGrant | null,
): void {
  if (station) memory.lastStationReplyAt = now;
  if (station?.kind === 'grant') {
    memory.platform = station.platform;
    memory.alternative = null;
    addLock(memory, station.platform);
  }
  if (station?.kind === 'refuse') memory.alternative = station.alternative;

  if (merge) {
    memory.heardMergeReply = true;
    addLock(memory, 'JUNCTION');
    setLeader(memory, merge.follow ?? 'none');
  }
}

/** Changes the leader, dropping the old leader's report if the leader is new. */
export function setLeader(memory: TrainMemory, leader: Leader): void {
  if (memory.leader === leader) return;
  memory.leader = leader;
  memory.leaderReport = null;
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

/** Builds the agent for train `id`. Uses only its ID, the timetable and each decide input. */
export function createAgent(id: TrainId, timetable: TimetableEntry[]): TrainAgent {
  const memory = initialMemory(id, timetable);

  return {
    decide(input: TrainInput): TrainOutput {
      const entry = memory.entry;
      if (!entry) return hold();
      const { now, self, inbox, sightAhead } = input;

      // Read this tick's inbox. A message sent on tick t arrives here on tick t + 1.
      const station = stationReply(inbox, id);
      remember(memory, now, station, mergeGrant(inbox, id));
      memory.leaderReport = latestLeaderReport(memory.leaderReport, inbox, memory.leader);
      memory.permit = latestPermit(memory.permit, inbox, id);
      memory.platformStatus = recordPlatformStatus(memory.platformStatus, inbox);
      memory.dwellStartedAt = dwellStart(memory.dwellStartedAt, self, now);
      memory.asking = platformToAsk(
        entry.platform,
        suggestedPlatform(memory.permit, now, entry.entry),
        memory.alternative,
      );

      const refusalIsSilence = refusalMeansSilence({
        reply: station,
        statuses: memory.platformStatus,
        entry: entry.entry,
        pos: self.pos,
        now,
      });
      memory.usingFallback = shouldUseFallback({
        self,
        now,
        lastReplyAt: memory.lastStationReplyAt,
        refusalIsSilence,
        usingFallback: memory.usingFallback,
      });

      const route = chooseRoute(memory, input);
      memory.platform = route.platform;
      if (route.slotStart) setLeader(memory, 'unknown');
      const nextTrack = route.nextTrack;

      const limit = lowestLimit([
        leaderLimit(self.pos, memory.leader, memory.leaderReport),
        sightLimit(sightAhead),
        stopPointLimit(self, memory.platform, nextTrack),
        permitLimit(self, memory.permit, now),
        fallbackLimit(memory.usingFallback),
      ]);

      let accel = accelFor(self.speed, limit);
      if (pathJustChanged(memory.lastNextTrack, nextTrack)) accel = Math.min(accel, 0);
      accel = clampAccel(accel);

      const outbox = [
        positionMessage(now, self, memory.lastPositionSentAt),
        platformRequest({
          now,
          id,
          pos: self.pos,
          asking: memory.platform ?? memory.asking,
          lastSentAt: memory.lastPlatformRequestAt,
        }),
        junctionRequest({
          now,
          id,
          dwellDone: dwellDone(memory.dwellStartedAt, entry.dwell, now),
          holdsJunction: memory.locks.includes('JUNCTION'),
          lastSentAt: memory.lastJunctionRequestAt,
        }),
      ].filter((o): o is Outgoing => o !== null);
      noteSent(memory, outbox, now);

      memory.lastNextTrack = nextTrack;
      return {
        accel,
        nextTrack,
        outbox,
        mode: modeFor(now, memory.leader, memory.leaderReport, isPermitFresh(memory.permit, now)),
      };
    },
  };
}
