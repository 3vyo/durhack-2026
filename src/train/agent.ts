import { ACCEL, BRAKE, MAX_SPEED, TICK } from '../shared/constants';
import { isEntryTrack, isPlatform } from '../shared/map';
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
import {
  dwellDone,
  grantExpired,
  junctionRequest,
  mayStartInSlot,
  junctionKeeperReply,
  slotOpen,
  useClockSlots,
  type JunctionKeeperReply,
} from './depart';
import {
  isPastPlatformStop,
  leaderLimit,
  leaderReport,
  leavingMessage,
  modeFor,
  positionMessage,
  recordPositions,
  sightLimit,
  stopPointLimit,
  type Leader,
  type ReportLog,
} from './follow';
import { trainNumbers, type TrainNumbers } from './numbers';
import {
  committedPlatform,
  isPermitFresh,
  latestPermit,
  permitLeader,
  permitLimit,
  permitRoute,
  type HeldPermit,
} from './permits';
import {
  creepStep,
  dwellStart,
  fallbackLimit,
  fixedSplitPlatform,
  ownPairOnly,
  pathJustChanged,
  platformRequest,
  platformToAsk,
  recordPlatformStatus,
  refusalMeansSilence,
  sensorsSilent,
  shouldUseFallback,
  platformKeeperReply,
  type HeardPlatformKeeperReply,
  type PlatformStatusLog,
  type PlatformKeeperReply,
} from './station';

// The agent for one of our trains. It keeps the train's memory, calls the rule files each
// tick, takes the lowest speed limit and builds the TrainOutput. The rules themselves live
// in follow.ts, permits.ts, station.ts and depart.ts. See "Train rules" in docs/design.md.
//
// While the train holds a fresh permit it obeys the control centre, like today's trains,
// and sends no lock requests. When the permit goes stale it runs on its own rules. It keeps
// its memory up to date in both, so it can switch on any tick.

/** Everything one train remembers between ticks. */
export interface TrainMemory {
  id: TrainId;
  entry: TimetableEntry | null; // this train's own timetable entry, null if the timetable lacks it
  leader: Leader; // from the timetable on its entry track, from the junction grant on EXIT
  reports: ReportLog; // the newest position report from every train, the leader's included
  permit: HeldPermit | null; // the last permit from the control centre
  locks: ResourceId[]; // locks the platform and junction keepers have granted this train
  platform: PlatformId | null; // the platform this train has chosen
  dwellStartedAt: number | null; // when the train stopped in its platform

  // Timers and fallback state.
  lastPositionSentAt: number | null;
  asking: PlatformId | null; // the platform the train is asking the platform keeper for
  firstPlatformRequestAt: number | null;
  lastPlatformRequestAt: number | null;
  lastPlatformKeeperReply: HeardPlatformKeeperReply | null; // what the platform keeper last said, and when
  platformKeeperHeardAt: number | null; // when the platform keeper last gave a reply that does not count as silence
  usingFallback: boolean; // using the rule for a switched-off platform keeper, from shouldUseFallback
  firstJunctionRequestAt: number | null;
  lastJunctionRequestAt: number | null;
  lastJunctionKeeperReplyAt: number | null; // when the junction keeper last granted or refused
  junctionGrantAt: number | null; // when the train first heard the junction grant it holds or last held
  slotStarted: boolean; // true once the train has started in its clock slot
  platformStatus: PlatformStatusLog;
  lastNextTrack: TrackId | null; // the nextTrack returned last tick, which sightAhead follows now

  // The centre comes first.
  central: boolean; // true if the train obeyed a fresh permit last tick
  cleared: boolean; // true if the centre let the train through the junction before it failed
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
    firstPlatformRequestAt: null,
    lastPlatformRequestAt: null,
    lastPlatformKeeperReply: null,
    platformKeeperHeardAt: null,
    usingFallback: false,
    firstJunctionRequestAt: null,
    lastJunctionRequestAt: null,
    lastJunctionKeeperReplyAt: null,
    junctionGrantAt: null,
    slotStarted: false,
    platformStatus: {},
    lastNextTrack: null,
    central: false,
    cleared: false,
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
 * it by the next tick. At a limit of 0 it is full brakes, so the engine's clamp leaves the
 * speed at exactly 0.
 */
export function accelFor(speed: number, limit: number): number {
  if (!(limit > 0)) return -BRAKE;
  return clampAccel((limit - speed) / TICK);
}

/** What chooseRoute decided this tick. The agent stores it in memory. */
export interface RouteChoice {
  nextTrack: TrackId | null; // the track to take at the end of the current one
  platform: PlatformId | null; // the chosen platform, from a grant or the fallback
  slotStart: boolean; // true on the tick the train starts in its clock slot
}

/**
 * True once the train may run out of its platform: it holds the junction lock, has started
 * in its slot, or the centre let it through before it failed.
 */
export function isLeaving(memory: TrainMemory): boolean {
  return memory.locks.includes('JUNCTION') || memory.slotStarted || memory.cleared;
}

/**
 * "Entering the station", "Platform keeper switched off", "Leaving the station" and
 * "Junction keeper switched off". The route for this tick. On an entry track, nextTrack is the chosen platform, or the one
 * the creep rule is looking into. In a platform it is EXIT once the train holds the
 * junction lock or is using its clock slot. Null otherwise. A chosen platform never
 * changes, so nextTrack cannot change after the front has crossed the end of the track.
 */
export function chooseRoute(memory: TrainMemory, input: TrainInput, numbers: TrainNumbers): RouteChoice {
  const { track } = input.self.pos;
  if (track === 'EXIT') return { nextTrack: null, platform: memory.platform, slotStart: false };
  if (isEntryTrack(track)) return entryRoute(memory, input, numbers);
  return platformRoute(memory, input, track, numbers);
}

/**
 * The route on an entry track. With a platform chosen, go there. Under the fallback, take the
 * fixed split's platform, from the train's own pair, if the sensors name an empty one. If the sensors are silent,
 * creep: look into one platform at a time. Otherwise wait with nextTrack null.
 */
function entryRoute(memory: TrainMemory, input: TrainInput, numbers: TrainNumbers): RouteChoice {
  const wait: RouteChoice = { nextTrack: memory.platform, platform: memory.platform, slotStart: false };
  if (memory.platform !== null || !memory.usingFallback) return wait;
  if (memory.entry === null || input.self.brokenDown) return wait;

  const entry = memory.entry.entry;
  const split = fixedSplitPlatform(entry, memory.platformStatus, input.now, numbers);
  if (split !== null) return { nextTrack: split, platform: split, slotStart: false };
  if (!sensorsSilent(entry, memory.platformStatus, input.now, numbers)) return wait;

  const step = creepStep({ entry, probing: memory.lastNextTrack, sightAhead: input.sightAhead }, numbers);
  return { nextTrack: step.take ?? step.probe, platform: step.take, slotStart: false };
}

/**
 * The route in a platform. EXIT once the train is leaving. With the junction keeper silent
 * and the train's slot open, a train at its stop point first points nextTrack at EXIT so that the next tick's
 * sightAhead looks through the junction zone, and starts on a later tick if that shows the
 * zone empty. Pointing at EXIT does not move the train: the platform stop point holds it
 * until slotStart.
 */
function platformRoute(
  memory: TrainMemory,
  input: TrainInput,
  platform: PlatformId,
  numbers: TrainNumbers,
): RouteChoice {
  const route = (nextTrack: TrackId | null, slotStart = false): RouteChoice => ({
    nextTrack,
    platform: memory.platform,
    slotStart,
  });
  if (isLeaving(memory)) return route('EXIT');
  if (input.self.brokenDown) return route(null);

  const { now, self } = input;
  const silent = useClockSlots(memory.firstJunctionRequestAt, memory.lastJunctionKeeperReplyAt, now, numbers);
  if (!silent || !slotOpen(platform, now, numbers)) return route(null);
  // Only from the stop point, so the junction sensor shows the train soon after it starts.
  if (self.pos.offset < numbers.platformStop - numbers.stopClose) return route(null);
  const looked = memory.lastNextTrack === 'EXIT';
  return route('EXIT', looked && mayStartInSlot(platform, now, input.sightAhead, numbers));
}

/**
 * The leader on EXIT named by a junction grant. Null means no train ahead. The train's
 * own ID is how the junction keeper says "I was just switched back on and do not know who is
 * ahead", so it reads as unknown and the train stays at SIGHT_SPEED or below.
 */
export function exitLeader(follow: TrainId | null, self: TrainId): Leader {
  if (follow === null) return 'none';
  return follow === self ? 'unknown' : follow;
}

/**
 * Stores what this tick's replies say. Bookkeeping only. The decisions live in the rule
 * files.
 */
export function remember(
  memory: TrainMemory,
  now: number,
  pos: Position,
  platformKeeper: PlatformKeeperReply | null,
  junctionKeeper: JunctionKeeperReply | null,
): void {
  if (platformKeeper) rememberPlatformKeeper(memory, now, pos, platformKeeper);
  if (junctionKeeper) rememberJunctionKeeper(memory, now, pos, junctionKeeper);
}

/**
 * A platform keeper reply counts only while the front is on the entry track, so a late grant
 * cannot move a train that is already in a platform. Once the train has chosen a platform
 * it keeps it: a refusal, or a grant for another platform, is ignored and not stored.
 */
function rememberPlatformKeeper(memory: TrainMemory, now: number, pos: Position, reply: PlatformKeeperReply): void {
  if (!isEntryTrack(pos.track)) return;
  const chosen = memory.platform;
  if (chosen !== null && (reply.kind === 'refuse' || reply.platform !== chosen)) return;
  memory.lastPlatformKeeperReply = { ...reply, at: now };
  if (reply.kind === 'grant') {
    memory.platform = reply.platform;
    addLock(memory, reply.platform);
  }
}

/**
 * A junction keeper reply counts only in a platform. Any reply resets the junction keeper timeout. A grant is
 * taken only if the train has asked and has not already left on a clock slot. A train
 * that left on a slot stays leader unknown, because the grant's follow may not be the
 * train directly ahead. A refusal never takes back a grant.
 */
function rememberJunctionKeeper(memory: TrainMemory, now: number, pos: Position, reply: JunctionKeeperReply): void {
  if (!isPlatform(pos.track)) return;
  memory.lastJunctionKeeperReplyAt = now;
  if (reply.kind !== 'grant' || memory.firstJunctionRequestAt === null) return;
  if (isLeaving(memory)) return;
  addLock(memory, 'JUNCTION');
  memory.junctionGrantAt ??= now;
  memory.leader = exitLeader(reply.follow, memory.id);
}

/** Records when each request and position message went out, for the repeat timers. */
export function noteSent(memory: TrainMemory, outbox: Outgoing[], now: number): void {
  for (const { msg } of outbox) {
    if (msg.type === 'position') memory.lastPositionSentAt = now;
    if (msg.type === 'lockRequest' && msg.resource === 'JUNCTION') {
      memory.firstJunctionRequestAt ??= now;
      memory.lastJunctionRequestAt = now;
    } else if (msg.type === 'lockRequest') {
      memory.firstPlatformRequestAt ??= now;
      memory.lastPlatformRequestAt = now;
    }
  }
}

function addLock(memory: TrainMemory, resource: ResourceId): void {
  if (!memory.locks.includes(resource)) memory.locks.push(resource);
}

/**
 * "Leaving the station". The junction keeper releases a junction grant that is not used within
 * junctionKeeperTimeout. So the train drops a grant it can no longer use in time and asks again,
 * and it never enters the zone on an old grant. A grant heard again within junctionKeeperTimeout of
 * the first is the same grant, with the same clock.
 */
export function expireJunctionGrant(memory: TrainMemory, input: TrainInput, numbers: TrainNumbers): void {
  const { now, self } = input;
  const grantedAt = memory.junctionGrantAt;
  if (grantedAt === null) return;
  const held = memory.locks.includes('JUNCTION');
  const distance = isPlatform(self.pos.track) ? numbers.platformStop - self.pos.offset : 0;
  if (held && grantExpired({ now, grantedAt, distance, speed: self.speed }, numbers)) {
    memory.locks = memory.locks.filter((lock) => lock !== 'JUNCTION');
  } else if (!held && now - grantedAt >= numbers.junctionKeeperTimeout - numbers.slack) {
    memory.junctionGrantAt = null;
  }
}

/** A platform lock is of no use once the train is on EXIT, so it forgets it there. */
export function dropPlatformLocks(memory: TrainMemory, pos: Position): void {
  if (pos.track === 'EXIT') memory.locks = memory.locks.filter((lock) => lock === 'JUNCTION');
}

/**
 * Reads this tick's inbox into memory. A message sent on tick t arrives on tick t + 1.
 * While the train obeys the centre it ignores the local actors' replies: it has not asked.
 */
function readInbox(memory: TrainMemory, entry: TimetableEntry, input: TrainInput, numbers: TrainNumbers): void {
  const { now, self, inbox } = input;
  if (!memory.central) {
    const platformKeeper = ownPairOnly(platformKeeperReply(inbox, memory.id), numbers.pairs[entry.entry]);
    remember(memory, now, self.pos, platformKeeper, junctionKeeperReply(inbox, memory.id));
  }
  dropPlatformLocks(memory, self.pos);
  expireJunctionGrant(memory, input, numbers);
  memory.reports = recordPositions(memory.reports, inbox);
  memory.permit = latestPermit(memory.permit, inbox, memory.id);
  memory.platformStatus = recordPlatformStatus(memory.platformStatus, inbox);
  memory.dwellStartedAt = dwellStart(memory.dwellStartedAt, self, now);
  memory.asking = platformToAsk(entry.platform, memory.lastPlatformKeeperReply);
}

/**
 * "The centre comes first". The train starts obeying the centre. It forgets its request
 * timers and fallback state, so a later failure starts them afresh, and it drops a junction
 * grant, because the centre now orders the junction. It keeps a platform it has chosen: the
 * centre sees its route and sends it there.
 */
export function enterCentral(memory: TrainMemory): void {
  memory.firstPlatformRequestAt = null;
  memory.lastPlatformRequestAt = null;
  memory.lastPlatformKeeperReply = null;
  memory.platformKeeperHeardAt = null;
  memory.usingFallback = false;
  memory.firstJunctionRequestAt = null;
  memory.lastJunctionRequestAt = null;
  memory.lastJunctionKeeperReplyAt = null;
  memory.junctionGrantAt = null;
  memory.locks = memory.locks.filter((lock) => lock !== 'JUNCTION');
  memory.cleared = false;
}

/**
 * "The centre comes first". The train's permit has just gone stale, so it carries on with
 * its own rules from where the centre left it.
 * - On EXIT, or past its platform stop and so in the junction zone, it follows the train
 *   its last permit named. The centre let it through, so it carries on out.
 * - On an entry track, if it can no longer stop before the end of its entry track, it keeps the
 *   platform its last permit sent it to, and asks the platform keeper for it.
 * - Anywhere else it stops where its own rules say and asks for what it needs.
 */
export function enterLocal(
  memory: TrainMemory,
  entry: TimetableEntry,
  self: TrainInput['self'],
  permit: HeldPermit | null,
  numbers: TrainNumbers,
): void {
  if (self.pos.track === 'EXIT' || isPastPlatformStop(self.pos, numbers)) {
    memory.leader = permitLeader(permit);
    memory.cleared = self.pos.track !== 'EXIT';
  } else if (memory.platform === null) {
    memory.platform = committedPlatform(self, permit, entry.entry, numbers);
  }
}

/** The position messages to send this tick: the last one if the train leaves the map, else the usual one. */
function positionsToSend(memory: TrainMemory, self: TrainInput['self'], now: number, accel: number, numbers: TrainNumbers) {
  const leaving = leavingMessage(now, self, accel, numbers);
  return leaving ?? positionMessage(now, self, memory.lastPositionSentAt, numbers);
}

/**
 * "The centre comes first". One tick obeying a fresh permit, like today's trains: the
 * permit's nextTrack, its untilX and the train's own sensor. No lock requests.
 */
function centralDecide(memory: TrainMemory, input: TrainInput, permit: HeldPermit, numbers: TrainNumbers): TrainOutput {
  const { now, self, sightAhead } = input;
  const nextTrack = permitRoute(self.pos.track, permit, memory.lastNextTrack);
  const limit = lowestLimit([permitLimit(self, permit, now, numbers), sightLimit(sightAhead)]);
  const accel = clampAccel(self.brokenDown ? -BRAKE : accelFor(self.speed, limit));
  const position = positionsToSend(memory, self, now, accel, numbers);
  const outbox = position ? [position] : [];
  noteSent(memory, outbox, now);
  memory.lastNextTrack = nextTrack;
  return { accel, nextTrack, outbox, mode: 'central' };
}

/**
 * "Platform keeper switched off". Works out whether the train is on the fallback this tick. A
 * reply heard this tick resets the platform keeper timeout, unless it is a refusal that counts as
 * silence.
 */
function updateFallback(
  memory: TrainMemory,
  entry: TimetableEntry,
  input: TrainInput,
  numbers: TrainNumbers,
): void {
  const { now, self } = input;
  const refusalIsSilence = refusalMeansSilence(
    { lastReply: memory.lastPlatformKeeperReply, statuses: memory.platformStatus, entry: entry.entry, pos: self.pos, now },
    numbers,
  );
  if (memory.lastPlatformKeeperReply?.at === now && !refusalIsSilence) memory.platformKeeperHeardAt = now;
  memory.usingFallback = shouldUseFallback(
    {
      self,
      now,
      firstAskedAt: memory.firstPlatformRequestAt,
      lastReplyAt: memory.platformKeeperHeardAt,
      usingFallback: memory.usingFallback,
    },
    numbers,
  );
}

/** The messages to send this tick. A broken-down train only broadcasts its position. */
function buildOutbox(
  memory: TrainMemory,
  entry: TimetableEntry,
  input: TrainInput,
  accel: number,
  numbers: TrainNumbers,
): Outgoing[] {
  const { now, self } = input;
  const id = memory.id;
  const position = positionsToSend(memory, self, now, accel, numbers);
  if (self.brokenDown) return position ? [position] : [];
  return [
    position,
    platformRequest(
      { now, id, pos: self.pos, asking: memory.platform ?? memory.asking, lastSentAt: memory.lastPlatformRequestAt },
      numbers,
    ),
    junctionRequest(
      {
        now,
        id,
        dwellDone: dwellDone(memory.dwellStartedAt, entry.dwell, now, numbers),
        holdsJunction: isLeaving(memory),
        lastSentAt: memory.lastJunctionRequestAt,
      },
      numbers,
    ),
  ].filter((o): o is Outgoing => o !== null);
}

/**
 * Builds the agent for train `id`. Uses only its ID, the timetable, the map and timing
 * numbers, and each decide input. `readNumbers` is called on every decide, so a constant
 * changed by a parameter file before the run is the one the rules use.
 */
export function createAgent(
  id: TrainId,
  timetable: TimetableEntry[],
  readNumbers: () => TrainNumbers = trainNumbers,
): TrainAgent {
  const memory = initialMemory(id, timetable);

  return {
    decide(input: TrainInput): TrainOutput {
      const entry = memory.entry;
      if (!entry) return hold();
      const numbers = readNumbers();
      const { now, self, sightAhead } = input;

      const permit = latestPermit(memory.permit, input.inbox, memory.id);
      const central = isPermitFresh(permit, now, numbers);
      if (central && !memory.central) enterCentral(memory);
      if (!central && memory.central) enterLocal(memory, entry, self, permit, numbers);
      memory.central = central;

      readInbox(memory, entry, input, numbers);
      if (central && permit !== null) return centralDecide(memory, input, permit, numbers);
      updateFallback(memory, entry, input, numbers);

      const route = chooseRoute(memory, input, numbers);
      memory.platform = route.platform;
      if (route.slotStart) {
        memory.slotStarted = true;
        memory.leader = 'unknown';
      }
      const nextTrack = route.nextTrack;
      const report = leaderReport(memory.reports, memory.leader);

      const limit = lowestLimit([
        leaderLimit(self.pos, memory.leader, report, numbers),
        sightLimit(sightAhead),
        stopPointLimit(self, memory.platform, isLeaving(memory), numbers),
        fallbackLimit(memory.usingFallback),
      ]);

      let accel = accelFor(self.speed, limit);
      if (pathJustChanged(memory.lastNextTrack, nextTrack)) accel = Math.min(accel, 0);
      if (self.brokenDown) accel = -BRAKE;
      accel = clampAccel(accel);

      const outbox = buildOutbox(memory, entry, input, accel, numbers);
      noteSent(memory, outbox, now);

      memory.lastNextTrack = nextTrack;
      return {
        accel,
        nextTrack,
        outbox,
        mode: modeFor(now, memory.leader, report, false, numbers),
      };
    },
  };
}
