import { SENSOR_RANGE, SIGHT_SPEED, TICK, TRAIN_LENGTH } from '../shared/constants';
import type {
  LocalActor,
  Message,
  Outgoing,
  PlatformId,
  Position,
  TimetableEntry,
  TrackId,
  TrainAgent,
  TrainId,
  TrainOutput,
  TrainState,
} from '../shared/types';
import type { Body } from './footprint';
import { xOf } from '../shared/map';
import { advanceTrain } from './physics';
import type { ControlCentre, TrainProgram } from './ports';
import { route, type Recipient, type Sender } from './radio';
import { checkSafety } from './safety';
import { readSensors, sightAhead } from './sensing';
import { ALL_ON, type Press, type Switches } from './switches';
import { makeRng } from './timetable';

export interface EngineConfig {
  timetable: TimetableEntry[];
  program: TrainProgram;
  seed: number;
  runLength: number;
  /** Scripted switch changes. Live presses are made with Engine.press. */
  presses: Press[];
}

export interface TrainView {
  id: TrainId;
  pos: Position;
  x: number;
  speed: number;
  mode: TrainOutput['mode'];
  reason?: string;
  /** Present and true once the train has broken down. It never moves again. */
  brokenDown?: boolean;
  /** Seconds since a position report from this train's timetable leader arrived, or null if none has. */
  leaderAge: number | null;
  /** Seconds since a permit arrived, or null if none has. */
  permitAge: number | null;
  /**
   * The last lock grants this train heard. The engine never clears them: this is what the train
   * was told, not what an actor believes, so it is labelled "last grant" and not "lock held".
   */
  lastGrants: { platform: PlatformId | null; junction: boolean };
}

export interface Snapshot {
  now: number;
  switches: Switches;
  trains: TrainView[];
}

export interface RunResult {
  runLength: number;
  finished: boolean;
  exits: Map<TrainId, number>;
  collisions: number;
  closeCalls: number;
  overruns: number;
}

/** What the engine remembers about one train between ticks. */
interface Runtime {
  id: TrainId;
  agent: TrainAgent;
  state: TrainState;
  /** The track the train's rear is still on while its front is within TRAIN_LENGTH of a boundary. */
  prev: TrackId | null;
  nextTrack: TrackId | null;
  mode: TrainOutput['mode'];
  reason?: string;
  /** The train that runs directly ahead on its entry track, from the timetable. */
  leaderId: TrainId | null;
  lastLeaderAt: number | null;
  lastPermitAt: number | null;
  lastGrants: { platform: PlatformId | null; junction: boolean };
}

interface Sent {
  out: Outgoing;
  from: Sender;
}

const PLATFORMS: PlatformId[] = ['P1', 'P2', 'P3', 'P4'];

/**
 * The optional display-only `reason` on a train's output. It is read as an unknown field so
 * the engine compiles before and after `reason` is added to the shared types (Task 2). The
 * engine never makes a decision from it.
 */
function displayReason(out: TrainOutput): string | undefined {
  const reason = (out as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * The simulation. Deterministic and steppable: it never reads a clock or a random source
 * other than its seeded generator, so the same config always gives the same run. Time
 * advances by TICK per step().
 *
 * Messages sent on tick t are delivered into inboxes on tick t + 1.
 */
export class Engine {
  private tick = 0;
  private readonly runTicks: number;
  private readonly pending: TimetableEntry[];
  private active: Runtime[] = [];
  private readonly exits = new Map<TrainId, number>();
  private overruns = 0;
  private collisions = 0;
  private closeCalls = 0;
  private readonly safetyActive = new Set<string>();
  private readonly switches: Switches = { ...ALL_ON };
  private readonly broken = new Set<TrainId>();
  private readonly scriptedPresses: Press[];
  private readonly actors: LocalActor[];
  private readonly centre: ControlCentre | null;
  private readonly rng: () => number;
  private trainInboxes = new Map<TrainId, Message[]>();
  private actorInboxes = new Map<'platformKeeper' | 'junctionKeeper', Message[]>();

  constructor(private readonly cfg: EngineConfig) {
    this.runTicks = Math.ceil(cfg.runLength / TICK - 1e-9);
    this.pending = [...cfg.timetable].sort((a, b) => a.enterAt - b.enterAt || a.id - b.id);
    this.scriptedPresses = [...cfg.presses].sort((a, b) => a.at - b.at);
    this.actors = cfg.program.makeActors(cfg.timetable);
    this.centre = cfg.program.makeCentre(cfg.timetable);
    this.rng = makeRng(cfg.seed);
  }

  /** A live press: the switches change now and show in the next snapshot. */
  press(set: Partial<Switches>): void {
    Object.assign(this.switches, set);
  }

  /**
   * Break a train down: it stops where it is and never moves again. Its agent is still asked
   * to decide each tick, so it can keep broadcasting its position. A train that has not
   * entered yet breaks down as it enters, and blocks its entry track.
   */
  breakDown(id: TrainId): void {
    this.broken.add(id);
  }

  get now(): number {
    return this.tick * TICK;
  }

  /** True once every train in the timetable has left. Cheaper than result().finished. */
  get finished(): boolean {
    return this.exits.size === this.cfg.timetable.length;
  }

  step(): void {
    if (this.tick >= this.runTicks) return;
    this.applyScriptedPresses();
    this.spawnDueTrains();
    for (const rt of this.active) {
      if (this.broken.has(rt.id) && !rt.state.brokenDown) rt.state = { ...rt.state, speed: 0, brokenDown: true };
    }

    const now = this.now;
    const bodies: Body[] = this.active.map((rt) => ({ state: rt.state, prev: rt.prev }));
    const sensors = readSensors(bodies, this.switches);
    const onSecond = this.tick % Math.round(1 / TICK) === 0;

    // What arrives this tick was sent last tick. Messages sent now go to a fresh queue.
    const trainInbox = this.trainInboxes;
    const actorInbox = this.actorInboxes;
    this.trainInboxes = new Map();
    this.actorInboxes = new Map();
    const sent: Sent[] = [];

    // Platform sensors broadcast once a second while they are switched on.
    if (this.switches.sensors && onSecond) {
      for (const platform of PLATFORMS) {
        sent.push({
          out: {
            msg: { type: 'platformStatus', platform, occupied: sensors.platformOccupied[platform], sentAt: now },
            range: 'short',
          },
          from: { kind: 'sensors' },
        });
      }
    }

    // Local actors run only while their own switch is on.
    for (const actor of this.actors) {
      if (!this.switches[actor.id]) continue;
      for (const out of actor.step(now, actorInbox.get(actor.id) ?? [], sensors)) {
        sent.push({ out, from: { kind: 'actor', id: actor.id } });
      }
    }

    // The control centre sees every train's true state, once a second, while it is on. Its
    // own train detection does not go through our platform sensors, so their switch does
    // not affect what it sees.
    if (this.centre && this.switches.centre && onSecond) {
      const states = this.active.map((rt) => rt.state);
      const trueSensors = readSensors(bodies, { ...this.switches, sensors: true });
      const routes = new Map(this.active.map((rt) => [rt.id, rt.nextTrack] as const));
      for (const msg of this.centre.step(now, states, trueSensors, routes)) {
        sent.push({ out: { msg, range: 'long' }, from: { kind: 'centre' } });
      }
    } else if (this.centre?.radioStep && onSecond) {
      // Radio working: staff move trains by radio while the centre is down.
      const states = this.active.map((rt) => rt.state);
      const trueSensors = readSensors(bodies, { ...this.switches, sensors: true });
      const routes = new Map(this.active.map((rt) => [rt.id, rt.nextTrack] as const));
      for (const msg of this.centre.radioStep(now, states, trueSensors, routes)) {
        sent.push({ out: { msg, range: 'long' }, from: { kind: 'radio' } });
      }
    }

    // Every agent decides from the state at the start of the tick, then all move together,
    // so the result does not depend on the order trains are listed in.
    for (const rt of this.active) this.observe(rt, trainInbox.get(rt.id) ?? [], now);
    const outputs = this.active.map((rt, i) =>
      rt.agent.decide({
        now,
        self: rt.state,
        inbox: trainInbox.get(rt.id) ?? [],
        sightAhead: sightAhead(bodies[i], rt.nextTrack, bodies),
      }),
    );
    outputs.forEach((o, i) => {
      for (const out of o.outbox) sent.push({ out, from: { kind: 'train', id: this.active[i].id } });
    });

    // One function decides who hears each message. Delivery is next tick.
    const positions = this.active.map((rt) => ({ id: rt.id, x: xOf(rt.state.pos) }));
    for (const { out, from } of sent) {
      for (const to of route(out, from, positions, this.switches, this.rng)) this.deliver(to, out.msg);
    }

    const exitTime = (this.tick + 1) * TICK;
    const stillActive: Runtime[] = [];
    this.active.forEach((rt, i) => {
      const o = outputs[i];
      // A broken-down train stays exactly where it is, whatever its agent asks for.
      const moved = rt.state.brokenDown
        ? { state: rt.state, exited: false, overrun: false }
        : advanceTrain(rt.state, o.accel, o.nextTrack);
      if (moved.state.pos.track !== rt.state.pos.track) rt.prev = rt.state.pos.track;
      if (moved.overrun) this.overruns += 1;
      rt.state = moved.state;
      rt.nextTrack = o.nextTrack;
      rt.mode = o.mode;
      rt.reason = displayReason(o);
      if (moved.exited) this.exits.set(rt.id, exitTime);
      else stillActive.push(rt);
    });
    this.active = stillActive;

    // Check the bodies where the trains now are, so a rear on the previous track counts.
    const after = checkSafety(
      this.active.map((rt) => ({ state: rt.state, prev: rt.prev })),
      this.safetyActive,
    );
    this.collisions += after.collisions;
    this.closeCalls += after.closeCalls;
    this.tick += 1;
  }

  snapshot(): Snapshot {
    return {
      now: this.now,
      switches: { ...this.switches },
      trains: this.active.map((rt) => ({
        id: rt.id,
        pos: { ...rt.state.pos },
        x: xOf(rt.state.pos),
        speed: rt.state.speed,
        mode: rt.mode,
        ...(rt.reason !== undefined ? { reason: rt.reason } : {}),
        ...(rt.state.brokenDown ? { brokenDown: true } : {}),
        leaderAge: rt.lastLeaderAt === null ? null : this.now - rt.lastLeaderAt,
        permitAge: rt.lastPermitAt === null ? null : this.now - rt.lastPermitAt,
        lastGrants: { ...rt.lastGrants },
      })),
    };
  }

  result(): RunResult {
    return {
      runLength: this.cfg.runLength,
      finished: this.finished,
      exits: new Map(this.exits),
      collisions: this.collisions,
      closeCalls: this.closeCalls,
      overruns: this.overruns,
    };
  }

  /** Notes what a train was just told, for the overlay. The engine decides nothing from this. */
  private observe(rt: Runtime, inbox: Message[], now: number): void {
    for (const m of inbox) {
      if (m.type === 'position' && rt.leaderId !== null && m.from === rt.leaderId) {
        rt.lastLeaderAt = now;
      } else if (m.type === 'permit') {
        rt.lastPermitAt = now;
      } else if (m.type === 'lockGrant') {
        if (m.resource === 'JUNCTION') {
          rt.lastGrants.junction = true;
          // On EXIT the junction keeper names the train ahead, or says there is none. That replaces
          // the entry-track leader from the timetable, which is no longer the train in front.
          rt.leaderId = m.follow;
          rt.lastLeaderAt = null;
        } else {
          rt.lastGrants.platform = m.resource;
        }
      }
    }
  }

  private deliver(to: Recipient, msg: Message): void {
    if (to.kind === 'train') {
      const queue = this.trainInboxes.get(to.id) ?? [];
      queue.push(msg);
      this.trainInboxes.set(to.id, queue);
    } else {
      const queue = this.actorInboxes.get(to.id) ?? [];
      queue.push(msg);
      this.actorInboxes.set(to.id, queue);
    }
  }

  /** Applies scripted presses whose time has come, in time order. */
  private applyScriptedPresses(): void {
    while (this.scriptedPresses.length > 0 && this.scriptedPresses[0].at <= this.now + 1e-9) {
      const press = this.scriptedPresses.shift()!;
      Object.assign(this.switches, press.set);
      if (press.breakDown !== undefined) this.breakDown(press.breakDown);
    }
  }

  /** Spawns due trains in timetable order, keeping each entry track first in, first out. */
  private spawnDueTrains(): void {
    const blocked = new Set<TrackId>();
    const stillPending: TimetableEntry[] = [];
    for (const entry of this.pending) {
      const due = entry.enterAt <= this.now + 1e-9;
      if (!due || blocked.has(entry.entry) || !this.entryClear(entry.entry)) {
        if (due) blocked.add(entry.entry);
        stillPending.push(entry);
        continue;
      }
      this.active.push({
        id: entry.id,
        agent: this.cfg.program.agentFactory(entry.id, this.cfg.timetable),
        state: { id: entry.id, pos: { track: entry.entry, offset: 0 }, speed: SIGHT_SPEED, brokenDown: false },
        prev: null,
        nextTrack: null,
        mode: 'blind',
        leaderId: entry.leader,
        lastLeaderAt: null,
        lastPermitAt: null,
        lastGrants: { platform: null, junction: false },
      });
    }
    this.pending.length = 0;
    this.pending.push(...stillPending);
  }

  /**
   * A new train waits until the first SENSOR_RANGE metres of its entry track are clear, and it
   * enters at SIGHT_SPEED, the one speed that can always stop within what its own sensor sees
   * (issue #33). Entering faster could put a train behind a stopped one it cannot see in time.
   */
  private entryClear(track: TrackId): boolean {
    const clear = SENSOR_RANGE + TRAIN_LENGTH;
    return !this.active.some((rt) => rt.state.pos.track === track && rt.state.pos.offset < clear);
  }
}
